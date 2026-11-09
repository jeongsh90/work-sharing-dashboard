import { useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { ArrowLeft, FileDown, FileSearch, FileText, Trash2, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { confirmDialog } from "@/components/confirm-dialog"
import { DateRangePicker } from "@/components/date-range-picker"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, apiFetch, ApiError } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { invalidate, useApi } from "@/lib/store"

// 구글 색인 보고서(슈퍼관리자): 서치콘솔 색인 요청 보고서를 날짜별로 올려 두고 본다(서버 apps/api/src/index-reports.ts).
// 처음엔 날짜별 목록만 보이고, 보고서를 누르면 그 보고서를 넓게 연다("목록"으로 돌아간다). 보고서 HTML 은 원본 스타일을 빼고 WSD 디자인(index.css 의 .index-report)으로 다시 입힌다.

type ReportSummary = { id: number; date: string; title: string; summary: string; hasPdf: boolean; pdfName: string; createdAt: number; updatedAt: number }
type ReportDetail = ReportSummary & { html: string }

const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
const dayLabel = (s: string) => format(toDate(s), "M월 d일 (EEE)", { locale: ko })
const ymd = (d: Date) => format(d, "yyyy-MM-dd")

// 화면에 넣기 전에 한 번 더 거른다: 허용한 태그·속성만 남기고, 표는 가로 스크롤 틀로 감싼다
const TAGS = new Set(
  "div p span b strong i em u br h1 h2 h3 h4 ul ol li table thead tbody tr th td code small a svg g line rect text circle path polyline".split(" "),
)
const ATTRS = new Set(
  "class colspan rowspan href viewBox width height x y x1 y1 x2 y2 rx ry cx cy r d points fill stroke stroke-width font-size text-anchor role aria-label".split(
    " ",
  ),
)
function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html")
  const root = doc.getElementById("root")!
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase()
      if (!TAGS.has(tag)) {
        child.remove()
        continue
      }
      for (const a of [...child.attributes]) {
        if (!ATTRS.has(a.name) || (a.name === "href" && !/^https?:/i.test(a.value))) child.removeAttribute(a.name)
      }
      if (tag === "a") {
        child.setAttribute("target", "_blank")
        child.setAttribute("rel", "noreferrer")
      }
      walk(child)
    }
  }
  walk(root)
  for (const table of [...root.querySelectorAll("table")]) {
    const wrap = doc.createElement("div")
    wrap.className = "table-wrap"
    table.replaceWith(wrap)
    wrap.append(table)
  }
  return root.innerHTML
}

