import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, posix } from 'node:path'
import { Transform } from 'node:stream'

import { Client, FileType } from 'basic-ftp'
import iconv from 'iconv-lite'

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
// 파일 이름 인코딩. 한국 호스팅(카페24·가비아)은 EUC-KR 이라 UTF-8 로 올리면 다른 FTP 프로그램에서 한글이 깨진다
if (!all<{ name: string }>("PRAGMA table_info(ftp_servers)").some((c) => c.name === 'encoding')) {
  db.exec("ALTER TABLE ftp_servers ADD COLUMN encoding TEXT NOT NULL DEFAULT 'euc-kr'")
}
// 웹 주소: FTP 의 / 가 웹에서 열리는 주소(예: https://yorihaeyou.cafe24.com). 넣으면 이미지마다 <img src> 를 만들어 준다
if (!all<{ name: string }>("PRAGMA table_info(ftp_servers)").some((c) => c.name === 'web_url')) {
  db.exec("ALTER TABLE ftp_servers ADD COLUMN web_url TEXT NOT NULL DEFAULT ''")
}

// 서비스 이용기간(호스팅 계약 시작·만료일, YYYY-MM-DD). FTP 메뉴 제목 옆에 보인다
for (const col of ['service_start', 'service_end']) {
  if (!all<{ name: string }>('PRAGMA table_info(ftp_servers)').some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ftp_servers ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`)
  }
}

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
  encoding: string
  web_url: string
  service_start: string
  service_end: string
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
  const base = { id: r.id, name: r.name, root: r.root, serviceStart: r.service_start, serviceEnd: r.service_end }
  if (user.role !== 'superadmin') return base
  return { ...base, host: r.host, port: r.port, username: r.username, secure: r.secure === 1, encoding: r.encoding, webUrl: r.web_url, createdBy: r.created_by, createdAt: r.created_at }
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
  // 웹 주소는 http(s)://주소[/폴더] 만. 끝의 / 는 뗀다
  const webUrl = str(body.webUrl, 300).replace(/\/+$/, '')
  if (webUrl && !/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/[^\s"'<>]*)?$/.test(webUrl)) throw new HttpError(400, '웹 주소는 https://… 로 입력해 주세요(예: https://yorihaeyou.cafe24.com).')
  // 서비스 이용기간: 비워도 됨. 날짜는 YYYY-MM-DD
  const day = (v: unknown, label: string) => {
    const d = str(v, 10)
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, `${label}은 YYYY-MM-DD 로 입력해 주세요.`)
    return d
  }
  const service_start = day(body.serviceStart, '이용 시작일')
  const service_end = day(body.serviceEnd, '만료일')
  if (service_start && service_end && service_start > service_end) throw new HttpError(400, '만료일이 시작일보다 빠릅니다.')
  return {
    service_start,
    service_end,
    name,
    host,
    port,
    username,
    password,
    secure: body.secure === true ? 1 : 0,
    root: cleanPath(body.root),
    encoding: body.encoding === 'utf8' ? 'utf8' : 'euc-kr',
    web_url: webUrl,
  }
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
    `INSERT INTO ftp_servers (id, name, host, port, username, password, secure, root, encoding, web_url, service_start, service_end, sort, created_by, created_at)
     VALUES (:id, :name, :host, :port, :username, :password, :secure, :root, :encoding, :web_url, :service_start, :service_end, :sort, :me, :now)`,
    { id, ...f, sort, me: user.id, now: Date.now() },
  )
  return toDto(find(id), user)
}

export function updateFtpServer(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body, find(id))
  run(
    `UPDATE ftp_servers SET name = :name, host = :host, port = :port, username = :username, password = :password,
     secure = :secure, root = :root, encoding = :encoding, web_url = :web_url,
     service_start = :service_start, service_end = :service_end WHERE id = :id`,
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
type Conn = { host: string; port: number; username: string; password: string; secure: boolean; encoding: string }

async function connect(c: Conn) {
  const client = new Client(30_000)
  try {
    await client.access({ host: c.host, port: c.port, user: c.username, password: c.password, secure: c.secure })
    // 이름은 늘 바이트 그대로(latin1) 주고받는다. 한 서버 안에 UTF-8·EUC-KR 이름이 섞여 있어도
    // 원래 바이트로 받고·지우고, 화면에는 바이트를 보고 알맞게 풀어 보여 준다(show).
    client.ftp.encoding = 'latin1'
    if (c.encoding === 'euc-kr') await client.send('OPTS UTF8 OFF').catch(() => {})
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

// ── 이름 바이트 ──
// raw: FTP 에 실제로 있는 바이트를 latin1 문자열로 담은 것. 화면과는 base64url 로 주고받는다.
// 새로 만드는 이름(올리기·새 폴더)은 서버 설정 인코딩으로 만든다. 파일질라 같은 프로그램은 서버가 UTF-8 을
// 알리지 않으면(가비아) 한국어 Windows 에서 EUC-KR 로 읽으므로, 그런 서버는 EUC-KR 로 올려야 안 깨진다.
const toRaw = (r: { encoding: string }, text: string) =>
  (r.encoding === 'euc-kr' ? iconv.encode(text, 'cp949') : Buffer.from(text, 'utf8')).toString('latin1')
const utf8 = new TextDecoder('utf-8', { fatal: true })
// 바이트가 올바른 UTF-8 이면 UTF-8, 아니면 EUC-KR(CP949)로 푼다
function show(raw: string) {
  const bytes = Buffer.from(raw, 'latin1')
  try {
    return utf8.decode(bytes)
  } catch {
    return iconv.decode(bytes, 'cp949')
  }
}
// 웹 주소 경로: 이름 바이트를 그대로 %XX 로(EUC-KR 이름도 웹 서버가 찾게). 영문·숫자·-._~/ 는 그대로 둔다
const webPath = (raw: string) =>
  [...Buffer.from(raw, 'latin1')]
    .map((b) => {
      const c = String.fromCharCode(b)
      return /[A-Za-z0-9\-._~/]/.test(c) ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0')
    })
    .join('')
const pack = (raw: string) => Buffer.from(raw, 'latin1').toString('base64url')
const unpack = (value: unknown) => (typeof value === 'string' && value ? Buffer.from(value, 'base64url').toString('latin1') : null)

const connOf = (r: Row): Conn => ({
  host: r.host,
  port: r.port,
  username: r.username,
  password: decrypt(r.password),
  secure: r.secure === 1,
  encoding: r.encoding,
})

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
  const client = await connect({
    host: f.host,
    port: f.port,
    username: f.username,
    password: decrypt(f.password),
    secure: f.secure === 1,
    encoding: f.encoding,
  })
  try {
    const list = await client.list(toRaw(f, f.root))
    return { ok: true, count: list.length }
  } catch (e) {
    throw new HttpError(502, `접속은 됐지만 시작 폴더(${f.root})를 열지 못했습니다: ${ftpMessage(e)}`)
  } finally {
    client.close()
  }
}

// 비밀번호 바꾸기: 카페24·가비아는 FTP 로 계정 비밀번호를 바꿀 수 없어서(SITE 명령 없음) 호스팅 관리화면에서 바꾼 뒤
// 여기에 새 비밀번호를 넣는다. 새 비밀번호로 실제 접속이 되는지 먼저 확인하고, 될 때만 저장한다(잘못 넣어 FTP 가 멈추지 않게)
export async function changeFtpPassword(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const r = find(id)
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : ''
  if (!password) throw new HttpError(400, '새 비밀번호를 입력해 주세요.')
  const client = await connect({ ...connOf(r), password }).catch((e: unknown) => {
    throw new HttpError(400, `새 비밀번호로 접속하지 못해 저장하지 않았습니다. ${e instanceof Error ? e.message.replace(/^FTP 에 접속하지 못했습니다: /, '') : ''}`)
  })
  client.close()
  run('UPDATE ftp_servers SET password = :password WHERE id = :id', { id, password: encrypt(password) })
  return { ok: true }
}

// 화면이 보낸 경로(바이트)를 시작 폴더 안으로만 허용한다(.. 로 밖에 나가지 못하게)
function inside(r: Row, value: unknown) {
  const root = toRaw(r, r.root)
  const raw = unpack(value) ?? root
  const parts = raw.split('/').filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..' || p.includes('\0'))) throw new HttpError(400, '경로가 올바르지 않습니다.')
  const p = '/' + parts.join('/')
  if (root !== '/' && p !== root && !p.startsWith(root + '/')) throw new HttpError(403, `${r.root} 폴더 밖은 볼 수 없습니다.`)
  return p
}
const child = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)

function validName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 200) throw new HttpError(400, '이름이 올바르지 않습니다.')
  return name
}
// 목록에서 고른 항목(바이트 이름)
function rawName(value: unknown) {
  const name = unpack(value)
  if (!name || name === '.' || name === '..' || /[/\0]/.test(name)) throw new HttpError(400, '이름이 올바르지 않습니다.')
  return name
}

// ── 기록: 누가 무엇을 올리고·받고·만들고·지웠는지. 관리 → FTP 서버 아래에서 본다 ──
db.exec(`
CREATE TABLE IF NOT EXISTS ftp_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  action    TEXT NOT NULL,
  path      TEXT NOT NULL,
  size      INTEGER,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ftp_logs_at ON ftp_logs(at);
`)
function log(r: Row, user: PublicUser, action: 'upload' | 'download' | 'mkdir' | 'delete', raw: string, size: number | null = null) {
  run('INSERT INTO ftp_logs (server_id, user_id, action, path, size, at) VALUES (:s, :u, :a, :p, :z, :t)', {
    s: r.id,
    u: user.id,
    a: action,
    p: show(raw),
    z: size,
    t: Date.now(),
  })
}
type LogRow = { id: number; server_id: string; name: string | null; user_id: string; action: string; path: string; size: number | null; at: number }
export function listFtpLogs(user: PublicUser) {
  requireSuperadmin(user)
  return all<LogRow>('SELECT l.*, s.name FROM ftp_logs l LEFT JOIN ftp_servers s ON s.id = l.server_id ORDER BY l.at DESC LIMIT 2000').map((l) => ({
    id: l.id,
    serverName: l.name ?? '(지운 서버)',
    userId: l.user_id,
    action: l.action,
    path: l.path,
    size: l.size,
    at: l.at,
  }))
}

// 폴더 열기. into(바이트 이름)를 주면 그 하위 폴더, up 이면 위 폴더
export async function ftpList(user: PublicUser, id: string, params: URLSearchParams) {
  requireFtpUser(user)
  const r = find(id)
  let dir = inside(r, params.get('path'))
  if (params.get('into')) dir = inside(r, pack(child(dir, rawName(params.get('into')))))
  else if (params.has('up')) dir = inside(r, pack(dir.replace(/\/[^/]+$/, '') || '/'))
  const list = await withFtp(r, (c) => c.list(dir))
  // 경로 표시: 시작 폴더부터 한 단계씩
  const root = toRaw(r, r.root)
  const rest = dir === root ? [] : dir.slice(root === '/' ? 1 : root.length + 1).split('/')
  const crumbs = rest.map((part, i) => ({ label: show(part), path: pack((root === '/' ? '' : root) + '/' + rest.slice(0, i + 1).join('/')) }))
  return {
    path: pack(dir),
    root: pack(root),
    display: show(dir),
    crumbs,
    items: list
      .filter((f) => f.name !== '.' && f.name !== '..')
      .map((f) => ({
        name: show(f.name),
        raw: pack(f.name),
        dir: f.type === FileType.Directory || (f.type === FileType.SymbolicLink && !f.size),
        size: f.size,
        modifiedAt: f.modifiedAt ? f.modifiedAt.getTime() : f.rawModifiedAt || null,
        url: r.web_url && f.type === FileType.File ? r.web_url + webPath(child(dir, f.name)) : null,
      })),
  }
}

export async function ftpMkdir(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireFtpUser(user)
  const r = find(id)
  const dir = child(inside(r, body.path), toRaw(r, validName(body.name)))
  await withFtp(r, async (c) => {
    await c.send(`MKD ${dir}`)
  })
  log(r, user, 'mkdir', dir)
  return { ok: true }
}

export async function ftpDelete(user: PublicUser, id: string, params: URLSearchParams) {
  requireFtpUser(user)
  if (!isManager(user)) throw new HttpError(403, 'FTP 파일은 관리자만 지울 수 있습니다.')
  const r = find(id)
  const target = child(inside(r, params.get('path')), rawName(params.get('name')))
  // 폴더는 비어 있을 때만 지운다(실수로 통째로 지우지 않게)
  await withFtp(r, (c) => (params.has('dir') ? c.send(`RMD ${target}`) : c.remove(target)))
  log(r, user, 'delete', target)
  return { ok: true }
}

// 올리기: 본문이 파일 그대로. 받는 대로 FTP 로 흘려 보낸다(서버에 쌓지 않음). 같은 이름이 있으면 덮어쓴다
export async function ftpUpload(req: IncomingMessage, user: PublicUser, id: string, params: URLSearchParams) {
  requireFtpUser(user)
  const r = find(id)
  const dir = inside(r, params.get('path'))
  const name = validName(decodeURIComponent(String(req.headers['x-file-name'] ?? '')))
  const target = child(dir, toRaw(r, name))
  // 바로 이어 두어야 FTP 접속을 기다리는 동안 받은 내용이 흘러 없어지지 않는다(흐름이 멈춰 기다림)
  let size = 0
  const body = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      done(null, chunk)
    },
  })
  req.pipe(body)
  await withFtp(r, (c) => c.uploadFrom(body, target))
  log(r, user, 'upload', target, size)
  return { ok: true }
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

// 내려받기: FTP 에서 받는 대로 화면으로 흘려 보낸다. preview 면 미리보기(이미지 형식으로 보내고 기록하지 않음)
export async function ftpDownload(res: ServerResponse, user: PublicUser, id: string, params: URLSearchParams) {
  requireFtpUser(user)
  const r = find(id)
  const name = rawName(params.get('name'))
  const target = child(inside(r, params.get('path')), name)
  const preview = params.has('preview')
  const type = preview ? IMAGE_TYPES[show(name).split('.').pop()?.toLowerCase() ?? ''] : undefined
  if (preview && !type) throw new HttpError(400, '이미지만 미리 볼 수 있습니다.')
  const client = await connect(connOf(r))
  try {
    let size: number | null = null
    try {
      size = await client.size(target)
    } catch (e) {
      throw new HttpError(404, ftpMessage(e))
    }
    res.writeHead(200, {
      'Content-Type': type ?? 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(show(name))}`,
      'X-Content-Type-Options': 'nosniff',
    })
    await client.downloadTo(res, target)
    res.end()
    if (!preview) log(r, user, 'download', target, size)
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
