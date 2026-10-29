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
  'approved', // 예전 흐름의 컨펌 완료(작업 완료 처리 전). 새 요청은 컨펌하면 바로 source-pending
  'source-pending', // 완료(원본 대기): 컨펌으로 작업은 끝났고, 작업자가 원본 파일을 올리기를 기다린다
  'done',
  'canceled',
] as const
export type Status = (typeof STATUSES)[number]

const ACTIVE: Status[] = ['requested', 'needs-info', 'waiting', 'in-progress', 'review', 'revising', 'approved']

export const URGENCIES = ['normal', 'urgent', 'critical'] as const
// 대신 작성한 요청을 받은 경로
export const SOURCES = ['구두', '전화', '메신저', '메일', '기타'] as const

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
  requested_start_at: number | null
  ongoing: number
  on_hold: number
  due_at: number
  created_at: number
  updated_at: number
  started_at: number | null
  approved_at: number | null
  completed_at: number | null
  source: string
  created_by: string | null
  requester_label: string
  original_kind: string
  original_link: string
  original_tool: string
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

export const code = (id: number) => `REQ-${String(id).padStart(4, '0')}`

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
  | 'reassign'
  | 'take'
  | 'request-info'
  | 'resubmit'
  | 'start'
  | 'submit'
  | 'reject'
  | 'approve'
  | 'complete'
  | 'upload-source'
  | 'cancel'
  | 'pin'
  | 'comment'
  | 'resolve'
  | 'undo'
  | 'ask-requester'

// 작업 취소(되돌리기) 대상: 아직 되돌리지 않은 마지막 상태 변경. 지금 상태로 바꾼 기록이어야 한다.
type UndoTarget = { id: number; type: string; actor_id: string; from_status: Status; to_status: Status }
const UNDO_LABEL: Record<string, string> = {
  assign: '작업자 지정',
  reassign: '작업자 변경',
  take: '담당 맡음',
  'request-info': '보완 요청',
  resubmit: '보완 완료',
  start: '작업 시작',
  submit: '컨펌 요청',
  reject: '반려',
  approve: '컨펌',
  complete: '작업 완료',
  'upload-source': '원본 업로드',
  cancel: '요청 취소',
}
function undoTarget(req: RequestRow) {
  const ev = get<UndoTarget>(
    `SELECT id, type, actor_id, from_status, to_status FROM events
     WHERE request_id = :id AND undone = 0 AND type != 'undo' AND type != 'create'
       AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status != to_status
     ORDER BY id DESC LIMIT 1`,
    { id: req.id },
  )
  return ev && ev.to_status === req.status && UNDO_LABEL[ev.type] ? ev : null
}

// 상세 화면에 보낼 되돌리기 정보(버튼 확인 창 문구용)
export function undoInfo(req: RequestRow) {
  const t = undoTarget(req)
  return t ? { label: UNDO_LABEL[t.type], to: t.from_status } : null
}

// 슈퍼관리자·본부장(직급·직책에 '본부장')은 요청 상태와 상관없이 요청 내용을 고칠 수 있다(완료된 요청 포함).
export function canEditAnytime(user: PublicUser) {
  return user.role === 'superadmin' || /본부장/.test(`${user.rank} ${user.position}`)
}

