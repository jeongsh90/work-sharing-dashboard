import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'
import { personalGroup } from './config.ts'

// 메모(개인 메뉴): 계정마다 자기 메모만 쓰고 본다(계정 전환 묶음은 함께 — config.personalGroup). 제목(비우면 내용 첫 줄) + 내용, 고정하면 목록 맨 위.

db.exec(`
CREATE TABLE IF NOT EXISTS memos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memos_user ON memos(user_id);
`)

type MemoRow = { id: number; user_id: string; title: string; body: string; pinned: number; created_at: number; updated_at: number }

const TITLE_MAX = 100
const BODY_MAX = 20_000

const dto = (m: MemoRow) => ({ id: m.id, title: m.title, body: m.body, pinned: m.pinned === 1, createdAt: m.created_at, updatedAt: m.updated_at })

function fields(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : ''
  const text = typeof body.body === 'string' ? body.body.replace(/\s+$/, '') : ''
  if (text.length > BODY_MAX) throw new HttpError(400, `메모는 ${BODY_MAX.toLocaleString()}자까지 쓸 수 있습니다.`)
  if (!title && !text.trim()) throw new HttpError(400, '제목이나 내용을 입력해 주세요.')
  return { title, body: text }
}

function own(user: PublicUser, id: number) {
  const row = get<MemoRow>('SELECT * FROM memos WHERE id = :id AND user_id IN (SELECT value FROM json_each(:g))', { id, g: personalGroup(user.id) })
  if (!row) throw new HttpError(404, '메모를 찾을 수 없습니다.')
  return row
}

export function listMemos(user: PublicUser) {
  return all<MemoRow>('SELECT * FROM memos WHERE user_id IN (SELECT value FROM json_each(:g)) ORDER BY pinned DESC, updated_at DESC, id DESC', { g: personalGroup(user.id) }).map(dto)
}

export function createMemo(user: PublicUser, body: Record<string, unknown>) {
  const f = fields(body)
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM memos WHERE user_id IN (SELECT value FROM json_each(:g))', { g: personalGroup(user.id) })?.n ?? 0) >= 2000) {
    throw new HttpError(400, '메모는 2,000개까지 남길 수 있습니다. 안 쓰는 메모를 지워 주세요.')
  }
  const now = Date.now()
  const r = run('INSERT INTO memos (user_id, title, body, created_at, updated_at) VALUES (:u, :title, :body, :now, :now)', { u: user.id, ...f, now })
  return dto(own(user, Number(r.lastInsertRowid)))
}

export function updateMemo(user: PublicUser, id: number, body: Record<string, unknown>) {
  own(user, id)
  // 고정만 바꿀 때는 내용·수정 시각을 건드리지 않는다
  if (typeof body.pinned === 'boolean' && body.title === undefined && body.body === undefined) {
    run('UPDATE memos SET pinned = :p WHERE id = :id', { id, p: body.pinned ? 1 : 0 })
    return dto(own(user, id))
  }
  const f = fields(body)
  run('UPDATE memos SET title = :title, body = :body, updated_at = :now WHERE id = :id', { id, ...f, now: Date.now() })
  return dto(own(user, id))
}

export function deleteMemo(user: PublicUser, id: number) {
  own(user, id)
  run('DELETE FROM memos WHERE id = :id', { id })
  return { ok: true }
}
