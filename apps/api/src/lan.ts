import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

import { randomBytes, randomUUID } from 'node:crypto'

import acme from 'acme-client'

import { ALLOWED_ORIGINS, DATA_DIR } from './config.ts'
import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 사내망 직통: 같은 사무실 PC 는 바깥 중계(Funnel, 초당 2.5MB 안팎이 한계) 대신 서버 PC 로 바로 파일을 올리고 받는다.
// 브라우저는 https 화면에서 http 주소로 파일을 보내지 못하므로, 사내 IP 를 가리키는 무료 주소(DuckDNS)에
// 정식 인증서(Let's Encrypt, DNS 확인)를 붙여 https 로 연다. 화면(lib/api.ts)이 이 주소에 닿으면 올리기·받기를 이쪽으로 보낸다.
//
// 설정: data/lan.json = { "domain": "xxx.duckdns.org", "token": "DuckDNS 토큰", "port": 4443 }  (git 에 올리지 않는다)
// 인증서: data/lan-cert/{key,cert}.pem. 90일짜리라 하루에 한 번 보고 30일 남으면 새로 받는다.

type LanConfig = { domain: string; token: string; port?: number; email?: string }

const CONFIG_FILE = join(DATA_DIR, 'lan.json')
const CERT_DIR = join(DATA_DIR, 'lan-cert')
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

let lanUrl: string | null = null
// 화면이 물어보면 알려 줄 사내망 주소(열려 있을 때만)
export const lanAddress = () => lanUrl

// ── 등록한 PC 만 쓰기 ──
// 서버 PC 방화벽은 같은 사무실 네트워크 전체에 열어 두고(open-lan-4443-all.bat), 누가 쓸지는 여기서 정한다.
// 관리 → 사내망 직통 화면에서 그 PC 로 "이 PC 등록"을 누르면 그 브라우저에 열쇠(token)를 주고, 이후 요청은 X-Lan-Device 머리글로 열쇠를 보낸다.
// IP 가 아니라 열쇠로 알아보므로 공유기가 PC 의 IP 를 바꿔도 계속 쓸 수 있다(마지막 IP 는 기록만 한다).
db.exec(`
CREATE TABLE IF NOT EXISTS lan_devices (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  last_ip    TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
`)

type DeviceRow = { id: string; token: string; name: string; last_ip: string; created_by: string; created_at: number; last_seen: number }

// 사내망 주소로 들어온 요청의 보낸 PC IP(::ffff: 는 뗀다)
const remoteIp = (req: IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
const isLanRequest = (req: IncomingMessage) => (req.socket as { encrypted?: boolean }).encrypted === true

function deviceOf(req: IncomingMessage) {
  const token = String(req.headers['x-lan-device'] ?? '')
  return token ? get<DeviceRow>('SELECT * FROM lan_devices WHERE token = :token', { token }) : undefined
}

// 사내망 주소에서 이 PC 가 누구인지(관리 화면에서 보여 준다)
export function lanWhoami(req: IncomingMessage) {
  if (!isLanRequest(req)) throw new HttpError(400, '사내망 주소로 접속한 요청이 아닙니다.')
  const d = deviceOf(req)
  return { ip: remoteIp(req), device: d ? { id: d.id, name: d.name } : null }
}

export function listLanDevices(user: PublicUser) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 볼 수 있습니다.')
  return all<DeviceRow>('SELECT * FROM lan_devices ORDER BY created_at').map((d) => ({
    id: d.id,
    name: d.name,
    lastIp: d.last_ip,
    createdBy: d.created_by,
    createdAt: d.created_at,
    lastSeen: d.last_seen,
  }))
}

// 이 PC 등록: 사내망 주소로 들어온 요청만(그래야 같은 사무실 PC 다). 열쇠는 이 응답에서 한 번만 준다.
export function registerLanDevice(user: PublicUser, req: IncomingMessage, body: Record<string, unknown>) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 등록할 수 있습니다.')
  if (!isLanRequest(req)) throw new HttpError(400, '사무실 PC 에서 사내망 주소로 접속해야 등록할 수 있습니다.')
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : ''
  if (!name) throw new HttpError(400, 'PC 이름을 입력해 주세요.')
  const now = Date.now()
  // 이미 등록한 PC 면 이름만 바꾼다
  const cur = deviceOf(req)
  if (cur) {
    run('UPDATE lan_devices SET name = :name, last_ip = :ip, last_seen = :now WHERE id = :id', { id: cur.id, name, ip: remoteIp(req), now })
    return { id: cur.id, token: cur.token }
  }
  const id = randomUUID()
  const token = randomBytes(24).toString('base64url')
  run(
    `INSERT INTO lan_devices (id, token, name, last_ip, created_by, created_at, last_seen)
     VALUES (:id, :token, :name, :ip, :me, :now, :now)`,
    { id, token, name, ip: remoteIp(req), me: user.id, now },
  )
  return { id, token }
}

export function deleteLanDevice(user: PublicUser, id: string) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 지울 수 있습니다.')
  run('DELETE FROM lan_devices WHERE id = :id', { id })
  return { ok: true }
}

