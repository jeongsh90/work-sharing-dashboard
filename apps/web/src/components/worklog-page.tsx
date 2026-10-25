import { useState } from "react"
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { EVENT_LABEL, STATUS_LABEL, type RequestStatus } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { invalidate, useApi } from "@/lib/store"

// 업무일지(디자인팀 작업자): 이 시스템에서 내가 한 일(진행 기록)이 날짜별로 자동으로 적히고,
// 날마다 직접 메모를 더 쓸 수 있다. 일간·주간·월간으로 보고, 보고용 글로 복사할 수 있다.

type Mode = "day" | "week" | "month"
type LogEvent = {
  at: number
  type: string
  fromStatus: RequestStatus | null
  toStatus: RequestStatus | null
  note: string
  requestId: number
  code: string
  title: string
}
type Note = { day: string; body: string; updatedAt: number }
type Worklog = { events: LogEvent[]; notes: Note[] }

const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEK = ["일", "월", "화", "수", "목", "금", "토"]
const dayTitle = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

// 보이는 기간(주는 월요일부터)
function rangeOf(mode: Mode, anchor: Date) {
  if (mode === "day") return { from: anchor, to: anchor }
  if (mode === "week") {
    const monday = addDays(anchor, -((anchor.getDay() + 6) % 7))
    return { from: monday, to: addDays(monday, 6) }
  }
  return { from: new Date(anchor.getFullYear(), anchor.getMonth(), 1), to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) }
}

function move(mode: Mode, anchor: Date, step: number) {
  if (mode === "day") return addDays(anchor, step)
  if (mode === "week") return addDays(anchor, step * 7)
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1)
}

function rangeLabel(mode: Mode, from: Date, to: Date) {
  if (mode === "day") return `${from.getFullYear()}년 ${dayTitle(from)}`
  if (mode === "month") return `${from.getFullYear()}년 ${from.getMonth() + 1}월`
  return `${dayTitle(from)} ~ ${dayTitle(to)}`
}

// 기록 한 줄: "작업 시작 → 작업 중" + 메모
function eventText(e: LogEvent) {
  const label = EVENT_LABEL[e.type] ?? e.type
  const status = e.toStatus && e.toStatus !== e.fromStatus ? ` → ${STATUS_LABEL[e.toStatus] ?? e.toStatus}` : ""
  return `${label}${status}${e.note ? ` · ${e.note}` : ""}`
}

const time = (at: number) => {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 날짜별로 묶는다. 일·주는 모든 날, 월은 기록이나 메모가 있는 날(과 오늘)만
function daysOf(mode: Mode, from: Date, to: Date, log: Worklog) {
  const today = dayKey(new Date())
  const days: { date: Date; key: string; events: LogEvent[]; note: string }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = dayKey(d)
    const events = log.events.filter((e) => dayKey(new Date(e.at)) === key)
    const note = log.notes.find((n) => n.day === key)?.body ?? ""
    if (mode === "month" && events.length === 0 && !note && key !== today) continue
    days.push({ date: d, key, events, note })
  }
  return days
}

// 보고용 글(복사)
function reportText(title: string, days: ReturnType<typeof daysOf>) {
  const lines = [`[업무일지] ${title}`]
  for (const d of days) {
    if (d.events.length === 0 && !d.note) continue
    lines.push("", `■ ${dayTitle(d.date)}`)
    for (const e of d.events) lines.push(`- ${time(e.at)} ${e.code} ${e.title} · ${eventText(e)}`)
    if (d.note) lines.push(...d.note.split("\n").map((l) => `  ${l}`))
  }
  return lines.join("\n")
}

