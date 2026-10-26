import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from "@/components/date-range-picker"
import { confirmDialog } from "@/components/confirm-dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageState } from "@/components/page-state"
import { PAGE_GRID } from "@/lib/layout"
import { isActive, STATUS_LABEL, statusText, type DesignRequest, type RequestStatus } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { STATUS_BEAM } from "@/lib/status-colors"
import { invalidate, useApi, useDesigners, useRequests, useUserNames } from "@/lib/store"
import { dateKey, useHolidays } from "@/lib/holidays"
import { api, ApiError } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"

// 디자인팀 일정(달력). 프로젝트마다 작업 기간(시작일 ~ 마감일)을 한 달 달력 위에 가로 막대로 그린다.
// 여러 날·여러 주에 걸친 일정은 주마다 이어지는 막대로 보인다. 막대를 누르면 요청 상세로 간다.

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]
const LANE_HEIGHT = 22 // 막대 한 줄 높이(px)
const LANE_GAP = 4

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()

// 예정일정: 팀 엑셀(디자인팀_일정.xlsx '2026_일정' 시트)을 서버가 읽어 둔 것(apps/api/src/schedule-plans.ts).
// 줄 앞 색 도형이 담당자(달마다 비고 칸의 안내로 이름을 붙인다), 취소선은 끝난 일.
type PlanLine = { marks: string[]; text: string; done: boolean; color?: string }
type SchedulePlans = {
  importedAt: number
  fileName: string
  months: Record<string, { legend: { mark: string; name: string }[]; notes: PlanLine[] }>
  days: Record<string, PlanLine[]>
}
// 엑셀 화면에서 보이는 색에 맞춘다
const MARK_COLOR: Record<string, string> = {
  "🟨": "#f5a33c",
  "⬜": "#d9c9ef",
  "🟦": "#3d7fd6",
  "🟥": "#e0405a",
  "⬛": "#3a3a3a",
  "🟪": "#8b5cd6",
  "🟩": "#3fb26b",
  "🟧": "#f97316",
  "🟫": "#8b5a2b",
}
const monthKey = (d: Date) => dateKey(d).slice(0, 7)

function PlanMark({ mark }: { mark: string }) {
  // ⬛(팀)은 어두운 화면에서 묻히지 않게 밝게
  if (mark === "⬛") return <span className="mt-[3px] size-2.5 shrink-0 rounded-[2px] bg-neutral-700 dark:bg-neutral-400" aria-hidden />
  return <span className="mt-[3px] size-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10 dark:ring-white/25" style={{ backgroundColor: MARK_COLOR[mark] ?? "#999" }} aria-hidden />
}

const WEEKLY_COLOR = "#ff00ff"
const isWeekly = (l: PlanLine) => !l.marks.length && l.text.startsWith("주간보고")

function PlanText({ line, owners, onEdit }: { line: PlanLine; owners: string; onEdit?: () => void }) {
  const Tag = onEdit ? "button" : "div"
  return (
    <Tag
      {...(onEdit ? { type: "button" as const, onClick: onEdit } : {})}
      className={`flex min-w-0 items-start gap-1 text-left text-[11px] leading-[1.35] break-keep ${onEdit ? "-mx-1 rounded px-1 hover:bg-muted" : ""}`}
      title={owners ? `${line.text} · ${owners}${line.done ? " (완료)" : ""}` : line.text}
    >
      {line.marks.map((m, i) => (
        <PlanMark key={i} mark={m} />
      ))}
      <span
        className={`min-w-0 ${line.done ? "text-muted-foreground line-through" : ""} ${line.color && !line.marks.length ? "font-semibold" : ""}`}
        style={line.color && !line.done ? { color: line.color } : undefined}
      >
        {line.text}
      </span>
    </Tag>
  )
}

type Editing = { date: string; index: number; line: PlanLine } | { date: string; index: null; line: null }

