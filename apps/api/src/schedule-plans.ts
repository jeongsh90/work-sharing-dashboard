import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

import { DATA_DIR } from './config.ts'
import { HttpError } from './requests.ts'
import { isManager, type PublicUser } from './users.ts'

// 디자인팀 예정일정: 팀이 쓰는 엑셀(디자인팀_일정.xlsx)의 'YYYY_일정' 시트(달마다 달력)를 읽어 data/schedule-plans.json 에 둔다.
// 날짜 칸의 한 줄이 일정 하나다. 줄 앞 색 도형(🟨⬜🟦🟥⬛🟪🟩)은 담당자, 취소선은 끝난 일.
// 담당자 이름은 달마다 오른쪽 '비고' 칸의 안내(🟨효선 …)에서 읽는다. 안내가 없는 달은 가까운 달의 안내를 쓴다.
// 공휴일(빨간 글자)은 공휴일 API 로 따로 보이므로 뺀다.

const FILE = join(DATA_DIR, 'schedule-plans.json')
const MARK_RE = /[⬛⬜\u{1F7E5}-\u{1F7EB}]/gu // ⬛⬜ 🟥🟦🟧🟨🟩🟪🟫

export type PlanLine = { marks: string[]; text: string; done: boolean; color?: string }
export type SchedulePlans = {
  importedAt: number
  fileName: string
  sheet: string
  months: Record<string, { legend: { mark: string; name: string }[]; notes: PlanLine[] }> // 'yyyy-MM'
  days: Record<string, PlanLine[]> // 'yyyy-MM-dd'
}

export async function schedulePlans(): Promise<SchedulePlans | null> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as SchedulePlans
  } catch {
    return null
  }
}

export async function importSchedulePlans(data: Buffer, fileName: string) {
  let plans: SchedulePlans
  try {
    plans = parseWorkbook(unzip(data), fileName)
  } catch (e) {
    throw new HttpError(400, e instanceof HttpError ? e.message : '엑셀 파일을 읽지 못했습니다. 디자인팀_일정.xlsx 를 그대로 올려 주세요.')
  }
  const count = Object.values(plans.days).reduce((n, d) => n + d.length, 0)
  if (!count) throw new HttpError(400, '일정 시트(예: 2026_일정)에서 일정을 찾지 못했습니다.')
  await writeFile(FILE + '.tmp', JSON.stringify(plans))
  await rename(FILE + '.tmp', FILE)
  return { ok: true, count, sheet: plans.sheet }
}

// ── zip(xlsx) 풀기: 중앙 디렉터리에서 파일 목록을 읽는다 ──
function unzip(buf: Buffer) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip 아님')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map<string, string>()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 목록 오류')
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'))
  }
  return files
}

// ── xlsx 읽기 ──
const dec = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => dec(m[1])).join('')

type Font = { strike: boolean; color?: string }
type Run = { t: string } & Font

function fontOf(xml: string): Partial<Font> {
  const strike = /<strike(?: val="(\w+)")?\/>/.exec(xml)
  const rgb = /<color rgb="(?:[0-9A-F]{2})?([0-9A-F]{6})"/i.exec(xml)
  return { strike: strike ? strike[1] !== '0' && strike[1] !== 'false' : undefined, color: rgb ? `#${rgb[1].toLowerCase()}` : undefined }
}

