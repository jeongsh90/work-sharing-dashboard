import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { addColumn, all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 디자인 툴 히스토리: 툴로 만든 이미지(상품정보고시 등)를 제목과 함께 남겨 두고 디자인팀이 다시 내려받는다.
// 이미지는 uploads 에 파일(kind = 'tool')로 두고, 입력 내용(form)도 함께 저장해 나중에 불러올 수 있게 한다.

db.exec(`
CREATE TABLE IF NOT EXISTS tool_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tool        TEXT NOT NULL,
  title       TEXT NOT NULL,
  file_id     TEXT NOT NULL REFERENCES files(id),
  form        TEXT NOT NULL DEFAULT '{}',
  author_id   TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_history_tool ON tool_history(tool, created_at);
`)
// 입력에 넣은 그림(이렇게 보내드려요 사진 등)의 파일 id 목록(JSON). 불러오기 때 다시 받는다. 기록을 지우면 다른 데서 안 쓰는 그림은 지운다
addColumn('tool_history', 'asset_ids', "TEXT NOT NULL DEFAULT '[]'")

const TOOLS = new Set(['product-notice', 'ship', 'detail-page', 'talk'])
// 디자인 툴은 로그인한 누구나(요청자·작업자·관리자) 쓴다
const canUse = (_u: PublicUser) => true

function requireTool(user: PublicUser, tool: string) {
  if (!TOOLS.has(tool)) throw new HttpError(404, '없는 도구입니다.')
}

export function listToolHistory(user: PublicUser, tool: string, query: string) {
  requireTool(user, tool)
  const q = `%${query.trim()}%`
  return all<{ id: number; title: string; file_id: string; form: string; author_id: string; author_name: string | null; created_at: number }>(
    `SELECT h.id, h.title, h.file_id, h.form, h.author_id, u.name AS author_name, h.created_at
     FROM tool_history h LEFT JOIN users u ON u.id = h.author_id
     WHERE h.tool = :tool AND (:q = '%%' OR h.title LIKE :q)
     ORDER BY h.created_at DESC LIMIT 300`,
    { tool, q },
  ).map((h) => ({
    id: h.id,
    title: h.title,
    fileId: h.file_id,
    form: JSON.parse(h.form) as unknown,
    authorId: h.author_id,
    authorName: h.author_name ?? h.author_id,
    createdAt: h.created_at,
  }))
}

// 새로 남기기: body = { title, form, image: 'data:image/jpeg;base64,...', fileName }
export async function addToolHistory(user: PublicUser, tool: string, body: Record<string, unknown>) {
  requireTool(user, tool)
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : ''
  const m = typeof body.image === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null
  if (!m) throw new HttpError(400, '이미지가 올바르지 않습니다.')
  const data = Buffer.from(m[1], 'base64')
  if (data.length > 20 * 1024 * 1024) throw new HttpError(413, '이미지가 너무 큽니다.')
  const fileName = typeof body.fileName === 'string' && /^[\w.\-가-힣 ]{1,60}\.jpg$/.test(body.fileName) ? body.fileName : 'r.jpg'
  const form = JSON.stringify(body.form ?? {})
  if (form.length > 200_000) throw new HttpError(413, '입력 내용이 너무 깁니다.')
  const assetIds = Array.isArray(body.fileIds) ? [...new Set(body.fileIds.filter((f): f is string => typeof f === 'string' && /^[0-9a-f-]{36}$/.test(f)))] : []
  // 내가 방금 올린 파일(어디에도 붙지 않은 것)이거나 이미 디자인 툴 파일인 것만
  for (const fileId of assetIds) {
    const f = get<{ kind: string | null; uploader_id: string; request_id: number | null }>('SELECT kind, uploader_id, request_id FROM files WHERE id = :fileId', { fileId })
    if (!f) throw new HttpError(400, '그림 파일을 찾을 수 없습니다. 다시 내려받아 주세요.')
    if (f.kind === 'tool') continue
    if (f.kind !== null || f.request_id !== null || f.uploader_id !== user.id) throw new HttpError(400, '쓸 수 없는 그림 파일입니다.')
  }

  const fileId = randomUUID()
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(join(UPLOAD_DIR, fileId), data)
  const now = Date.now()
  run(
    `INSERT INTO files (id, uploader_id, name, mime, size, kind, created_at)
     VALUES (:id, :me, :name, 'image/jpeg', :size, 'tool', :now)`,
    { id: fileId, me: user.id, name: fileName, size: data.length, now },
  )
  run(
    `INSERT INTO tool_history (tool, title, file_id, form, asset_ids, author_id, created_at)
     VALUES (:tool, :title, :fileId, :form, :assets, :me, :now)`,
    { tool, title: title || '제목 없음', fileId, form, assets: JSON.stringify(assetIds), me: user.id, now },
  )
  for (const id of assetIds) run("UPDATE files SET kind = 'tool' WHERE id = :id AND kind IS NULL", { id })
  return { ok: true }
}

// 지우기: 만든 사람 또는 관리자
export function deleteToolHistory(user: PublicUser, id: number) {
  const row = get<{ author_id: string; tool: string; asset_ids: string }>('SELECT author_id, tool, asset_ids FROM tool_history WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '기록을 찾을 수 없습니다.')
  requireTool(user, row.tool)
  if (row.author_id !== user.id && !isManager(user)) throw new HttpError(403, '만든 사람이나 관리자만 지울 수 있습니다.')
  run('DELETE FROM tool_history WHERE id = :id', { id })
  void dropUnusedAssets(JSON.parse(row.asset_ids) as string[])
  return { ok: true }
}

// 이 그림 파일을 아직 쓰는 데가 있는지(히스토리 이미지·다른 히스토리 입력·상세페이지 임시 저장)
export function toolAssetInUse(fileId: string) {
  return !!(
    get('SELECT 1 FROM tool_history WHERE file_id = :fileId', { fileId }) ||
    get('SELECT 1 FROM tool_history WHERE asset_ids LIKE :like', { like: `%"${fileId}"%` }) ||
    get("SELECT 1 FROM sqlite_master WHERE name = 'detail_draft_files'") && get('SELECT 1 FROM detail_draft_files WHERE file_id = :fileId', { fileId })
  )
}

async function dropUnusedAssets(fileIds: string[]) {
  for (const fileId of fileIds) {
    if (toolAssetInUse(fileId)) continue
    run("DELETE FROM files WHERE id = :fileId AND kind = 'tool' AND request_id IS NULL", { fileId })
    await unlink(join(UPLOAD_DIR, fileId)).catch(() => {})
  }
}

// 툴 이미지 파일(kind 'tool')은 디자인팀 누구나 본다
export const canSeeToolFile = canUse