// 예정일정 한 줄 등록·고치기: 날짜 · 담당자(색 도형) · 내용 · 완료
function PlanDialog({ editing, owners, onClose }: { editing: Editing; owners: (date: string) => { mark: string; name: string }[]; onClose: () => void }) {
  const [date, setDate] = useState(editing.date)
  const [mark, setMark] = useState(editing.line?.marks.join("") || "none")
  const [text, setText] = useState(editing.line?.text ?? "")
  const [done, setDone] = useState(editing.line?.done ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = owners(date)
  const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))

  const run = async (method: "POST" | "PATCH" | "DELETE") => {
    if (method === "DELETE" && !(await confirmDialog({ title: "이 일정을 지울까요?", description: editing.line?.text, confirmText: "삭제", destructive: true }))) return
    setPending(true)
    setError(null)
    try {
      const marks = mark === "none" ? [] : [...mark.matchAll(/./gu)].map((m) => m[0])
      // 주간보고는 엑셀처럼 분홍 글자
      const payload = { date, marks, text, done, ...(editing.line?.color ? { color: editing.line.color } : !marks.length && text.trim().startsWith("주간보고") ? { color: WEEKLY_COLOR } : {}) }
      const path = editing.index === null ? "/schedule-plans/lines" : `/schedule-plans/lines/${editing.date}/${editing.index}`
      await api(path, { method, body: method === "DELETE" ? undefined : payload })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing.line ? "예정일정 수정" : "예정일정 등록"}</DialogTitle>
          <DialogDescription>그날 칸에 한 줄로 보입니다. 앞 색 도형이 담당자입니다.</DialogDescription>
        </DialogHeader>
        <form
          id="plan-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(editing.line ? "PATCH" : "POST")
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>날짜</FieldLabel>
              <DateRangePicker single value={{ from: fromKey(date), to: undefined }} onChange={(r) => r?.from && setDate(dateKey(r.from))} placeholder="날짜" />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-owner">담당자</FieldLabel>
              <Select value={mark} onValueChange={setMark}>
                <SelectTrigger id="plan-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">담당자 없음 (주간보고·회의 등)</SelectItem>
                  {options.map((o) => (
                    <SelectItem key={o.mark} value={o.mark}>
                      <PlanMark mark={o.mark} />
                      {o.name}
                    </SelectItem>
                  ))}
                  {/* 여러 담당자 줄(엑셀)은 그대로 고를 수 있게 */}
                  {mark !== "none" && !options.some((o) => o.mark === mark) && (
                    <SelectItem value={mark}>
                      {[...mark.matchAll(/./gu)].map((m, i) => (
                        <PlanMark key={i} mark={m[0]} />
                      ))}
                      {[...mark.matchAll(/./gu)].map((m) => options.find((o) => o.mark === m[0])?.name ?? "").filter(Boolean).join(", ") || "지금 담당자"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-text">내용</FieldLabel>
              <Input id="plan-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 김장페스타 이벤트/배너" maxLength={200} autoFocus />
            </Field>
            <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
              <Checkbox checked={done} onCheckedChange={(v) => setDone(v === true)} />
              끝난 일(취소선)
            </Label>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter className="sm:justify-between">
          {editing.line ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => run("DELETE")}>
              <Trash2 data-icon="inline-start" />
              삭제
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" form="plan-form" disabled={pending || !text.trim()}>
              {pending ? "저장 중…" : editing.line ? "저장" : "등록"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 작업 기간: 요청자가 고른 시작일 → 없으면 실제 시작 → 없으면 등록일. 끝은 마감일
function period(r: DesignRequest) {
  const start = startOfDay(r.requestedStartAt ?? r.startedAt ?? r.createdAt)
  const end = startOfDay(r.dueAt)
  return start <= end ? { start, end } : { start: end, end }
}

// 월요일부터 시작하는 주 단위로 그 달을 덮는 날짜들
function monthWeeks(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  let cursor = addDays(first, -((first.getDay() + 6) % 7))
  const weeks: Date[][] = []
  while (cursor <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)))
    cursor = addDays(cursor, 7)
  }
  return weeks
}

type Bar = { request: DesignRequest; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean }

// 한 주에 걸치는 일정을 겹치지 않게 줄(lane)에 배치한다.
function layoutWeek(week: Date[], items: { request: DesignRequest; start: Date; end: Date }[]) {
  const ws = week[0]
  const we = week[6]
  const inWeek = items
    .filter((i) => i.start <= we && i.end >= ws)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  const laneEnds: Date[] = []
  const bars: Bar[] = []
  for (const i of inWeek) {
    const s = i.start < ws ? ws : i.start
    const e = i.end > we ? we : i.end
    let lane = laneEnds.findIndex((end) => end < s)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = e
    bars.push({
      request: i.request,
      col: Math.round((s.getTime() - ws.getTime()) / DAY),
      span: Math.round((e.getTime() - s.getTime()) / DAY) + 1,
      lane,
      startsHere: sameDay(s, i.start),
      endsHere: sameDay(e, i.end),
    })
  }
  return { bars, lanes: laneEnds.length }
}

export function SchedulePage({ session }: { session: Session }) {
  const { requests, error } = useRequests()
  const designers = useDesigners()
  const userName = useUserNames()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [includeDone, setIncludeDone] = useState(true) // 완료 포함: 기본으로 켠다
  const [who, setWho] = useState("all")
  // 탭: 프로젝트 일정(요청 작업 기간 막대) / 예정일정(팀 엑셀에서 옮긴 날짜별 할 일)
  const [tab, setTab] = useState<"projects" | "plans">("projects")
  const showPlans = tab === "plans"
  const plans = useApi<SchedulePlans | null>(showPlans ? "/schedule-plans" : null, 300_000).data
  const canEditPlans = session.role === "designer" || isManager(session)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [today] = useState(() => startOfDay(new Date()))
  // 공휴일: 보이는 달 앞뒤 주까지(연말·연초면 두 해)
  const holidays = useHolidays(new Date(month.getFullYear(), month.getMonth(), 0).getFullYear(), new Date(month.getFullYear(), month.getMonth() + 1, 1).getFullYear())

  const items = useMemo(
    () =>
      (requests ?? [])
        .filter((r) => r.status !== "canceled" && (includeDone || isActive(r)))
        .filter((r) => (who === "all" ? true : who === "unassigned" ? r.designers.length === 0 : r.designers.includes(who)))
        .map((r) => ({ request: r, ...period(r) })),
    [requests, includeDone, who],
  )

  // 그날 예정일정: 완료 포함·작업자 조건을 따른다(작업자를 고르면 그 사람 담당 + 담당자 없는 줄)
  const whoName = who === "all" || who === "unassigned" ? null : userName(who)
  const planLines = (key: string) => {
    if (!showPlans || !plans) return []
    const legend = plans.months[key.slice(0, 7)]?.legend ?? []
    return (plans.days[key] ?? [])
      .map((line, index) => ({ line, index }))
      .filter(({ line: l }) => includeDone || !l.done)
      .filter(({ line: l }) => {
        if (who === "all" || !l.marks.length) return true
        if (!whoName) return false
        return l.marks.some((m) => legend.some((g) => g.mark === m && g.name.split(/\s*\/\s*/).some((n) => n.length >= 2 && whoName.includes(n))))
      })
  }
  const ownersOf = (key: string, line: PlanLine) => {
    const legend = plans?.months[key.slice(0, 7)]?.legend ?? []
    return line.marks.map((m) => legend.find((g) => g.mark === m)?.name).filter(Boolean).join(", ")
  }

  // 담당자 고르기: 그 달 안내 → 없으면 다른 달 안내(가까운 달 이름)
  const ownerOptions = (key: string) => {
    const own = plans?.months[key.slice(0, 7)]?.legend ?? []
    if (own.length) return own
    const all = new Map<string, string>()
    for (const k of Object.keys(plans?.months ?? {}).sort()) for (const g of plans!.months[k].legend) all.set(g.mark, g.name)
    return [...all].map(([mark, name]) => ({ mark, name }))
  }
  const edit = (date: string, index: number, line: PlanLine) => (canEditPlans ? () => setEditing({ date, index, line }) : undefined)

  if (!requests) return <PageState error={error} />

  const weeks = monthWeeks(month)
  const monthStart = month
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const thisMonthCount = showPlans
    ? weeks.flat().filter((d) => d.getMonth() === month.getMonth()).reduce((n, d) => n + planLines(dateKey(d)).filter(({ line }) => !isWeekly(line)).length, 0)
    : items.filter((i) => i.start <= monthEnd && i.end >= monthStart).length
  const planMonth = showPlans ? plans?.months[monthKey(month)] : undefined
  const legend: RequestStatus[] = ["requested", "waiting", "in-progress", "review", "revising", "approved", ...(includeDone ? (["source-pending", "done"] as RequestStatus[]) : [])]

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-4">
        {/* 달 이동과 보기 조건 */}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "projects" | "plans")}>
            <TabsList>
              <TabsTrigger value="projects">프로젝트 일정</TabsTrigger>
              <TabsTrigger value="plans">예정일정</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronLeft />
            </Button>
            <h2 className="w-32 text-center text-lg font-semibold tabular-nums">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </h2>
            <Button variant="outline" size="icon-sm" aria-label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="sm" className="ml-1" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
              오늘
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">이 달 {thisMonthCount}건</span>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger size="sm" className="w-36" aria-label="작업자">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 작업자</SelectItem>
                {designers?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
                <SelectItem value="unassigned">미배정</SelectItem>
              </SelectContent>
            </Select>
            <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
              <Checkbox checked={includeDone} onCheckedChange={(v) => setIncludeDone(v === true)} />
              완료 포함
            </Label>
            {/* 예정일정 한 줄 등록(디자인팀·관리자) */}
            {showPlans && canEditPlans && (
              <Button
                size="sm"
                onClick={() => setEditing({ date: dateKey(month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear() ? today : month), index: null, line: null })}
              >
                <Plus data-icon="inline-start" />
                일정 등록
              </Button>
            )}
          </div>
        </div>

        {/* 상태 색 안내 · 예정일정 담당자 색 */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <ul className={`flex flex-wrap gap-x-4 gap-y-1 ${showPlans ? "hidden" : ""}`}>
            {legend.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: STATUS_BEAM[s] }} aria-hidden />
                {STATUS_LABEL[s]}
              </li>
            ))}
          </ul>
          {!!planMonth?.legend.length && (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <li className="font-medium text-foreground">예정일정 담당</li>
              {planMonth.legend.map((g) => (
                <li key={g.mark} className="flex items-start gap-1">
                  <PlanMark mark={g.mark} />
                  {g.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 달력 */}
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-2 ${i === 5 ? "text-sky-600 dark:text-sky-400" : i === 6 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                {w}
              </div>
            ))}
          </div>
          {weeks.map((week) => {
            const { bars, lanes } = showPlans ? { bars: [] as Bar[], lanes: 0 } : layoutWeek(week, items)
            const dayPlans = week.map((day) => (day.getMonth() === month.getMonth() ? planLines(dateKey(day)) : []))
            const weekPlans = dayPlans.map((ls) => ls.filter(({ line }) => !isWeekly(line)))
            const hasPlans = weekPlans.some((l) => l.length > 0)
            return (
              <div
                key={week[0].getTime()}
                className="relative border-b last:border-b-0"
                style={{ minHeight: 32 + Math.max(lanes, 2) * (LANE_HEIGHT + LANE_GAP) + 8 }}
              >
                {/* 날짜 칸 */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {week.map((day, di) => {
                    const other = day.getMonth() !== month.getMonth()
                    const weekly = dayPlans[di].filter(({ line }) => isWeekly(line))
                    const isToday = sameDay(day, today)
                    const holiday = holidays.get(dateKey(day))
                    return (
                      <div
                        key={day.getTime()}
                        className={`flex min-w-0 items-start gap-1 border-r p-1.5 last:border-r-0 ${other ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""}`}
                      >
                        <span
                          className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums ${
                            isToday
                              ? "bg-primary font-semibold text-primary-foreground"
                              : holiday
                                ? `font-semibold text-destructive ${other ? "opacity-60" : ""}`
                                : other
                                  ? "text-muted-foreground/60"
                                  : ""
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        {/* 공휴일 이름 */}
                        {holiday && (
                          <span className={`min-w-0 truncate pt-1 text-[11px] text-destructive ${other ? "opacity-60" : ""}`} title={holiday}>
                            {holiday}
                          </span>
                        )}
                        {/* 주간보고: 날짜·공휴일 오른쪽 */}
                        {weekly.map(({ line, index }) => {
                          const onEdit = edit(dateKey(day), index, line)
                          const label = (
                            <span className={line.done ? "text-muted-foreground line-through" : ""} style={line.done ? undefined : { color: line.color ?? WEEKLY_COLOR }}>
                              {line.text}
                            </span>
                          )
                          return onEdit ? (
                            <button key={index} type="button" onClick={onEdit} className="relative z-10 shrink-0 rounded px-0.5 pt-1 text-[11px] font-semibold hover:bg-muted">
                              {label}
                            </button>
                          ) : (
                            <span key={index} className="shrink-0 pt-1 text-[11px] font-semibold">
                              {label}
                            </span>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
                <div className="relative pt-8 pb-2">
                {/* 예정일정(팀 엑셀): 날짜 아래 줄마다 */}
                {hasPlans && (
                  <div className="grid grid-cols-7 pb-1.5">
                    {weekPlans.map((lines, i) => (
                      <div key={i} className="flex min-w-0 flex-col gap-0.5 px-1.5">
                        {lines.map(({ line, index }) => (
                          <PlanText key={index} line={line} owners={ownersOf(dateKey(week[i]), line)} onEdit={edit(dateKey(week[i]), index, line)} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {/* 일정 막대 */}
                {!showPlans && (
                <div
                  className="relative grid grid-cols-7 px-0.5"
                  style={{ gridAutoRows: `${LANE_HEIGHT}px`, rowGap: LANE_GAP }}
                >
                  {bars.map((b) => {
                    const r = b.request
                    const color = STATUS_BEAM[r.status]
                    const overdue = isActive(r) && startOfDay(r.dueAt) < today
                    const names = r.designers.map(userName).join(", ") || "미배정"
                    return (
                      <button
                        key={`${r.id}-${b.col}`}
                        type="button"
                        onClick={() => openRequest(r.id)}
                        title={`${r.title}\n${statusText(r)} · ${names}\n${period(r).start.toLocaleDateString("ko-KR")} ~ ${r.ongoing ? "계속 업무" : r.dueAt.toLocaleString("ko-KR")}`}
                        className={`mx-0.5 flex min-w-0 items-center gap-1 overflow-hidden px-1.5 text-left text-xs leading-none transition-opacity hover:opacity-80 ${
                          b.startsHere ? "rounded-l-md" : ""
                        } ${b.endsHere ? "rounded-r-md" : ""}`}
                        style={{
                          gridColumn: `${b.col + 1} / span ${b.span}`,
                          gridRow: b.lane + 1,
                          backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)`,
                          borderLeft: b.startsHere ? `3px solid ${color}` : undefined,
                        }}
                      >
                        <span className="min-w-0 truncate font-medium">{r.title}</span>
                        <span className="hidden shrink-0 text-muted-foreground sm:inline">· {names}</span>
                        {overdue && b.endsHere && <span className="shrink-0 font-medium text-destructive">마감 지남</span>}
                      </button>
                    )
                  })}
                </div>
                )}
                </div>
              </div>
            )
          })}
        </div>
        {/* 그 달 비고(팀 엑셀 오른쪽 칸) */}
        {!!planMonth?.notes.filter((l) => includeDone || !l.done).length && (
          <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">비고</h3>
            {planMonth.notes
              .filter((l) => includeDone || !l.done)
              .map((l, i) => (
                <PlanText key={i} line={l} owners={ownersOf(monthKey(month), l)} />
              ))}
          </div>
        )}
        {showPlans
          ? !!plans &&
            thisMonthCount === 0 && <p className="text-center text-sm text-muted-foreground">이 달 예정일정이 없습니다.{canEditPlans ? " 일정 등록으로 추가할 수 있습니다." : ""}</p>
          : items.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {includeDone ? "표시할 일정이 없습니다." : "진행 중인 프로젝트가 없습니다. 완료 포함을 켜면 끝난 작업도 볼 수 있습니다."}
              </p>
            )}
        {editing && <PlanDialog key={`${editing.date}-${editing.index}`} editing={editing} owners={ownerOptions} onClose={() => setEditing(null)} />}
      </div>
    </div>
  )
}
