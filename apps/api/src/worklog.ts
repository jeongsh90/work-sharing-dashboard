import { all, db, get, run } from './db.ts'
import { code, HttpError } from './requests.ts'
import { isManager, listUsers, type PublicUser } from './users.ts'

// 업무일지: 내가 이 시스템에서 한 일(진행 기록)을 날짜별로 모아 보여 주고, 직접 쓰는 항목(작성일·시간·카테고리·내용)을 더한다.
// 날짜는 서버(사무실 PC) 시간대 기준 'YYYY-MM-DD'.

db.exec(`
CREATE TABLE IF NOT EXISTS worklog_notes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  day         TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS worklog_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  day         TEXT NOT NULL,
  time        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS worklog_entries_user_day ON worklog_entries(user_id, day);
`)

// 예전 "그날 메모"는 직접 쓴 항목(카테고리 '메모')으로 옮기고 지운다(한 번만).
for (const n of all<{ user_id: string; day: string; body: string; updated_at: number }>('SELECT * FROM worklog_notes')) {
  run(
    `INSERT INTO worklog_entries (user_id, day, time, category, body, created_at, updated_at)
     VALUES (:u, :day, '', '메모', :body, :at, :at)`,
    { u: n.user_id, day: n.day, body: n.body, at: n.updated_at },
  )
  run('DELETE FROM worklog_notes WHERE user_id = :u AND day = :day', { u: n.user_id, day: n.day })
}


const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayStart(day: unknown, label: string) {
  const m = typeof day === 'string' ? day.match(DAY) : null
  if (!m) throw new HttpError(400, `${label} 날짜가 올바르지 않습니다.`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

// from ~ to(둘 다 그날 포함) 사이 그 사람의 진행 기록과 메모
export function worklog(user: Pick<PublicUser, 'id'>, from: string | null, to: string | null) {
  const start = dayStart(from, '시작')
  const endDay = dayStart(to, '끝')
  const end = new Date(endDay).setDate(new Date(endDay).getDate() + 1)
  if (end <= start) throw new HttpError(400, '기간이 올바르지 않습니다.')
  if (end - start > 62 * 86_400_000) throw new HttpError(400, '한 번에 두 달까지 볼 수 있습니다.')

  const events = all<{
    at: number
    type: string
    from_status: string | null
    to_status: string | null
    note: string
    request_id: number
    title: string
  }>(
    `SELECT e.created_at AS at, e.type, e.from_status, e.to_status, e.note, e.request_id, r.title
     FROM events e JOIN requests r ON r.id = e.request_id
     WHERE e.actor_id = :me AND e.created_at >= :start AND e.created_at < :end
     ORDER BY e.created_at`,
    { me: user.id, start, end },
  ).map((e) => ({
    at: e.at,
    type: e.type,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    note: e.note,
    requestId: e.request_id,
    code: code(e.request_id),
    title: e.title,
  }))

  const entries = all<{ id: number; day: string; time: string; category: string; body: string; updated_at: number }>(
    `SELECT id, day, time, category, body, updated_at FROM worklog_entries
     WHERE user_id = :me AND day >= :from AND day <= :to ORDER BY day, time, id`,
    { me: user.id, from, to },
  ).map((e) => ({ id: e.id, day: e.day, time: e.time, category: e.category, body: e.body, updatedAt: e.updated_at }))

  return { events, entries }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function entryFields(body: Record<string, unknown>) {
  const day = typeof body.day === 'string' ? body.day : ''
  dayStart(day, '작성일')
  const time = typeof body.time === 'string' ? body.time.trim() : ''
  if (time && !TIME.test(time)) throw new HttpError(400, '작성시간이 올바르지 않습니다.')
  const category = typeof body.category === 'string' ? body.category.trim().slice(0, 20) : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) throw new HttpError(400, '내용을 입력해 주세요.')
  if (text.length > 5000) throw new HttpError(400, '내용은 5000자까지 쓸 수 있습니다.')
  return { day, time, category, body: text }
}

function ownEntry(user: PublicUser, id: number) {
  const row = get<{ user_id: string }>('SELECT user_id FROM worklog_entries WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '항목을 찾을 수 없습니다.')
  if (row.user_id !== user.id) throw new HttpError(403, '내가 쓴 항목만 고칠 수 있습니다.')
}

export function createWorklogEntry(user: PublicUser, body: Record<string, unknown>) {
  const f = entryFields(body)
  const now = Date.now()
  run(
    `INSERT INTO worklog_entries (user_id, day, time, category, body, created_at, updated_at)
     VALUES (:me, :day, :time, :category, :body, :now, :now)`,
    { me: user.id, ...f, now },
  )
  return { ok: true }
}

export function updateWorklogEntry(user: PublicUser, id: number, body: Record<string, unknown>) {
  ownEntry(user, id)
  const f = entryFields(body)
  run(
    'UPDATE worklog_entries SET day = :day, time = :time, category = :category, body = :body, updated_at = :now WHERE id = :id',
    { id, ...f, now: Date.now() },
  )
  return { ok: true }
}

export function deleteWorklogEntry(user: PublicUser, id: number) {
  ownEntry(user, id)
  run('DELETE FROM worklog_entries WHERE id = :id', { id })
  return { ok: true }
}

// 디자인팀 작업자(작업자 + 디자인팀 관리자)
const isDesignWorker = (u: PublicUser) =>
  u.role === 'designer' || (isManager(u) && u.department.replace(/\s+/g, '') === '디자인팀')

// 팀 업무일지(관리자): 디자인팀 작업자마다 그 기간의 기록·메모. 고치지 않고 보기만 한다.
export function teamWorklog(viewer: PublicUser, from: string | null, to: string | null) {
  if (!isManager(viewer)) throw new HttpError(403, '팀 업무일지는 관리자만 볼 수 있습니다.')
  return listUsers()
    .filter((u) => u.active && u.approved && isDesignWorker(u))
    .map((u) => ({ user: { id: u.id, name: u.name, rank: u.rank, avatarId: u.avatarId }, ...worklog(u, from, to) }))
}
