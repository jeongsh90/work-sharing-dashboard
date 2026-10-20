import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

import {
  ALLOWED_ORIGINS,
  COMPANY_EMAIL_DOMAIN,
  LOCK_MS,
  MAX_FAILED_LOGINS,
  PORT,
  SESSION_TTL_MS,
  WEB_DIR,
} from './config.ts'
import { verifyUser, type PublicUser } from './users.ts'

type Session = { user: PublicUser; expiresAt: number }

// 서버를 다시 켜면 모두 다시 로그인한다.
const sessions = new Map<string, Session>()
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    // Tailscale 에 연결된 PC 에서는 ts.net 주소가 내부망(100.x)으로 풀린다.
    // 공개 사이트(GitHub Pages)에서 오는 요청을 브라우저가 내부망 요청으로 보고 확인을 요구하므로 허용한다.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 10_000) return null
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function currentSession(req: IncomingMessage) {
  const token = req.headers.authorization?.match(/^Bearer (\w+)$/)?.[1]
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { token, session }
}

async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req)
  const id = typeof body?.id === 'string' ? body.id.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

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
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS })
  sendJson(res, 200, { token, user })
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
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!path.startsWith('/api/')) return await serveStatic(req, res)

    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    if (req.method === 'POST' && path === '/api/login') return await handleLogin(req, res)

    if (req.method === 'GET' && path === '/api/me') {
      const current = currentSession(req)
      return current
        ? sendJson(res, 200, { user: current.session.user })
        : sendJson(res, 401, { error: '다시 로그인해 주세요.' })
    }

    if (req.method === 'POST' && path === '/api/logout') {
      const current = currentSession(req)
      if (current) sessions.delete(current.token)
      return sendJson(res, 200, { ok: true })
    }

    sendJson(res, 404, { error: '찾을 수 없습니다.' })
  } catch (error) {
    console.error(error)
    if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했습니다.' })
  }
})

server.listen(PORT, () => {
  console.log(`WSD 서버: http://localhost:${PORT} (화면 ${WEB_DIR})`)
})
