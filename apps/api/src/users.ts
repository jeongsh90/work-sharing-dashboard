import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import { REMEMBER_TTL_MS, SESSION_TTL_MS } from './config.ts'
import { all, get, run } from './db.ts'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const ROLES = ['superadmin', 'admin', 'designer', 'requester'] as const
export type Role = (typeof ROLES)[number]

export const PRESENCES = ['working', 'away', 'meeting', 'outside', 'vacation', 'off'] as const

// 화면에 내보내는 사용자 정보. 비밀번호 관련 값은 절대 넣지 않는다.
export type PublicUser = {
  id: string
  name: string
  role: Role
  rank: string
  position: string
  department: string
  presence: string
  active: boolean
  canLogin: boolean
  approved: boolean // 회원가입 후 슈퍼관리자 승인 여부
  createdAt: number
}

type UserRow = {
  id: string
  name: string
  role: Role
  rank: string
  position: string
  department: string
  presence: string
  salt: string | null
  hash: string | null
  active: number
  approved: number
  created_at: number
}

function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    rank: u.rank,
    position: u.position,
    department: u.department,
    presence: u.presence,
    active: u.active === 1,
    canLogin: !!u.hash,
    approved: u.approved === 1,
    createdAt: u.created_at,
  }
}

export function isManager(user: { role: Role }) {
  return user.role === 'superadmin' || user.role === 'admin'
}

export function findUser(id: string) {
  const row = get<UserRow>('SELECT * FROM users WHERE id = :id', { id })
  return row ? toPublic(row) : null
}

export function listUsers() {
  return all<UserRow>('SELECT * FROM users ORDER BY sort, created_at').map(toPublic)
}

async function hashPassword(password: string, salt: Buffer) {
  return scryptAsync(password, salt, 64)
}

export async function verifyUser(id: string, password: string): Promise<PublicUser | null> {
  const user = get<UserRow>('SELECT * FROM users WHERE id = :id AND active = 1', { id })
  // 계정이 없어도 같은 시간만큼 계산해 응답 시간으로 계정 존재를 알 수 없게 한다.
  const salt = user?.salt ? Buffer.from(user.salt, 'hex') : randomBytes(16)
  const actual = await hashPassword(password, salt)
  if (!user?.hash) return null
  const expected = Buffer.from(user.hash, 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return toPublic(user)
}

export async function setPassword(id: string, password: string) {
  const salt = randomBytes(16)
  const hash = await hashPassword(password, salt)
  run('UPDATE users SET salt = :salt, hash = :hash WHERE id = :id', {
    id,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
  })
  // 비밀번호가 바뀌면 다른 곳의 로그인은 끊는다.
  run('DELETE FROM sessions WHERE user_id = :id', { id })
}

export type UserFields = Pick<PublicUser, 'name' | 'role' | 'rank' | 'position' | 'department'>

export function createUser(id: string, fields: UserFields, { approved = true } = {}) {
  run(
    `INSERT INTO users (id, name, role, rank, position, department, approved, created_at)
     VALUES (:id, :name, :role, :rank, :position, :department, :approved, :now)`,
    { id, ...fields, approved: approved ? 1 : 0, now: Date.now() },
  )
}

// 가입 승인: 역할을 정해 승인한다.
export function approveUser(id: string, role: Role) {
  run('UPDATE users SET approved = 1, role = :role WHERE id = :id', { id, role })
}

// 가입 거절: 승인 전 계정은 남긴 기록이 없으므로 지운다.
export function deletePendingUser(id: string) {
  run('DELETE FROM users WHERE id = :id AND approved = 0', { id })
}

export function superadminIds() {
  return all<{ id: string }>("SELECT id FROM users WHERE role = 'superadmin' AND active = 1 AND approved = 1").map((u) => u.id)
}

export function updateUser(id: string, fields: Partial<UserFields & { presence: string; active: boolean }>) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const params: Record<string, unknown> = { id }
  const sets = entries.map(([k, v]) => {
    params[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v
    return `${k} = :${k}`
  })
  run(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, params)
  if (fields.active === false) run('DELETE FROM sessions WHERE user_id = :id', { id })
}

// 세션: 토큰 원문은 화면에만 주고, DB 에는 해시만 둔다.
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

// remember: 로그인 상태 유지(30일). 아니면 12시간
export function createSession(userId: string, { remember = false } = {}) {
  const token = randomBytes(32).toString('hex')
  run('DELETE FROM sessions WHERE expires_at < :now', { now: Date.now() })
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (:h, :u, :e)', {
    h: tokenHash(token),
    u: userId,
    e: Date.now() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS),
  })
  return token
}

export function sessionUser(token: string) {
  const row = get<UserRow & { expires_at: number }>(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = :h AND u.active = 1 AND u.approved = 1`,
    { h: tokenHash(token) },
  )
  if (!row || row.expires_at < Date.now()) return null
  return toPublic(row)
}

export function deleteSession(token: string) {
  run('DELETE FROM sessions WHERE token_hash = :h', { h: tokenHash(token) })
}
