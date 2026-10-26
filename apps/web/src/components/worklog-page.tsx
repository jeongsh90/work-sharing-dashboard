import { useState } from "react"
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DateRangePicker } from "@/components/date-range-picker"
import { TimePicker } from "@/components/time-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { UserAvatar } from "@/components/user-avatar"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { EVENT_LABEL, STATUS_LABEL, WORK_TYPES, type RequestStatus } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"
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
// 직접 쓰는 항목: 작성일·작성시간·카테고리·내용
type Entry = { id: number; day: string; time: string; category: string; body: string; updatedAt: number }
type Worklog = { events: LogEvent[]; entries: Entry[] }

// 카테고리: 업무 종류 + 요청서의 작업 종류(WORK_TYPES). 기타는 맨 끝
const WORK_CATEGORIES = ["디자인 작업", "수정 대응", "회의", "자료 조사", "교육", "메모"]
const TYPE_CATEGORIES = WORK_TYPES.filter((t) => t !== "기타" && !WORK_CATEGORIES.includes(t))
const CATEGORIES = [...WORK_CATEGORIES, ...TYPE_CATEGORIES, "기타"]
type TeamMember = Worklog & { user: { id: string; name: string; rank: string; avatarId: string | null } }

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

// 날짜별로 묶는다. 일·주는 모든 날, 월은 기록이나 직접 쓴 항목이 있는 날(과 오늘)만
function daysOf(mode: Mode, from: Date, to: Date, log: Worklog) {
  const today = dayKey(new Date())
  const days: { date: Date; key: string; events: LogEvent[]; entries: Entry[] }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = dayKey(d)
    const events = log.events.filter((e) => dayKey(new Date(e.at)) === key)
    const entries = log.entries.filter((n) => n.day === key)
    if (mode === "month" && events.length === 0 && entries.length === 0 && key !== today) continue
    days.push({ date: d, key, events, entries })
  }
  return days
}

const hasContent = (d: { events: LogEvent[]; entries: Entry[] }) => d.events.length > 0 || d.entries.length > 0
const entryLine = (n: Entry) => `${n.time ? `${n.time} ` : "종일 "}${n.category ? `[${n.category}] ` : ""}${n.body}`

// 보고용 글(복사). 팀 보기에서는 사람마다 이어 붙인다.
function reportText(title: string, days: ReturnType<typeof daysOf>, who?: string) {
  const lines = [who ? `[업무일지] ${who} · ${title}` : `[업무일지] ${title}`]
  for (const d of days) {
    if (!hasContent(d)) continue
    lines.push("", `■ ${dayTitle(d.date)}`)
    for (const e of d.events) lines.push(`- ${time(e.at)} ${e.code} ${e.title} · ${eventText(e)}`)
    for (const n of d.entries) lines.push(`- ${entryLine(n)}`.replace(/\n/g, "\n  "))
  }
  return lines.join("\n")
}

