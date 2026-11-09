import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'

// 구글 색인 보고서(슈퍼관리자 전용): 서치콘솔 색인 요청 보고서(HTML)를 날짜마다 하나씩 올려 두고 WSD 화면에서 본다.
// HTML 은 <body> 안쪽만 저장하고(스크립트·스타일·이벤트 속성은 뺀다) 화면이 WSD 디자인으로 다시 입힌다. PDF 는 함께 올리면 내려받기용으로 둔다.

db.exec(`
CREATE TABLE IF NOT EXISTS index_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  html        TEXT NOT NULL,
  pdf         BLOB,
  pdf_name    TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`)

type Row = {
  id: number
  report_date: string
  title: string
  summary: string
  html: string
  pdf: Uint8Array | null
  pdf_name: string
  created_by: string
  created_at: number
  updated_at: number
}

const HTML_MAX = 2_000_000
const PDF_MAX = 20 * 1024 * 1024

export function onlySuper(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 볼 수 있습니다.')
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
const plain = (s: string) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

// <body> 안쪽만, 위험한 것은 뺀다(화면에서도 한 번 더 거른다)
export function cleanReportHtml(raw: string) {
  const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? raw
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|title|head)\b[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim()
}

// 제목: 첫 <h1>, 요약: .summary 첫 문단(목록에 한 줄로)
function describe(html: string) {
  const title = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const summaryBox = html.match(/class="summary"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
  const summary = plain(summaryBox.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '').replace(/^결론\s*[:—-]?\s*/, '')
  return { title, summary: summary.slice(0, 400) }
}

// 보고서 위쪽 숫자 칸(.tile 의 .k 이름 / .v 값)에서 색인 현황을 뽑는다(목록 차트용). 색인 요청 보고서가 아니면 null
export function reportStats(html: string) {
  const tiles = [...html.matchAll(/class="k"[^>]*>([\s\S]*?)<\/div>\s*<div class="v[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => ({
    k: plain(m[1]),
    v: Number(plain(m[2]).replace(/,/g, '')),
  }))
  const pick = (re: RegExp) => {
    const t = tiles.find((x) => re.test(x.k) && Number.isFinite(x.v))
    return t ? t.v : null
  }
  const requested = pick(/요청/)
  const indexed = pick(/색인.*됨/)
  if (requested === null || indexed === null) return null
  return { total: pick(/전체/), requested, indexed, pending: pick(/대기/) ?? Math.max(0, requested - indexed) }
}

const dto = (r: Omit<Row, 'html' | 'pdf'> & { has_pdf: number }) => ({
  id: r.id,
  date: r.report_date,
  title: r.title,
  summary: r.summary,
  hasPdf: r.has_pdf === 1,
  pdfName: r.pdf_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const LIST_COLS = 'id, report_date, title, summary, pdf_name, created_by, created_at, updated_at, (pdf IS NOT NULL) AS has_pdf'

export function listIndexReports(user: PublicUser) {
  onlySuper(user)
  return all<Omit<Row, 'pdf'> & { has_pdf: number }>(`SELECT ${LIST_COLS}, html FROM index_reports ORDER BY report_date DESC`).map((r) => ({
    ...dto(r),
    stats: reportStats(r.html),
  }))
}

export function getIndexReport(user: PublicUser, id: number) {
  onlySuper(user)
  const r = get<Omit<Row, 'pdf'> & { has_pdf: number }>(`SELECT ${LIST_COLS}, html FROM index_reports WHERE id = :id`, { id })
  if (!r) throw new HttpError(404, '보고서를 찾을 수 없습니다.')
  return { ...dto(r), html: r.html }
}

export function indexReportPdf(user: PublicUser, id: number) {
  onlySuper(user)
  const r = get<{ pdf: Uint8Array | null; pdf_name: string }>('SELECT pdf, pdf_name FROM index_reports WHERE id = :id', { id })
  if (!r?.pdf) throw new HttpError(404, 'PDF 가 없습니다.')
  return { data: Buffer.from(r.pdf), name: r.pdf_name || `report-${id}.pdf` }
}

// 올리기: 같은 날짜가 있으면 바꾼다(PDF 를 안 보내면 예전 PDF 는 둔다)
export function saveIndexReport(user: PublicUser, body: Record<string, unknown>) {
  onlySuper(user)
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : ''
  if (!date) throw new HttpError(400, '보고서 날짜를 골라 주세요.')
  const raw = typeof body.html === 'string' ? body.html : ''
  if (!raw.trim()) throw new HttpError(400, '보고서 HTML 파일을 골라 주세요.')
  if (raw.length > HTML_MAX) throw new HttpError(413, 'HTML 파일이 너무 큽니다.')
  const html = cleanReportHtml(raw)
  const d = describe(html)
  const title = (typeof body.title === 'string' && body.title.trim().slice(0, 100)) || d.title || `${date} 색인 보고서`
  let pdf: Buffer | null = null
  if (typeof body.pdf === 'string' && body.pdf) {
    pdf = Buffer.from(body.pdf, 'base64')
    if (pdf.length > PDF_MAX) throw new HttpError(413, 'PDF 는 20MB 까지 올릴 수 있습니다.')
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'PDF 파일이 아닙니다.')
  }
  const pdfName = typeof body.pdfName === 'string' ? body.pdfName.slice(0, 200) : ''
  const now = Date.now()
  const old = get<{ id: number }>('SELECT id FROM index_reports WHERE report_date = :date', { date })
  if (old) {
    run('UPDATE index_reports SET title = :title, summary = :summary, html = :html, updated_at = :now WHERE id = :id', {
      id: old.id,
      title,
      summary: d.summary,
      html,
      now,
    })
    if (pdf) run('UPDATE index_reports SET pdf = :pdf, pdf_name = :name WHERE id = :id', { id: old.id, pdf, name: pdfName })
    return { id: old.id, replaced: true }
  }
  const r = run(
    `INSERT INTO index_reports (report_date, title, summary, html, pdf, pdf_name, created_by, created_at, updated_at)
     VALUES (:date, :title, :summary, :html, :pdf, :name, :by, :now, :now)`,
    { date, title, summary: d.summary, html, pdf, name: pdf ? pdfName : '', by: user.id, now },
  )
  return { id: Number(r.lastInsertRowid), replaced: false }
}

export function deleteIndexReport(user: PublicUser, id: number) {
  onlySuper(user)
  run('DELETE FROM index_reports WHERE id = :id', { id })
  return { ok: true }
}
