import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, posix } from 'node:path'
import { PassThrough } from 'node:stream'

import { Client, FileType } from 'basic-ftp'

import { DATA_DIR } from './config.ts'
import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager } from './users.ts'
import type { PublicUser } from './users.ts'

// FTP: 이미 있는 FTP 서버(카페24 등)를 사이트 안에서 쓴다. 서버 PC 가 대신 접속해 폴더 보기·올리기·내려받기를 한다.
// 접속 정보는 슈퍼관리자가 관리 → FTP 서버 화면에서 넣는다. 비밀번호는 data/ftp-key 로 암호화해 DB 에 두고 화면에는 절대 보내지 않는다.
// 쓰기(폴더 보기·올리기·내려받기·새 폴더)는 디자인팀·관리자, 지우기는 관리자만.

db.exec(`
CREATE TABLE IF NOT EXISTS ftp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL DEFAULT 21,
  username   TEXT NOT NULL,
  password   TEXT NOT NULL,
  secure     INTEGER NOT NULL DEFAULT 0,
  root       TEXT NOT NULL DEFAULT '/',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`)

type Row = {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  secure: number
  root: string
  sort: number
  created_by: string
  created_at: number
}

// ── 비밀번호 암호화(AES-256-GCM). 키는 data/ftp-key(처음 쓸 때 만든다, git 에 없음) ──
const KEY_FILE = join(DATA_DIR, 'ftp-key')
let key: Buffer | null = null
function secretKey() {
  if (key) return key
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
  key = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
  return key
}
function encrypt(text: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', secretKey(), iv)
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split('.').map((s) => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', secretKey(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(data), d.final()]).toString('utf8')
}

const canUseFtp = (u: PublicUser) => u.role === 'designer' || isManager(u)
function requireFtpUser(user: PublicUser) {
  if (!canUseFtp(user)) throw new HttpError(403, 'FTP 는 디자인팀과 관리자만 쓸 수 있습니다.')
}
function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 쓸 수 있습니다.')
}

// 화면에 보내는 모양. 접속 정보(주소·아이디)는 슈퍼관리자에게만, 비밀번호는 누구에게도 보내지 않는다
function toDto(r: Row, user: PublicUser) {
  const base = { id: r.id, name: r.name, root: r.root }
  if (user.role !== 'superadmin') return base
  return { ...base, host: r.host, port: r.port, username: r.username, secure: r.secure === 1, createdBy: r.created_by, createdAt: r.created_at }
}

export function listFtpServers(user: PublicUser) {
  requireFtpUser(user)
  return all<Row>('SELECT * FROM ftp_servers ORDER BY sort, created_at').map((r) => toDto(r, user))
}

// 시작 폴더 등 경로: / 로 시작하는 정리된 경로
function cleanPath(value: unknown, fallback = '/') {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  const p = posix.normalize('/' + raw.replace(/\\/g, '/'))
  return p.length > 1 ? p.replace(/\/+$/, '') : '/'
}

function fields(body: Record<string, unknown>, editing: Row | null) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const name = str(body.name, 40)
  const host = str(body.host, 200).replace(/^s?ftps?:\/\//i, '').replace(/\/.*$/, '')
  const username = str(body.username, 200)
  const port = body.port === undefined || body.port === '' ? 21 : Number(body.port)
  if (!name) throw new HttpError(400, '이름을 입력해 주세요.')
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) throw new HttpError(400, 'FTP 주소를 입력해 주세요(예: yorihaeyou.ftp.cafe24.com).')
  if (!username) throw new HttpError(400, '아이디를 입력해 주세요.')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, '포트는 1~65535 사이 숫자입니다.')
  // 고칠 때 비밀번호 칸을 비우면 원래 비밀번호를 그대로 쓴다
  const typed = typeof body.password === 'string' ? body.password : ''
  if (!typed && !editing) throw new HttpError(400, '비밀번호를 입력해 주세요.')
  const password = typed ? encrypt(typed.slice(0, 200)) : editing!.password
  return { name, host, port, username, password, secure: body.secure === true ? 1 : 0, root: cleanPath(body.root) }
}

function find(id: string) {
  const row = get<Row>('SELECT * FROM ftp_servers WHERE id = :id', { id })
  if (!row) throw new HttpError(404, 'FTP 서버를 찾을 수 없습니다.')
  return row
}

export function addFtpServer(user: PublicUser, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body, null)
  const id = randomUUID()
  const sort = (get<{ n: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM ftp_servers')?.n ?? 1)
  run(
    `INSERT INTO ftp_servers (id, name, host, port, username, password, secure, root, sort, created_by, created_at)
     VALUES (:id, :name, :host, :port, :username, :password, :secure, :root, :sort, :me, :now)`,
    { id, ...f, sort, me: user.id, now: Date.now() },
  )
  return toDto(find(id), user)
}

export function updateFtpServer(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body, find(id))
  run(
    `UPDATE ftp_servers SET name = :name, host = :host, port = :port, username = :username, password = :password,
     secure = :secure, root = :root WHERE id = :id`,
    { id, ...f },
  )
  return toDto(find(id), user)
}

export function deleteFtpServer(user: PublicUser, id: string) {
  requireSuperadmin(user)
  run('DELETE FROM ftp_servers WHERE id = :id', { id })
  return { ok: true }
}

// ── 접속 ──
type Conn = { host: string; port: number; username: string; password: string; secure: boolean }

