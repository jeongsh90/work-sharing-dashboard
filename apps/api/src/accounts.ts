import { randomUUID } from 'node:crypto'

import { all, db, get, run } from './db.ts'
import { decrypt, encrypt } from './ftp.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'

// 계정 정보(슈퍼관리자): 회사에서 쓰는 외부 서비스 계정(서비스·아이디·비밀번호·호스트·링크·메모)을 모아 둔다.
// 비밀번호 두 칸(password·password2)은 FTP 비밀번호와 같은 키(data/ftp-key)로 암호화해 DB 에 둔다.
// 목록에는 비밀번호를 싣지 않고, 화면에서 보기·복사를 누를 때만 /secret 으로 하나씩 꺼낸다.

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  service    TEXT NOT NULL,
  login_id   TEXT NOT NULL DEFAULT '',
  password   TEXT NOT NULL DEFAULT '',
  host       TEXT NOT NULL DEFAULT '',
  password2  TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  memo       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`)

type Row = {
  id: string
  service: string
  login_id: string
  password: string
  host: string
  password2: string
  link: string
  memo: string
  sort: number
  updated_by: string | null
  updated_at: number
  created_at: number
}

function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 쓸 수 있습니다.')
}

const toDto = (r: Row) => ({
  id: r.id,
  service: r.service,
  loginId: r.login_id,
  host: r.host,
  link: r.link,
  memo: r.memo,
  hasPassword: r.password !== '',
  hasPassword2: r.password2 !== '',
  updatedAt: r.updated_at,
})

function find(id: string) {
  const row = get<Row>('SELECT * FROM accounts WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '계정 정보를 찾을 수 없습니다.')
  return row
}

export function listAccounts(user: PublicUser) {
  requireSuperadmin(user)
  return all<Row>('SELECT * FROM accounts ORDER BY sort, created_at').map(toDto)
}

export function accountSecret(user: PublicUser, id: string) {
  requireSuperadmin(user)
  const r = find(id)
  return { password: r.password ? decrypt(r.password) : '', password2: r.password2 ? decrypt(r.password2) : '' }
}

// 비밀번호 칸: 보내지 않으면(undefined) 그대로, 빈 글자면 지움
function secretField(v: unknown, keep: string) {
  if (v === undefined) return keep
  if (typeof v !== 'string') return keep
  const s = v.slice(0, 500)
  return s ? encrypt(s) : ''
}

function fields(body: Record<string, unknown>, editing: Row | null) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const service = str(body.service, 100)
  if (!service) throw new HttpError(400, '서비스 이름을 입력해 주세요.')
  return {
    service,
    login_id: str(body.loginId, 300),
    host: str(body.host, 300),
    link: str(body.link, 500),
    memo: str(body.memo, 2000),
    password: secretField(body.password, editing?.password ?? ''),
    password2: secretField(body.password2, editing?.password2 ?? ''),
  }
}

export function addAccount(user: PublicUser, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body, null)
  const id = randomUUID()
  const now = Date.now()
  const sort = get<{ n: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM accounts')?.n ?? 1
  run(
    `INSERT INTO accounts (id, service, login_id, password, host, password2, link, memo, sort, updated_by, updated_at, created_at)
     VALUES (:id, :service, :login_id, :password, :host, :password2, :link, :memo, :sort, :me, :now, :now)`,
    { id, ...f, sort, me: user.id, now },
  )
  return toDto(find(id))
}

export function updateAccount(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body, find(id))
  run(
    `UPDATE accounts SET service = :service, login_id = :login_id, password = :password, host = :host, password2 = :password2,
     link = :link, memo = :memo, updated_by = :me, updated_at = :now WHERE id = :id`,
    { id, ...f, me: user.id, now: Date.now() },
  )
  return toDto(find(id))
}

export function deleteAccount(user: PublicUser, id: string) {
  requireSuperadmin(user)
  find(id)
  run('DELETE FROM accounts WHERE id = :id', { id })
  return { ok: true }
}
