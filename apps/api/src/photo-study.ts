import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { SWITCH_ACCOUNTS, SWITCH_PRIMARY, UPLOAD_DIR } from './config.ts'
import { addColumn, all, db, get, run, transaction } from './db.ts'
import { HttpError, notifyLink } from './requests.ts'
import { isManager, listUsers, type PublicUser } from './users.ts'

// 사진공부방: 관리자가 날짜마다 공지(제목·내용·링크)를 올리면, 직원들이 그 아래에 사진과 사진 설명·피드백을 올리고
// 서로 댓글로 이야기한다. 날짜별로 남겨 두고 지난 공지도 다시 본다.
// 사진은 uploads 에 두고(files.kind = 'photo') photo_files 로 글에 묶는다. 올리기는 /api/uploads 로 먼저 올린 뒤 id 를 보낸다.

db.exec(`
CREATE TABLE IF NOT EXISTS photo_topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  author_id  TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_topics_day ON photo_topics(day);
CREATE TABLE IF NOT EXISTS photo_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES photo_topics(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_posts_topic ON photo_posts(topic_id);
CREATE TABLE IF NOT EXISTS photo_files (
  post_id INTEGER NOT NULL REFERENCES photo_posts(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, file_id)
);
CREATE TABLE IF NOT EXISTS photo_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES photo_posts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_comments_post ON photo_comments(post_id);
`)

// 예약 등록: publish_at 이 있으면 그때 목록에 보이고 알림이 간다(그 전에는 쓴 사람·관리자만 본다).
// notified = 0 이면 아직 새 공지 알림을 보내지 않은 글(예약 글). 1분마다 확인해 때가 되면 보낸다
if (addColumn('photo_topics', 'publish_at', 'INTEGER')) {
  /* 예전 공지는 바로 공개 */
}
addColumn('photo_topics', 'notified', 'INTEGER NOT NULL DEFAULT 1')

// ── 사진공부방 접근 권한(멤버) ──
// 슈퍼관리자가 메뉴 관리 → 메뉴 권한에서 계정을 골라 준다(app_settings 'photo-study-members' = { members: [계정 id] }).
// 계정 전환 묶음(SWITCH_ACCOUNTS)에 든 계정이 하나라도 있으면 묶음 전체가 멤버다(예: 정상훈 연결 계정).
// 멤버만 메뉴를 보고, 공지(예약 포함)·사진·댓글을 올리고, 알림을 받는다. 아직 정하지 않았으면 예전처럼 모두가 멤버
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL);`)
const MEMBERS_KEY = 'photo-study-members'

function savedMembers(): string[] | null {
  const row = get<{ value: string }>('SELECT value FROM app_settings WHERE key = :key', { key: MEMBERS_KEY })
  if (!row) return null
  try {
    const list = (JSON.parse(row.value) as { members?: unknown }).members
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function memberIds(): Set<string> | null {
  const list = savedMembers()
  if (!list) return null
  const ids = new Set(list)
  if (SWITCH_ACCOUNTS.some((id) => ids.has(id))) for (const id of SWITCH_ACCOUNTS) ids.add(id)
  return ids
}

// 권한 보기(슈퍼관리자): 고른 계정, 아직 정하지 않았으면 null
export function photoStudyMembers(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 볼 수 있습니다.')
  return { members: savedMembers(), linked: [...SWITCH_ACCOUNTS] }
}
export function setPhotoStudyMembers(user: PublicUser, body: Record<string, unknown>) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 정할 수 있습니다.')
  const known = new Set(listUsers().map((u) => u.id))
  const members = body.members === null ? null : [...new Set(ids(body.members).filter((id) => known.has(id)))]
  if (members === null) run('DELETE FROM app_settings WHERE key = :key', { key: MEMBERS_KEY })
  else
    run(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (:key, :value, :me, :now)
       ON CONFLICT(key) DO UPDATE SET value = :value, updated_by = :me, updated_at = :now`,
      { key: MEMBERS_KEY, value: JSON.stringify({ members }), me: user.id, now: Date.now() },
    )
  return photoStudyMembers(user)
}
export const photoStudyAccess = (user: PublicUser) => ({ member: isPhotoMember(user) })
export const isPhotoMember = (u: PublicUser) => memberIds()?.has(u.id) ?? true
const member = (u: PublicUser) => {
  if (!isPhotoMember(u)) throw new HttpError(403, '사진공부방 권한이 없습니다.')
}
// 글쓴이 계정: 계정 전환 묶음(admin·테스트·애찬_Ai 등)으로 쓰면 대표 계정(정상훈)으로 올린다
const actorOf = (user: PublicUser) => (SWITCH_ACCOUNTS.includes(user.id) ? SWITCH_PRIMARY : user.id)
// 같은 사람(본인 또는 같은 전환 묶음)인지
const samePerson = (a: string, b: string) => a === b || (SWITCH_ACCOUNTS.includes(a) && SWITCH_ACCOUNTS.includes(b))

