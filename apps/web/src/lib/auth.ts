// 로그인은 서버(apps/api)가 검사한다. 화면에는 계정 정보를 두지 않는다.
import { api, ApiError, readSessionRaw, SESSION_KEY } from './api'

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
  avatarId?: string | null // 프로필 사진 파일 id
}

// 슈퍼관리자·본부장: 상태와 상관없이 요청 내용 수정(서버 canEditAnytime 과 같다)
export function canEditAnytime(session: Pick<Session, 'role' | 'rank' | 'position'>) {
  return session.role === 'superadmin' || /본부장/.test(`${session.rank} ${session.position}`)
}

// 목록에서 "요청 수정"을 누르면 상세 화면을 수정 모드로 연다(이 값으로 넘긴다)
export const EDIT_ON_OPEN_KEY = 'wsd-edit-on-open'

export function isManager(session: { role: Role }) {
  return session.role === 'superadmin' || session.role === 'admin'
}

type Stored = { token: string; user: Session }

function readStored(): Stored | null {
  try {
    const raw = readSessionRaw()
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

// persist: 로그인 상태 유지(브라우저를 껐다 켜도 남는다). 정하지 않으면 지금 저장된 곳을 그대로 쓴다.
export function writeStored(value: Stored | null, persist?: boolean) {
  try {
    if (!value) {
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_KEY)
      return
    }
    const keep = persist ?? (sessionStorage.getItem(SESSION_KEY) === null && localStorage.getItem(SESSION_KEY) !== null)
    if (keep) {
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.setItem(SESSION_KEY, JSON.stringify(value))
    } else {
      localStorage.removeItem(SESSION_KEY)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
    }
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 로그인 상태를 유지한다.
  }
}

// 로그인 화면의 "아이디 기억": 아이디만 브라우저에 남긴다(비밀번호는 저장하지 않는다).
const REMEMBER_ID_KEY = 'wsd-remember-id'

export function rememberedId(): string {
  try {
    return localStorage.getItem(REMEMBER_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveRememberedId(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBER_ID_KEY, id)
    else localStorage.removeItem(REMEMBER_ID_KEY)
  } catch {
    // 저장할 수 없으면 기억하지 않는다.
  }
}

// 내 정보가 바뀌면(상태·비밀번호) 저장된 값도 바꾼다.
export function updateStoredUser(user: Session, token?: string) {
  const stored = readStored()
  if (stored) writeStored({ token: token ?? stored.token, user })
}

export type LoginResult = { ok: true; session: Session } | { ok: false; error: string }

export async function login(
  rawId: string,
  password: string,
  { rememberId = false, keepLoggedIn = false } = {},
): Promise<LoginResult> {
  const id = rawId.trim()
  if (!id || !password) {
    return { ok: false, error: '아이디(회사 이메일)와 비밀번호를 입력해 주세요.' }
  }
  try {
    const body = await api<Stored>('/login', { body: { id, password, remember: keepLoggedIn } })
    writeStored(body, keepLoggedIn)
    saveRememberedId(rememberId ? id : null)
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
