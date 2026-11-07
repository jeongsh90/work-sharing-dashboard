import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'
import { personalGroup } from './config.ts'

// 체크리스트(개인 메뉴): 계정마다 자기 체크리스트를 여러 개 만들고(예: "상세페이지 올리기 전 확인"), 항목을 체크한다.
// 다른 사람의 체크리스트는 보이지 않는다(계정 전환 묶음은 함께 — config.personalGroup). 같은 체크를 반복할 때는 "모두 해제"로 처음 상태로 돌린다.

db.exec(`
CREATE TABLE IF NOT EXISTS checklists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checklists_user ON checklists(user_id);
CREATE TABLE IF NOT EXISTS checklist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id     INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  done_at     INTEGER,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checklist_items_list ON checklist_items(list_id);
`)

type ListRow = { id: number; user_id: string; title: string; sort: number; created_at: number; updated_at: number }
type ItemRow = { id: number; list_id: number; body: string; done_at: number | null; sort: number; created_at: number }

const TITLE_MAX = 60
const BODY_MAX = 300

function text(v: unknown, label: string, max: number) {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  if (!s) throw new HttpError(400, `${label}을 입력해 주세요.`)
  return s
}

// 내 체크리스트만(남의 것은 없는 것처럼 404)
function ownList(user: PublicUser, id: number) {
  const row = get<ListRow>('SELECT * FROM checklists WHERE id = :id AND user_id IN (SELECT value FROM json_each(:g))', { id, g: personalGroup(user.id) })
  if (!row) throw new HttpError(404, '체크리스트를 찾을 수 없습니다.')
  return row
}
function ownItem(user: PublicUser, id: number) {
  const row = get<ItemRow>(
    'SELECT i.* FROM checklist_items i JOIN checklists c ON c.id = i.list_id WHERE i.id = :id AND c.user_id IN (SELECT value FROM json_each(:g))',
    { id, g: personalGroup(user.id) },
  )
  if (!row) throw new HttpError(404, '항목을 찾을 수 없습니다.')
  return row
}
const touch = (listId: number) => run('UPDATE checklists SET updated_at = :now WHERE id = :id', { id: listId, now: Date.now() })

const itemDto = (i: ItemRow) => ({ id: i.id, body: i.body, done: i.done_at !== null, doneAt: i.done_at })

export function listChecklists(user: PublicUser) {
  const lists = all<ListRow>('SELECT * FROM checklists WHERE user_id IN (SELECT value FROM json_each(:g)) ORDER BY sort, id', { g: personalGroup(user.id) })
  const items = all<ItemRow>(
    'SELECT i.* FROM checklist_items i JOIN checklists c ON c.id = i.list_id WHERE c.user_id IN (SELECT value FROM json_each(:g)) ORDER BY i.sort, i.id',
    { g: personalGroup(user.id) },
  )
  return lists.map((l) => ({
    id: l.id,
    title: l.title,
    updatedAt: l.updated_at,
    items: items.filter((i) => i.list_id === l.id).map(itemDto),
  }))
}

export function createChecklist(user: PublicUser, body: Record<string, unknown>) {
  const title = text(body.title, '체크리스트 이름', TITLE_MAX)
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM checklists WHERE user_id IN (SELECT value FROM json_each(:g))', { g: personalGroup(user.id) })?.n ?? 0) >= 100) {
    throw new HttpError(400, '체크리스트는 100개까지 만들 수 있습니다.')
  }
  const sort = (get<{ s: number | null }>('SELECT MAX(sort) AS s FROM checklists WHERE user_id IN (SELECT value FROM json_each(:g))', { g: personalGroup(user.id) })?.s ?? -1) + 1
  const now = Date.now()
  const r = run('INSERT INTO checklists (user_id, title, sort, created_at, updated_at) VALUES (:u, :title, :sort, :now, :now)', {
    u: user.id,
    title,
    sort,
    now,
  })
  return { id: Number(r.lastInsertRowid) }
}

export function updateChecklist(user: PublicUser, id: number, body: Record<string, unknown>) {
  ownList(user, id)
  run('UPDATE checklists SET title = :title, updated_at = :now WHERE id = :id', { id, title: text(body.title, '체크리스트 이름', TITLE_MAX), now: Date.now() })
  return { ok: true }
}

