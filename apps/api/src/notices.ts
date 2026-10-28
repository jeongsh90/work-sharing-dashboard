import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { all, db, get, run, transaction } from './db.ts'
import { HttpError, notifyLink } from './requests.ts'
import { isManager, listUsers, type PublicUser } from './users.ts'

// 공지사항 게시판. 누구나 읽고, 관리자가 쓴다.
// 본문은 에디터(Tiptap)가 만든 HTML. 본문 그림은 <img data-file-id="…"> 로 남기고(화면에서 로그인 주소로 바꿔 보여 준다),
// 그림·첨부 파일은 uploads 에 두고(files.kind = 'notice') notice_files 로 묶는다.
// 읽음: notice_reads(공지·사람) 한 줄씩. 조회 수 = 읽은 사람 수, 안 읽은 공지는 메뉴에 N 표시.

db.exec(`
CREATE TABLE IF NOT EXISTS notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  author_id   TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notice_files (
  notice_id   INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  inline      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (notice_id, file_id)
);
CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id   INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  read_at     INTEGER NOT NULL,
  PRIMARY KEY (notice_id, user_id)
);
`)

// 공지 파일(kind 'notice')은 로그인한 누구나 본다
export const canSeeNoticeFile = (_u: PublicUser) => true

function requireWriter(user: PublicUser) {
  if (!isManager(user)) throw new HttpError(403, '공지사항은 관리자만 쓸 수 있습니다.')
}

type NoticeRow = {
  id: number
  title: string
  body: string
  pinned: number
  author_id: string
  author_name: string | null
  created_at: number
  updated_at: number
  views: number
  files: number
  read: number
}

const SELECT = `SELECT n.*, u.name AS author_name,
    (SELECT COUNT(*) FROM notice_reads r WHERE r.notice_id = n.id) AS views,
    (SELECT COUNT(*) FROM notice_files f WHERE f.notice_id = n.id AND f.inline = 0) AS files,
    EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = :me) AS read
  FROM notices n LEFT JOIN users u ON u.id = n.author_id`

const summary = (n: NoticeRow) => ({
  id: n.id,
  title: n.title,
  pinned: !!n.pinned,
  authorId: n.author_id,
  authorName: n.author_name ?? n.author_id,
  createdAt: n.created_at,
  updatedAt: n.updated_at,
  views: n.views,
  attachments: n.files,
  read: !!n.read,
})

export function listNotices(user: PublicUser) {
  return all<NoticeRow>(`${SELECT} ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`, { me: user.id }).map(summary)
}

// 상세: 읽음으로 남긴다. 앞뒤 글(고정 글 제외, 작성 순)도 함께
export function noticeDetail(user: PublicUser, id: number) {
  const exists = get<{ id: number }>('SELECT id FROM notices WHERE id = :id', { id })
  if (!exists) throw new HttpError(404, '공지사항을 찾을 수 없습니다.')
  run('INSERT OR IGNORE INTO notice_reads (notice_id, user_id, read_at) VALUES (:id, :me, :now)', { id, me: user.id, now: Date.now() })
  const n = get<NoticeRow>(`${SELECT} WHERE n.id = :id`, { id, me: user.id })!
  const attachments = all<{ id: string; name: string; mime: string; size: number }>(
    `SELECT f.id, f.name, f.mime, f.size FROM notice_files nf JOIN files f ON f.id = nf.file_id
     WHERE nf.notice_id = :id AND nf.inline = 0 ORDER BY f.created_at`,
    { id },
  )
  const prev = get<{ id: number; title: string }>(
    'SELECT id, title FROM notices WHERE created_at < :at OR (created_at = :at AND id < :id) ORDER BY created_at DESC, id DESC LIMIT 1',
    { at: n.created_at, id },
  )
  const next = get<{ id: number; title: string }>(
    'SELECT id, title FROM notices WHERE created_at > :at OR (created_at = :at AND id > :id) ORDER BY created_at, id LIMIT 1',
    { at: n.created_at, id },
  )
  return { ...summary(n), body: n.body, files: attachments, prev: prev ?? null, next: next ?? null }
}

function text(value: unknown, label: string, max: number, required = false) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (required && !v) throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  if (v.length > max) throw new HttpError(400, `${label}이(가) 너무 깁니다.`)
  return v
}

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) : [])

// 본문 그림의 파일 id
const inlineIds = (body: string) => [...body.matchAll(/data-file-id="([0-9a-f-]{36})"/g)].map((m) => m[1])

