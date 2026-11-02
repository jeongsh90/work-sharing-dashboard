import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 디자인 툴 > 상세페이지 임시 저장: 만들던 상세페이지(입력 내용 + 넣은 그림)를 저장해 두고 나중에 불러와 이어서 만든다.
// 본사 자료(상품정보고시 등)를 기다리는 동안 구성해 둔 내용이 사라지지 않게. 디자인 툴을 쓰는 사람 누구나 목록을 보고 이어서 고칠 수 있다.
// 그림은 /api/uploads 로 먼저 올린 파일(id)을 data 안에서 가리키고, 저장할 때 kind 'tool' 로 바꿔 둔다(디자인 툴 사용자 누구나 열람).
// 지우기는 만든 사람·관리자. 지우거나 고쳐서 더 쓰지 않는 그림 파일은 함께 지운다.

db.exec(`
CREATE TABLE IF NOT EXISTS detail_drafts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  data        TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS detail_draft_files (
  draft_id TEXT NOT NULL REFERENCES detail_drafts(id) ON DELETE CASCADE,
  file_id  TEXT NOT NULL,
  PRIMARY KEY (draft_id, file_id)
);
`)

type Row = { id: string; title: string; data: string; author_id: string; updated_by: string; created_at: number; updated_at: number }

const MAX_DATA = 2_000_000

export function listDetailDrafts(_user: PublicUser) {
  return all<Row & { count: number }>(
    `SELECT d.id, d.title, d.author_id, d.updated_by, d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM detail_draft_files f WHERE f.draft_id = d.id) AS count
     FROM detail_drafts d ORDER BY d.updated_at DESC LIMIT 300`,
  ).map((d) => ({ id: d.id, title: d.title, authorId: d.author_id, updatedBy: d.updated_by, createdAt: d.created_at, updatedAt: d.updated_at, images: d.count }))
}

function find(id: string) {
  const row = get<Row>('SELECT * FROM detail_drafts WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '임시 저장을 찾을 수 없습니다.')
  return row
}

export function getDetailDraft(_user: PublicUser, id: string) {
  const d = find(id)
  return { id: d.id, title: d.title, data: JSON.parse(d.data) as unknown, updatedAt: d.updated_at }
}

function fields(user: PublicUser, body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : ''
  if (!title) throw new HttpError(400, '저장할 이름을 입력해 주세요.')
  const data = JSON.stringify(body.data ?? {})
  if (data.length > MAX_DATA) throw new HttpError(413, '입력 내용이 너무 깁니다.')
  const fileIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.filter((f): f is string => typeof f === 'string' && /^[0-9a-f-]{36}$/.test(f)))] : []
  // 내가 방금 올린 파일(어디에도 붙지 않은 것)이거나 이미 디자인 툴 파일인 것만 가리킬 수 있다
  for (const fileId of fileIds) {
    const f = get<{ kind: string | null; uploader_id: string; request_id: number | null }>('SELECT kind, uploader_id, request_id FROM files WHERE id = :fileId', { fileId })
    if (!f) throw new HttpError(400, '그림 파일을 찾을 수 없습니다. 다시 저장해 주세요.')
    if (f.kind === 'tool') continue
    if (f.kind !== null || f.request_id !== null || f.uploader_id !== user.id) throw new HttpError(400, '쓸 수 없는 그림 파일입니다.')
  }
  return { title, data, fileIds }
}

function linkFiles(draftId: string, fileIds: string[]) {
  run('DELETE FROM detail_draft_files WHERE draft_id = :draftId', { draftId })
  for (const fileId of fileIds) {
    run("UPDATE files SET kind = 'tool' WHERE id = :fileId AND kind IS NULL", { fileId })
    run('INSERT INTO detail_draft_files (draft_id, file_id) VALUES (:draftId, :fileId)', { draftId, fileId })
  }
}

// 어떤 임시 저장도 더 가리키지 않는 그림 파일을 지운다
async function dropUnused(fileIds: string[]) {
  for (const fileId of fileIds) {
    if (get('SELECT 1 FROM detail_draft_files WHERE file_id = :fileId', { fileId })) continue
    if (get('SELECT 1 FROM tool_history WHERE file_id = :fileId', { fileId })) continue
    run("DELETE FROM files WHERE id = :fileId AND kind = 'tool' AND request_id IS NULL", { fileId })
    await unlink(join(UPLOAD_DIR, fileId)).catch(() => {})
  }
}
const filesOf = (draftId: string) =>
  all<{ file_id: string }>('SELECT file_id FROM detail_draft_files WHERE draft_id = :draftId', { draftId }).map((f) => f.file_id)

export function addDetailDraft(user: PublicUser, body: Record<string, unknown>) {
  const f = fields(user, body)
  const id = randomUUID()
  const now = Date.now()
  db.exec('BEGIN')
  try {
    run(
      `INSERT INTO detail_drafts (id, title, data, author_id, updated_by, created_at, updated_at)
       VALUES (:id, :title, :data, :me, :me, :now, :now)`,
      { id, title: f.title, data: f.data, me: user.id, now },
    )
    linkFiles(id, f.fileIds)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { id, updatedAt: now }
}

export async function updateDetailDraft(user: PublicUser, id: string, body: Record<string, unknown>) {
  find(id)
  const f = fields(user, body)
  const before = filesOf(id)
  const now = Date.now()
  db.exec('BEGIN')
  try {
    run('UPDATE detail_drafts SET title = :title, data = :data, updated_by = :me, updated_at = :now WHERE id = :id', {
      id,
      title: f.title,
      data: f.data,
      me: user.id,
      now,
    })
    linkFiles(id, f.fileIds)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  await dropUnused(before.filter((x) => !f.fileIds.includes(x)))
  return { id, updatedAt: now }
}

export async function deleteDetailDraft(user: PublicUser, id: string) {
  const d = find(id)
  if (d.author_id !== user.id && !isManager(user)) throw new HttpError(403, '만든 사람이나 관리자만 지울 수 있습니다.')
  const before = filesOf(id)
  run('DELETE FROM detail_drafts WHERE id = :id', { id })
  await dropUnused(before)
  return { ok: true }
}
