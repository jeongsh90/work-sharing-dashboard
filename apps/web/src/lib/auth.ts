// 로그인은 서버(apps/api)가 검사한다. 화면에는 계정 정보를 두지 않는다.

export const COMPANY_EMAIL_DOMAIN = 'owenfood.com'

// 비어 있으면 같은 주소의 /api 를 쓴다(로컬 개발은 vite 프록시, Tailscale 은 같은 서버).
const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export type Role = 'superadmin'

export type Session = {
  id: string
  name: string
  role: Role
}

type Stored = { token: string; user: Session }

const SESSION_KEY = 'wsd-session'

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

function writeStored(value: Stored | null) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 로그인 상태를 유지한다.
  }
}

async function request(path: string, init: RequestInit = {}) {
  const token = readStored()?.token
  return fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
}

export type LoginResult = { ok: true; session: Session } | { ok: false; error: string }

export async function login(rawId: string, password: string): Promise<LoginResult> {
  const id = rawId.trim()
  if (!id || !password) {
    return { ok: false, error: '아이디(회사 이메일)와 비밀번호를 입력해 주세요.' }
  }
  try {
    const res = await request('/login', { method: 'POST', body: JSON.stringify({ id, password }) })
    const body = await res.json()
    if (!res.ok) return { ok: false, error: body.error ?? '로그인하지 못했습니다.' }
    writeStored({ token: body.token, user: body.user })
    return { ok: true, session: body.user }
  } catch {
    return { ok: false, error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

export function loadSession(): Session | null {
  return readStored()?.user ?? null
}

// 저장된 로그인이 아직 유효한지 서버에 확인한다.
export async function verifySession(): Promise<Session | null> {
  if (!readStored()) return null
  try {
    const res = await request('/me')
    if (res.ok) return (await res.json()).user
    if (res.status === 401) writeStored(null)
    return null
  } catch {
    return readStored()?.user ?? null
  }
}

export async function logout() {
  try {
    await request('/logout', { method: 'POST' })
  } catch {
    // 서버에 닿지 않아도 화면에서는 로그아웃한다.
  }
  writeStored(null)
}
