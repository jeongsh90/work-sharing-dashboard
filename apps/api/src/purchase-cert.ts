import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

import { HttpError } from './requests.ts'

// 디자인 툴 > 수매확인서: PDF 첫 장을 이미지로 바꾸고(윈도우 내장 Windows.Data.Pdf),
// 한국어 OCR(Windows.Media.Ocr)로 '생식용 굴'·표 첫 칸·발행일을 찾아 강조 위치를 계산한다.
// 사양: docs/tools/수매확인서_툴_사양.md 7장. 좌표는 종이(620×877) 왼쪽 위 기준, 1배.

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
  highlight: Box | null
  tag: { left: number; top: number } | null // '생식용 굴' 말풍선(164×50)
  dateBox: { left: number; top: number } | null // '수매일자' 말풍선(164×112)
  warnings: string[]
}

export async function analyzePurchaseCert(pdf: Buffer): Promise<CertLayout> {
  if (pdf.length === 0) throw new HttpError(400, 'PDF 파일을 올려 주세요.')
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'PDF 파일만 올릴 수 있습니다.')
  const dir = await mkdtemp(join(tmpdir(), 'wsd-cert-'))
  try {
    const pdfPath = join(dir, 'in.pdf')
    const jpgPath = join(dir, 'page.jpg')
    const ocrPath = join(dir, 'ocr.json')
    await writeFile(pdfPath, pdf)
    let stderr = ''
    try {
      const r = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Pdf', pdfPath, '-OutJpg', jpgPath, '-OutOcr', ocrPath, '-Width', String(PAGE_WIDTH)],
        { timeout: 90_000, windowsHide: true },
      )
      stderr = r.stderr
    } catch (e) {
      console.error('수매확인서 PDF 변환 실패:', e)
      throw new HttpError(500, 'PDF 를 이미지로 바꾸지 못했습니다. PDF 파일이 맞는지 확인해 주세요.')
    }
    const ocr = JSON.parse((await readFile(ocrPath, 'utf8')).replace(/^﻿/, '')) as Ocr
    const jpg = await readFile(jpgPath)
    const pageCount = /PDF 가 (\d+)쪽/.exec(stderr)?.[1] ? Number(/PDF 가 (\d+)쪽/.exec(stderr)![1]) : 1
    const warnings: string[] = []
    if (pageCount > 1) warnings.push(`PDF 가 ${pageCount}쪽입니다. 첫 장만 씁니다.`)

    const s = PAPER_WIDTH / ocr.width
    const words: Word[] = ocr.lines.flatMap((l) => l.words.map((w) => ({ ...w, line: l.text })))

    // 7-2. 발행일
    const issuedLine = ocr.lines.find((l) => l.text.includes('발행'))?.text ?? ''
    const dm = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/.exec(issuedLine)
    const pad = (n: string) => n.padStart(2, '0')
    const issued = dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : null
    if (!issued) warnings.push('PDF 에서 발행일을 읽지 못했습니다. 수매일자를 직접 골라 주세요.')

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

    // 7-3. '생식용 굴' 형광펜
    let highlight: Box | null = null
    let tag: CertLayout['tag'] = null
    const w1 = words.find((w) => /^생식용/.test(w.t) && w.line.includes('증명')) ?? words.find((w) => /^생식용/.test(w.t))
    if (w1) {
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
    const hd = words.find((w) => /^(중량|품목|수량)/.test(w.t))
    if (hd) {
      const c1 = words.filter((w) => Math.abs(w.y - hd.y) < 40).sort((a, b) => a.x - b.x)[0]
      const cy = Math.round(c1.y + c1.h / 2)
      const cx = Math.round(c1.x + c1.w / 2)
      const L = scanX(c1.x - 3, cy, -1)
      const R = scanX(c1.x + c1.w + 3, cy, 1)
      const T = scanY(cx, c1.y - 3, -1)
      const vx = L + 10 // 칸 안 왼쪽(날짜 글자를 피한다)
      const mid = scanY(vx, c1.y + c1.h + 3, 1)
      let y = mid
      while (dark(vx, y) && y < PH) y++
      const B = scanY(vx, y, 1)
      dateBox = { left: R * s + 4 - 164, top: ((T + B) / 2) * s - 56 }
    } else {
      warnings.push('PDF 에서 표(생산일자 칸)를 찾지 못해 수매일자 말풍선을 기본 위치에 넣었습니다.')
    }

    return {
      pageImage: `data:image/jpeg;base64,${jpg.toString('base64')}`,
      pageCount,
      issued,
      highlight,
      tag,
      dateBox,
      warnings,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
