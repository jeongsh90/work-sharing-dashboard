import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

import { HttpError } from './requests.ts'

// 디자인 툴 > 수매확인서·노로 비검출해역 확인서: PDF 첫 장(또는 스캔 이미지)을 이미지로 바꾸고(윈도우 내장 Windows.Data.Pdf),
// 한국어 OCR(Windows.Media.Ocr)로 강조할 글자('생식용 굴' / '노로 비검출해역')·표 첫 칸·발행일을 찾아 강조 위치를 계산한다.
// 사양: docs/tools/수매확인서_툴_사양.md 7장, docs/tools/노로비검출_툴_사양.md. 좌표는 종이(620×877) 왼쪽 위 기준, 1배.

const execFileAsync = promisify(execFile)
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/pdf-page.ps1')
const PAGE_WIDTH = 2480 // A4 300dpi 가로
const PAPER_WIDTH = 620

type Word = { t: string; x: number; y: number; w: number; h: number; line: string }
type Ocr = { width: number; height: number; lines: { text: string; words: Omit<Word, 'line'>[] }[] }
type Box = { l: number; t: number; r: number; b: number }

export type CertLayout = {
  pageImage: string // data:image/jpeg;base64,...
  pageCount: number
  issued: string | null // PDF 발행일 yyyy-MM-dd (못 읽으면 null)
  produced: string | null // 표 첫 칸 생산일자 값, PDF 에 적힌 그대로(예 10.22). 말풍선에 이 값을 쓴다
  highlight: Box | null
  tag: { left: number; top: number } | null // 강조 말풍선('생식용 굴' 164×50 / '노로 비검출해역' 220×50)
  dateBox: { left: number; top: number } | null // '수매일자' 말풍선(164×112)
  warnings: string[]
}

export type CertKind = 'purchase' | 'noro'

export const analyzePurchaseCert = (file: Buffer) => analyzeCert(file, 'purchase')
export const analyzeNoroCert = (file: Buffer) => analyzeCert(file, 'noro')

// 올린 파일 → 첫 장 JPG(가로 2480) + OCR. PDF 는 윈도우가 그리고, 스캔 이미지(JPG·PNG·WebP)는 sharp 로 크기만 맞춰 OCR 한다
async function pageAndOcr(file: Buffer, allowImage: boolean, dir: string) {
  const jpgPath = join(dir, 'page.jpg')
  const ocrPath = join(dir, 'ocr.json')
  const isPdf = file.subarray(0, 5).toString() === '%PDF-'
  let stderr = ''
  if (isPdf) {
    const pdfPath = join(dir, 'in.pdf')
    await writeFile(pdfPath, file)
    try {
      const r = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Pdf', pdfPath, '-OutJpg', jpgPath, '-OutOcr', ocrPath, '-Width', String(PAGE_WIDTH)],
        { timeout: 90_000, windowsHide: true },
      )
      stderr = r.stderr
    } catch (e) {
      console.error('확인서 PDF 변환 실패:', e)
      throw new HttpError(500, 'PDF 를 이미지로 바꾸지 못했습니다. PDF 파일이 맞는지 확인해 주세요.')
    }
  } else {
    const meta = allowImage ? await sharp(file).metadata().catch(() => null) : null
    if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format ?? '')) {
      throw new HttpError(400, allowImage ? 'PDF 나 이미지(JPG·PNG) 파일만 올릴 수 있습니다.' : 'PDF 파일만 올릴 수 있습니다.')
    }
    await sharp(file).rotate().flatten({ background: '#ffffff' }).resize({ width: PAGE_WIDTH }).jpeg({ quality: 92 }).toFile(jpgPath)
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Img', jpgPath, '-OutOcr', ocrPath], {
        timeout: 90_000,
        windowsHide: true,
      })
    } catch (e) {
      console.error('확인서 이미지 OCR 실패:', e)
      throw new HttpError(500, '이미지에서 글자를 읽지 못했습니다.')
    }
  }
  const ocr = JSON.parse((await readFile(ocrPath, 'utf8')).replace(/^﻿/, '')) as Ocr
  const jpg = await readFile(jpgPath)
  const pageCount = /PDF 가 (\d+)쪽/.exec(stderr)?.[1] ? Number(/PDF 가 (\d+)쪽/.exec(stderr)![1]) : 1
  return { ocr, jpg, pageCount }
}

