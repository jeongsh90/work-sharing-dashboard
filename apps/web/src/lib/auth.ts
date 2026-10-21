// 로그인은 서버(apps/api)가 검사한다. 화면에는 계정 정보를 두지 않는다.
import { api, ApiError, SESSION_KEY } from './api'

export const COMPANY_EMAIL_DOMAIN = 'owenfood.com'

// superadmin(슈퍼관리자) · admin(관리자) · designer(작업자) · requester(요청자)
export type Role = 'superadmin' | 'admin' | 'designer' | 'requester'

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: '슈퍼관리자',
  admin: '관리자',
  designer: '작업자',
  requester: '요청자',
}

export type Session = {
  id: string
  name: string
  role: Role
  rank: string
  position: string
  department: string
  presence: string
}

export function isManager(session: { role: Role }) {
  return session.role === 'superadmin' || session.role === 'admin'
}

type Stored = { token: string; user: Session }

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

export function writeStored(value: Stored | null) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 로그인 상태를 유지한다.
  }
}

// 내 정보가 바뀌면(상태·비밀번호) 저장된 값도 바꾼다.
export function updateStoredUser(user: Session, token?: string) {
  const stored = readStored()
  if (stored) writeStored({ token: token ?? stored.token, user })
}

export type LoginResult = { ok: true; session: Session } | { ok: false; error: string }

export async function login(rawId: string, password: string): Promise<LoginResult> {
  const id = rawId.trim()
  if (!id || !password) {
    return { ok: false, error: '아이디(회사 이메일)와 비밀번호를 입력해 주세요.' }
  }
  try {
    const body = await api<Stored>('/login', { body: { id, password } })
    writeStored(body)
    return { ok: true, session: body.user }
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : '로그인하지 못했습니다.' }
  }
}

export function loadSession(): Session | null {
  return readStored()?.user ?? null
}

// 저장된 로그인이 아직 유효한지 서버에 확인한다.
export async function verifySession(): Promise<Session | null> {
  if (!readStored()) return null
  try {
    const { user } = await api<{ user: Session }>('/me')
    updateStoredUser(user)
    return user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      writeStored(null)
      return null
    }
    return readStored()?.user ?? null
  }
}

export async function logout() {
  try {
    await api('/logout', { body: {} })
  } catch {
    // 서버에 닿지 않아도 화면에서는 로그아웃한다.
  }
  writeStored(null)
}