const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 직접 쓰는 항목 입력: 작성일(기본 오늘)·작성시간(기본 지금)·카테고리·내용. entry 가 있으면 수정
function EntryEditor({ entry, defaultDay, onDone }: { entry?: Entry; defaultDay: string; onDone?: () => void }) {
  const [day, setDay] = useState(entry?.day ?? defaultDay)
  const [at, setAt] = useState(entry?.time || nowTime())
  // 종일: 시각 없이 그날 전체(저장할 때 시각을 비운다)
  const [allDay, setAllDay] = useState(!!entry && !entry.time)
  const [category, setCategory] = useState(entry?.category || CATEGORIES[0])
  const [body, setBody] = useState(entry?.body ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!body.trim()) {
      setError("내용을 입력해 주세요.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const payload = { day, time: allDay ? "" : at, category, body }
      if (entry) await api(`/worklog/entries/${entry.id}`, { method: "PATCH", body: payload })
      else await api("/worklog/entries", { body: payload })
      invalidate()
      if (!entry) {
        setBody("")
        setAt(nowTime())
      }
      onDone?.()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 sm:col-span-4">
          <DateRangePicker
            single
            value={{ from: fromKey(day), to: undefined }}
            onChange={(r) => r?.from && setDay(dayKey(r.from))}
            placeholder="작성일"
          />
        </div>
        <div className="col-span-12 flex items-center gap-3 sm:col-span-4">
          <TimePicker value={at} onChange={setAt} disabled={allDay} className="min-w-0 flex-1" />
          <Label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm font-normal">
            <Checkbox checked={allDay} onCheckedChange={(v) => setAllDay(v === true)} />
            종일
          </Label>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full" aria-label="카테고리">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectGroup>
                <SelectLabel>업무</SelectLabel>
                {WORK_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>작업 종류</SelectLabel>
                {TYPE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectItem value="기타">기타</SelectItem>
              {/* 예전에 쓴 카테고리가 목록에 없으면 그대로 보이게 */}
              {!CATEGORIES.includes(category) && <SelectItem value={category}>{category}</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="한 일, 회의, 다음 할 일 등을 적어 주세요."
        className="min-h-20"
        aria-label="업무 내용"
      />
      <div className="flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
        {onDone && entry && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            취소
          </Button>
        )}
        <Button size="sm" disabled={pending} onClick={save}>
          {entry ? null : <Plus data-icon="inline-start" />}
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  )
}

// 직접 쓴 항목 목록. editable 이면 줄마다 수정·삭제
function EntryList({ entries, editable }: { entries: Entry[]; editable: boolean }) {
  const [editing, setEditing] = useState<number | null>(null)
  const remove = async (n: Entry) => {
    if (!(await confirmDialog({ title: "이 항목을 지울까요?", description: n.body.slice(0, 80), confirmText: "삭제", destructive: true }))) return
    await api(`/worklog/entries/${n.id}`, { method: "DELETE" })
    invalidate()
  }
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {entries.map((n) =>
        editing === n.id ? (
          <li key={n.id} className="p-3">
            <EntryEditor entry={n} defaultDay={n.day} onDone={() => setEditing(null)} />
          </li>
        ) : (
          <li key={n.id} className="group flex items-start gap-3 px-3 py-2 text-sm">
            <span className="w-11 shrink-0 text-muted-foreground tabular-nums">{n.time || "종일"}</span>
            <span className="min-w-0 flex-1">
              {n.category && (
                <Badge variant="secondary" className="mr-1.5 align-middle">
                  {n.category}
                </Badge>
              )}
              <span className="whitespace-pre-wrap">{n.body}</span>
            </span>
            {editable && (
              <span className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100">
                <Button variant="ghost" size="icon-xs" aria-label="수정" onClick={() => setEditing(n.id)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" aria-label="삭제" onClick={() => remove(n)}>
                  <Trash2 />
                </Button>
              </span>
            )}
          </li>
        ),
      )}
    </ul>
  )
}

// 동작별 색: 그 동작으로 바뀌는 상태의 색(상태 배지와 같은 계열)
const EVENT_STATUS: Record<string, RequestStatus> = {
  assign: "waiting",
  take: "waiting",
  reassign: "waiting",
  "request-info": "needs-info",
  resubmit: "requested",
  start: "in-progress",
  submit: "review",
  reject: "revising",
  approve: "source-pending",
  "upload-source": "done",
  complete: "done",
  cancel: "canceled",
  undo: "requested",
}
const eventColor = (type: string) => {
  const st = EVENT_STATUS[type]
  return st ? `${STATUS_BG[st]} ${STATUS_TEXT[st]}` : ""
}

// 기간 요약(요청 수·기록 수·동작별 건수)
function Summary({ log }: { log: Worklog }) {
  const requestCount = new Set(log.events.map((e) => e.requestId)).size
  const byType = Object.entries(
    log.events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">
        요청 {requestCount}건 · 기록 {log.events.length}건
      </span>
      {byType.map(([type, n]) => (
        <Badge key={type} variant="secondary" className={`tabular-nums ${eventColor(type)}`}>
          {EVENT_LABEL[type] ?? type} {n}
        </Badge>
      ))}
      {log.events.length === 0 && <span className="text-muted-foreground">이 기간에 자동으로 기록된 작업이 없습니다.</span>}
    </div>
  )
}

// 그날 자동 기록 목록(누르면 요청 상세)
function EventList({ events }: { events: LogEvent[] }) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {events.map((e, i) => (
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
  )
}

// 팀 업무일지(관리자): 디자인팀 작업자마다 기록이 있는 날만 보여 준다. 메모는 보기만 한다.
function TeamView({ members, from, to }: { members: TeamMember[]; from: Date; to: Date }) {
  if (members.length === 0) return <p className="text-sm text-muted-foreground">디자인팀 작업자가 없습니다.</p>
  return (
    <div className="flex flex-col gap-4">
      {members.map((m) => {
        const days = daysOf("month", from, to, m).filter(hasContent)
        return (
          <article key={m.user.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <header className="flex flex-wrap items-center gap-3">
              <UserAvatar name={m.user.name} avatarId={m.user.avatarId} className="size-9" />
              <div className="min-w-0">
                <h3 className="font-semibold">
                  {m.user.name}
                  {m.user.rank && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{m.user.rank}</span>}
                </h3>
              </div>
              <div className="ml-auto">
                <Summary log={m} />
              </div>
            </header>
            {days.length === 0 ? (
              <p className="text-sm text-muted-foreground">이 기간에 기록·메모가 없습니다.</p>
            ) : (
              days.map((d) => (
                <section key={d.key} className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium">{dayTitle(d.date)}</h4>
                  {d.events.length > 0 && <EventList events={d.events} />}
                  {d.entries.length > 0 && <EntryList entries={d.entries} editable={false} />}
                </section>
              ))
            )}
          </article>
        )
      })}
    </div>
  )
}

export function WorklogPage({ session }: { session: Session }) {
  // 관리자는 팀 업무일지(디자인팀 전원)도 본다
  const canTeam = isManager(session)
  const [view, setView] = useState<"mine" | "team">("mine")
  const [mode, setMode] = useState<Mode>("day")
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [copied, setCopied] = useState(false)
  const [todayKey] = useState(() => dayKey(new Date()))
  const { from, to } = rangeOf(mode, anchor)
  const range = `from=${dayKey(from)}&to=${dayKey(to)}`
  const team = view === "team" && canTeam
  const { data, error } = useApi<Worklog>(team ? null : `/worklog?${range}`, 60_000)
  const { data: teamData, error: teamError } = useApi<TeamMember[]>(team ? `/worklog/team?${range}` : null, 60_000)

  const title = rangeLabel(mode, from, to)
  const days = data ? daysOf(mode, from, to, data) : []

  const copy = async () => {
    const text = team
      ? (teamData ?? [])
          .map((m) => reportText(title, daysOf("month", from, to, m).filter(hasContent), m.user.name))
          .join("\n\n")
      : reportText(title, days)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="업무일지"
        aside={<span className="text-sm text-muted-foreground">{title}</span>}
        className="col-span-12 xl:col-span-10 xl:col-start-2"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canTeam && (
              <Tabs value={view} onValueChange={(v) => setView(v as "mine" | "team")}>
                <TabsList>
                  <TabsTrigger value="mine">내 업무일지</TabsTrigger>
                  <TabsTrigger value="team">팀 업무일지</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
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
            <Button size="sm" disabled={team ? !teamData : !data} onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "복사됨" : "보고용 복사"}
            </Button>
          </div>
        }
      >
        {team ? (
          teamData ? <TeamView members={teamData} from={from} to={to} /> : <PageState error={teamError} />
        ) : !data ? (
          <PageState error={error} />
        ) : (
          <div className="flex flex-col gap-4">
            {/* 기간 요약 */}
            <div className="rounded-xl border bg-card px-4 py-3">
              <Summary log={data} />
            </div>

            {/* 새 항목 쓰기(작성일 기본 = 오늘, 일간 보기면 그날) */}
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <h3 className="font-semibold">업무 쓰기</h3>
              <EntryEditor key={mode === "day" ? dayKey(anchor) : todayKey} defaultDay={mode === "day" ? dayKey(anchor) : todayKey} />
            </div>

            {days.map((d) => (
              <article key={d.key} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                <header className="flex items-center gap-2">
                  <h3 className="font-semibold">{dayTitle(d.date)}</h3>
                  {d.key === todayKey && <Badge>오늘</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    자동 기록 {d.events.length}건 · 직접 쓴 항목 {d.entries.length}건
                  </span>
                </header>
                {/* 자동 기록: 이 시스템에서 내가 한 일 */}
                {d.events.length > 0 ? (
                  <EventList events={d.events} />
                ) : (
                  <p className="text-sm text-muted-foreground">자동 기록 없음</p>
                )}
                {/* 직접 쓴 항목(수정·삭제) */}
                {d.entries.length > 0 && <EntryList entries={d.entries} editable />}
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
