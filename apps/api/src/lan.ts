import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

import acme from 'acme-client'

import { DATA_DIR } from './config.ts'

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
    const server: Server = createServer({ key, cert }, handler)
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