// 새로 붙는 파일은 쓰는 사람이 올린, 아직 어디에도 붙지 않은 파일이어야 한다. 이미 이 공지에 붙은 파일은 그대로 둔다.
function attachFiles(user: PublicUser, noticeId: number, body: string, attachmentIds: string[]) {
  const inline = new Set(inlineIds(body))
  const wanted = new Map<string, number>()
  for (const f of inline) wanted.set(f, 1)
  for (const f of attachmentIds) if (!inline.has(f)) wanted.set(f, 0)
  const current = new Set(all<{ file_id: string }>('SELECT file_id FROM notice_files WHERE notice_id = :noticeId', { noticeId }).map((r) => r.file_id))
  for (const fileId of wanted.keys()) {
    if (current.has(fileId)) continue
    const file = get<{ uploader_id: string; request_id: number | null; kind: string | null }>(
      'SELECT uploader_id, request_id, kind FROM files WHERE id = :fileId',
      { fileId },
    )
    if (!file || file.uploader_id !== user.id || file.request_id !== null || file.kind !== null) {
      throw new HttpError(400, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
    }
  }
  const removed = [...current].filter((f) => !wanted.has(f))
  for (const [fileId, isInline] of wanted) {
    run("UPDATE files SET kind = 'notice' WHERE id = :fileId", { fileId })
    run(
      `INSERT INTO notice_files (notice_id, file_id, inline) VALUES (:noticeId, :fileId, :isInline)
       ON CONFLICT (notice_id, file_id) DO UPDATE SET inline = excluded.inline`,
      { noticeId, fileId, isInline },
    )
  }
  for (const fileId of removed) {
    run('DELETE FROM notice_files WHERE notice_id = :noticeId AND file_id = :fileId', { noticeId, fileId })
    run('DELETE FROM files WHERE id = :fileId', { fileId })
  }
  return removed
}

const removeFromDisk = (fileIds: string[]) => Promise.all(fileIds.map((f) => unlink(join(UPLOAD_DIR, f)).catch(() => {})))

// body = { title, body, pinned, fileIds, notify }
export async function createNotice(user: PublicUser, body: Record<string, unknown>) {
  requireWriter(user)
  const title = text(body.title, '제목', 150, true)
  const html = text(body.body, '본문', 1_000_000)
  const now = Date.now()
  const id = transaction(() => {
    const r = run(
      'INSERT INTO notices (title, body, pinned, author_id, created_at, updated_at) VALUES (:title, :html, :pinned, :me, :now, :now)',
      { title, html, pinned: body.pinned === true ? 1 : 0, me: user.id, now },
    )
    const noticeId = Number(r.lastInsertRowid)
    attachFiles(user, noticeId, html, ids(body.fileIds))
    return noticeId
  })
  // 쓴 사람을 뺀 모든 사람에게 알림(끌 수 있다)
  if (body.notify !== false) {
    const receivers = listUsers()
      .filter((u) => u.active && u.approved && u.id !== user.id)
      .map((u) => u.id)
    notifyLink(receivers, `새 공지사항: ${title}`, `notices/${id}`)
  }
  return { id }
}

export async function updateNotice(user: PublicUser, id: number, body: Record<string, unknown>) {
  requireWriter(user)
  if (!get('SELECT id FROM notices WHERE id = :id', { id })) throw new HttpError(404, '공지사항을 찾을 수 없습니다.')
  const title = text(body.title, '제목', 150, true)
  const html = text(body.body, '본문', 1_000_000)
  const removed = transaction(() => {
    run('UPDATE notices SET title = :title, body = :html, pinned = :pinned, updated_at = :now WHERE id = :id', {
      id,
      title,
      html,
      pinned: body.pinned === true ? 1 : 0,
      now: Date.now(),
    })
    return attachFiles(user, id, html, ids(body.fileIds))
  })
  await removeFromDisk(removed)
  return { id }
}

export async function deleteNotice(user: PublicUser, id: number) {
  requireWriter(user)
  const fileIds = all<{ file_id: string }>('SELECT file_id FROM notice_files WHERE notice_id = :id', { id }).map((r) => r.file_id)
  transaction(() => {
    run('DELETE FROM notice_files WHERE notice_id = :id', { id })
    run('DELETE FROM notice_reads WHERE notice_id = :id', { id })
    run('DELETE FROM notices WHERE id = :id', { id })
    for (const fileId of fileIds) run('DELETE FROM files WHERE id = :fileId', { fileId })
  })
  await removeFromDisk(fileIds)
  return { ok: true }
}