// 그날 메모: 쓰고 저장(칸을 벗어나면 저장). 서버 값이 바뀌면 key 로 새로 그린다
function NoteEditor({ day, value }: { day: string; value: string }) {
  const [text, setText] = useState(value)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const dirty = text.trim() !== value.trim()

  const save = async () => {
    if (!dirty) return
    setState("saving")
    setError(null)
    try {
      await api(`/worklog/notes/${day}`, { method: "PUT", body: { body: text } })
      setState("saved")
      invalidate()
    } catch (e) {
      setState("error")
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setState("idle")
        }}
        onBlur={save}
        placeholder="오늘 한 일, 회의, 다음 할 일 등을 직접 적어 주세요."
        className="min-h-20"
        aria-label={`${day} 업무 메모`}
      />
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {state === "saving" && <span>저장 중…</span>}
        {state === "saved" && !dirty && <span>저장했습니다</span>}
        {error && <span className="text-destructive">{error}</span>}
        <Button size="sm" variant="outline" disabled={!dirty || state === "saving"} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  )
}

export function WorklogPage() {
  const [mode, setMode] = useState<Mode>("day")
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [copied, setCopied] = useState(false)
  const [todayKey] = useState(() => dayKey(new Date()))
  const { from, to } = rangeOf(mode, anchor)
  const { data, error } = useApi<Worklog>(`/worklog?from=${dayKey(from)}&to=${dayKey(to)}`, 60_000)

  const title = rangeLabel(mode, from, to)
  const days = data ? daysOf(mode, from, to, data) : []
  const requestCount = data ? new Set(data.events.map((e) => e.requestId)).size : 0
  // 기간 요약: 동작별 건수(많은 순)
  const byType = data
    ? Object.entries(
        data.events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {}),
      ).sort((a, b) => b[1] - a[1])
    : []

  const copy = async () => {
    await navigator.clipboard.writeText(reportText(title, days))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="업무일지"
        aside={<span className="text-sm text-muted-foreground">{title}</span>}
        className="col-span-12 xl:col-span-10"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(v as Mode)
                setAnchor(startOfDay(new Date()))
              }}
            >
              <TabsList>
                <TabsTrigger value="day">일간</TabsTrigger>
                <TabsTrigger value="week">주간</TabsTrigger>
                <TabsTrigger value="month">월간</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="이전" onClick={() => setAnchor(move(mode, anchor, -1))}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
                오늘
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="다음" onClick={() => setAnchor(move(mode, anchor, 1))}>
                <ChevronRight />
              </Button>
            </div>
            <Button size="sm" disabled={!data} onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "복사됨" : "보고용 복사"}
            </Button>
          </div>
        }
      >
        {!data ? (
          <PageState error={error} />
        ) : (
          <div className="flex flex-col gap-4">
            {/* 기간 요약 */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
              <span className="font-medium">
                요청 {requestCount}건 · 기록 {data.events.length}건
              </span>
              {byType.map(([type, n]) => (
                <Badge key={type} variant="secondary" className="tabular-nums">
                  {EVENT_LABEL[type] ?? type} {n}
                </Badge>
              ))}
              {data.events.length === 0 && <span className="text-muted-foreground">이 기간에 자동으로 기록된 작업이 없습니다.</span>}
            </div>

            {days.map((d) => (
              <article key={d.key} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <header className="flex items-center gap-2">
                  <h3 className="font-semibold">{dayTitle(d.date)}</h3>
                  {d.key === todayKey && <Badge>오늘</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">기록 {d.events.length}건</span>
                </header>
                {/* 자동 기록: 이 시스템에서 내가 한 일 */}
                {d.events.length > 0 ? (
                  <ul className="flex flex-col divide-y rounded-lg border">
                    {d.events.map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50"
                          onClick={() => openRequest(e.requestId)}
                        >
                          <span className="shrink-0 text-muted-foreground tabular-nums">{time(e.at)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{e.title}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">{e.code}</span>
                            <span className="block text-muted-foreground">{eventText(e)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">자동 기록 없음</p>
                )}
                {/* 직접 쓰는 메모 */}
                <NoteEditor key={`${d.key}:${d.note}`} day={d.key} value={d.note} />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
