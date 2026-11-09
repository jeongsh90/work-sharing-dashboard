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
import type { PublicUser } from './users.ts'

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

// ── 등록한 PC(IP)만 쓰기 ──
// 서버 PC 방화벽은 같은 사무실 네트워크 전체에 열어 두고(open-lan-4443-all.bat), 누가 쓸지는 여기서 정한다.
// 슈퍼관리자가 관리 → 사내망 직통 화면에서 PC 의 IP 와 이름을 넣는다. 목록에 없는 IP 는 막고(403) 화면은 바깥 중계로 보낸다.
// 공유기가 PC 의 IP 를 바꾸면 그 PC 는 다시 중계를 쓴다(마지막 사용 시각으로 알아볼 수 있다).
db.exec(`
DROP TABLE IF EXISTS lan_devices;
CREATE TABLE IF NOT EXISTS lan_ips (
  id         TEXT PRIMARY KEY,
  ip         TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);
`)

// user_id: 이 PC 를 쓰는 사람. 공유기가 IP 를 바꾸면 그 사람이 들어올 때 새 IP 로 저절로 고친다(reportLan)
if (!all<{ name: string }>('PRAGMA table_info(lan_ips)').some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE lan_ips ADD COLUMN user_id TEXT')
}

type IpRow = { id: string; ip: string; name: string; created_by: string; created_at: number; last_seen: number | null; user_id: string | null }

// 사내망 주소로 들어온 요청을 보낸 PC 의 IP(::ffff: 는 뗀다)
const remoteIp = (req: IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')

function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 쓸 수 있습니다.')
}

const toDto = (r: IpRow) => ({ id: r.id, ip: r.ip, name: r.name, createdBy: r.created_by, createdAt: r.created_at, lastSeen: r.last_seen })

export function listLanIps(user: PublicUser) {
  requireSuperadmin(user)
  return all<IpRow>('SELECT * FROM lan_ips ORDER BY ip').map(toDto)
}

// 사내 IP(192.168.x / 10.x / 172.16~31.x)만 받는다
const PRIVATE_IP = /^(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/

function fields(body: Record<string, unknown>) {
  const ip = typeof body.ip === 'string' ? body.ip.trim() : ''
  if (!PRIVATE_IP.test(ip) || ip.split('.').some((n) => Number(n) > 255)) {
    throw new HttpError(400, '사무실 PC 의 IP 를 입력해 주세요(예: 192.168.219.77).')
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : ''
  if (!name) throw new HttpError(400, 'PC 이름을 입력해 주세요.')
  return { ip, name }
}

export function addLanIp(user: PublicUser, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body)
  if (get('SELECT id FROM lan_ips WHERE ip = :ip', { ip: f.ip })) throw new HttpError(400, '이미 등록한 IP 입니다.')
  const id = randomUUID()
  // 못 탄 PC 목록에서 "이 IP 로 등록"하면 그 사람(userId)을 같이 적어 둔다 → 다음부터 IP 가 바뀌어도 저절로 고침
  const owner = typeof body.userId === 'string' && body.userId ? body.userId : null
  run('INSERT INTO lan_ips (id, ip, name, created_by, created_at, user_id) VALUES (:id, :ip, :name, :me, :now, :owner)', { id, ...f, me: user.id, now: Date.now(), owner })
  if (owner) misses.delete(owner) // 허용했으니 못 탄 PC 목록에서 뺀다
  return toDto(get<IpRow>('SELECT * FROM lan_ips WHERE id = :id', { id })!)
}

export function updateLanIp(user: PublicUser, id: string, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const f = fields(body)
  if (get('SELECT id FROM lan_ips WHERE ip = :ip AND id != :id', { ip: f.ip, id })) throw new HttpError(400, '이미 등록한 IP 입니다.')
  run('UPDATE lan_ips SET ip = :ip, name = :name WHERE id = :id', { id, ...f })
  if (typeof body.userId === 'string' && body.userId) {
    run('UPDATE lan_ips SET user_id = :u WHERE id = :id', { id, u: body.userId })
    misses.delete(body.userId)
  }
  const row = get<IpRow>('SELECT * FROM lan_ips WHERE id = :id', { id })
  if (!row) throw new HttpError(404, '등록한 PC 를 찾을 수 없습니다.')
  return toDto(row)
}

export function deleteLanIp(user: PublicUser, id: string) {
  requireSuperadmin(user)
  run('DELETE FROM lan_ips WHERE id = :id', { id })
  return { ok: true }
}

// ── 못 탄 PC 알아보기 ──
// 공유기가 PC 의 IP 를 바꾸면 그 PC 는 말없이 바깥 중계(느림)로 돌아간다. 누가 그런지 관리 화면에 보이게 한다.
// 등록 안 된 IP 로 사내망 주소에 오면 표(nonce)를 돌려주고, 화면이 그 표를 로그인한 채로 본 주소에 알려 준다(누가·어느 IP).
// 사내망 주소에 아예 닿지 않으면(브라우저 허용 안 함·네트워크) 화면이 "닿지 않음"으로 알려 준다. 메모리에만 두고 3일 지나면 버린다.
const NONCE_MS = 10 * 60 * 1000
const MISS_MS = 3 * DAY
const nonces = new Map<string, { ip: string; at: number }>()
// publicIp: 그 사람이 본 주소에 들어온 바깥(공인) IP. 사내 IP 를 알아내지 못했을 때 관리 화면에 대신 보인다
type Miss = { userId: string; ip: string | null; publicIp: string | null; kind: 'unregistered' | 'unreachable'; at: number }
const misses = new Map<string, Miss>()

function issueNonce(ip: string) {
  const now = Date.now()
  for (const [k, v] of nonces) if (now - v.at > NONCE_MS) nonces.delete(k)
  if (nonces.size > 500) nonces.clear()
  const nonce = randomBytes(18).toString('base64url')
  nonces.set(nonce, { ip, at: now })
  return nonce
}

// 회사 공인 IP(서버 PC 가 바깥으로 나가는 주소). "닿지 않음"은 이 주소에서 온 사람만 남긴다(재택·외근은 원래 중계를 쓴다)
let officeIp: { ip: string; at: number } | null = null
async function officePublicIp() {
  if (officeIp && Date.now() - officeIp.at < 60 * 60 * 1000) return officeIp.ip
  try {
    const ip = (await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) })).text()).trim()
    if (/^[\d.:a-f]+$/i.test(ip)) officeIp = { ip, at: Date.now() }
  } catch {
    /* 모르면 거르지 않는다 */
  }
  return officeIp?.ip ?? null
}