function parseWorkbook(files: Map<string, string>, fileName: string): SchedulePlans {
  const workbook = files.get('xl/workbook.xml') ?? ''
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? ''
  const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)].map((m) => ({ name: dec(m[1]), rid: m[2] }))
  const sheet = sheets.find((s) => /^\d{4}_일정$/.test(s.name)) ?? sheets.find((s) => /일정/.test(s.name) && !/상세/.test(s.name))
  if (!sheet) throw new HttpError(400, "'2026_일정' 처럼 'YYYY_일정' 이름의 시트가 없습니다.")
  const target = new RegExp(`Id="${sheet.rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${sheet.rid}"`).exec(rels)
  const path = 'xl/' + (target?.[1] ?? target?.[2] ?? '').replace(/^\/?xl\//, '')
  const xml = files.get(path)
  if (!xml) throw new Error('시트 없음')

  // 글꼴(취소선·색) → 셀 서식
  const styles = files.get('xl/styles.xml') ?? ''
  const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? '').matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map((m) => fontOf(m[1] ?? ''))
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '').matchAll(/<xf ([^>]*?)\/?>/g)].map((m) => Number(/fontId="(\d+)"/.exec(m[1])?.[1] ?? 0))
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
    const runs = [...m[1].matchAll(/<r>([\s\S]*?)<\/r>/g)]
    if (!runs.length) return [{ t: textOf(m[1]) }] as ({ t: string } & Partial<Font>)[]
    return runs.map((r) => ({ t: textOf(r[1]), ...fontOf(/<rPr>([\s\S]*?)<\/rPr>/.exec(r[1])?.[1] ?? '') }))
  })

  // 셀: 행 → 열 → 조각들
  const rows = new Map<number, Map<string, Run[] | number>>()
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, rowNo, attrs, inner] = m
    if (!inner) continue
    const font = fonts[xfs[Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? 0)] ?? 0] ?? {}
    const type = / t="(\w+)"/.exec(attrs)?.[1]
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    let value: Run[] | number
    if (type === 's' && v !== undefined) value = (shared[+v] ?? []).map((r) => ({ t: r.t, strike: r.strike ?? font.strike ?? false, color: r.color ?? font.color }))
    else if (type === 'inlineStr' || type === 'str') value = [{ t: type === 'str' ? dec(v ?? '') : textOf(inner), strike: font.strike ?? false, color: font.color }]
    else if (v !== undefined && !Number.isNaN(Number(v))) value = Number(v)
    else continue
    const row = rows.get(+rowNo) ?? new Map()
    row.set(col, value)
    rows.set(+rowNo, row)
  }

  // 셀 글을 줄 단위로: 색 도형(담당자) · 글 · 취소선(글자 절반 이상) · 글자 색
  const linesOf = (runs: Run[]): PlanLine[] => {
    const lines: Run[][] = [[]]
    for (const r of runs)
      r.t.split(/\r?\n/).forEach((part, i) => {
        if (i > 0) lines.push([])
        if (part) lines[lines.length - 1].push({ ...r, t: part })
      })
    return lines.flatMap((l) => {
      const full = l.map((r) => r.t).join('').trim()
      if (!full) return []
      const marks = full.match(MARK_RE) ?? []
      const text = full.replace(MARK_RE, ' ').replace(/\s+/g, ' ').trim()
      if (!text) return []
      const letters = (rs: Run[]) => rs.map((r) => r.t.replace(MARK_RE, '').replace(/\s/g, '')).join('').length
      const done = letters(l.filter((r) => r.strike)) * 2 > letters(l)
      const color = l.find((r) => r.t.replace(MARK_RE, '').trim())?.color
      return [{ marks, text, done, ...(color && color !== '#000000' ? { color } : {}) }]
    })
  }

  const DAY_COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H']
  const serialToKey = (n: number) => new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10)
  const isRed = (c?: string) => !!c && /^#(ff0000|e00000|c00000|ea4335|ff3333|f00)$/.test(c)
  const year = Number(/^(\d{4})/.exec(sheet.name)?.[1] ?? new Date().getFullYear())

  const days: SchedulePlans['days'] = {}
  const months: SchedulePlans['months'] = {}
  let month = '' // 'yyyy-MM'
  let dateCols: Map<string, string> | null = null
  let lastNoteRow = -2
  let legendMode = false

  for (const rowNo of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(rowNo)!
    const b = row.get('B')
    const header = Array.isArray(b) ? /^\s*(\d{1,2})\s*월\s*$/.exec(b.map((r) => r.t).join('')) : null
    if (header) {
      month = `${year}-${header[1].padStart(2, '0')}`
      months[month] ??= { legend: [], notes: [] }
      dateCols = null
      continue
    }
    if (!month) continue
    // 비고 칸: 담당자 안내와 그 달 메모
    const j = row.get('J')
    if (Array.isArray(j)) {
      for (const line of linesOf(j)) {
        if (/^(비고|담당자 컬러)$/.test(line.text)) {
          legendMode = line.text === '담당자 컬러'
          lastNoteRow = rowNo
          continue
        }
        const nameOnly = line.marks.length === 1 && !line.done && /^[가-힣]{2,3}$/.test(line.text)
        const legendTail = legendMode && rowNo === lastNoteRow + 1 && line.marks.length === 1 && !line.done && line.text.length <= 30
        if (nameOnly || legendTail) {
          months[month].legend.push({ mark: line.marks[0], name: line.text })
          legendMode = true
        } else {
          months[month].notes.push(line)
          legendMode = false
        }
        lastNoteRow = rowNo
      }
    }
    // 날짜 줄: B~H 가 모두 날짜 숫자
    const serials = DAY_COLS.map((c) => row.get(c))
    if (serials.every((v) => typeof v === 'number' && v > 40_000 && v < 80_000)) {
      dateCols = new Map(DAY_COLS.map((c, i) => [c, serialToKey(serials[i] as number)]))
      continue
    }
    // 날짜 칸 일정(그 달 날짜만: 앞뒤 달 날짜는 그 달 달력에 있다)
    if (dateCols) {
      for (const c of DAY_COLS) {
        const v = row.get(c)
        const key = dateCols.get(c)
        if (!Array.isArray(v) || !key || !key.startsWith(month)) continue
        for (const line of linesOf(v)) {
          if (!line.marks.length && isRed(line.color)) continue // 공휴일
          ;(days[key] ??= []).push(line)
        }
      }
    }
  }

  // 안내가 없는 달·색은 가까운 달의 안내로 채운다
  const keys = Object.keys(months).sort()
  const original = new Map(keys.map((k) => [k, months[k].legend]))
  keys.forEach((k, i) => {
    const own = new Map(original.get(k)!.map((l) => [l.mark, l.name]))
    const nearest = keys.map((o, oi) => ({ o, d: Math.abs(oi - i) + (oi < i ? 0 : 0.5) })).filter((x) => x.o !== k).sort((a, b) => a.d - b.d)
    const used = new Set([...Object.entries(days).filter(([d]) => d.startsWith(k)).flatMap(([, ls]) => ls.flatMap((l) => l.marks)), ...months[k].notes.flatMap((l) => l.marks)])
    for (const mark of used) {
      if (own.has(mark)) continue
      const name = nearest.map(({ o }) => original.get(o)!.find((l) => l.mark === mark)?.name).find(Boolean)
      if (name) own.set(mark, name)
    }
    months[k].legend = [...own].map(([mark, name]) => ({ mark, name }))
  })

  return { importedAt: Date.now(), fileName, sheet: sheet.name, months, days }
}

