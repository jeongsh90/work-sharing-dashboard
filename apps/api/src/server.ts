import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import {
  ALLOWED_ORIGINS,
  COMPANY_EMAIL_DOMAIN,
  LOCK_MS,
  MAX_FAILED_LOGINS,
  MAX_UPLOAD_BYTES,
  PORT,
  UPLOAD_DIR,
  WEB_DIR,
} from './config.ts'
import {
  addComment,
  addPin,
  addPinComment,
  archive,
  createRequest,
  findFile,
  HttpError,
  insertFile,
  listNotifications,
  listRequests,
  markNotificationsRead,
  performAction,
  requestDetail,
  resolvePin,
  updateRequest,
  type Action,
} from './requests.ts'
import {
  createSession,
  createUser,
  deleteSession,
  findUser,
  isManager,
  listUsers,
  PRESENCES,
  ROLES,
  sessionUser,
  setPassword,
  updateUser,
  verifyUser,
  type PublicUser,
  type Role,
} from './users.ts'

const failures = new Map<string, { count: number; lockedUntil: number }>()

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    // Tailscale 에 연결된 PC 에서는 ts.net 주소가 내부망(100.x)으로 풀린다.
    // 공개 사이트(GitHub Pages)에서 오는 요청을 브라우저가 내부망 요청으로 보고 확인을 요구하므로 허용한다.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 200_000) throw new HttpError(413, '보낸 내용이 너무 큽니다.')
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (value && typeof value === 'object') return value as Record<string, unknown>
  } catch {
    // 아래에서 처리
  }
  throw new HttpError(400, '요청 형식이 올바르지 않습니다.')
}

function bearer(req: IncomingMessage) {
  return req.headers.authorization?.match(/^Bearer (\w+)$/)?.[1] ?? null
}

function requireUser(req: IncomingMessage): PublicUser {
  const token = bearer(req)
  const user = token ? sessionUser(token) : null
  if (!user) throw new HttpError(401, '다시 로그인해 주세요.')
  return user
}

function requireManager(user: PublicUser) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 할 수 있습니다.')
}

async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req)
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!id || !password) {
    return sendJson(res, 400, { error: '아이디(회사 이메일)와 비밀번호를 입력해 주세요.' })
  }
  if (id.includes('@') && !id.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
    return sendJson(res, 400, { error: `회사 이메일(@${COMPANY_EMAIL_DOMAIN})로 로그인해 주세요.` })
  }

  const failure = failures.get(id)
  if (failure && failure.lockedUntil > Date.now()) {
    return sendJson(res, 429, { error: '로그인에 여러 번 실패했습니다. 10분 뒤에 다시 시도해 주세요.' })
  }

  const user = await verifyUser(id, password)
  if (!user) {
    const count = (failure?.count ?? 0) + 1
    failures.set(id, { count, lockedUntil: count >= MAX_FAILED_LOGINS ? Date.now() + LOCK_MS : 0 })
    return sendJson(res, 401, { error: '아이디 또는 비밀번호가 맞지 않습니다.' })
  }

  failures.delete(id)
  sendJson(res, 200, { token: createSession(user.id), user })
}

// 파일 올리기: 본문이 파일 그대로(멀티파트 아님). 파일 이름은 X-File-Name 헤더(URL 인코딩)로 받는다.
async function handleUpload(req: IncomingMessage, res: ServerResponse, user: PublicUser) {
  const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).trim().slice(0, 200)
  if (!name) throw new HttpError(400, '파일 이름이 없습니다.')
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, '파일이 너무 큽니다(최대 100MB).')
  const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0] || 'application/octet-stream'
  const id = randomUUID()
  const path = join(UPLOAD_DIR, id)
  await mkdir(UPLOAD_DIR, { recursive: true })
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES) req.destroy(new HttpError(413, '파일이 너무 큽니다(최대 100MB).'))
  })
  try {
    await pipeline(req, createWriteStream(path))
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error instanceof HttpError ? error : new HttpError(400, '파일을 받지 못했습니다.')
  }
  insertFile({ id, uploaderId: user.id, name, mime, size })
  sendJson(res, 201, { id, name, mime, size })
}