// 처음 보는 사람의 PC 를 사내 IP 로 새로 등록한다(이름 = 그 사람 이름). 이미 등록한 PC 가 있거나, IP 를 다른 PC 가 쓰거나, 거절한 사람이면 하지 않는다
function autoAdd(user: PublicUser, ip: string) {
  if (!PRIVATE_IP.test(ip) || !user.name.trim() || isIgnored(user.id)) return false
  if (get('SELECT id FROM lan_ips WHERE ip = :ip OR user_id = :u', { ip, u: user.id })) return false
  run('INSERT INTO lan_ips (id, ip, name, created_by, created_at, user_id) VALUES (:id, :ip, :name, :me, :now, :me)', { id: randomUUID(), ip, name: user.name.trim(), me: user.id, now: Date.now() })
  log(`${user.name}: 사내 IP 자동 등록 ${ip}`)
  return true
}

// 등록된 이 사람의 PC 를 새 IP 로 옮긴다. 사람(user_id)으로 찾고, 없으면 PC 이름에 그 사람 이름이 든 것이 딱 하나일 때(처음 한 번) 그것.
// 새 IP 를 이미 다른 PC 가 쓰고 있으면 건드리지 않는다(관리 화면에서 사람이 고른다)
export function autoMove(user: PublicUser, ip: string) {
  if (!PRIVATE_IP.test(ip)) return false
  if (get('SELECT id FROM lan_ips WHERE ip = :ip', { ip })) return false
  let row = get<IpRow>('SELECT * FROM lan_ips WHERE user_id = :u', { u: user.id })
  if (!row && user.name.trim()) {
    const named = all<IpRow>("SELECT * FROM lan_ips WHERE user_id IS NULL AND instr(name, :n) > 0", { n: user.name.trim() })
    if (named.length === 1) row = named[0]
  }
  if (!row) return false
  run('UPDATE lan_ips SET ip = :ip, user_id = :u WHERE id = :id', { id: row.id, ip, u: user.id })
  log(`${row.name}: IP 자동 변경 ${row.ip} → ${ip}`)
  return true
}

