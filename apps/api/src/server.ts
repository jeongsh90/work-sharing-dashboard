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
  SWITCH_ACCOUNTS,
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
  deleteRequest,
  findFile,
  HttpError,
  insertFile,
  listNotifications,
  listRequests,
  notifyLink,
  markNotificationsRead,
  performAction,
  requestDetail,
  resolvePin,
  updateRequest,
  type Action,
} from './requests.ts'
import { answerSuggestion, createSuggestion, deleteSuggestion, listSuggestions } from './suggestions.ts'
import {
  approveUser,
  createSession,
  createUser,
  deletePendingUser,
  deleteSession,
  findUser,
  isManager,
  listUsers,
  PRESENCES,
  ROLES,
  sessionUser,
  setAvatar,
  setPassword,
  superadminIds,
  updateUser,
  verifyUser,
  type PublicUser,
  type Role,
} from './users.ts'

const failures = new Map<string, { count: number; lockedUntil: number }>()
// 회원가입 남용 막기: 같은 주소(IP)에서 한 시간에 5번까지
const signups = new Map<string, number[]>()
const SIGNUP_LIMIT = 5
const SIGNUP_WINDOW_MS = 60 * 60 * 1000

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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
  if (!user.approved) {
    return sendJson(res, 403, { error: '가입 승인을 기다리고 있습니다. 슈퍼관리자가 승인하면 로그인할 수 있습니다.' })
  }
  sendJson(res, 200, { token: createSession(user.id, { remember: body.remember === true }), user })
}

// 파일 올리기: 본문이 파일 그대로(멀티파트 아님). 파일 이름은 X-File-Name 헤더(URL 인코딩)로 받는다.
// 크기 제한은 두지 않는다(작업 원본 PSD 등). 메모리에 올리지 않고 받는 대로 디스크에 쓴다.
async function handleUpload(req: IncomingMessage, res: ServerResponse, user: PublicUser) {
  const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).trim().slice(0, 200)
  if (!name) throw new HttpError(400, '파일 이름이 없습니다.')
  const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0] || 'application/octet-stream'
  const id = randomUUID()
  const path = join(UPLOAD_DIR, id)
  await mkdir(UPLOAD_DIR, { recursive: true })
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
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
  // 어디에도 붙지 않은 파일은 올린 사람만 볼 수 있다. 프로필 사진은 로그인한 누구나 볼 수 있다.
  if (!file || (file.request_id === null && file.kind !== 'avatar' && file.uploader_id !== user.id)) {
    throw new HttpError(404, '파일을 찾을 수 없습니다.')
  }
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

// 회원가입: 회사 이메일로만 가입하고, 슈퍼관리자가 승인해야 로그인할 수 있다.
async function handleSignup(req: IncomingMessage, res: ServerResponse) {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  const recent = (signups.get(ip) ?? []).filter((t) => t > Date.now() - SIGNUP_WINDOW_MS)
  if (recent.length >= SIGNUP_LIMIT) throw new HttpError(429, '가입 신청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.')

  const body = await readJson(req)
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
  if (!new RegExp(`^[a-z0-9._-]+@${COMPANY_EMAIL_DOMAIN.replace('.', '\\.')}$`).test(id) || id.length > 60) {
    throw new HttpError(400, `회사 이메일(@${COMPANY_EMAIL_DOMAIN})을 입력해 주세요.`)
  }
  const f = userFields(body)
  if (!f.name) throw new HttpError(400, '이름을 입력해 주세요.')
  if (!f.department) throw new HttpError(400, '부서를 입력해 주세요.')
  // 가입할 때는 요청자·작업자만 고를 수 있다. 관리자 역할은 슈퍼관리자가 정한다.
  const role: Role = f.role === 'designer' ? 'designer' : 'requester'
  const password = checkPassword(body.password)
  if (findUser(id)) throw new HttpError(409, '이미 가입했거나 승인을 기다리는 이메일입니다.')

  createUser(id, { name: f.name, role, rank: f.rank ?? '', position: '', department: f.department }, { approved: false })
  await setPassword(id, password)
  signups.set(ip, [...recent, Date.now()])
  notifyLink(superadminIds(), `가입 승인 요청: ${f.name} (${f.department}, ${id})`, 'team')
  sendJson(res, 201, { ok: true })
}

function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 가입을 승인할 수 있습니다.')
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
  if (method === 'POST' && path === '/api/signup') return handleSignup(req, res)

  if (method === 'POST' && path === '/api/logout') {
    const token = bearer(req)
    if (token) deleteSession(token)
    return sendJson(res, 200, { ok: true })
  }

  const user = requireUser(req)
  let m: RegExpMatchArray | null

  // ── 계정 전환(SWITCH_ACCOUNTS 묶음끼리만) ──
  if (path === '/api/switch') {
    if (!SWITCH_ACCOUNTS.includes(user.id)) throw new HttpError(403, '계정 전환을 쓸 수 없는 계정입니다.')
    const accounts = listUsers().filter((u) => SWITCH_ACCOUNTS.includes(u.id) && u.active && u.approved && u.canLogin)
    if (method === 'GET') return sendJson(res, 200, accounts.map((u) => ({ id: u.id, name: u.name, role: u.role })))
    if (method === 'POST') {
      const body = await readJson(req)
      const target = accounts.find((u) => u.id === body.id)
      if (!target) throw new HttpError(400, '전환할 수 없는 계정입니다.')
      return sendJson(res, 200, { token: createSession(target.id), user: target })
    }
  }

  // ── 내 정보 ──
  if (path === '/api/me') {
    if (method === 'GET') return sendJson(res, 200, { user })
    if (method === 'PATCH') {
      const body = await readJson(req)
      if (body.avatarId !== undefined) {
        const result = setAvatar(user.id, typeof body.avatarId === 'string' ? body.avatarId : null)
        if ('error' in result) throw new HttpError(400, result.error as string)
        if (result.removed) await unlink(join(UPLOAD_DIR, result.removed)).catch(() => {})
      }
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
      // 승인 전 계정은 슈퍼관리자에게만 보인다. 관리자가 아니면 비활성 계정과 로그인 가능 여부도 감춘다.
      const users = listUsers().filter((u) => u.approved || user.role === 'superadmin')
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
  if ((m = path.match(/^\/api\/users\/([^/]+)\/(approve|reject)$/)) && method === 'POST') {
    requireSuperadmin(user)
    const target = findUser(decodeURIComponent(m[1]))
    if (!target || target.approved) throw new HttpError(404, '승인을 기다리는 가입 신청이 없습니다.')
    if (m[2] === 'reject') {
      deletePendingUser(target.id)
      return sendJson(res, 200, { ok: true })
    }
    const body = await readJson(req)
    const role = ROLES.includes(body.role as Role) ? (body.role as Role) : target.role
    approveUser(target.id, role)
    return sendJson(res, 200, { user: findUser(target.id) })
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
    if (method === 'DELETE') {
      const fileIds = deleteRequest(user, id)
      await Promise.all(fileIds.map((f) => unlink(join(UPLOAD_DIR, f)).catch(() => {})))
      return sendJson(res, 200, { ok: true })
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

  // ── 건의게시판 ──
  if (path === '/api/suggestions') {
    if (method === 'GET') return sendJson(res, 200, listSuggestions())
    if (method === 'POST') return sendJson(res, 201, createSuggestion(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/suggestions\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'PATCH') return sendJson(res, 200, answerSuggestion(user, id, await readJson(req)))
    if (method === 'DELETE') {
      deleteSuggestion(user, id)
      return sendJson(res, 200, { ok: true })
    }
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