async function handleFile(req: IncomingMessage, res: ServerResponse, user: PublicUser, id: string, download: boolean) {
  const file = findFile(id)
  // 어디에도 붙지 않은 파일은 올린 사람만 볼 수 있다.
  if (!file || (file.request_id === null && file.uploader_id !== user.id)) throw new HttpError(404, '파일을 찾을 수 없습니다.')
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
  res.writeHead(200, {
    'Content-Type': file.mime,
    'Content-Length': file.size,
    'Content-Disposition': disposition,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  await pipeline(createReadStream(join(UPLOAD_DIR, file.id)), res)
}

function userFields(body: Record<string, unknown>) {
  const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
  const role = body.role === undefined ? undefined : ROLES.includes(body.role as Role) ? (body.role as Role) : null
  if (role === null) throw new HttpError(400, '역할이 올바르지 않습니다.')
  return {
    name: str(body.name),
    role,
    rank: str(body.rank),
    position: str(body.position),
    department: str(body.department),
  }
}

function checkPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, '비밀번호는 8자 이상으로 정해 주세요.')
  return value
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (method === 'POST' && path === '/api/login') return handleLogin(req, res)

  if (method === 'POST' && path === '/api/logout') {
    const token = bearer(req)
    if (token) deleteSession(token)
    return sendJson(res, 200, { ok: true })
  }

  const user = requireUser(req)
  let m: RegExpMatchArray | null

  // ── 내 정보 ──
  if (path === '/api/me') {
    if (method === 'GET') return sendJson(res, 200, { user })
    if (method === 'PATCH') {
      const body = await readJson(req)
      if (body.presence !== undefined) {
        if (!PRESENCES.includes(body.presence as never)) throw new HttpError(400, '상태 값이 올바르지 않습니다.')
        updateUser(user.id, { presence: body.presence as string })
      }
      if (body.newPassword !== undefined) {
        const ok = await verifyUser(user.id, typeof body.currentPassword === 'string' ? body.currentPassword : '')
        if (!ok) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.')
        await setPassword(user.id, checkPassword(body.newPassword))
        return sendJson(res, 200, { user: findUser(user.id), token: createSession(user.id) })
      }
      return sendJson(res, 200, { user: findUser(user.id) })
    }
  }

  // ── 사용자(팀 관리) ──
  if (path === '/api/users') {
    if (method === 'GET') {
      const users = listUsers()
      // 관리자가 아니면 비활성 계정과 로그인 가능 여부는 감춘다.
      return sendJson(res, 200, isManager(user) ? users : users.filter((u) => u.active).map((u) => ({ ...u, canLogin: false })))
    }
    if (method === 'POST') {
      requireManager(user)
      const body = await readJson(req)
      const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
      if (!/^[a-z0-9._@-]{2,60}$/.test(id)) throw new HttpError(400, '아이디는 영문 소문자·숫자·.-_@ 로 2~60자입니다.')
      if (id.includes('@') && !id.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
        throw new HttpError(400, `이메일 아이디는 @${COMPANY_EMAIL_DOMAIN} 만 쓸 수 있습니다.`)
      }
      if (findUser(id)) throw new HttpError(409, '이미 있는 아이디입니다.')
      const f = userFields(body)
      if (!f.name || !f.role) throw new HttpError(400, '이름과 역할을 입력해 주세요.')
      if (f.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 슈퍼관리자를 만들 수 있습니다.')
      createUser(id, { name: f.name, role: f.role, rank: f.rank ?? '', position: f.position ?? '', department: f.department ?? '' })
      if (body.password) await setPassword(id, checkPassword(body.password))
      return sendJson(res, 201, { user: findUser(id) })
    }
  }
  if ((m = path.match(/^\/api\/users\/([^/]+)$/)) && method === 'PATCH') {
    requireManager(user)
    const target = findUser(decodeURIComponent(m[1]))
    if (!target) throw new HttpError(404, '계정을 찾을 수 없습니다.')
    if (target.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자 계정은 바꿀 수 없습니다.')
    const body = await readJson(req)
    const f = userFields(body)
    if (f.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 슈퍼관리자를 지정할 수 있습니다.')
    if (target.id === user.id && (body.active === false || (f.role && f.role !== user.role))) {
      throw new HttpError(400, '내 계정의 역할이나 사용 여부는 바꿀 수 없습니다.')
    }
    updateUser(target.id, { ...f, role: f.role ?? undefined, active: typeof body.active === 'boolean' ? body.active : undefined })
    if (body.password) await setPassword(target.id, checkPassword(body.password))
    return sendJson(res, 200, { user: findUser(target.id) })
  }

  // ── 요청 ──
  if (path === '/api/requests') {
    if (method === 'GET') return sendJson(res, 200, listRequests())
    if (method === 'POST') return sendJson(res, 201, { id: createRequest(user, await readJson(req)) })
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'GET') return sendJson(res, 200, requestDetail(user, id))
    if (method === 'PATCH') {
      updateRequest(user, id, await readJson(req))
      return sendJson(res, 200, requestDetail(user, id))
    }
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)\/actions\/([a-z-]+)$/)) && method === 'POST') {
    const id = Number(m[1])
    performAction(user, id, m[2] as Action, await readJson(req))
    return sendJson(res, 200, requestDetail(user, id))
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)\/comments$/)) && method === 'POST') {
    const id = Number(m[1])
    addComment(user, id, null, await readJson(req))
    return sendJson(res, 201, requestDetail(user, id))
  }
  if (path === '/api/archive' && method === 'GET') return sendJson(res, 200, archive())

  // ── 파일·핀 ──
  if (path === '/api/uploads' && method === 'POST') return handleUpload(req, res, user)
  if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})$/)) && method === 'GET') {
    return handleFile(req, res, user, m[1], url.searchParams.has('download'))
  }
  if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})\/pins$/)) && method === 'POST') {
    const pinId = addPin(user, m[1], await readJson(req))
    return sendJson(res, 201, { id: pinId })
  }
  if ((m = path.match(/^\/api\/pins\/(\d+)\/comments$/)) && method === 'POST') {
    addPinComment(user, Number(m[1]), await readJson(req))
    return sendJson(res, 201, { ok: true })
  }
  if ((m = path.match(/^\/api\/pins\/(\d+)\/resolve$/)) && method === 'POST') {
    const body = await readJson(req)
    resolvePin(user, Number(m[1]), body.resolved !== false)
    return sendJson(res, 200, { ok: true })
  }

  // ── 알림 ──
  if (path === '/api/notifications' && method === 'GET') return sendJson(res, 200, listNotifications(user.id))
  if (path === '/api/notifications/read' && method === 'POST') {
    markNotificationsRead(user.id)
    return sendJson(res, 200, { ok: true })
  }

  sendJson(res, 404, { error: '찾을 수 없습니다.' })
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  const filePath = normalize(join(WEB_DIR, urlPath))
  if (!filePath.startsWith(normalize(WEB_DIR + sep)) && filePath !== normalize(WEB_DIR)) {
    return sendJson(res, 404, { error: '찾을 수 없습니다.' })
  }

  let target = filePath
  try {
    if ((await stat(target)).isDirectory()) target = join(target, 'index.html')
  } catch {
    // 화면 주소는 모두 index.html 로 보낸다.
    target = join(WEB_DIR, 'index.html')
  }

  try {
    const data = await readFile(target)
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream'
    const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
    res.end(data)
  } catch {
    sendJson(res, 404, { error: '화면 파일이 없습니다. apps/web 에서 npm run deploy:server 를 실행해 주세요.' })
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res)

    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    await handleApi(req, res, url)
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) sendJson(res, error.status, { error: error.message })
      return
    }
    console.error(error)
    if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했습니다.' })
  }
})

server.listen(PORT, () => {
  console.log(`WSD 서버: http://localhost:${PORT} (화면 ${WEB_DIR})`)
})
