import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { HttpError } from './requests.ts'

// 디자인 툴 > 상세페이지: 화면이 만든 상세 HTML(섹션마다 <section data-out="NN_이름.jpg">)을 Edge(헤드리스)로 열어
// 섹션마다 860 폭 JPG(품질 90)로 찍어 돌려준다. 상세페이지 스킬의 render.ps1 과 같은 방식(같은 브라우저 엔진·웹폰트)이라 결과가 같다.
// 한 번에 하나씩만 찍는다(서버 PC 부담).

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

let queue: Promise<unknown> = Promise.resolve()

export function renderDetail(body: Record<string, unknown>) {
  const html = typeof body.html === 'string' ? body.html : ''
  if (!html.includes('data-out=')) throw new HttpError(400, '찍을 섹션이 없습니다.')
  const run = queue.then(() => shoot(html))
  queue = run.catch(() => {})
  return run
}

type Cdp = { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; close: () => void }

async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let n = 0
  const pending = new Map<number, (m: { result?: Record<string, unknown>; error?: { message: string } }) => void>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data))
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m)
      pending.delete(m.id)
    }
  }
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++n
        pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result ?? {})))
        ws.send(JSON.stringify({ id, method, params }))
      }),
    close: () => ws.close(),
  }
}

async function shoot(html: string) {
  if (!EDGE) throw new HttpError(500, '서버 PC 에서 Edge 를 찾지 못했습니다.')
  const dir = await mkdtemp(join(tmpdir(), 'wsd-detail-'))
  const file = join(dir, 'detail.html')
  await writeFile(file, html)
  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(dir, 'profile')}`,
    'about:blank',
  ])
  try {
    // 헤드리스가 알려 주는 디버깅 주소(ws://127.0.0.1:포트/devtools/browser/…)
    const browserUrl = await new Promise<string>((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(new Error('Edge 가 응답하지 않습니다.')), 20_000)
      proc.stderr.on('data', (d: Buffer) => {
        text += d.toString()
        const m = text.match(/DevTools listening on (ws:\/\/\S+)/)
        if (m) {
          clearTimeout(timer)
          resolve(m[1])
        }
      })
      proc.once('exit', () => reject(new Error('Edge 가 꺼졌습니다.')))
    })
    const port = new URL(browserUrl).port
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string }
    const page = await connect(target.webSocketDebuggerUrl)
    try {
      await page.send('Page.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 1200, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url: pathToFileURL(file).href })
      // 웹폰트·그림이 다 받아지고 detail.js 가 낱말을 감싼 뒤
      const ready = await page.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `new Promise((resolve) => {
          const go = async () => {
            await document.fonts.ready
            await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })))
            await new Promise((r) => setTimeout(r, 300))
            document.documentElement.style.background = document.body.style.background = '#fff'
            document.querySelectorAll('section[data-out]').forEach((s) => { s.style.marginBottom = '0' })
            const broken = [...document.images].filter((i) => !i.naturalWidth).length
            resolve({ broken, sections: [...document.querySelectorAll('section[data-out]')].map((s) => { const r = s.getBoundingClientRect(); return { out: s.getAttribute('data-out'), y: r.top + scrollY, h: r.height } }) })
          }
          if (document.readyState === 'complete') go(); else addEventListener('load', go)
        })`,
      })
      const { broken, sections } = (ready.result as { value: { broken: number; sections: { out: string; y: number; h: number }[] } }).value
      if (broken > 0) throw new HttpError(400, `불러오지 못한 그림이 ${broken}개 있습니다. 그림을 다시 넣어 주세요.`)
      const out: { file: string; width: number; height: number; data: string }[] = []
      for (const s of sections) {
        const h = Math.round(s.h)
        const shot = await page.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 90,
          captureBeyondViewport: true,
          clip: { x: 0, y: Math.round(s.y), width: 860, height: h, scale: 1 },
        })
        out.push({ file: s.out, width: 860, height: h, data: String(shot.data) })
      }
      return out
    } finally {
      page.close()
    }
  } finally {
    proc.kill()
    await new Promise((r) => setTimeout(r, 300))
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
