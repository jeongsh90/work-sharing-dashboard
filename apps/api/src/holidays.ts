import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DATA_DIR } from './config.ts'

// 공휴일(한국천문연구원 특일 정보, 공공데이터포털 SpcdeInfoService/getRestDeInfo).
// 인증키는 저장소·화면 코드에 넣지 않는다: 환경 변수 WSD_HOLIDAY_API_KEY 또는 data/holiday-api-key.txt.
// 해마다 한 번 받아 data/holidays-YYYY.json 에 두고 7일마다 새로 받는다. 받지 못하면 빈 목록(달력은 그대로 보인다).

const API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
const REFRESH_MS = 7 * 86_400_000

export type Holiday = { date: string; name: string } // date: yyyy-MM-dd

async function apiKey() {
  if (process.env.WSD_HOLIDAY_API_KEY) return process.env.WSD_HOLIDAY_API_KEY.trim()
  try {
    return (await readFile(join(DATA_DIR, 'holiday-api-key.txt'), 'utf8')).trim()
  } catch {
    return ''
  }
}

const memory = new Map<number, { at: number; list: Holiday[] }>()
const pending = new Map<number, Promise<Holiday[]>>()

async function fetchYear(year: number): Promise<Holiday[]> {
  const key = await apiKey()
  if (!key) return []
  const url = `${API}?solYear=${year}&numOfRows=100&_type=json&ServiceKey=${encodeURIComponent(key)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`공휴일 API ${res.status}`)
  const body = (await res.json()) as {
    response?: { header?: { resultCode?: string }; body?: { items?: { item?: unknown } | '' } }
  }
  if (body.response?.header?.resultCode !== '00') throw new Error(`공휴일 API 응답 ${body.response?.header?.resultCode}`)
  const items = body.response?.body?.items
  const raw = items && typeof items === 'object' ? items.item : undefined
  // 하나뿐이면 배열이 아니라 객체로 온다
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { locdate: number; dateName: string; isHoliday: string }[]
  return list
    .filter((h) => h.isHoliday === 'Y')
    .map((h) => {
      const d = String(h.locdate)
      return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: h.dateName }
    })
}

export async function holidays(year: number): Promise<Holiday[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return []
  const cached = memory.get(year)
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached.list

  let job = pending.get(year)
  if (!job) {
    job = (async () => {
      const file = join(DATA_DIR, `holidays-${year}.json`)
      // 파일에 받아 둔 것이 아직 새것이면 그대로
      try {
        const saved = JSON.parse(await readFile(file, 'utf8')) as { at: number; list: Holiday[] }
        if (Date.now() - saved.at < REFRESH_MS) {
          memory.set(year, saved)
          return saved.list
        }
      } catch {
        // 없으면 새로 받는다
      }
      try {
        const list = await fetchYear(year)
        const entry = { at: Date.now(), list }
        memory.set(year, entry)
        if (list.length > 0) await writeFile(file, JSON.stringify(entry))
        return list
      } catch (e) {
        console.error('공휴일 정보를 받지 못함:', e)
        // 예전에 받아 둔 것이 있으면 오래됐어도 쓴다
        try {
          return (JSON.parse(await readFile(file, 'utf8')) as { list: Holiday[] }).list
        } catch {
          return []
        }
      }
    })()
    pending.set(year, job)
    job.finally(() => pending.delete(year)).catch(() => {})
  }
  return job
}