function availableActions(user: PublicUser, req: RequestRow, assignees: string[]): Action[] {
  const owner = req.requester_id === user.id
  const assignee = assignees.includes(user.id)
  const manager = isManager(user)
  const designer = user.role === 'designer'
  const active = ACTIVE.includes(req.status)
  const s = req.status
  const can: Record<Action, boolean> = {
    edit:
      (active && ((owner && (s === 'requested' || s === 'needs-info')) || manager || (!!req.created_by && req.created_by === user.id))) ||
      canEditAnytime(user),
    // 작업자 지정은 처음 한 번(아직 담당이 없을 때). 그 뒤에는 작업자 변경으로 넘긴다.
    assign: active && manager && assignees.length === 0,
    reassign:
      manager && assignees.length > 0 && ['needs-info', 'waiting', 'in-progress', 'review', 'revising'].includes(s),
    take: designer && !assignee && (s === 'requested' || s === 'needs-info' || s === 'waiting'),
    'request-info': (manager || designer) && (s === 'requested' || s === 'waiting'),
    resubmit: (owner || manager) && s === 'needs-info',
    start: (assignee || manager) && s === 'waiting' && assignees.length > 0,
    submit: (assignee || manager) && (s === 'in-progress' || s === 'revising'),
    reject: (owner || manager) && s === 'review',
    approve: (owner || manager) && s === 'review',
    complete: (assignee || manager) && s === 'approved',
    'upload-source': (assignee || manager) && s === 'source-pending',
    cancel: active && (owner || manager),
    // 핀은 시안 확인 중일 때 최신 시안에만 꽂는다. 핀 댓글·일반 댓글은 관계자 누구나
    pin: s === 'review' && (owner || manager || assignee || designer),
    comment: s !== 'canceled' && (owner || manager || assignee || designer),
    resolve: assignee || manager,
    // 요청자 확인 필요: 상태는 그대로 두고 요청자에게 확인해 달라는 알림만 보낸다(담당 작업자·관리자)
    'ask-requester': active && !owner && (assignee || manager),
    // 작업 취소: 마지막 단계를 되돌린다. 관리자 또는 그 단계를 한 사람만
    undo: (() => {
      const t = undoTarget(req)
      return !!t && (manager || t.actor_id === user.id)
    })(),
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

// 요청 내용 묶음: 사이즈(제목·너비·높이) + 요청 내용. 모두 빈 묶음은 건너뛰고, 한 개 이상 있어야 한다.
// 너비·높이는 비워 두면 자유(정해지지 않음)
type Item = { label: string; width: number | null; height: number | null; body: string }

function items(value: unknown) {
  const rows = Array.isArray(value) ? value : []
  const result: Item[] = []
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim())
  for (const raw of rows.slice(0, 30)) {
    const r = (raw ?? {}) as Record<string, unknown>
    if (empty(r.label) && empty(r.width) && empty(r.height) && empty(r.body)) continue
    const n = result.length + 1
    const label = text(r.label, `${n}번 내용의 제목`, { required: true, max: 60 })
    const body = text(r.body, `${n}번 요청 내용`, { required: true, max: 5000 })
    const width = empty(r.width) ? null : Number(r.width)
    const height = empty(r.height) ? null : Number(r.height)
    const ok = (v: number) => Number.isInteger(v) && v > 0 && v <= 100_000
    if (width !== null && !ok(width)) throw new HttpError(400, `${n}번 내용의 너비를 숫자로 입력해 주세요.`)
    if (height !== null && !ok(height)) throw new HttpError(400, `${n}번 내용의 높이를 숫자로 입력해 주세요.`)
    result.push({ label, width, height, body })
  }
  if (result.length === 0) throw new HttpError(400, '요청 내용을 한 개 이상 입력해 주세요.')
  return result
}

function saveItems(requestId: number, list: Item[]) {
  run('DELETE FROM request_items WHERE request_id = :requestId', { requestId })
  list.forEach((item, ord) =>
    run(
      'INSERT INTO request_items (request_id, ord, label, width, height, body) VALUES (:requestId, :ord, :label, :width, :height, :body)',
      { requestId, ord, ...item },
    ),
  )
}

// requests.description 에는 묶음을 글로 이어 붙여 둔다(검색·예전 화면용).
const describe = (list: Item[]) =>
  list.map((i) => `[${i.label} ${i.width ?? '자유'}×${i.height ?? '자유'}]\n${i.body}`).join('\n\n')

// 작업 기간: 시작일(선택)과 마감 일시. 시작일이 마감보다 늦으면 안 된다.
// 계속 업무(마감 없음)의 due_at. 마감 정렬에서 맨 뒤로 가고, 마감 지남·이번 주 마감에 걸리지 않는다.
export const ONGOING_DUE = Date.UTC(9999, 11, 31)

function period(body: Record<string, unknown>) {
  if (body.ongoing === true) {
    // 계속 업무는 시작일만 있다.
    return { startAt: timestamp(body.requestedStartAt, '시작일'), dueAt: ONGOING_DUE, ongoing: 1 }
  }
  const dueAt = timestamp(body.dueAt, '마감 일시')
  const startAt = body.requestedStartAt === undefined || body.requestedStartAt === null ? null : timestamp(body.requestedStartAt, '시작일')
  if (startAt !== null && startAt > dueAt) throw new HttpError(400, '시작일이 마감 일시보다 늦습니다.')
  return { startAt, dueAt, ongoing: 0 }
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

export const ORIGINAL_KINDS = ['file', 'figma', 'tool', 'link'] as const
type OriginalKind = (typeof ORIGINAL_KINDS)[number]
const ORIGINAL_LABEL: Record<OriginalKind, string> = { file: '파일', figma: 'Figma 로 작업', tool: '디자인 툴로 제작', link: '링크' }
const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function summary(row: RequestRow & { requester_name: string }) {
  return {
    id: row.id,
    code: code(row.id),
    title: row.title,
    workType: row.work_type,
    department: row.department,
    requesterId: row.requester_id,
    // 계정이 없는 요청자는 적어 둔 이름으로 보인다
    requesterName: row.requester_label || row.requester_name,
    source: row.source,
    createdBy: row.created_by,
    // 작업 원본 형태(원본 업로드 때 고른다): 파일이 없는 작업(Figma·디자인 툴)도 어디서 만들었는지 남긴다
    originalKind: row.original_kind,
    originalLink: row.original_link,
    originalTool: row.original_tool,
    designers: assigneesOf(row.id),
    urgency: row.urgency,
    status: row.status,
    revision: row.revision,
    requestedStartAt: row.requested_start_at,
    ongoing: row.ongoing === 1,
    onHold: row.on_hold === 1,
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
    items: all<{ label: string; width: number | null; height: number | null; body: string }>(
      'SELECT label, width, height, body FROM request_items WHERE request_id = :id ORDER BY ord',
      { id },
    ),
    references: files.filter((f) => f.kind === 'reference').map(fileInfo),
    finals: files.filter((f) => f.kind === 'final').map(fileInfo),
    submissions,
    pins,
    comments: comments.filter((c) => c.pinId === null),
    events,
    actions: availableActions(user, row, assigneesOf(id)),
    undo: undoInfo(row),
  }
}

// 최종 파일 보관함: 완료된 요청과 최종 파일·컨펌된 시안
export function archive() {
  const done = all<RequestRow & { requester_name: string }>(
    `${SUMMARY_SQL} WHERE r.status IN ('done', 'source-pending') ORDER BY r.completed_at DESC`,
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

// 대신 작성(작업자·관리자): body.proxy = { requesterId | requesterName, source }.
// 요청자는 계정을 고르거나(그 사람의 요청으로 들어가 내 요청·컨펌을 그 사람이 한다), 계정이 없으면 이름만 적는다.
// 작업자는 요청을 직접 보내지 않으므로 늘 대신 작성이다. takeSelf 면 쓴 사람이 바로 담당을 맡는다(작업 대기).
function proxyOf(user: PublicUser, body: Record<string, unknown>) {
  const raw = body.proxy && typeof body.proxy === 'object' ? (body.proxy as Record<string, unknown>) : null
  const canProxy = user.role === 'designer' || isManager(user)
  if (!raw) {
    if (user.role === 'designer') throw new HttpError(400, '요청한 사람을 골라 주세요.')
    return null
  }
  if (!canProxy) throw new HttpError(403, '대신 작성은 작업자·관리자만 할 수 있습니다.')
  const source = SOURCES.includes(raw.source as never) ? (raw.source as string) : '구두'
  if (typeof raw.requesterId === 'string' && raw.requesterId) {
    const target = findUser(raw.requesterId)
    if (!target || !target.active || !target.approved) throw new HttpError(400, '요청한 사람의 계정을 찾을 수 없습니다.')
    return { source, requesterId: target.id, label: '', requester: target }
  }
  const label = text(raw.requesterName, '요청한 사람 이름', { required: true, max: 30 })
  return { source, requesterId: user.id, label, requester: null }
}

export function createRequest(user: PublicUser, body: Record<string, unknown>) {
  const title = text(body.title, '제목', { required: true, max: 100 })
  const workType = text(body.workType, '작업 종류', { required: true, max: 40 })
  const itemList = items(body.items)
  const description = describe(itemList)
  const proxy = proxyOf(user, body)
  const department = text(body.department, '부서', { max: 40 }) || proxy?.requester?.department || (proxy ? '' : user.department)
  const { startAt, dueAt, ongoing } = period(body)
  const takeSelf = !!proxy && body.takeSelf === true
  const now = Date.now()
  return transaction(() => {
    const result = run(
      `INSERT INTO requests (title, work_type, description, department, requester_id, urgency, status, requested_start_at, due_at, ongoing, created_at, updated_at, source, created_by, requester_label)
       VALUES (:title, :workType, :description, :department, :requester, :urgency, 'requested', :startAt, :dueAt, :ongoing, :now, :now, :source, :createdBy, :label)`,
      {
        title,
        workType,
        description,
        department,
        requester: proxy?.requesterId ?? user.id,
        urgency: urgency(body.urgency),
        startAt,
        dueAt,
        ongoing,
        now,
        source: proxy?.source ?? '',
        createdBy: user.id,
        label: proxy?.label ?? '',
      },
    )
    const id = Number(result.lastInsertRowid)
    saveItems(id, itemList)
    claimFiles(user, body.fileIds, { requestId: id, kind: 'reference' })
    if (!proxy) {
      logEvent(id, user.id, 'create', null, 'requested')
      notify(managersAndDesigners(), user.id, id, `새 디자인 요청: ${title}`)
      return id
    }
    const who = proxy.requester?.name ?? proxy.label
    logEvent(id, user.id, 'create', null, 'requested', `${proxy.source} 요청 대신 작성 · 요청자 ${who}`)
    if (takeSelf) {
      run('INSERT INTO assignees (request_id, user_id, ord) VALUES (:id, :uid, 0)', { id, uid: user.id })
      setStatus({ id } as RequestRow, 'waiting')
      logEvent(id, user.id, 'take', 'requested', 'waiting', `담당: ${user.name}`)
    }
    if (proxy.requester) {
      notify([proxy.requester.id], user.id, id, `${user.name}님이 ${proxy.source}로 받은 요청을 요청서로 등록했습니다: ${title}`)
    }
    notify(
      managersAndDesigners().filter((uid) => uid !== proxy.requester?.id),
      user.id,
      id,
      `새 디자인 요청(${proxy.source} · ${who}${takeSelf ? ` · 담당 ${user.name}` : ''}): ${title}`,
    )
    return id
  })
}

export function updateRequest(user: PublicUser, id: number, body: Record<string, unknown>) {
  const req = loadRequest(id)
  requireAction(user, req, 'edit')
  const itemList = items(body.items)
  const { startAt, dueAt, ongoing } = period(body)
  transaction(() => {
    saveItems(id, itemList)
    run(
      `UPDATE requests SET title = :title, work_type = :workType, description = :description, department = :department,
       urgency = :urgency, requested_start_at = :startAt, due_at = :dueAt, ongoing = :ongoing, on_hold = :onHold, updated_at = :now WHERE id = :id`,
      {
        id,
        title: text(body.title, '제목', { required: true, max: 100 }),
        workType: text(body.workType, '작업 종류', { required: true, max: 40 }),
        description: describe(itemList),
        department: text(body.department, '부서', { max: 40 }),
        urgency: urgency(body.urgency),
        startAt,
        dueAt,
        ongoing,
        onHold: body.onHold === true ? 1 : 0,
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

// 요청 삭제(슈퍼관리자만). 딸린 담당·시안·핀·댓글·기록·알림은 DB 가 함께 지운다(ON DELETE CASCADE).
// 지운 파일 id 를 돌려주면 서버가 업로드 폴더에서 실제 파일도 지운다.
export function deleteRequest(user: PublicUser, id: number) {
  if (user.role !== 'superadmin') throw new HttpError(403, '요청 삭제는 슈퍼관리자만 할 수 있습니다.')
  loadRequest(id)
  return transaction(() => {
    const fileIds = all<{ id: string }>('SELECT id FROM files WHERE request_id = :id', { id }).map((f) => f.id)
    run('DELETE FROM requests WHERE id = :id', { id })
    return fileIds
  })
}

// 담당으로 고른 사람들(작업자·관리자만, 사용 중인 계정)
function designerIdsFrom(body: Record<string, unknown>) {
  const ids = Array.isArray(body.designerIds) ? body.designerIds.filter((v): v is string => typeof v === 'string') : []
  if (ids.length === 0) throw new HttpError(400, '담당 작업자를 한 명 이상 골라 주세요.')
  for (const uid of ids) {
    const u = findUser(uid)
    if (!u || !u.active || !(u.role === 'designer' || isManager(u))) {
      throw new HttpError(400, '담당으로 지정할 수 없는 사용자가 있습니다.')
    }
  }
  return ids
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
      case 'reassign': {
        // 작업자 변경: 프로젝트를 새 작업자에게 넘기고 작업 대기부터 다시 시작한다(시작 일시도 새로 잡는다).
        const ids = designerIdsFrom(body)
        if (ids.length === assignees.length && ids.every((uid, i) => uid === assignees[i])) {
          throw new HttpError(400, '지금과 다른 작업자를 골라 주세요.')
        }
        run('DELETE FROM assignees WHERE request_id = :id', { id })
        ids.forEach((uid, ord) => run('INSERT INTO assignees (request_id, user_id, ord) VALUES (:id, :uid, :ord)', { id, uid, ord }))
        setStatus(req, 'waiting', { started_at: null })
        const nameOf = (list: string[]) => list.map((uid) => findUser(uid)?.name ?? uid).join(', ')
        logEvent(id, user.id, action, req.status, 'waiting', `담당: ${nameOf(assignees)} → ${nameOf(ids)}`)
        notify(ids.filter((uid) => !assignees.includes(uid)), user.id, id, `작업자 변경으로 담당이 되었습니다: ${req.title}`)
        notify(assignees.filter((uid) => !ids.includes(uid)), user.id, id, `작업자 변경으로 담당에서 빠졌습니다: ${req.title}`)
        notify([req.requester_id], user.id, id, `담당 작업자가 바뀌었습니다(${nameOf(ids)}): ${req.title}`)
        return
      }
      case 'assign':
      case 'take': {
        const ids = action === 'take' ? [...assignees, user.id] : designerIdsFrom(body)
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
          // 컨펌하면 작업은 완료로 본다. 작업자는 이어서 작업 원본을 올린다(원본 대기 → 원본 업로드 → 완료).
          const now = Date.now()
          setStatus(req, 'source-pending', { approved_at: now, completed_at: now })
          logEvent(id, user.id, action, req.status, 'source-pending', note ? `${latest.round}차 시안 컨펌 · ${note}` : `${latest.round}차 시안 컨펌`)
          notify([req.requester_id], user.id, id, `작업이 완료되었습니다(${latest.round}차 시안 컨펌): ${req.title}`)
          notify(assignees, user.id, id, `컨펌 완료 · 작업 원본 파일을 올려 주세요: ${req.title}`)
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
      case 'upload-source': {
        // 원본 형태: 파일이 없는 작업(Figma 로 작업, 수매확인서 같은 디자인 툴로 제작)도 완료할 수 있다
        const kind = ORIGINAL_KINDS.includes(body.originalKind as OriginalKind) ? (body.originalKind as OriginalKind) : 'file'
        const link = text(body.originalLink, '링크', { max: 500 })
        const tool = text(body.originalTool, '디자인 툴', { max: 40 })
        if (link && !isHttpUrl(link)) throw new HttpError(400, '링크는 https:// 로 시작하는 주소를 넣어 주세요.')
        if ((kind === 'figma' || kind === 'link') && !link) throw new HttpError(400, '작업 링크를 넣어 주세요.')
        if (kind === 'tool' && !tool) throw new HttpError(400, '사용한 디자인 툴을 골라 주세요.')
        const count = claimFiles(user, body.fileIds, { requestId: id, kind: 'final' })
        if (kind === 'file' && count === 0) throw new HttpError(400, '작업 원본 파일을 한 개 이상 올려 주세요.')
        run('UPDATE requests SET original_kind = :kind, original_link = :link, original_tool = :tool WHERE id = :id', {
          id,
          kind,
          link,
          tool: kind === 'tool' ? tool : '',
        })
        setStatus(req, 'done')
        const what = [ORIGINAL_LABEL[kind] + (kind === 'tool' ? `(${tool})` : ''), count > 0 ? `원본 ${count}개` : '', note].filter(Boolean).join(' · ')
        logEvent(id, user.id, action, req.status, 'done', what)
        notify([req.requester_id], user.id, id, `작업 원본 파일이 등록되었습니다: ${req.title}`)
        return
      }
      case 'ask-requester': {
        logEvent(id, user.id, action, req.status, req.status, note)
        notify([req.requester_id], user.id, id, `요청자 확인이 필요합니다${note ? ` (${note.slice(0, 60)})` : ''}: ${req.title}`)
        return
      }
      case 'undo': {
        const t = undoTarget(req)!
        const latest = get<{ id: number; round: number }>(
          'SELECT id, round FROM submissions WHERE request_id = :id ORDER BY round DESC LIMIT 1',
          { id },
        )
        const extra: Record<string, unknown> = {}
        if (t.type === 'assign') run('DELETE FROM assignees WHERE request_id = :id', { id })
        if (t.type === 'take') run('DELETE FROM assignees WHERE request_id = :id AND user_id = :uid', { id, uid: t.actor_id })
        if (t.type === 'submit' && latest) {
          // 올린 시안을 지운다(핀·핀 댓글·시안 파일 기록 포함)
          run('DELETE FROM comments WHERE pin_id IN (SELECT p.id FROM pins p JOIN files f ON f.id = p.file_id WHERE f.submission_id = :sid)', { sid: latest.id })
          run('DELETE FROM pins WHERE file_id IN (SELECT id FROM files WHERE submission_id = :sid)', { sid: latest.id })
          run('DELETE FROM files WHERE submission_id = :sid', { sid: latest.id })
          run('DELETE FROM submissions WHERE id = :sid', { sid: latest.id })
        }
        if ((t.type === 'reject' || t.type === 'approve') && latest) {
          run(
            "UPDATE submissions SET decision = NULL, decided_by = NULL, decided_at = NULL, decision_note = '' WHERE id = :sid",
            { sid: latest.id },
          )
        }
        if (t.type === 'reject') extra.revision = Math.max(0, req.revision - 1)
        if (t.type === 'approve') Object.assign(extra, { approved_at: null, completed_at: null })
        if (t.type === 'complete') extra.completed_at = null
        if (t.type === 'start') extra.started_at = null
        setStatus(req, t.from_status, extra)
        run('UPDATE events SET undone = 1 WHERE id = :eid', { eid: t.id })
        logEvent(id, user.id, action, req.status, t.from_status, `취소한 단계: ${UNDO_LABEL[t.type]}${note ? ` · ${note}` : ''}`)
        notify(assigneesOf(id).concat(req.requester_id, assignees), user.id, id, `작업이 이전 단계로 되돌려졌습니다(${UNDO_LABEL[t.type]} 취소): ${req.title}`)
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
  return all<{ id: number; request_id: number | null; link: string | null; message: string; created_at: number; read_at: number | null }>(
    'SELECT * FROM notifications WHERE user_id = :userId ORDER BY id DESC LIMIT 100',
    { userId },
  ).map((n) => ({
    id: n.id,
    requestId: n.request_id,
    link: n.link,
    message: n.message,
    createdAt: n.created_at,
    read: n.read_at !== null,
  }))
}

// 요청과 관계없는 알림(가입 승인 요청 등). link 는 눌렀을 때 열 화면
export function notifyLink(userIds: string[], message: string, link: string) {
  const now = Date.now()
  for (const userId of userIds) {
    run('INSERT INTO notifications (user_id, link, message, created_at) VALUES (:userId, :link, :message, :now)', {
      userId,
      link,
      message,
      now,
    })
  }
}

export function markNotificationsRead(userId: string) {
  run('UPDATE notifications SET read_at = :now WHERE user_id = :userId AND read_at IS NULL', { userId, now: Date.now() })
}