async function connect(c: Conn) {
  const client = new Client(30_000)
  try {
    await client.access({ host: c.host, port: c.port, user: c.username, password: c.password, secure: c.secure })
  } catch (e) {
    client.close()
    throw new HttpError(502, `FTP 에 접속하지 못했습니다: ${ftpMessage(e)}`)
  }
  return client
}

function ftpMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (/530/.test(msg)) return '아이디나 비밀번호가 맞지 않습니다.'
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return '주소를 찾을 수 없습니다.'
  if (/ECONNREFUSED/.test(msg)) return '서버가 연결을 받지 않습니다(주소·포트 확인).'
  if (/timeout|ETIMEDOUT/i.test(msg)) return '응답이 없습니다(시간 초과).'
  if (/550/.test(msg)) return '없는 파일·폴더이거나 권한이 없습니다.'
  return msg.slice(0, 200)
}

const connOf = (r: Row): Conn => ({ host: r.host, port: r.port, username: r.username, password: decrypt(r.password), secure: r.secure === 1 })

// 서버 하나로 일을 하고 닫는다. FTP 오류는 알아볼 수 있는 말로 바꾼다
async function withFtp<T>(r: Row, work: (client: Client) => Promise<T>) {
  const client = await connect(connOf(r))
  try {
    return await work(client)
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(502, ftpMessage(e))
  } finally {
    client.close()
  }
}

// 접속 확인(저장 전·후). 비밀번호를 비우면 저장한 비밀번호로 해 본다
export async function testFtpServer(user: PublicUser, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const editing = typeof body.id === 'string' && body.id ? find(body.id) : null
  const f = fields({ name: 'test', ...body }, editing)
  const client = await connect({ host: f.host, port: f.port, username: f.username, password: decrypt(f.password), secure: f.secure === 1 })
  try {
    const list = await client.list(f.root)
    return { ok: true, count: list.length }
  } catch (e) {
    throw new HttpError(502, `접속은 됐지만 시작 폴더(${f.root})를 열지 못했습니다: ${ftpMessage(e)}`)
  } finally {
    client.close()
  }
}

// 화면이 보낸 경로를 시작 폴더 안으로만 허용한다(../ 로 밖에 나가지 못하게)
function inside(r: Row, value: unknown) {
  const p = cleanPath(value, r.root)
  if (r.root !== '/' && p !== r.root && !p.startsWith(r.root + '/')) throw new HttpError(403, `${r.root} 폴더 밖은 볼 수 없습니다.`)
  return p
}

function validName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 200) throw new HttpError(400, '이름이 올바르지 않습니다.')
  return name
}

export async function ftpList(user: PublicUser, id: string, path: unknown) {
  requireFtpUser(user)
  const r = find(id)
  const dir = inside(r, path)
  const list = await withFtp(r, (c) => c.list(dir))
  return {
    path: dir,
    root: r.root,
    items: list
      .filter((f) => f.name !== '.' && f.name !== '..')
      .map((f) => ({
        name: f.name,
        dir: f.type === FileType.Directory || (f.type === FileType.SymbolicLink && !f.size),
        size: f.size,
        modifiedAt: f.modifiedAt ? f.modifiedAt.getTime() : f.rawModifiedAt || null,
      })),
  }
}

export async function ftpMkdir(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireFtpUser(user)
  const r = find(id)
  const dir = posix.join(inside(r, body.path), validName(body.name))
  await withFtp(r, async (c) => {
    await c.send(`MKD ${dir}`)
  })
  return { ok: true, path: dir }
}

export async function ftpDelete(user: PublicUser, id: string, path: unknown, isDir: boolean) {
  requireFtpUser(user)
  if (!isManager(user)) throw new HttpError(403, 'FTP 파일은 관리자만 지울 수 있습니다.')
  const r = find(id)
  const target = inside(r, path)
  if (target === r.root || target === '/') throw new HttpError(400, '시작 폴더는 지울 수 없습니다.')
  // 폴더는 비어 있을 때만 지운다(실수로 통째로 지우지 않게)
  await withFtp(r, (c) => (isDir ? c.send(`RMD ${target}`) : c.remove(target)))
  return { ok: true }
}

// 올리기: 본문이 파일 그대로. 받는 대로 FTP 로 흘려 보낸다(서버에 쌓지 않음). 같은 이름이 있으면 덮어쓴다
export async function ftpUpload(req: IncomingMessage, user: PublicUser, id: string, path: unknown) {
  requireFtpUser(user)
  const r = find(id)
  const dir = inside(r, path)
  const name = validName(decodeURIComponent(String(req.headers['x-file-name'] ?? '')))
  const target = posix.join(dir, name)
  await withFtp(r, async (c) => {
    const body = new PassThrough()
    req.pipe(body)
    await c.uploadFrom(body, target)
  })
  return { ok: true, path: target }
}

// 내려받기: FTP 에서 받는 대로 화면으로 흘려 보낸다
export async function ftpDownload(res: ServerResponse, user: PublicUser, id: string, path: unknown) {
  requireFtpUser(user)
  const r = find(id)
  const target = inside(r, path)
  const client = await connect(connOf(r))
  try {
    let size: number | null = null
    try {
      size = await client.size(target)
    } catch (e) {
      throw new HttpError(404, ftpMessage(e))
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(posix.basename(target))}`,
      'X-Content-Type-Options': 'nosniff',
    })
    await client.downloadTo(res, target)
    res.end()
  } catch (e) {
    if (res.headersSent) {
      res.destroy()
      return
    }
    throw e instanceof HttpError ? e : new HttpError(502, ftpMessage(e))
  } finally {
    client.close()
  }
}