async function openPdf(r: ReportSummary) {
  const res = await apiFetch(`/index-reports/${r.id}/pdf`)
  if (!res.ok) throw new ApiError(res.status, "PDF 를 받지 못했습니다.")
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement("a")
  a.href = url
  a.download = r.pdfName || `${r.date} 색인 보고서.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function IndexReportPage() {
  const { data: reports, error: loadError } = useApi<ReportSummary[]>("/index-reports")
  const [picked, setPicked] = useState<number | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const selected = reports?.find((r) => r.id === picked) ?? null
  const open = (id: number | null) => {
    setPicked(id)
    setActionError(null)
    window.scrollTo({ top: 0 })
  }
  const { data: detail, error: detailError } = useApi<ReportDetail>(selected ? `/index-reports/${selected.id}` : null, 300_000)
  const body = useMemo(() => (detail && detail.id === selected?.id ? sanitize(detail.html) : null), [detail, selected?.id])

  if (!reports) return <PageState error={loadError} />

  const remove = async (r: ReportSummary) => {
    if (
      !(await confirmDialog({
        title: `${dayLabel(r.date)} 보고서를 지울까요?`,
        description: "지운 보고서는 되돌릴 수 없습니다. 원본 파일은 PC 폴더에 그대로 있습니다.",
        confirmText: "삭제",
        destructive: true,
      }))
    )
      return
    try {
      await api(`/index-reports/${r.id}`, { method: "DELETE" })
      open(null)
      invalidate()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "지우지 못했습니다.")
    }
  }

  return (
    <div className={PAGE_GRID}>
      {/* 날짜별 목록(보고서를 고르기 전) */}
      {!selected && (
        <Section
          title="날짜별 보고서"
          aside={<span className="text-sm text-muted-foreground tabular-nums">{reports.length}건</span>}
          action={
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              보고서 올리기
            </Button>
          }
          className="col-span-12"
        >
          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
              <FileSearch className="size-8" />
              아직 올린 보고서가 없습니다. "보고서 올리기"로 HTML(과 PDF)을 올려 주세요.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {reports.map((r) => {
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => open(r.id)}
                      className="flex h-full w-full flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{dayLabel(r.date)}</span>
                        {r.hasPdf && (
                          <Badge variant="outline" className="ml-auto">
                            PDF
                          </Badge>
                        )}
                      </span>
                      <span className="truncate text-sm">{r.title}</span>
                      {r.summary && <span className="line-clamp-2 text-xs break-keep text-muted-foreground">{r.summary}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}

      {/* 고른 보고서 */}
      {selected && (
        <Section
          title={selected.title}
          aside={<span className="text-sm text-muted-foreground tabular-nums">{dayLabel(selected.date)}</span>}
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => open(null)}>
                <ArrowLeft data-icon="inline-start" />
                목록
              </Button>
              {selected.hasPdf && (
                <Button variant="outline" size="sm" onClick={() => openPdf(selected).catch((e) => setActionError(e.message))}>
                  <FileDown data-icon="inline-start" />
                  PDF 받기
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void remove(selected)}>
                <Trash2 data-icon="inline-start" />
                삭제
              </Button>
            </div>
          }
          className="col-span-12"
        >
          {actionError && <FieldError>{actionError}</FieldError>}
          {body === null ? (
            <PageState error={detailError} />
          ) : (
            <article className="index-report rounded-xl border bg-card p-4 md:p-6" dangerouslySetInnerHTML={{ __html: body }} />
          )}
        </Section>
      )}

      {uploadOpen && (
        <UploadDialog
          reports={reports}
          onClose={() => setUploadOpen(false)}
          onDone={(id) => {
            setUploadOpen(false)
            setPicked(id)
            invalidate()
          }}
        />
      )}
    </div>
  )
}

const readText = (f: File) => f.text()
const readBase64 = async (f: File) => {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// 파일 이름 앞 YYMMDD(예: 261109_셰프애찬_색인요청_보고서.html)로 날짜를 미리 채운다
function dateFromName(name: string) {
  const m = name.match(/^(\d{2})(\d{2})(\d{2})_/)
  return m ? new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function UploadDialog({ reports, onClose, onDone }: { reports: ReportSummary[]; onClose: () => void; onDone: (id: number) => void }) {
  const [date, setDate] = useState<Date | undefined>(new Date())
  const [html, setHtml] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const htmlRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const same = date ? reports.find((r) => r.date === ymd(date)) : undefined

  const submit = async () => {
    if (!date) return setError("보고서 날짜를 골라 주세요.")
    if (!html) return setError("보고서 HTML 파일을 골라 주세요.")
    if (
      same &&
      !(await confirmDialog({
        title: `${dayLabel(same.date)} 보고서를 바꿀까요?`,
        description: "같은 날짜의 보고서가 이미 있습니다. 새 파일로 바꿉니다.",
        confirmText: "바꾸기",
      }))
    )
      return
    setPending(true)
    setError(null)
    try {
      const r = await api<{ id: number }>("/index-reports", {
        body: { date: ymd(date), html: await readText(html), ...(pdf ? { pdf: await readBase64(pdf), pdfName: pdf.name } : {}) },
      })
      onDone(r.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "올리지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  const pickHtml = (f: File | null) => {
    setHtml(f)
    const d = f && dateFromName(f.name)
    if (d) setDate(d)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>색인 보고서 올리기</DialogTitle>
          <DialogDescription>보고서 HTML 을 올리면 WSD 화면에 맞춰 보여 줍니다. PDF 는 함께 올리면 내려받을 수 있습니다.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>보고서 HTML</FieldLabel>
            <input ref={htmlRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => pickHtml(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" className="justify-start font-normal" onClick={() => htmlRef.current?.click()}>
              <FileText data-icon="inline-start" />
              <span className="truncate">{html ? html.name : "HTML 파일 고르기"}</span>
            </Button>
            <FieldDescription>파일 이름이 261109_… 처럼 날짜로 시작하면 날짜를 자동으로 채웁니다.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>PDF (선택)</FieldLabel>
            <input ref={pdfRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" className="justify-start font-normal" onClick={() => pdfRef.current?.click()}>
              <FileDown data-icon="inline-start" />
              <span className="truncate">{pdf ? pdf.name : "PDF 파일 고르기"}</span>
            </Button>
          </Field>
          <Field>
            <FieldLabel htmlFor="ir-date">보고서 날짜</FieldLabel>
            <DateRangePicker id="ir-date" single value={date ? { from: date, to: undefined } : undefined} onChange={(r) => setDate(r?.from)} />
            {same && <FieldDescription className="text-amber-700 dark:text-amber-300">이 날짜에 이미 보고서가 있습니다. 올리면 바뀝니다.</FieldDescription>}
          </Field>
        </FieldGroup>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !html}>
            <Upload data-icon="inline-start" />
            {pending ? "올리는 중…" : "올리기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