export async function reportLan(user: PublicUser, body: Record<string, unknown>, publicIp: string) {
  const now = Date.now()
  if (body.unreachable === true) {
    const office = await officePublicIp()
    if (office && publicIp && publicIp !== office) {
      misses.delete(user.id)
      return { ok: true }
    }
  }
  if (body.ok === true) {
    misses.delete(user.id)
  } else if (typeof body.nonce === 'string') {
    const n = nonces.get(body.nonce)
    nonces.delete(body.nonce)
    if (n && now - n.at < NONCE_MS) {
      // 사내 IP 가 잡히면 저절로 적용한다: 이 사람의 PC 가 등록돼 있으면 새 IP 로 고치고(공유기가 IP 를 바꾼 경우), 없으면 새로 등록한다.
      // 그 IP 를 다른 PC 가 쓰고 있거나 거절한 사람이면 관리 화면에 남겨 사람이 고른다
      if (autoMove(user, n.ip) || autoAdd(user, n.ip)) misses.delete(user.id)
      else misses.set(user.id, { userId: user.id, ip: n.ip, publicIp: publicIp || null, kind: 'unregistered', at: now })
    }
  } else if (body.unreachable === true) {
    const prev = misses.get(user.id)
    // 방금 "등록 안 된 IP"로 알아낸 게 있으면 그쪽이 더 쓸모 있어 덮지 않는다
    if (!prev || prev.kind !== 'unregistered' || now - prev.at > 60 * 60 * 1000) misses.set(user.id, { userId: user.id, ip: null, publicIp: publicIp || null, kind: 'unreachable', at: now })
  }
  return { ok: true }
}

export function listLanMisses(user: PublicUser) {
  requireSuperadmin(user)
  const now = Date.now()
  const registered = new Set(all<{ ip: string }>('SELECT ip FROM lan_ips').map((r) => r.ip))
  return [...misses.values()]
    .filter((m) => now - m.at < MISS_MS && !(m.ip && registered.has(m.ip)) && !isIgnored(m.userId))
    .sort((a, b) => b.at - a.at)
}

// ── 거절: 직통을 쓰지 않을 사람(재택·AI 계정 등). 못 탄 PC 목록에 다시 올리지 않는다(되돌릴 수 있다) ──
db.exec(`
CREATE TABLE IF NOT EXISTS lan_ignored (
  user_id    TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`)
const isIgnored = (userId: string) => !!get('SELECT user_id FROM lan_ignored WHERE user_id = :u', { u: userId })

export function listLanIgnored(user: PublicUser) {
  requireSuperadmin(user)
  return all<{ user_id: string; created_at: number }>('SELECT user_id, created_at FROM lan_ignored ORDER BY created_at DESC').map((r) => ({
    userId: r.user_id,
    at: r.created_at,
  }))
}

export function ignoreLanMiss(user: PublicUser, userId: string) {
  requireSuperadmin(user)
  run('INSERT INTO lan_ignored (user_id, created_by, created_at) VALUES (:u, :me, :now) ON CONFLICT DO NOTHING', { u: userId, me: user.id, now: Date.now() })
  misses.delete(userId)
  return { ok: true }
}

export function unignoreLanMiss(user: PublicUser, userId: string) {
  requireSuperadmin(user)
  run('DELETE FROM lan_ignored WHERE user_id = :u', { u: userId })
  return { ok: true }
}

// 사내망 주소의 문지기: 등록한 IP 만 지나간다(확인 요청 OPTIONS 는 그대로).
function gate(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') return handler(req, res)
    const row = get<{ id: string }>('SELECT id FROM lan_ips WHERE ip = :ip', { ip: remoteIp(req) })
    if (!row) {
      // 등록하지 않은 PC: 화면이 이 응답을 보고 바깥 중계로 보낸다(브라우저가 응답을 읽을 수 있게 CORS 머리글을 붙인다)
      const origin = req.headers.origin
      if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '사내망 직통에 등록하지 않은 PC 입니다.', nonce: issueNonce(remoteIp(req)) }))
      return
    }
    run('UPDATE lan_ips SET last_seen = :now WHERE id = :id', { id: row.id, now: Date.now() })
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
