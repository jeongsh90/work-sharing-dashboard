import { db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'

// 디자인 요청서 임시저장: 새 요청서를 쓰다가 저장해 두고 나중에 이어서 쓴다. 한 사람당 하나.
// data 는 화면 입력 그대로(JSON). 참고 자료는 /api/uploads 로 먼저 올린 파일(id)을 가리키고,
// 요청을 보낼 때 그 파일들이 요청에 붙는다. 요청을 보내면(createRequest 성공) 임시저장은 지운다.

db.exec(`
CREATE TABLE IF NOT EXISTS request_drafts (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  file_ids   TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
`)

type FileRow = { id: string; name: string; mime: string; size: number; kind: string | null; uploader_id: string; request_id: number | null; created_at: number }

const MAX_DATA = 200_000

// 아직 어디에도 붙지 않은 내 파일만 남긴다(지워졌거나 다른 데 쓰인 파일은 뺀다)
function myLooseFiles(user: PublicUser, ids: unknown) {
  const list = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string').slice(0, 200) : []
  return list
    .map((id) => get<FileRow>('SELECT * FROM files WHERE id = :id', { id }))
    .filter((f): f is FileRow => !!f && f.uploader_id === user.id && f.request_id === null && f.kind === null)
}

export function getRequestDraft(user: PublicUser) {
  const row = get<{ data: string; file_ids: string; updated_at: number }>('SELECT * FROM request_drafts WHERE user_id = :id', { id: user.id })
  if (!row) return null
  let data: unknown = {}
  let ids: unknown = []
  try {
    data = JSON.parse(row.data)
    ids = JSON.parse(row.file_ids)
  } catch {
    // 깨진 값이면 빈 요청서로
  }
  const files = myLooseFiles(user, ids).map((f) => ({
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    kind: null,
    uploaderId: f.uploader_id,
    createdAt: f.created_at,
  }))
  return { data, files, updatedAt: row.updated_at }
}

export function saveRequestDraft(user: PublicUser, body: Record<string, unknown>) {
  const data = JSON.stringify(body.data ?? {})
  if (data.length > MAX_DATA) throw new HttpError(400, '임시저장 내용이 너무 깁니다.')
  const ids = myLooseFiles(user, body.fileIds).map((f) => f.id)
  const now = Date.now()
  run(
    `INSERT INTO request_drafts (user_id, data, file_ids, updated_at) VALUES (:id, :data, :ids, :now)
     ON CONFLICT(user_id) DO UPDATE SET data = :data, file_ids = :ids, updated_at = :now`,
    { id: user.id, data, ids: JSON.stringify(ids), now },
  )
  return { ok: true, updatedAt: now }
}

// 지우기: discardFiles 면 임시저장에만 쓰던(아직 붙지 않은) 파일 기록도 지운다(파일은 저장 공간 정리가 치운다)
export function deleteRequestDraft(user: PublicUser, discardFiles = false) {
  if (discardFiles) {
    const row = get<{ file_ids: string }>('SELECT file_ids FROM request_drafts WHERE user_id = :id', { id: user.id })
    let ids: unknown = []
    try {
      ids = JSON.parse(row?.file_ids ?? '[]')
    } catch {
      // 무시
    }
    for (const f of myLooseFiles(user, ids)) run('DELETE FROM files WHERE id = :id AND request_id IS NULL AND kind IS NULL', { id: f.id })
  }
  run('DELETE FROM request_drafts WHERE user_id = :id', { id: user.id })
  return { ok: true }
}

