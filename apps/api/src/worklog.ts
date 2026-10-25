import { all, db, run } from './db.ts'
import { code, HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'

// 업무일지: 내가 이 시스템에서 한 일(진행 기록)을 날짜별로 모아 보여 주고, 날마다 직접 적는 메모를 더한다.
// 날짜는 서버(사무실 PC) 시간대 기준 'YYYY-MM-DD'.

db.exec(`
CREATE TABLE IF NOT EXISTS worklog_notes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  day         TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
`)

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayStart(day: unknown, label: string) {
  const m = typeof day === 'string' ? day.match(DAY) : null
  if (!m) throw new HttpError(400, `${label} 날짜가 올바르지 않습니다.`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

// from ~ to(둘 다 그날 포함) 사이 내 진행 기록과 메모
export function worklog(user: PublicUser, from: string | null, to: string | null) {
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

  const notes = all<{ day: string; body: string; updated_at: number }>(
    'SELECT day, body, updated_at FROM worklog_notes WHERE user_id = :me AND day >= :from AND day <= :to ORDER BY day',
    { me: user.id, from, to },
  ).map((n) => ({ day: n.day, body: n.body, updatedAt: n.updated_at }))

  return { events, notes }
}

// 그날 메모 저장(비우면 지운다)
export function saveWorklogNote(user: PublicUser, day: string, body: unknown) {
  dayStart(day, '메모')
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length > 5000) throw new HttpError(400, '메모는 5000자까지 쓸 수 있습니다.')
  if (!text) {
    run('DELETE FROM worklog_notes WHERE user_id = :me AND day = :day', { me: user.id, day })
    return { day, body: '', updatedAt: Date.now() }
  }
  const now = Date.now()
  run(
    `INSERT INTO worklog_notes (user_id, day, body, updated_at) VALUES (:me, :day, :body, :now)
     ON CONFLICT(user_id, day) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    { me: user.id, day, body: text, now },
  )
  return { day, body: text, updatedAt: now }
}