export function deleteChecklist(user: PublicUser, id: number) {
  ownList(user, id)
  run('DELETE FROM checklist_items WHERE list_id = :id', { id })
  run('DELETE FROM checklists WHERE id = :id', { id })
  return { ok: true }
}

// 순서 바꾸기: ids 는 내 체크리스트(또는 한 체크리스트의 항목) 전부를 새 순서로
function reorder(table: 'checklists' | 'checklist_items', ids: unknown, known: number[]) {
  const list = Array.isArray(ids) ? ids.filter((v): v is number => Number.isInteger(v)) : []
  const set = new Set(known)
  if (list.length !== set.size || list.some((id) => !set.has(id))) throw new HttpError(400, '목록이 바뀌었습니다. 새로고침 후 다시 해 주세요.')
  db.exec('BEGIN')
  try {
    list.forEach((id, i) => run(`UPDATE ${table} SET sort = :i WHERE id = :id`, { id, i }))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { ok: true }
}

export function reorderChecklists(user: PublicUser, body: Record<string, unknown>) {
  const known = all<{ id: number }>('SELECT id FROM checklists WHERE user_id IN (SELECT value FROM json_each(:g))', { g: personalGroup(user.id) }).map((r) => r.id)
  return reorder('checklists', body.ids, known)
}

export function reorderChecklistItems(user: PublicUser, listId: number, body: Record<string, unknown>) {
  ownList(user, listId)
  const known = all<{ id: number }>('SELECT id FROM checklist_items WHERE list_id = :id', { id: listId }).map((r) => r.id)
  return reorder('checklist_items', body.ids, known)
}

export function addChecklistItem(user: PublicUser, listId: number, body: Record<string, unknown>) {
  ownList(user, listId)
  const text_ = text(body.body, '항목', BODY_MAX)
  if ((get<{ n: number }>('SELECT COUNT(*) AS n FROM checklist_items WHERE list_id = :id', { id: listId })?.n ?? 0) >= 300) {
    throw new HttpError(400, '한 체크리스트에 항목은 300개까지 넣을 수 있습니다.')
  }
  const sort = (get<{ s: number | null }>('SELECT MAX(sort) AS s FROM checklist_items WHERE list_id = :id', { id: listId })?.s ?? -1) + 1
  const r = run('INSERT INTO checklist_items (list_id, body, sort, created_at) VALUES (:id, :body, :sort, :now)', {
    id: listId,
    body: text_,
    sort,
    now: Date.now(),
  })
  touch(listId)
  return itemDto(get<ItemRow>('SELECT * FROM checklist_items WHERE id = :id', { id: Number(r.lastInsertRowid) })!)
}

export function updateChecklistItem(user: PublicUser, id: number, body: Record<string, unknown>) {
  const item = ownItem(user, id)
  if (body.body !== undefined) run('UPDATE checklist_items SET body = :b WHERE id = :id', { id, b: text(body.body, '항목', BODY_MAX) })
  if (typeof body.done === 'boolean') {
    run('UPDATE checklist_items SET done_at = :at WHERE id = :id', { id, at: body.done ? (item.done_at ?? Date.now()) : null })
  }
  touch(item.list_id)
  return itemDto(get<ItemRow>('SELECT * FROM checklist_items WHERE id = :id', { id })!)
}

export function deleteChecklistItem(user: PublicUser, id: number) {
  const item = ownItem(user, id)
  run('DELETE FROM checklist_items WHERE id = :id', { id })
  touch(item.list_id)
  return { ok: true }
}

// 모두 해제(같은 체크를 다시 시작) / 완료한 항목 지우기
export function resetChecklist(user: PublicUser, id: number) {
  ownList(user, id)
  run('UPDATE checklist_items SET done_at = NULL WHERE list_id = :id', { id })
  touch(id)
  return { ok: true }
}
export function clearDoneChecklist(user: PublicUser, id: number) {
  ownList(user, id)
  run('DELETE FROM checklist_items WHERE list_id = :id AND done_at IS NOT NULL', { id })
  touch(id)
  return { ok: true }
}
