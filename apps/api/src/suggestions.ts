import { all, get, run } from './db.ts'
import { HttpError, notifyLink } from './requests.ts'
import { isManager, listUsers, type PublicUser } from './users.ts'

// 건의게시판. 누구나 글을 쓰고, 관리자가 처리 상태와 답변을 남긴다.
// status: open(접수) | reviewing(검토 중) | done(반영 완료) | declined(보류)

export const SUGGESTION_STATUSES = ['open', 'reviewing', 'done', 'declined'] as const
type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

type SuggestionRow = {
  id: number
  author_id: string
  author_name: string | null
  title: string
  body: string
  status: SuggestionStatus
  reply: string
  replied_by: string | null
  replied_at: number | null
  created_at: number
  updated_at: number
}

const toDto = (s: SuggestionRow) => ({
  id: s.id,
  authorId: s.author_id,
  authorName: s.author_name ?? s.author_id,
  title: s.title,
  body: s.body,
  status: s.status,
  reply: s.reply,
  repliedBy: s.replied_by,
  repliedAt: s.replied_at,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
})

const SELECT = `SELECT s.*, u.name AS author_name FROM suggestions s LEFT JOIN users u ON u.id = s.author_id`

function text(value: unknown, label: string, max: number, required = true) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (required && !v) throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  if (v.length > max) throw new HttpError(400, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
  return v
}

function load(id: number) {
  const row = get<SuggestionRow>(`${SELECT} WHERE s.id = :id`, { id })
  if (!row) throw new HttpError(404, '건의글을 찾을 수 없습니다.')
  return row
}

export function listSuggestions() {
  return all<SuggestionRow>(`${SELECT} ORDER BY s.id DESC`).map(toDto)
}

export function createSuggestion(user: PublicUser, body: Record<string, unknown>) {
  const title = text(body.title, '제목', 100)
  const content = text(body.body, '내용', 5000)
  const now = Date.now()
  const id = Number(
    run(
      `INSERT INTO suggestions (author_id, title, body, status, created_at, updated_at) VALUES (:a, :t, :b, 'open', :now, :now)`,
      { a: user.id, t: title, b: content, now },
    ).lastInsertRowid,
  )
  const managers = listUsers()
    .filter((u) => u.active && u.approved && isManager(u) && u.id !== user.id)
    .map((u) => u.id)
  notifyLink(managers, `새 건의: ${title} (${user.name})`, 'feedback')
  return toDto(load(id))
}

// 관리자: 처리 상태와 답변을 바꾼다. 답변이 새로 달리거나 바뀌면 작성자에게 알린다.
export function answerSuggestion(user: PublicUser, id: number, body: Record<string, unknown>) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 처리할 수 있습니다.')
  const row = load(id)
  const status = SUGGESTION_STATUSES.includes(body.status as SuggestionStatus) ? (body.status as SuggestionStatus) : row.status
  const reply = body.reply === undefined ? row.reply : text(body.reply, '답변', 5000, false)
  const replyChanged = reply !== row.reply
  const now = Date.now()
  run(
    `UPDATE suggestions SET status = :status, reply = :reply, replied_by = :by, replied_at = :at, updated_at = :now WHERE id = :id`,
    {
      id,
      status,
      reply,
      by: replyChanged ? (reply ? user.id : null) : row.replied_by,
      at: replyChanged ? (reply ? now : null) : row.replied_at,
      now,
    },
  )
  if ((replyChanged && reply) || status !== row.status) {
    const what = replyChanged && reply ? '답변이 달렸습니다' : '처리 상태가 바뀌었습니다'
    if (row.author_id !== user.id) notifyLink([row.author_id], `건의글에 ${what}: ${row.title}`, 'feedback')
  }
  return toDto(load(id))
}

// 삭제: 작성자는 아직 접수 상태인 자기 글만, 관리자는 모두
export function deleteSuggestion(user: PublicUser, id: number) {
  const row = load(id)
  const own = row.author_id === user.id && row.status === 'open'
  if (!own && !isManager(user)) throw new HttpError(403, '접수 상태인 내 글만 지울 수 있습니다.')
  run('DELETE FROM suggestions WHERE id = :id', { id })
}