// 알림 받을 멤버(로그인할 수 있는 사람만). 글쓴이와 같은 전환 묶음 계정은 뺀다
const memberReceivers = (except: string) =>
  listUsers()
    .filter((u) => u.active && u.approved && !samePerson(u.id, except) && isPhotoMember(u))
    .map((u) => u.id)

// 사진공부방 사진은 멤버만 본다
export const canSeePhotoFile = (u: PublicUser) => isPhotoMember(u)

const DAY = /^\d{4}-\d{2}-\d{2}$/
const FILES_MAX = 30

function text(value: unknown, label: string, max: number) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (v.length > max) throw new HttpError(400, `${label}은(는) ${max}자까지 입력할 수 있습니다.`)
  return v
}
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
// 공지 고치기·지우기: 쓴 사람 또는 관리자
const topicOwner = (user: PublicUser, t: { author_id: string }) => {
  if (!samePerson(t.author_id, user.id) && !isManager(user)) throw new HttpError(403, '공지는 쓴 사람이나 관리자만 고칠 수 있습니다.')
}

type TopicRow = { id: number; day: string; title: string; body: string; link: string; publish_at: number | null; notified: number; author_id: string; author_name: string | null; created_at: number; updated_at: number }
type PostRow = { id: number; topic_id: number; author_id: string; author_name: string | null; avatar_id: string | null; body: string; created_at: number; updated_at: number }
type FileRow = { post_id: number; id: string; name: string; mime: string; size: number }
type CommentRow = { id: number; post_id: number; author_id: string; author_name: string | null; avatar_id: string | null; body: string; created_at: number }

const topicDto = (t: TopicRow) => ({
  id: t.id,
  day: t.day,
  title: t.title,
  body: t.body,
  link: t.link,
  // 예약 글: 공개될 때(그 전이면 scheduled = true)
  publishAt: t.publish_at,
  scheduled: !!t.publish_at && t.publish_at > Date.now(),
  authorId: t.author_id,
  authorName: t.author_name ?? t.author_id,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
})

const TOPIC_SELECT = `SELECT t.*, u.name AS author_name FROM photo_topics t LEFT JOIN users u ON u.id = t.author_id`

// 예약 글은 공개 전까지 쓴 사람과, 사진공부방 접근 권한이 있는 관리자·슈퍼관리자만 본다(다른 멤버는 공개 때까지 못 본다)
const visibleTo = (user: PublicUser, t: TopicRow) =>
  !t.publish_at || t.publish_at <= Date.now() || samePerson(t.author_id, user.id) || (isManager(user) && isPhotoMember(user))

function loadTopic(id: number, user?: PublicUser) {
  const row = get<TopicRow>(`${TOPIC_SELECT} WHERE t.id = :id`, { id })
  if (!row || (user && !visibleTo(user, row))) throw new HttpError(404, '공지를 찾을 수 없습니다.')
  return row
}

// 목록: 날짜 최신순. 글 수·사진 수·참여한 사람 수·마지막 글 시각을 함께
export function listPhotoTopics(user: PublicUser) {
  member(user)
  const stats = new Map(
    all<{ topic_id: number; posts: number; people: number; last: number }>(
      'SELECT topic_id, COUNT(*) AS posts, COUNT(DISTINCT author_id) AS people, MAX(created_at) AS last FROM photo_posts GROUP BY topic_id',
    ).map((r) => [r.topic_id, r]),
  )
  const photos = new Map(
    all<{ topic_id: number; n: number }>('SELECT p.topic_id, COUNT(*) AS n FROM photo_files f JOIN photo_posts p ON p.id = f.post_id GROUP BY p.topic_id').map((r) => [r.topic_id, r.n]),
  )
  return all<TopicRow>(`${TOPIC_SELECT} ORDER BY t.day DESC, t.id DESC`).filter((t) => visibleTo(user, t)).map((t) => ({
    ...topicDto(t),
    posts: stats.get(t.id)?.posts ?? 0,
    people: stats.get(t.id)?.people ?? 0,
    photos: photos.get(t.id) ?? 0,
    lastPostAt: stats.get(t.id)?.last ?? null,
  }))
}

