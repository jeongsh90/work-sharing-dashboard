import { all, get, run, transaction } from './db.ts'
import { findUser, isManager, listUsers, type PublicUser } from './users.ts'

// 디자인 요청의 진행 흐름(상태 기계).
// 요청됨 → (담당 지정) 작업 대기 → (작업 시작) 작업 중 → (컨펌 요청) 시안 확인
//   → 반려: 수정 중 → (컨펌 요청) 시안 확인 … → 컨펌: 컨펌 완료 → (작업 완료) 완료
// 보완 요청(보완 필요)과 취소는 중간에 언제든 들어올 수 있다.
// 누가 어떤 동작을 할 수 있는지는 여기서만 정한다. 화면은 상세 응답의 actions 로 버튼을 그린다.

export const STATUSES = [
  'requested',
  'needs-info',
  'waiting',
  'in-progress',
  'review',
  'revising',
  'approved',
  'done',
  'canceled',
] as const
export type Status = (typeof STATUSES)[number]

const ACTIVE: Status[] = ['requested', 'needs-info', 'waiting', 'in-progress', 'review', 'revising', 'approved']

export const URGENCIES = ['normal', 'urgent', 'critical'] as const

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type RequestRow = {
  id: number
  title: string
  work_type: string
  description: string
  department: string
  requester_id: string
  urgency: string
  status: Status
  revision: number
  due_at: number
  created_at: number
  updated_at: number
  started_at: number | null
  approved_at: number | null
  completed_at: number | null
}

type FileRow = {
  id: string
  request_id: number | null
  submission_id: number | null
  kind: string | null
  uploader_id: string
  name: string
  mime: string
  size: number
  created_at: number
}

const code = (id: number) => `REQ-${String(id).padStart(4, '0')}`