// ── 한 줄씩 등록·고치기·지우기(디자인팀·관리자). 날짜 칸에 엑셀처럼 한 줄로 붙는다 ──
const canEditPlans = (u: PublicUser) => u.role === 'designer' || isManager(u)
const KNOWN_MARKS = new Set(['⬛', '⬜', '🟥', '🟦', '🟧', '🟨', '🟩', '🟪', '🟫'])

function lineFrom(body: Record<string, unknown>): PlanLine {
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  if (!text) throw new HttpError(400, '내용을 적어 주세요.')
  const marks = Array.isArray(body.marks) ? body.marks.filter((m): m is string => typeof m === 'string' && KNOWN_MARKS.has(m)).slice(0, 4) : []
  const color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : undefined
  return { marks, text, done: body.done === true, ...(color ? { color } : {}) }
}

async function editPlans(user: PublicUser, fn: (p: SchedulePlans) => void) {
  if (!canEditPlans(user)) throw new HttpError(403, '디자인팀이나 관리자만 일정을 등록할 수 있습니다.')
  const plans = (await schedulePlans()) ?? { importedAt: Date.now(), fileName: '', sheet: '', months: {}, days: {} }
  fn(plans)
  await writeFile(FILE + '.tmp', JSON.stringify(plans))
  await rename(FILE + '.tmp', FILE)
  return { ok: true }
}

const checkDate = (d: unknown) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, '날짜가 올바르지 않습니다.')
  return d
}

export function addPlanLine(user: PublicUser, body: Record<string, unknown>) {
  const date = checkDate(body.date)
  const line = lineFrom(body)
  return editPlans(user, (p) => {
    ;(p.days[date] ??= []).push(line)
  })
}

// index: 그날 목록에서의 순서. 날짜를 바꾸면 새 날짜 끝으로 옮긴다
export function updatePlanLine(user: PublicUser, date: string, index: number, body: Record<string, unknown>) {
  checkDate(date)
  const line = lineFrom(body)
  const to = body.date === undefined ? date : checkDate(body.date)
  return editPlans(user, (p) => {
    const list = p.days[date]
    if (!list?.[index]) throw new HttpError(404, '일정을 찾을 수 없습니다. 새로고침해 주세요.')
    if (to === date) list[index] = line
    else {
      list.splice(index, 1)
      if (!list.length) delete p.days[date]
      ;(p.days[to] ??= []).push(line)
    }
  })
}

export function deletePlanLine(user: PublicUser, date: string, index: number) {
  checkDate(date)
  return editPlans(user, (p) => {
    const list = p.days[date]
    if (!list?.[index]) throw new HttpError(404, '일정을 찾을 수 없습니다. 새로고침해 주세요.')
    list.splice(index, 1)
    if (!list.length) delete p.days[date]
  })
}