// 공지 하나 + 그 아래 글(오래된 순) · 사진 · 댓글
export function photoTopicDetail(user: PublicUser, id: number) {
  member(user)
  const topic = topicDto(loadTopic(id, user))
  const posts = all<PostRow>(
    `SELECT p.*, u.name AS author_name, u.avatar_id FROM photo_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.topic_id = :id ORDER BY p.created_at, p.id`,
    { id },
  )
  const postIds = posts.map((p) => p.id).join(',')
  const files = new Map<number, Omit<FileRow, 'post_id'>[]>()
  const comments = new Map<number, ReturnType<typeof commentDto>[]>()
  if (postIds) {
    for (const f of all<FileRow>(
      `SELECT pf.post_id, f.id, f.name, f.mime, f.size FROM photo_files pf JOIN files f ON f.id = pf.file_id WHERE pf.post_id IN (${postIds}) ORDER BY f.created_at, f.name`,
    )) {
      const { post_id, ...file } = f
      files.set(post_id, [...(files.get(post_id) ?? []), file])
    }
    for (const c of all<CommentRow>(
      `SELECT c.*, u.name AS author_name, u.avatar_id FROM photo_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.post_id IN (${postIds}) ORDER BY c.created_at, c.id`,
    )) {
      comments.set(c.post_id, [...(comments.get(c.post_id) ?? []), commentDto(c)])
    }
  }
  return {
    ...topic,
    me: actorOf(user),
    posts: posts.map((p) => ({
      id: p.id,
      authorId: p.author_id,
      authorName: p.author_name ?? p.author_id,
      avatarId: p.avatar_id,
      body: p.body,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      files: files.get(p.id) ?? [],
      comments: comments.get(p.id) ?? [],
    })),
  }
}

const commentDto = (c: CommentRow) => ({
  id: c.id,
  authorId: c.author_id,
  authorName: c.author_name ?? c.author_id,
  avatarId: c.avatar_id,
  body: c.body,
  createdAt: c.created_at,
})

function topicFields(body: Record<string, unknown>) {
  const day = text(body.day, '날짜', 10)
  if (!DAY.test(day)) throw new HttpError(400, '날짜를 골라 주세요.')
  const title = text(body.title, '제목', 100)
  if (!title) throw new HttpError(400, '제목을 입력해 주세요.')
  const link = text(body.link, '링크', 500)
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new HttpError(400, '링크는 http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.')
  // 예약 등록 시각(ms). 없거나 30초 안이면 바로 공개
  const at = Number(body.publishAt)
  const publishAt = body.publishAt != null && Number.isFinite(at) && at > Date.now() + 30_000 ? Math.floor(at) : null
  if (publishAt && publishAt > Date.now() + 366 * 24 * 60 * 60_000) throw new HttpError(400, '예약은 1년 안으로 잡아 주세요.')
  return { day, title, body: text(body.body, '공지 내용', 5000), link, publishAt }
}

// 새 공지 알림: 사진공부방 멤버에게(쓴 사람 빼고)
function announce(t: Pick<TopicRow, 'id' | 'title' | 'author_id'>) {
  run('UPDATE photo_topics SET notified = 1 WHERE id = :id', { id: t.id })
  notifyLink(memberReceivers(t.author_id), `사진공부방 새 공지: ${t.title}`, `photo-study/${t.id}`)
}

// 예약 시각이 된 공지를 알린다(1분마다)
export function publishDuePhotoTopics() {
  for (const t of all<TopicRow>(`${TOPIC_SELECT} WHERE t.notified = 0 AND t.publish_at IS NOT NULL AND t.publish_at <= :now`, { now: Date.now() })) announce(t)
}
setInterval(() => {
  try {
    publishDuePhotoTopics()
  } catch (e) {
    console.error('사진공부방 예약 공지 확인 실패:', e)
  }
}, 60_000).unref()