function loadRequest(id: number) {
  const row = get<RequestRow>('SELECT * FROM requests WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '요청을 찾을 수 없습니다.')
  return row
}

function assigneesOf(id: number) {
  return all<{ user_id: string }>('SELECT user_id FROM assignees WHERE request_id = :id ORDER BY ord', { id }).map(
    (a) => a.user_id,
  )
}

// ── 권한 ──────────────────────────────────────────────

export type Action =
  | 'edit'
  | 'assign'
  | 'take'
  | 'request-info'
  | 'resubmit'
  | 'start'
  | 'submit'
  | 'reject'
  | 'approve'
  | 'complete'
  | 'cancel'
  | 'pin'
  | 'comment'
  | 'resolve'

function availableActions(user: PublicUser, req: RequestRow, assignees: string[]): Action[] {
  const owner = req.requester_id === user.id
  const assignee = assignees.includes(user.id)
  const manager = isManager(user)
  const designer = user.role === 'designer'
  const active = ACTIVE.includes(req.status)
  const s = req.status
  const can: Record<Action, boolean> = {
    edit: active && ((owner && (s === 'requested' || s === 'needs-info')) || manager),
    assign: active && manager,
    take: designer && !assignee && (s === 'requested' || s === 'needs-info' || s === 'waiting'),
    'request-info': (manager || designer) && (s === 'requested' || s === 'waiting'),
    resubmit: (owner || manager) && s === 'needs-info',
    start: (assignee || manager) && s === 'waiting' && assignees.length > 0,
    submit: (assignee || manager) && (s === 'in-progress' || s === 'revising'),
    reject: (owner || manager) && s === 'review',
    approve: (owner || manager) && s === 'review',
    complete: (assignee || manager) && s === 'approved',
    cancel: active && (owner || manager),
    // 핀은 시안 확인 중일 때 최신 시안에만 꽂는다. 핀 댓글·일반 댓글은 관계자 누구나
    pin: s === 'review' && (owner || manager || assignee || designer),
    comment: s !== 'canceled' && (owner || manager || assignee || designer),
    resolve: assignee || manager,
  }
  return (Object.keys(can) as Action[]).filter((a) => can[a])
}

function requireAction(user: PublicUser, req: RequestRow, action: Action) {
  if (!availableActions(user, req, assigneesOf(req.id)).includes(action)) {
    throw new HttpError(403, '지금 상태에서 할 수 없는 동작입니다. 화면을 새로 고쳐 주세요.')
  }
}

// ── 기록·알림 ─────────────────────────────────────────

function logEvent(requestId: number, actor: string, type: string, from: Status | null, to: Status | null, note = '') {
  run(
    `INSERT INTO events (request_id, actor_id, type, from_status, to_status, note, created_at)
     VALUES (:requestId, :actor, :type, :from, :to, :note, :now)`,
    { requestId, actor, type, from, to, note, now: Date.now() },
  )
}

function notify(userIds: Iterable<string>, actor: string, requestId: number, message: string) {
  const now = Date.now()
  for (const userId of new Set(userIds)) {
    if (userId === actor) continue
    run('INSERT INTO notifications (user_id, request_id, message, created_at) VALUES (:userId, :requestId, :message, :now)', {
      userId,
      requestId,
      message,
      now,
    })
  }
}

function managersAndDesigners() {
  return listUsers()
    .filter((u) => u.active && (isManager(u) || u.role === 'designer'))
    .map((u) => u.id)
}

function setStatus(req: RequestRow, to: Status, extra: Record<string, unknown> = {}) {
  const sets = ['status = :to', 'updated_at = :now', ...Object.keys(extra).map((k) => `${k} = :${k}`)]
  run(`UPDATE requests SET ${sets.join(', ')} WHERE id = :id`, { id: req.id, to, now: Date.now(), ...extra })
}

// ── 입력 검사 ─────────────────────────────────────────

function text(value: unknown, label: string, { required = false, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (required && !v) throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  if (v.length > max) throw new HttpError(400, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
  return v
}

function timestamp(value: unknown, label: string) {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  return n
}

function urgency(value: unknown) {
  return URGENCIES.includes(value as never) ? (value as string) : 'normal'
}

// 올린 사람 본인의, 아직 어디에도 붙지 않은 파일만 붙일 수 있다.
function claimFiles(
  user: PublicUser,
  ids: unknown,
  target: { requestId: number; submissionId?: number; kind: string },
  { imagesOnly = false } = {},
) {
  const list = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : []
  for (const id of list) {
    const file = get<FileRow>('SELECT * FROM files WHERE id = :id', { id })
    if (!file || file.uploader_id !== user.id || file.request_id !== null) {
      throw new HttpError(400, '첨부 파일을 찾을 수 없습니다. 다시 올려 주세요.')
    }
    if (imagesOnly && !file.mime.startsWith('image/')) {
      throw new HttpError(400, `시안은 이미지 파일만 올릴 수 있습니다: ${file.name}`)
    }
    run('UPDATE files SET request_id = :r, submission_id = :s, kind = :k WHERE id = :id', {
      id,
      r: target.requestId,
      s: target.submissionId ?? null,
      k: target.kind,
    })
  }
  return list.length
}

// ── 조회 ──────────────────────────────────────────────

function summary(row: RequestRow & { requester_name: string }) {
  return {
    id: row.id,
    code: code(row.id),
    title: row.title,
    workType: row.work_type,
    department: row.department,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    designers: assigneesOf(row.id),
    urgency: row.urgency,
    status: row.status,
    revision: row.revision,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
  }
}

const SUMMARY_SQL = `SELECT r.*, COALESCE(u.name, r.requester_id) AS requester_name
  FROM requests r LEFT JOIN users u ON u.id = r.requester_id`

export function listRequests() {
  return all<RequestRow & { requester_name: string }>(`${SUMMARY_SQL} ORDER BY r.id DESC`).map(summary)
}

const fileInfo = (f: FileRow) => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
  kind: f.kind,
  uploaderId: f.uploader_id,
  createdAt: f.created_at,
})

export function requestDetail(user: PublicUser, id: number) {
  const row = get<RequestRow & { requester_name: string }>(`${SUMMARY_SQL} WHERE r.id = :id`, { id })
  if (!row) throw new HttpError(404, '요청을 찾을 수 없습니다.')
  const files = all<FileRow>('SELECT * FROM files WHERE request_id = :id ORDER BY created_at', { id })
  const comments = all<{ id: number; pin_id: number | null; author_id: string; body: string; created_at: number }>(
    'SELECT * FROM comments WHERE request_id = :id ORDER BY created_at, id',
    { id },
  ).map((c) => ({ id: c.id, pinId: c.pin_id, authorId: c.author_id, body: c.body, createdAt: c.created_at }))
  const pins = all<{
    id: number
    file_id: string
    x: number
    y: number
    author_id: string
    created_at: number
    resolved_at: number | null
    resolved_by: string | null
  }>('SELECT * FROM pins WHERE request_id = :id ORDER BY created_at, id', { id }).map((p) => ({
    id: p.id,
    fileId: p.file_id,
    x: p.x,
    y: p.y,
    authorId: p.author_id,
    createdAt: p.created_at,
    resolvedAt: p.resolved_at,
    resolvedBy: p.resolved_by,
    comments: comments.filter((c) => c.pinId === p.id),
  }))
  const submissions = all<{
    id: number
    round: number
    author_id: string
    note: string
    created_at: number
    decision: string | null
    decided_by: string | null
    decided_at: number | null
    decision_note: string
  }>('SELECT * FROM submissions WHERE request_id = :id ORDER BY round', { id }).map((s) => ({
    id: s.id,
    round: s.round,
    authorId: s.author_id,
    note: s.note,
    createdAt: s.created_at,
    decision: s.decision,
    decidedBy: s.decided_by,
    decidedAt: s.decided_at,
    decisionNote: s.decision_note,
    files: files.filter((f) => f.submission_id === s.id).map(fileInfo),
  }))
  const events = all<{
    id: number
    actor_id: string
    type: string
    from_status: string | null
    to_status: string | null
    note: string
    created_at: number
  }>('SELECT * FROM events WHERE request_id = :id ORDER BY created_at, id', { id }).map((e) => ({
    id: e.id,
    actorId: e.actor_id,
    type: e.type,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    note: e.note,
    createdAt: e.created_at,
  }))
  return {
    ...summary(row),
    description: row.description,
    references: files.filter((f) => f.kind === 'reference').map(fileInfo),
    finals: files.filter((f) => f.kind === 'final').map(fileInfo),
    submissions,
    pins,
    comments: comments.filter((c) => c.pinId === null),
    events,
    actions: availableActions(user, row, assigneesOf(id)),
  }
}

// 최종 파일 보관함: 완료된 요청과 최종 파일·컨펌된 시안
export function archive() {
  const done = all<RequestRow & { requester_name: string }>(
    `${SUMMARY_SQL} WHERE r.status = 'done' ORDER BY r.completed_at DESC`,
  )
  return done.map((row) => {
    const approved = get<{ id: number }>(
      `SELECT id FROM submissions WHERE request_id = :id AND decision = 'approved' ORDER BY round DESC LIMIT 1`,
      { id: row.id },
    )
    const files = all<FileRow>(
      `SELECT * FROM files WHERE request_id = :id AND (kind = 'final' OR submission_id = :sid) ORDER BY kind DESC, created_at`,
      { id: row.id, sid: approved?.id ?? -1 },
    )
    return { ...summary(row), files: files.map(fileInfo) }
  })
}

// ── 요청 만들기·고치기 ─────────────────────────────────

export function createRequest(user: PublicUser, body: Record<string, unknown>) {
  const title = text(body.title, '제목', { required: true, max: 100 })
  const workType = text(body.workType, '작업 종류', { required: true, max: 40 })
  const description = text(body.description, '요청 내용', { required: true, max: 5000 })
  const department = text(body.department, '부서', { max: 40 }) || user.department
  const dueAt = timestamp(body.dueAt, '마감 일시')
  const now = Date.now()
  return transaction(() => {
    const result = run(
      `INSERT INTO requests (title, work_type, description, department, requester_id, urgency, status, due_at, created_at, updated_at)
       VALUES (:title, :workType, :description, :department, :requester, :urgency, 'requested', :dueAt, :now, :now)`,
      { title, workType, description, department, requester: user.id, urgency: urgency(body.urgency), dueAt, now },
    )
    const id = Number(result.lastInsertRowid)
    claimFiles(user, body.fileIds, { requestId: id, kind: 'reference' })
    logEvent(id, user.id, 'create', null, 'requested')
    notify(managersAndDesigners(), user.id, id, `새 디자인 요청: ${title}`)
    return id
  })
}

export function updateRequest(user: PublicUser, id: number, body: Record<string, unknown>) {
  const req = loadRequest(id)
  requireAction(user, req, 'edit')
  transaction(() => {
    run(
      `UPDATE requests SET title = :title, work_type = :workType, description = :description, department = :department,
       urgency = :urgency, due_at = :dueAt, updated_at = :now WHERE id = :id`,
      {
        id,
        title: text(body.title, '제목', { required: true, max: 100 }),
        workType: text(body.workType, '작업 종류', { required: true, max: 40 }),
        description: text(body.description, '요청 내용', { required: true, max: 5000 }),
        department: text(body.department, '부서', { max: 40 }),
        urgency: urgency(body.urgency),
        dueAt: timestamp(body.dueAt, '마감 일시'),
        now: Date.now(),
      },
    )
    // 참고 자료: 빠진 파일은 지우고 새로 올린 파일은 붙인다.
    if (Array.isArray(body.keepFileIds)) {
      const keep = new Set(body.keepFileIds)
      for (const f of all<FileRow>(`SELECT * FROM files WHERE request_id = :id AND kind = 'reference'`, { id })) {
        if (!keep.has(f.id)) run('DELETE FROM files WHERE id = :fid', { fid: f.id })
      }
    }
    claimFiles(user, body.fileIds, { requestId: id, kind: 'reference' })
    logEvent(id, user.id, 'edit', null, null)
    notify(assigneesOf(id), user.id, id, `요청 내용이 수정되었습니다: ${req.title}`)
  })
}

// ── 진행 동작 ─────────────────────────────────────────

export function performAction(user: PublicUser, id: number, action: Action, body: Record<string, unknown>) {
  const req = loadRequest(id)
  requireAction(user, req, action)
  const note = text(body.note, '메모', { max: 2000 })
  const assignees = assigneesOf(id)
  const everyone = [req.requester_id, ...assignees]

  transaction(() => {
    switch (action) {
      case 'assign':
      case 'take': {
        let ids: string[]
        if (action === 'take') {
          ids = [...assignees, user.id]
        } else {
          ids = Array.isArray(body.designerIds) ? body.designerIds.filter((v): v is string => typeof v === 'string') : []
          if (ids.length === 0) throw new HttpError(400, '담당 작업자를 한 명 이상 골라 주세요.')
          for (const uid of ids) {
            const u = findUser(uid)
            if (!u || !u.active || !(u.role === 'designer' || isManager(u))) {
              throw new HttpError(400, '담당으로 지정할 수 없는 사용자가 있습니다.')
            }
          }
        }
        run('DELETE FROM assignees WHERE request_id = :id', { id })
        ids.forEach((uid, ord) => run('INSERT INTO assignees (request_id, user_id, ord) VALUES (:id, :uid, :ord)', { id, uid, ord }))
        const to: Status = req.status === 'requested' ? 'waiting' : req.status
        if (to !== req.status) setStatus(req, to)
        else run('UPDATE requests SET updated_at = :now WHERE id = :id', { id, now: Date.now() })
        const names = ids.map((uid) => findUser(uid)?.name ?? uid).join(', ')
        logEvent(id, user.id, action, req.status, to, `담당: ${names}`)
        notify(
          ids.filter((uid) => !assignees.includes(uid)),
          user.id,
          id,
          `담당으로 지정되었습니다: ${req.title}`,
        )
        notify([req.requester_id], user.id, id, `담당 작업자가 정해졌습니다(${names}): ${req.title}`)
        return
      }
      case 'request-info': {
        if (!note) throw new HttpError(400, '무엇을 보완해야 하는지 적어 주세요.')
        setStatus(req, 'needs-info')
        logEvent(id, user.id, action, req.status, 'needs-info', note)
        notify([req.requester_id], user.id, id, `요청 보완이 필요합니다: ${req.title}`)
        return
      }
      case 'resubmit': {
        const to: Status = assignees.length > 0 ? 'waiting' : 'requested'
        setStatus(req, to)
        logEvent(id, user.id, action, req.status, to, note)
        notify(assignees.length > 0 ? assignees : managersAndDesigners(), user.id, id, `요청이 보완되었습니다: ${req.title}`)
        return
      }
      case 'start': {
        setStatus(req, 'in-progress', { started_at: req.started_at ?? Date.now() })
        logEvent(id, user.id, action, req.status, 'in-progress', note)
        notify([req.requester_id], user.id, id, `작업을 시작했습니다: ${req.title}`)
        return
      }
      case 'submit': {
        const last = get<{ round: number }>('SELECT MAX(round) AS round FROM submissions WHERE request_id = :id', { id })
        const round = (last?.round ?? 0) + 1
        const result = run(
          `INSERT INTO submissions (request_id, round, author_id, note, created_at) VALUES (:id, :round, :author, :note, :now)`,
          { id, round, author: user.id, note, now: Date.now() },
        )
        const submissionId = Number(result.lastInsertRowid)
        const count = claimFiles(user, body.fileIds, { requestId: id, submissionId, kind: 'deliverable' }, { imagesOnly: true })
        if (count === 0) throw new HttpError(400, '시안 이미지를 한 개 이상 올려 주세요.')
        setStatus(req, 'review')
        logEvent(id, user.id, action, req.status, 'review', note ? `${round}차 시안 · ${note}` : `${round}차 시안`)
        notify([req.requester_id], user.id, id, `${round}차 시안 컨펌 요청이 왔습니다: ${req.title}`)
        return
      }
      case 'reject':
      case 'approve': {
        const latest = get<{ id: number; round: number }>(
          'SELECT id, round FROM submissions WHERE request_id = :id ORDER BY round DESC LIMIT 1',
          { id },
        )
        if (!latest) throw new HttpError(400, '확인할 시안이 없습니다.')
        if (action === 'reject') {
          const pinCount = get<{ n: number }>(
            'SELECT COUNT(*) AS n FROM pins p JOIN files f ON f.id = p.file_id WHERE f.submission_id = :sid',
            { sid: latest.id },
          )!.n
          if (!note && pinCount === 0) throw new HttpError(400, '반려 사유를 적거나 이미지에 핀으로 수정 사항을 남겨 주세요.')
        }
        const decision = action === 'reject' ? 'rejected' : 'approved'
        run(
          'UPDATE submissions SET decision = :decision, decided_by = :by, decided_at = :now, decision_note = :note WHERE id = :sid',
          { sid: latest.id, decision, by: user.id, now: Date.now(), note },
        )
        if (action === 'reject') {
          setStatus(req, 'revising', { revision: req.revision + 1 })
          logEvent(id, user.id, action, req.status, 'revising', note ? `${latest.round}차 시안 반려 · ${note}` : `${latest.round}차 시안 반려`)
          notify(assignees, user.id, id, `${latest.round}차 시안이 반려되었습니다: ${req.title}`)
        } else {
          setStatus(req, 'approved', { approved_at: Date.now() })
          logEvent(id, user.id, action, req.status, 'approved', note ? `${latest.round}차 시안 컨펌 · ${note}` : `${latest.round}차 시안 컨펌`)
          notify(assignees, user.id, id, `${latest.round}차 시안이 컨펌되었습니다: ${req.title}`)
        }
        return
      }
      case 'complete': {
        claimFiles(user, body.fileIds, { requestId: id, kind: 'final' })
        setStatus(req, 'done', { completed_at: Date.now() })
        logEvent(id, user.id, action, req.status, 'done', note)
        notify([req.requester_id], user.id, id, `작업이 완료되었습니다: ${req.title}`)
        return
      }
      case 'cancel': {
        setStatus(req, 'canceled')
        logEvent(id, user.id, action, req.status, 'canceled', note)
        notify(everyone, user.id, id, `요청이 취소되었습니다: ${req.title}`)
        return
      }
      default:
        throw new HttpError(400, '알 수 없는 동작입니다.')
    }
  })
}

// ── 핀·댓글 ───────────────────────────────────────────

export function addPin(user: PublicUser, fileId: string, body: Record<string, unknown>) {
  const file = get<FileRow>('SELECT * FROM files WHERE id = :id', { id: fileId })
  if (!file || file.request_id === null || file.submission_id === null) throw new HttpError(404, '시안을 찾을 수 없습니다.')
  const req = loadRequest(file.request_id)
  requireAction(user, req, 'pin')
  const latest = get<{ id: number }>('SELECT id FROM submissions WHERE request_id = :id ORDER BY round DESC LIMIT 1', {
    id: req.id,
  })
  if (latest?.id !== file.submission_id) throw new HttpError(400, '핀은 최신 시안에만 꽂을 수 있습니다.')
  const x = Number(body.x)
  const y = Number(body.y)
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new HttpError(400, '핀 위치가 올바르지 않습니다.')
  const comment = text(body.body, '수정 내용', { required: true, max: 2000 })
  return transaction(() => {
    const now = Date.now()
    const pinId = Number(
      run(
        'INSERT INTO pins (request_id, file_id, x, y, author_id, created_at) VALUES (:r, :f, :x, :y, :a, :now)',
        { r: req.id, f: fileId, x, y, a: user.id, now },
      ).lastInsertRowid,
    )
    run('INSERT INTO comments (request_id, pin_id, author_id, body, created_at) VALUES (:r, :p, :a, :b, :now)', {
      r: req.id,
      p: pinId,
      a: user.id,
      b: comment,
      now,
    })
    notify([req.requester_id, ...assigneesOf(req.id)], user.id, req.id, `시안에 핀 댓글이 달렸습니다: ${req.title}`)
    return pinId
  })
}

function loadPin(pinId: number) {
  const pin = get<{ id: number; request_id: number; author_id: string }>('SELECT * FROM pins WHERE id = :id', { id: pinId })
  if (!pin) throw new HttpError(404, '핀을 찾을 수 없습니다.')
  return pin
}

export function addComment(user: PublicUser, requestId: number, pinId: number | null, body: Record<string, unknown>) {
  const req = loadRequest(requestId)
  requireAction(user, req, 'comment')
  const comment = text(body.body, '댓글', { required: true, max: 2000 })
  run('INSERT INTO comments (request_id, pin_id, author_id, body, created_at) VALUES (:r, :p, :a, :b, :now)', {
    r: requestId,
    p: pinId,
    a: user.id,
    b: comment,
    now: Date.now(),
  })
  const pinAuthor = pinId ? [loadPin(pinId).author_id] : []
  notify([req.requester_id, ...assigneesOf(requestId), ...pinAuthor], user.id, requestId, `새 댓글: ${req.title}`)
}

export function addPinComment(user: PublicUser, pinId: number, body: Record<string, unknown>) {
  const pin = loadPin(pinId)
  addComment(user, pin.request_id, pinId, body)
}

export function resolvePin(user: PublicUser, pinId: number, resolved: boolean) {
  const pin = loadPin(pinId)
  const req = loadRequest(pin.request_id)
  // 핀을 단 사람도 직접 해결 처리할 수 있다.
  if (pin.author_id !== user.id) requireAction(user, req, 'resolve')
  run('UPDATE pins SET resolved_at = :at, resolved_by = :by WHERE id = :id', {
    id: pinId,
    at: resolved ? Date.now() : null,
    by: resolved ? user.id : null,
  })
}

// ── 파일 ──────────────────────────────────────────────

export function findFile(id: string) {
  return get<FileRow>('SELECT * FROM files WHERE id = :id', { id })
}

export function insertFile(file: { id: string; uploaderId: string; name: string; mime: string; size: number }) {
  run(
    'INSERT INTO files (id, uploader_id, name, mime, size, created_at) VALUES (:id, :uploaderId, :name, :mime, :size, :now)',
    { ...file, now: Date.now() },
  )
}

// ── 알림 ──────────────────────────────────────────────

export function listNotifications(userId: string) {
  return all<{ id: number; request_id: number | null; message: string; created_at: number; read_at: number | null }>(
    'SELECT * FROM notifications WHERE user_id = :userId ORDER BY id DESC LIMIT 100',
    { userId },
  ).map((n) => ({ id: n.id, requestId: n.request_id, message: n.message, createdAt: n.created_at, read: n.read_at !== null }))
}

export function markNotificationsRead(userId: string) {
  run('UPDATE notifications SET read_at = :now WHERE user_id = :userId AND read_at IS NULL', { userId, now: Date.now() })
}
