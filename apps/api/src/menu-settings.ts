import { SWITCH_ACCOUNTS } from './config.ts'
import { db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { ROLES, type PublicUser, type Role } from './users.ts'

// 메뉴 관리(개인 → 메뉴 관리)
// - 메뉴 권한(슈퍼관리자, 모두에게 적용): 메뉴별로 보이는 역할. 화면(apps/web/src/lib/menu.ts)이 기본 메뉴 정의에 덮어 쓰고,
//   기본으로 허용된 역할 안에서만 줄일 수 있다. 보기는 로그인한 누구나(사이드메뉴를 그려야 하므로), 저장은 슈퍼관리자만.
// - 내 메뉴(계정마다 자기 것): 묶음 안 메뉴 순서, 맨 위 버튼으로 둘 메뉴, 버튼 색.
//   계정 전환 묶음(SWITCH_ACCOUNTS)은 메뉴 순서를 함께 쓴다(한 줄 SHARED_ROW 에 저장). 버튼·색은 계정마다.

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_menu_prefs (
  user_id    TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`)

export type MenuSettings = { roles: Record<string, Role[]>; updatedBy: string | null; updatedAt: number | null }
export type MenuPrefs = { order: Record<string, string[]>; buttons: string[] | null; colors: Record<string, string>; updatedAt: number | null; sharedOrder: boolean }

const SHARED_ROW = '@switch-accounts'
const sharesOrder = (userId: string) => SWITCH_ACCOUNTS.includes(userId)

const ID = /^[a-z0-9-]{1,40}$/
const COLOR = /^[a-z]{1,20}$/
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

export function getMenuSettings(): MenuSettings {
  const row = get<{ value: string; updated_by: string; updated_at: number }>("SELECT * FROM app_settings WHERE key = 'menu'")
  if (!row) return { roles: {}, updatedBy: null, updatedAt: null }
  try {
    const v = JSON.parse(row.value) as { roles?: Record<string, Role[]> }
    return { roles: v.roles ?? {}, updatedBy: row.updated_by, updatedAt: row.updated_at }
  } catch {
    return { roles: {}, updatedBy: row.updated_by, updatedAt: row.updated_at }
  }
}

export function saveMenuSettings(user: PublicUser, body: Record<string, unknown>) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 메뉴 권한을 바꿀 수 있습니다.')
  if (!isObj(body.roles)) throw new HttpError(400, '메뉴 권한 형식이 맞지 않습니다.')
  const roles: Record<string, Role[]> = {}
  for (const [id, list] of Object.entries(body.roles).slice(0, 100)) {
    if (!ID.test(id) || !Array.isArray(list)) throw new HttpError(400, '메뉴 권한 형식이 맞지 않습니다.')
    roles[id] = ROLES.filter((r) => list.includes(r))
  }
  run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('menu', :value, :me, :now)
     ON CONFLICT(key) DO UPDATE SET value = :value, updated_by = :me, updated_at = :now`,
    { value: JSON.stringify({ roles }), me: user.id, now: Date.now() },
  )
  return getMenuSettings()
}

function readRow(id: string) {
  const row = get<{ value: string; updated_at: number }>('SELECT * FROM user_menu_prefs WHERE user_id = :id', { id })
  if (!row) return null
  try {
    return { v: JSON.parse(row.value) as Partial<MenuPrefs>, at: row.updated_at }
  } catch {
    return { v: {} as Partial<MenuPrefs>, at: row.updated_at }
  }
}

export function getMenuPrefs(user: PublicUser): MenuPrefs {
  const shared = sharesOrder(user.id)
  const own = readRow(user.id)
  const group = shared ? readRow(SHARED_ROW) : null
  const order = (shared ? group?.v.order : own?.v.order) ?? {}
  const at = Math.max(own?.at ?? 0, group?.at ?? 0) || null
  return { order, buttons: Array.isArray(own?.v.buttons) ? own.v.buttons : null, colors: own?.v.colors ?? {}, updatedAt: at, sharedOrder: shared }
}

export function saveMenuPrefs(user: PublicUser, body: Record<string, unknown>) {
  if (!isObj(body.order) || !Array.isArray(body.buttons) || !isObj(body.colors)) throw new HttpError(400, '메뉴 설정 형식이 맞지 않습니다.')
  const order: Record<string, string[]> = {}
  for (const [group, ids] of Object.entries(body.order).slice(0, 20)) {
    if (!Array.isArray(ids) || group.length > 20) throw new HttpError(400, '메뉴 순서 형식이 맞지 않습니다.')
    order[group] = [...new Set(ids.filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, 60)
  }
  const buttons = [...new Set(body.buttons.filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, 10)
  const colors: Record<string, string> = {}
  for (const [id, c] of Object.entries(body.colors).slice(0, 60)) if (ID.test(id) && typeof c === 'string' && COLOR.test(c)) colors[id] = c
  const put = (id: string, value: unknown) =>
    run(
      `INSERT INTO user_menu_prefs (user_id, value, updated_at) VALUES (:id, :value, :now)
       ON CONFLICT(user_id) DO UPDATE SET value = :value, updated_at = :now`,
      { id, value: JSON.stringify(value), now: Date.now() },
    )
  if (sharesOrder(user.id)) {
    put(SHARED_ROW, { order })
    put(user.id, { buttons, colors })
  } else put(user.id, { order, buttons, colors })
  return getMenuPrefs(user)
}

export function resetMenuPrefs(user: PublicUser) {
  run('DELETE FROM user_menu_prefs WHERE user_id = :id', { id: user.id })
  return getMenuPrefs(user)
}