// 새 공지: 멤버. 바로 올리면 멤버에게 바로 알리고, 예약이면 그 시각에 공개·알림
export function createPhotoTopic(user: PublicUser, body: Record<string, unknown>) {
  member(user)
  const f = topicFields(body)
  const now = Date.now()
  const id = Number(
    run(
      `INSERT INTO photo_topics (day, title, body, link, publish_at, notified, author_id, created_at, updated_at)
       VALUES (:day, :title, :body, :link, :publishAt, :notified, :me, :now, :now)`,
      { ...f, notified: f.publishAt ? 0 : 1, me: actorOf(user), now },
    ).lastInsertRowid,
  )
  if (!f.publishAt) announce({ id, title: f.title, author_id: actorOf(user) })
  return photoTopicDetail(user, id)
}

// 공지 고치기: 쓴 사람·관리자. 아직 알리지 않은 예약 글은 예약 시각도 바꾸거나 비워서 바로 공개할 수 있다
export function updatePhotoTopic(user: PublicUser, id: number, body: Record<string, unknown>) {
  member(user)
  const t = loadTopic(id, user)
  topicOwner(user, t)
  const f = topicFields(body)
  const pending = t.notified === 0
  run('UPDATE photo_topics SET day = :day, title = :title, body = :body, link = :link, publish_at = :publishAt, updated_at = :now WHERE id = :id', {
    ...f,
    publishAt: pending ? f.publishAt : t.publish_at,
    id,
    now: Date.now(),
  })
  if (pending && !f.publishAt) announce({ id, title: f.title, author_id: t.author_id })
  return photoTopicDetail(user, id)
}

const removeFiles = async (fileIds: string[]) => {
  for (const fileId of fileIds) run('DELETE FROM files WHERE id = :fileId', { fileId })
  await Promise.all(fileIds.map((f) => unlink(join(UPLOAD_DIR, f)).catch(() => {})))
}

// 공지 지우기: 관리자. 그 아래 글·사진·댓글도 함께 지운다(사진 파일은 백업에는 남는다)
export async function deletePhotoTopic(user: PublicUser, id: number) {
  member(user)
  topicOwner(user, loadTopic(id, user))
  const fileIds = all<{ file_id: string }>('SELECT f.file_id FROM photo_files f JOIN photo_posts p ON p.id = f.post_id WHERE p.topic_id = :id', { id }).map((r) => r.file_id)
  run('DELETE FROM photo_topics WHERE id = :id', { id })
  await removeFiles(fileIds)
  return { ok: true }
}

// 올린 사람 본인의, 아직 어디에도 붙지 않은 이미지 파일만 붙인다
function attach(user: PublicUser, postId: number, fileIds: string[]) {
  for (const id of fileIds) {
    const file = get<{ uploader_id: string; request_id: number | null; kind: string | null; mime: string }>(
      'SELECT uploader_id, request_id, kind, mime FROM files WHERE id = :id',
      { id },
    )
    if (!file || file.uploader_id !== user.id || file.request_id !== null || file.kind !== null) {
      throw new HttpError(400, '올린 사진을 찾을 수 없습니다. 다시 올려 주세요.')
    }
    if (!file.mime.startsWith('image/')) throw new HttpError(400, '사진(이미지) 파일만 올릴 수 있습니다.')
    run("UPDATE files SET kind = 'photo' WHERE id = :id", { id })
    run('INSERT INTO photo_files (post_id, file_id) VALUES (:postId, :id)', { postId, id })
  }
}

// 사진 글 올리기: 누구나. body = { body, fileIds }. 사진이나 글 중 하나는 있어야 한다
// 공지 올린 사람과 이 공지에 글·댓글을 남긴 사람에게 알린다
export function createPhotoPost(user: PublicUser, topicId: number, body: Record<string, unknown>) {
  member(user)
  const topic = loadTopic(topicId, user)
  const content = text(body.body, '내용', 5000)
  const fileIds = [...new Set(ids(body.fileIds))]
  if (fileIds.length > FILES_MAX) throw new HttpError(400, `사진은 한 번에 ${FILES_MAX}장까지 올릴 수 있습니다.`)
  if (!content && fileIds.length === 0) throw new HttpError(400, '사진을 올리거나 내용을 적어 주세요.')
  const now = Date.now()
  transaction(() => {
    const postId = Number(
      run('INSERT INTO photo_posts (topic_id, author_id, body, created_at, updated_at) VALUES (:topicId, :me, :body, :now, :now)', {
        topicId,
        me: actorOf(user),
        body: content,
        now,
      }).lastInsertRowid,
    )
    attach(user, postId, fileIds)
  })
  notifyLink(participants(topicId, topic.author_id, user.id), `사진공부방 「${topic.title}」에 ${actorName(user)}님이 사진을 올렸습니다`, `photo-study/${topicId}`)
  return photoTopicDetail(user, topicId)
}

