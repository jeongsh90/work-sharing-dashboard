import { db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { ROLES, type PublicUser, type Role } from './users.ts'

// 메뉴 관리(관리 → 메뉴 관리, 슈퍼관리자): 사이드메뉴 묶음 안의 메뉴 순서와 메뉴별로 보이는 역할.
// 화면(apps/web/src/lib/menu.ts)이 기본 메뉴 정의에 이 설정을 덮어 쓴다. 역할은 기본으로 허용된 역할 안에서만 줄일 수 있다.
// 보기는 로그인한 누구나(사이드메뉴를 그려야 하므로), 저장은 슈퍼관리자만.

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`)

export type MenuSettings = {
  order: Record<string, string[]>
  roles: Record<string, Role[]>
  // 사이드메뉴 맨 위(로고 아래)에 큰 버튼으로 보일 메뉴. 설정이 없으면 디자인 요청 하나
  buttons: string[] | null
  updatedBy: string | null
  updatedAt: number | null
}

const ID = /^[a-z0-9-]{1,40}$/

export function getMenuSettings(): MenuSettings {
  const row = get<{ value: string; updated_by: string; updated_at: number }>("SELECT * FROM app_settings WHERE key = 'menu'")
  if (!row) return { order: {}, roles: {}, buttons: null, updatedBy: null, updatedAt: null }
  try {
    const v = JSON.parse(row.value) as Pick<MenuSettings, 'order' | 'roles' | 'buttons'>
    return { order: v.order ?? {}, roles: v.roles ?? {}, buttons: Array.isArray(v.buttons) ? v.buttons : null, updatedBy: row.updated_by, updatedAt: row.updated_at }
  } catch {
    return { order: {}, roles: {}, buttons: null, updatedBy: row.updated_by, updatedAt: row.updated_at }
  }
}

export function saveMenuSettings(user: PublicUser, body: Record<string, unknown>) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 메뉴를 바꿀 수 있습니다.')
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  if (!isObj(body.order) || !isObj(body.roles)) throw new HttpError(400, '메뉴 설정 형식이 맞지 않습니다.')

  const order: Record<string, string[]> = {}
  for (const [group, ids] of Object.entries(body.order).slice(0, 20)) {
    if (!Array.isArray(ids) || group.length > 20) throw new HttpError(400, '메뉴 순서 형식이 맞지 않습니다.')
    const list = ids.filter((id): id is string => typeof id === 'string' && ID.test(id))
    order[group] = [...new Set(list)].slice(0, 60)
  }
  const roles: Record<string, Role[]> = {}
  for (const [id, list] of Object.entries(body.roles).slice(0, 100)) {
    if (!ID.test(id) || !Array.isArray(list)) throw new HttpError(400, '메뉴 권한 형식이 맞지 않습니다.')
    roles[id] = ROLES.filter((r) => list.includes(r))
  }

  if (!Array.isArray(body.buttons)) throw new HttpError(400, '버튼 메뉴 형식이 맞지 않습니다.')
  const buttons = [...new Set(body.buttons.filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, 10)

  run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('menu', :value, :me, :now)
     ON CONFLICT(key) DO UPDATE SET value = :value, updated_by = :me, updated_at = :now`,
    { value: JSON.stringify({ order, roles, buttons }), me: user.id, now: Date.now() },
  )
  return getMenuSettings()
}
