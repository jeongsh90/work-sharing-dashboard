import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { all, db, get, run, transaction } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 디자인팀 자료실: 작업할 때 쓰는 자료(PSD·AI·FIG 템플릿, 로고, 폰트, 이미지 소스 등)를 올려 두고 디자인팀이 함께 내려받는다.
// 파일은 uploads 에 두고(files.kind = 'library'), 분류·메모는 library_items 에 둔다.
// 올리기는 /api/uploads 로 먼저 올린 뒤 그 파일 id 들을 POST /api/library 로 자료실에 넣는다.

db.exec(`
CREATE TABLE IF NOT EXISTS library_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  uploader_id TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS library_items_created ON library_items(created_at);
`)

// 디자인팀 작업자(작업자 + 디자인팀 관리자)와 관리자
export const canUseLibrary = (u: PublicUser) => u.role === 'designer' || isManager(u)

function requireLibrary(user: PublicUser) {
  if (!canUseLibrary(user)) throw new HttpError(403, '디자인팀 자료실은 디자인팀과 관리자만 볼 수 있습니다.')
}

function text(value: unknown, label: string, max: number) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (v.length > max) throw new HttpError(400, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
  return v
}

type ItemRow = {
  id: number
  file_id: string
  category: string
  note: string
  uploader_id: string
  uploader_name: string | null
  created_at: number
  updated_at: number
  name: string
  mime: string
  size: number
}

const SELECT = `SELECT l.*, f.name, f.mime, f.size, u.name AS uploader_name
  FROM library_items l JOIN files f ON f.id = l.file_id LEFT JOIN users u ON u.id = l.uploader_id`

const toDto = (r: ItemRow) => ({
  id: r.id,
  category: r.category,
  note: r.note,
  uploaderId: r.uploader_id,
  uploaderName: r.uploader_name ?? r.uploader_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  file: { id: r.file_id, name: r.name, mime: r.mime, size: r.size },
})

export function listLibrary(user: PublicUser) {
  requireLibrary(user)
  return all<ItemRow>(`${SELECT} ORDER BY l.created_at DESC, l.id DESC`).map(toDto)
}

// body = { fileIds: string[], category, note }. 올린 사람 본인의, 아직 어디에도 붙지 않은 파일만 넣을 수 있다.
export function addLibraryItems(user: PublicUser, body: Record<string, unknown>) {
  requireLibrary(user)
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((v): v is string => typeof v === 'string') : []
  if (fileIds.length === 0) throw new HttpError(400, '올릴 파일을 골라 주세요.')
  if (fileIds.length > 200) throw new HttpError(400, '한 번에 200개까지 올릴 수 있습니다.')
  const category = text(body.category, '분류', 20)
  const note = text(body.note, '메모', 300)
  for (const id of fileIds) {
    const file = get<{ uploader_id: string; request_id: number | null; kind: string | null }>(
      'SELECT uploader_id, request_id, kind FROM files WHERE id = :id',
      { id },
    )
    if (!file || file.uploader_id !== user.id || file.request_id !== null || file.kind !== null) {
      throw new HttpError(400, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
    }
  }
  const now = Date.now()
  transaction(() => {
    for (const id of fileIds) {
      run("UPDATE files SET kind = 'library' WHERE id = :id", { id })
      run(
        `INSERT INTO library_items (file_id, category, note, uploader_id, created_at, updated_at)
         VALUES (:id, :category, :note, :me, :now, :now)`,
        { id, category, note, me: user.id, now },
      )
    }
  })
  return { ok: true }
}

function own(user: PublicUser, id: number) {
  requireLibrary(user)
  const row = get<{ uploader_id: string; file_id: string }>('SELECT uploader_id, file_id FROM library_items WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '자료를 찾을 수 없습니다.')
  if (row.uploader_id !== user.id && !isManager(user)) throw new HttpError(403, '올린 사람이나 관리자만 고칠 수 있습니다.')
  return row
}

// 분류·메모·파일 이름 고치기
export function updateLibraryItem(user: PublicUser, id: number, body: Record<string, unknown>) {
  const row = own(user, id)
  const now = Date.now()
  if (body.category !== undefined || body.note !== undefined) {
    const cur = get<{ category: string; note: string }>('SELECT category, note FROM library_items WHERE id = :id', { id })!
    run('UPDATE library_items SET category = :category, note = :note, updated_at = :now WHERE id = :id', {
      id,
      category: body.category !== undefined ? text(body.category, '분류', 20) : cur.category,
      note: body.note !== undefined ? text(body.note, '메모', 300) : cur.note,
      now,
    })
  }
  if (body.name !== undefined) {
    const name = text(body.name, '파일 이름', 200)
    if (!name) throw new HttpError(400, '파일 이름을 입력해 주세요.')
    run('UPDATE files SET name = :name WHERE id = :fileId', { name, fileId: row.file_id })
    run('UPDATE library_items SET updated_at = :now WHERE id = :id', { id, now })
  }
  return toDto(get<ItemRow>(`${SELECT} WHERE l.id = :id`, { id })!)
}

// 지우기: 올린 사람 또는 관리자. 서버의 파일도 지운다(백업에는 남는다).
export async function deleteLibraryItem(user: PublicUser, id: number) {
  const row = own(user, id)
  run('DELETE FROM library_items WHERE id = :id', { id })
  run('DELETE FROM files WHERE id = :fileId', { fileId: row.file_id })
  await unlink(join(UPLOAD_DIR, row.file_id)).catch(() => {})
  return { ok: true }
}
