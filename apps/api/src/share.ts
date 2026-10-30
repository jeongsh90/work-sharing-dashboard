import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { all, db, get, run, transaction } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 파일공유자료실: 로그인한 누구나 글(제목·내용)과 파일을 올려 함께 본다.
// 파일은 uploads 에 두고(files.kind = 'share') share_files 로 글에 묶는다.
// 올리기는 /api/uploads 로 먼저 올린 뒤 그 파일 id 들을 글과 함께 POST /api/share 로 보낸다.

db.exec(`
CREATE TABLE IF NOT EXISTS share_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  author_id  TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS share_posts_created ON share_posts(created_at);
CREATE TABLE IF NOT EXISTS share_files (
  post_id INTEGER NOT NULL REFERENCES share_posts(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, file_id)
);
`)

// 공유 파일은 로그인한 누구나 본다
export const canSeeShareFile = (_u: PublicUser) => true

function text(value: unknown, label: string, max: number) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (v.length > max) throw new HttpError(400, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
  return v
}

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

type PostRow = {
  id: number
  title: string
  body: string
  category: string
  author_id: string
  author_name: string | null
  created_at: number
  updated_at: number
}
type FileRow = { post_id: number; id: string; name: string; mime: string; size: number }

const SELECT = `SELECT p.*, u.name AS author_name FROM share_posts p LEFT JOIN users u ON u.id = p.author_id`

function toDtos(rows: PostRow[]) {
  const files = new Map<number, Omit<FileRow, 'post_id'>[]>()
  if (rows.length > 0) {
    for (const f of all<FileRow>(
      `SELECT sf.post_id, f.id, f.name, f.mime, f.size FROM share_files sf JOIN files f ON f.id = sf.file_id
       WHERE sf.post_id IN (${rows.map((r) => r.id).join(',')}) ORDER BY f.created_at, f.name`,
    )) {
      const { post_id, ...file } = f
      files.set(post_id, [...(files.get(post_id) ?? []), file])
    }
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    authorId: r.author_id,
    authorName: r.author_name ?? r.author_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    files: files.get(r.id) ?? [],
  }))
}

export function listShare(_user: PublicUser) {
  return toDtos(all<PostRow>(`${SELECT} ORDER BY p.created_at DESC, p.id DESC`))
}

function fields(body: Record<string, unknown>) {
  const title = text(body.title, '제목', 100)
  if (!title) throw new HttpError(400, '제목을 입력해 주세요.')
  return { title, body: text(body.body, '내용', 5000), category: text(body.category, '분류', 20) }
}

// 올린 사람 본인의, 아직 어디에도 붙지 않은 파일만 글에 붙일 수 있다.
function attach(user: PublicUser, postId: number, fileIds: string[]) {
  if (fileIds.length > 100) throw new HttpError(400, '파일은 한 글에 100개까지 붙일 수 있습니다.')
  for (const id of fileIds) {
    const file = get<{ uploader_id: string; request_id: number | null; kind: string | null }>(
      'SELECT uploader_id, request_id, kind FROM files WHERE id = :id',
      { id },
    )
    if (!file || file.uploader_id !== user.id || file.request_id !== null || file.kind !== null) {
      throw new HttpError(400, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
    }
    run("UPDATE files SET kind = 'share' WHERE id = :id", { id })
    run('INSERT INTO share_files (post_id, file_id) VALUES (:postId, :id)', { postId, id })
  }
}

const one = (id: number) => toDtos(all<PostRow>(`${SELECT} WHERE p.id = :id`, { id }))[0]

// body = { title, body, category, fileIds }
export function createSharePost(user: PublicUser, body: Record<string, unknown>) {
  const f = fields(body)
  const now = Date.now()
  const id = transaction(() => {
    const postId = Number(
      run(
        `INSERT INTO share_posts (title, body, category, author_id, created_at, updated_at)
         VALUES (:title, :body, :category, :me, :now, :now)`,
        { ...f, me: user.id, now },
      ).lastInsertRowid,
    )
    attach(user, postId, ids(body.fileIds))
    return postId
  })
  return one(id)
}

function own(user: PublicUser, id: number) {
  const row = get<{ author_id: string }>('SELECT author_id FROM share_posts WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '글을 찾을 수 없습니다.')
  if (row.author_id !== user.id && !isManager(user)) throw new HttpError(403, '올린 사람이나 관리자만 고칠 수 있습니다.')
}

const removeFiles = async (fileIds: string[]) => {
  for (const fileId of fileIds) run('DELETE FROM files WHERE id = :fileId', { fileId })
  await Promise.all(fileIds.map((f) => unlink(join(UPLOAD_DIR, f)).catch(() => {})))
}

// body = { title, body, category, fileIds(새로 붙일 파일), removeFileIds(뗄 파일) }
export async function updateSharePost(user: PublicUser, id: number, body: Record<string, unknown>) {
  own(user, id)
  const f = fields(body)
  const current = new Set(all<{ file_id: string }>('SELECT file_id FROM share_files WHERE post_id = :id', { id }).map((r) => r.file_id))
  const removed = ids(body.removeFileIds).filter((fileId) => current.has(fileId))
  transaction(() => {
    run('UPDATE share_posts SET title = :title, body = :body, category = :category, updated_at = :now WHERE id = :id', {
      ...f,
      id,
      now: Date.now(),
    })
    for (const fileId of removed) run('DELETE FROM share_files WHERE post_id = :id AND file_id = :fileId', { id, fileId })
    attach(user, id, ids(body.fileIds))
  })
  await removeFiles(removed)
  return one(id)
}

// 지우기: 올린 사람 또는 관리자. 서버의 파일도 지운다(백업에는 남는다).
export async function deleteSharePost(user: PublicUser, id: number) {
  own(user, id)
  const fileIds = all<{ file_id: string }>('SELECT file_id FROM share_files WHERE post_id = :id', { id }).map((r) => r.file_id)
  run('DELETE FROM share_posts WHERE id = :id', { id })
  await removeFiles(fileIds)
  return { ok: true }
}