async function analyzeCert(file: Buffer, kind: CertKind): Promise<CertLayout> {
  if (file.length === 0) throw new HttpError(400, kind === 'noro' ? '확인서 파일을 올려 주세요.' : 'PDF 파일을 올려 주세요.')
  const dir = await mkdtemp(join(tmpdir(), 'wsd-cert-'))
  try {
    const { ocr, jpg, pageCount } = await pageAndOcr(file, kind === 'noro', dir)
    const warnings: string[] = []
    if (pageCount > 1) warnings.push(`PDF 가 ${pageCount}쪽입니다. 첫 장만 씁니다.`)

    const s = PAPER_WIDTH / ocr.width
    const words: Word[] = ocr.lines.flatMap((l) => l.words.map((w) => ({ ...w, line: l.text })))

    // 7-2. 발행일
    const issuedLine = ocr.lines.find((l) => l.text.includes('발행'))?.text ?? ''
    const dm = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/.exec(issuedLine)
    const pad = (n: string) => n.padStart(2, '0')
    const issued = dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : null

    // 픽셀(표 선 찾기): 밝기 < 120 = 선
    const { data: px, info } = await sharp(jpg).greyscale().raw().toBuffer({ resolveWithObject: true })
    const PW = info.width
    const PH = info.height
    const dark = (x: number, y: number) => x < 0 || y < 0 || x >= PW || y >= PH || px[y * PW + x] < 120
    const scanX = (x: number, y: number, dx: number) => {
      while (!dark(x, y)) x += dx
      return x
    }
    const scanY = (x: number, y: number, dy: number) => {
      while (!dark(x, y)) y += dy
      return y
    }

    // 7-3. 강조 형광펜
    let highlight: Box | null = null
    let tag: CertLayout['tag'] = null
    if (kind === 'noro') {
      // 표 채취해역 칸의 '노로 비검출해역'(아래 '노로검출지역' 줄은 빼고). 말풍선 220×50 은 형광펜 가운데 아래, 종이 밖으로 나가지 않게
      const n1 = words.find((w) => /^노로/.test(w.t) && /비검출/.test(w.line) && !/검출지역/.test(w.line))
      if (n1) {
        const rest = words.filter((w) => w.line === n1.line && w.x > n1.x && Math.abs(w.y - n1.y) < 40).sort((a, b) => a.x - b.x)
        const end = rest.find((w) => /해역/.test(w.t)) ?? rest[rest.length - 1] ?? n1
        const top = Math.min(n1.y, end.y)
        const bottom = Math.max(n1.y + n1.h, end.y + end.h)
        highlight = { l: (n1.x - 8) * s, t: (top - 8) * s, r: (end.x + end.w + 8) * s, b: (bottom + 8) * s }
        const left = (highlight.l + highlight.r) / 2 - 110
        tag = { left: Math.max(4, Math.min(PAPER_WIDTH - 224, left)), top: highlight.b + 14 }
      } else {
        warnings.push("확인서에서 '노로 비검출해역' 글자를 찾지 못해 형광펜을 넣지 않았습니다.")
      }
    }
    const w1 = kind === 'purchase' ? (words.find((w) => /^생식용/.test(w.t) && w.line.includes('증명')) ?? words.find((w) => /^생식용/.test(w.t))) : undefined
    if (kind === 'noro') {
      // 위에서 했다
    } else if (w1) {
      const w2 = words.filter((w) => w.line === w1.line && w.x > w1.x).sort((a, b) => a.x - b.x)[0]
      const right = w2 && /^굴/.test(w2.t) ? w2.x + w2.w / [...w2.t].length : w1.x + w1.w
      highlight = { l: (w1.x - 8) * s, t: (w1.y - 10) * s, r: (right + 8) * s, b: (w1.y + w1.h + 10) * s }
      // 7-4. 말풍선: 형광펜 가운데 아래
      tag = { left: (highlight.l + highlight.r) / 2 - 82, top: highlight.b + 14 }
    } else {
      warnings.push("PDF 에서 '생식용' 글자를 찾지 못해 형광펜을 넣지 않았습니다.")
    }

    // 7-5. 표 첫 칸(생산일자) → 수매일자 말풍선
    let dateBox: CertLayout['dateBox'] = null
    let produced: string | null = null
    const hd = words.find((w) => /^(중량|품목|수량)/.test(w.t))
    if (hd) {
      const c1 = words.filter((w) => Math.abs(w.y - hd.y) < 40).sort((a, b) => a.x - b.x)[0]
      const cy = Math.round(c1.y + c1.h / 2)
      const cx = Math.round(c1.x + c1.w / 2)
      const T = scanY(cx, c1.y - 3, -1)
      // 노로 확인서(팩스 스캔)는 머리 글자를 일부만 읽어(수매일자 → '수 자') 글자 줄에서 옆으로 찾으면 글자에 걸린다.
      // 칸 위 선 바로 아래(글자 위) 줄에서 왼쪽·오른쪽 선을 찾는다. 선 두께를 지나 첫 밝은 줄을 쓴다
      let rowY = cy
      if (kind === 'noro') {
        rowY = T + 1
        while (rowY < c1.y && dark(cx, rowY)) rowY++
        rowY = Math.min(rowY + 4, c1.y - 2)
      }
      const L = scanX(c1.x - 3, rowY, -1)
      const R = scanX(c1.x + c1.w + 3, rowY, 1)
      const vx = L + 10 // 칸 안 왼쪽(날짜 글자를 피한다)
      const mid = scanY(vx, c1.y + c1.h + 3, 1)
      let y = mid
      while (dark(vx, y) && y < PH) y++
      const B = scanY(vx, y, 1)
      dateBox = { left: R * s + 4 - 164, top: ((T + B) / 2) * s - 56 }
      // 생산일자 값: 첫 칸 머리 아래(값 칸) 안에 든 글자를 PDF 에 적힌 그대로 읽는다(예 10.22)
      const cell = words
        .filter((w) => {
          const mx = w.x + w.w / 2
          const my = w.y + w.h / 2
          return mx > L && mx < R && my > mid && my < B
        })
        .sort((a, b) => a.y - b.y || a.x - b.x)
      const text = cell
        .map((w) => w.t)
        .join(' ')
        .replace(/\s*([./-])\s*/g, '$1')
        .trim()
      produced = text || null
      // 노로 확인서는 표에 2026.11.06 처럼 연도까지 적혀 있어 말풍선에는 월.일만(11.06)
      const ymd = kind === 'noro' && produced ? /^\d{4}\.(\d{1,2})\.(\d{1,2})$/.exec(produced) : null
      if (ymd) produced = `${ymd[1].padStart(2, '0')}.${ymd[2].padStart(2, '0')}`
    } else {
      warnings.push(kind === 'noro' ? '확인서에서 표(수매일자 칸)를 찾지 못해 수매일자 말풍선을 기본 위치에 넣었습니다.' : 'PDF 에서 표(생산일자 칸)를 찾지 못해 생산일자 말풍선을 기본 위치에 넣었습니다.')
    }
    if (dateBox && !produced) warnings.push(kind === 'noro' ? '확인서에서 수매일자 값을 읽지 못했습니다. 직접 입력해 주세요.' : 'PDF 에서 생산일자 값을 읽지 못했습니다. 직접 입력해 주세요.')

    return {
      pageImage: `data:image/jpeg;base64,${jpg.toString('base64')}`,
      pageCount,
      issued,
      produced,
      highlight,
      tag,
      dateBox,
      warnings,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