const actorName = (user: PublicUser) => listUsers().find((u) => u.id === actorOf(user))?.name ?? user.name

function participants(topicId: number, topicAuthor: string, except: string) {
  const people = new Set([
    topicAuthor,
    ...all<{ author_id: string }>('SELECT DISTINCT author_id FROM photo_posts WHERE topic_id = :topicId', { topicId }).map((r) => r.author_id),
    ...all<{ author_id: string }>('SELECT DISTINCT c.author_id FROM photo_comments c JOIN photo_posts p ON p.id = c.post_id WHERE p.topic_id = :topicId', { topicId }).map((r) => r.author_id),
  ])
  people.delete(except)
  // 알림은 지금 멤버에게만
  const allowed = new Set(memberReceivers(except))
  return [...people].filter((id) => allowed.has(id))
}

function loadPost(id: number) {
  const row = get<{ id: number; topic_id: number; author_id: string }>('SELECT id, topic_id, author_id FROM photo_posts WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '글을 찾을 수 없습니다.')
  return row
}
const ownOrManager = (user: PublicUser, authorId: string) => {
  if (!samePerson(authorId, user.id) && !isManager(user)) throw new HttpError(403, '올린 사람이나 관리자만 고칠 수 있습니다.')
}

// 글 고치기(내용만, 사진 빼기): 올린 사람 또는 관리자. body = { body, removeFileIds }
export async function updatePhotoPost(user: PublicUser, id: number, body: Record<string, unknown>) {
  member(user)
  const post = loadPost(id)
  ownOrManager(user, post.author_id)
  const content = text(body.body, '내용', 5000)
  const current = all<{ file_id: string }>('SELECT file_id FROM photo_files WHERE post_id = :id', { id }).map((r) => r.file_id)
  const removed = ids(body.removeFileIds).filter((f) => current.includes(f))
  if (!content && removed.length === current.length) throw new HttpError(400, '사진이나 내용 중 하나는 남겨 주세요.')
  run('UPDATE photo_posts SET body = :body, updated_at = :now WHERE id = :id', { id, body: content, now: Date.now() })
  for (const fileId of removed) run('DELETE FROM photo_files WHERE post_id = :id AND file_id = :fileId', { id, fileId })
  await removeFiles(removed)
  return photoTopicDetail(user, post.topic_id)
}

export async function deletePhotoPost(user: PublicUser, id: number) {
  member(user)
  const post = loadPost(id)
  ownOrManager(user, post.author_id)
  const fileIds = all<{ file_id: string }>('SELECT file_id FROM photo_files WHERE post_id = :id', { id }).map((r) => r.file_id)
  run('DELETE FROM photo_posts WHERE id = :id', { id })
  await removeFiles(fileIds)
  return photoTopicDetail(user, post.topic_id)
}

// 댓글: 누구나. 글 올린 사람(과 이 공지 참여자)에게 알린다
export function createPhotoComment(user: PublicUser, postId: number, body: Record<string, unknown>) {
  member(user)
  const post = loadPost(postId)
  const content = text(body.body, '댓글', 2000)
  if (!content) throw new HttpError(400, '댓글을 입력해 주세요.')
  run('INSERT INTO photo_comments (post_id, author_id, body, created_at) VALUES (:postId, :me, :body, :now)', { postId, me: actorOf(user), body: content, now: Date.now() })
  const topic = loadTopic(post.topic_id)
  notifyLink(participants(post.topic_id, topic.author_id, user.id), `사진공부방 「${topic.title}」에 ${actorName(user)}님이 댓글을 남겼습니다`, `photo-study/${post.topic_id}`)
  return photoTopicDetail(user, post.topic_id)
}

export function deletePhotoComment(user: PublicUser, id: number) {
  member(user)
  const row = get<{ post_id: number; author_id: string }>('SELECT post_id, author_id FROM photo_comments WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '댓글을 찾을 수 없습니다.')
  ownOrManager(user, row.author_id)
  run('DELETE FROM photo_comments WHERE id = :id', { id })
  return photoTopicDetail(user, loadPost(row.post_id).topic_id)
}