// 사내망 주소의 문지기: 등록한 PC(열쇠)만 지나간다. 확인(OPTIONS)·주소 확인·이 PC 정보·등록은 열쇠 없이도 지나간다.
const OPEN_PATHS = new Set(['/api/lan/whoami', '/api/lan/devices'])
function gate(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0]
    if (req.method === 'OPTIONS' || OPEN_PATHS.has(path) || !path.startsWith('/api/')) return handler(req, res)
    const d = deviceOf(req)
    if (!d) {
      // 등록하지 않은 PC: 화면이 이 응답을 보고 바깥 중계로 보낸다(브라우저가 응답을 읽을 수 있게 CORS 머리글을 붙인다)
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '사내망 직통에 등록하지 않은 PC 입니다.' }))
      return
    }
    run('UPDATE lan_devices SET last_ip = :ip, last_seen = :now WHERE id = :id', { id: d.id, ip: remoteIp(req), now: Date.now() })
    handler(req, res)
  }
}

const log = (...args: unknown[]) => console.log('[사내망]', ...args)

// 서버 PC 의 사내 IP(192.168.x / 10.x / 172.16~31.x). Tailscale(100.x)·가상 어댑터는 뺀다.
function lanIp() {
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/tailscale|vethernet|virtual|vmware|loopback/i.test(name)) continue
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address
    }
  }
  return null
}

const sub = (c: LanConfig) => c.domain.replace(/\.duckdns\.org$/, '')

async function duck(c: LanConfig, params: Record<string, string>) {
  const q = new URLSearchParams({ domains: sub(c), token: c.token, ...params })
  const text = await (await fetch(`https://www.duckdns.org/update?${q}`)).text()
  if (!text.startsWith('OK')) throw new Error(`DuckDNS 응답: ${text}`)
}

async function readCert() {
  try {
    const [key, cert] = await Promise.all([readFile(join(CERT_DIR, 'key.pem'), 'utf8'), readFile(join(CERT_DIR, 'cert.pem'), 'utf8')])
    const expires = acme.crypto.readCertificateInfo(cert).notAfter.getTime()
    return { key, cert, expires }
  } catch {
    return null
  }
}

// Let's Encrypt 에서 인증서를 받는다. 주소 확인은 DuckDNS 의 TXT 기록으로 한다(DNS-01).
async function issue(c: LanConfig) {
  log('인증서를 받는 중…', c.domain)
  const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.production, accountKey: await acme.crypto.createPrivateKey() })
  const [key, csr] = await acme.crypto.createCsr({ commonName: c.domain })
  const cert = await client.auto({
    csr,
    email: c.email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
      await duck(c, { txt: keyAuthorization })
      // DuckDNS 가 TXT 를 퍼뜨릴 시간을 준다
      await new Promise((r) => setTimeout(r, 30_000))
    },
    challengeRemoveFn: async () => {
      await duck(c, { txt: 'removed', clear: 'true' }).catch(() => {})
    },
  })
  await mkdir(CERT_DIR, { recursive: true })
  await writeFile(join(CERT_DIR, 'key.pem'), key.toString())
  await writeFile(join(CERT_DIR, 'cert.pem'), cert)
  log('인증서를 받았습니다.')
  return { key: key.toString(), cert }
}

async function ensureCert(c: LanConfig) {
  const cur = await readCert()
  if (cur && cur.expires - Date.now() > RENEW_BEFORE_MS) return cur
  return issue(c)
}

export async function startLan(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  let c: LanConfig
  try {
    c = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  } catch {
    return // 설정이 없으면 사내망 직통을 쓰지 않는다
  }
  const port = c.port ?? 4443
  try {
    const ip = lanIp()
    if (!ip) throw new Error('사내 IP 를 찾지 못했습니다.')
    // 주소가 지금 사내 IP 를 가리키게(공유기가 IP 를 바꿔도 서버를 다시 켜면 맞춰진다)
    await duck(c, { ip })
    const { key, cert } = await ensureCert(c)
    const server: Server = createServer({ key, cert }, gate(handler))
    server.requestTimeout = 0
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, resolve)
    })
    lanUrl = `https://${c.domain}:${port}`
    log(`열림: ${lanUrl} → ${ip}`)
    // 공유기가 서버 PC 의 IP 를 바꿀 수 있어(자동 배정) 5분마다 보고, 바뀌었으면 주소도 새 IP 로 옮긴다
    let current = ip
    setInterval(async () => {
      const now = lanIp()
      if (!now || now === current) return
      try {
        await duck(c, { ip: now })
        log(`IP 바뀜: ${current} → ${now}`)
        current = now
      } catch (error) {
        log('주소 IP 바꾸기 실패:', error)
      }
    }, 5 * 60 * 1000)
    // 하루에 한 번 인증서 기한을 보고, 새로 받았으면 바로 바꿔 끼운다
    setInterval(async () => {
      try {
        const before = await readCert()
        const next = await ensureCert(c)
        if (next.cert !== before?.cert) server.setSecureContext({ key: next.key, cert: next.cert })
      } catch (error) {
        log('인증서 갱신 실패:', error)
      }
    }, DAY)
  } catch (error) {
    lanUrl = null
    log('열지 못했습니다(바깥 중계로만 동작):', error instanceof Error ? error.message : error)
  }
}
