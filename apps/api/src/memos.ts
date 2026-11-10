import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { addColumn, all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'
import { personalGroup, UPLOAD_DIR } from './config.ts'

// 메모(개인 메뉴): 계정마다 자기 메모만 쓰고 본다(계정 전환 묶음은 함께 — config.personalGroup). 제목(비우면 내용 첫 줄) + 내용 + 첨부 이미지, 고정하면 목록 맨 위.

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
// 첨부 이미지: 파일 id 배열(JSON). 파일은 kind 'memo' 로 두고 같은 계정 묶음만 본다(server.ts handleFile)
addColumn('memos', 'files', "TEXT NOT NULL DEFAULT '[]'")

type MemoRow = { id: number; user_id: string; title: string; body: string; pinned: number; files: string; created_at: number; updated_at: number }
type MemoFile = { id: string; name: string; mime: string; size: number }

const TITLE_MAX = 100
const BODY_MAX = 20_000

const FILES_MAX = 30
const fileIdsOf = (m: Pick<MemoRow, 'files'>): string[] => {
  try {
    const v = JSON.parse(m.files)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const filesOf = (m: MemoRow): MemoFile[] =>
  fileIdsOf(m)
    .map((id) => get<MemoFile>("SELECT id, name, mime, size FROM files WHERE id = :id AND kind = 'memo'", { id }))
    .filter((f): f is MemoFile => !!f)

const dto = (m: MemoRow) => ({ id: m.id, title: m.title, body: m.body, pinned: m.pinned === 1, files: filesOf(m), createdAt: m.created_at, updatedAt: m.updated_at })

// 첨부 id 확인: 내가 방금 올린(어디에도 안 붙은) 이미지이거나, 이미 같은 계정 묶음 메모에 붙은 이미지만
function attachIds(user: PublicUser, body: Record<string, unknown>) {
  if (!Array.isArray(body.files)) return null
  const ids = [...new Set(body.files.filter((f): f is string => typeof f === 'string' && /^[0-9a-f-]{36}$/.test(f)))]
  if (ids.length > FILES_MAX) throw new HttpError(400, `이미지는 메모 하나에 ${FILES_MAX}장까지 붙일 수 있습니다.`)
  const group: string[] = JSON.parse(personalGroup(user.id))
  for (const id of ids) {
    const f = get<{ kind: string | null; uploader_id: string; request_id: number | null; mime: string }>('SELECT kind, uploader_id, request_id, mime FROM files WHERE id = :id', { id })
    if (!f || f.request_id !== null || !group.includes(f.uploader_id)) throw new HttpError(400, '첨부 이미지를 찾을 수 없습니다. 다시 올려 주세요.')
    if (f.kind !== null && f.kind !== 'memo') throw new HttpError(400, '쓸 수 없는 첨부 파일입니다.')
    if (!f.mime.startsWith('image/')) throw new HttpError(400, '이미지 파일만 붙일 수 있습니다.')
  }
  return ids
}
function claim(ids: string[]) {
  for (const id of ids) run("UPDATE files SET kind = 'memo' WHERE id = :id AND kind IS NULL AND request_id IS NULL", { id })
}
// 어느 메모도 더 가리키지 않는 첨부를 지운다
async function dropUnused(ids: string[]) {
  for (const id of ids) {
    if (get('SELECT 1 FROM memos WHERE files LIKE :like', { like: `%"${id}"%` })) continue
    run("DELETE FROM files WHERE id = :id AND kind = 'memo' AND request_id IS NULL", { id })
    await unlink(join(UPLOAD_DIR, id)).catch(() => {})
  }
}

function fields(body: Record<string, unknown>, hasFiles = false) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : ''
  const text = typeof body.body === 'string' ? body.body.replace(/\s+$/, '') : ''
  if (text.length > BODY_MAX) throw new HttpError(400, `메모는 ${BODY_MAX.toLocaleString()}자까지 쓸 수 있습니다.`)
  if (!title && !text.trim() && !hasFiles) throw new HttpError(400, '제목이나 내용을 입력해 주세요.')
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
  const ids = attachIds(user, body) ?? []
  const f = fields(body, ids.length > 0)
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM memos WHERE user_id IN (SELECT value FROM json_each(:g))', { g: personalGroup(user.id) })?.n ?? 0) >= 2000) {
    throw new HttpError(400, '메모는 2,000개까지 남길 수 있습니다. 안 쓰는 메모를 지워 주세요.')
  }
  const now = Date.now()
  claim(ids)
  const r = run('INSERT INTO memos (user_id, title, body, files, created_at, updated_at) VALUES (:u, :title, :body, :files, :now, :now)', { u: user.id, ...f, files: JSON.stringify(ids), now })
  return dto(own(user, Number(r.lastInsertRowid)))
}

export async function updateMemo(user: PublicUser, id: number, body: Record<string, unknown>) {
  const before = own(user, id)
  // 고정만 바꿀 때는 내용·수정 시각을 건드리지 않는다
  if (typeof body.pinned === 'boolean' && body.title === undefined && body.body === undefined) {
    run('UPDATE memos SET pinned = :p WHERE id = :id', { id, p: body.pinned ? 1 : 0 })
    return dto(own(user, id))
  }
  const ids = attachIds(user, body) ?? fileIdsOf(before)
  const f = fields(body, ids.length > 0)
  claim(ids)
  run('UPDATE memos SET title = :title, body = :body, files = :files, updated_at = :now WHERE id = :id', { id, ...f, files: JSON.stringify(ids), now: Date.now() })
  await dropUnused(fileIdsOf(before).filter((x) => !ids.includes(x)))
  return dto(own(user, id))
}

export async function deleteMemo(user: PublicUser, id: number) {
  const before = own(user, id)
  run('DELETE FROM memos WHERE id = :id', { id })
  await dropUnused(fileIdsOf(before))
  return { ok: true }
}
