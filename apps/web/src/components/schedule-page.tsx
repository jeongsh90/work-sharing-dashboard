import { createContext, useContext, useMemo, useState } from "react"
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Settings2, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
  owners?: PlanOwner[]
}
// 담당자 목록(추가·삭제·색 지정). key 가 줄의 marks 값이다(엑셀 색 도형 또는 새로 만든 id)
type PlanOwner = { key: string; name: string; color: string }
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
// 담당자 색으로 고를 수 있는 색
const OWNER_PALETTE = ["#f5a33c", "#d9c9ef", "#3d7fd6", "#e0405a", "#3a3a3a", "#8b5cd6", "#3fb26b", "#f97316", "#8b5a2b", "#ec4899", "#06b6d4", "#eab308", "#14b8a6", "#64748b", "#84cc16", "#ef4444"]
const monthKey = (d: Date) => dateKey(d).slice(0, 7)

// 담당자 목록이 아직 저장되지 않았으면 엑셀 안내(달마다, 나중 달 이름 우선)로 만든다
function defaultOwners(plans: SchedulePlans): PlanOwner[] {
  const names = new Map<string, string>()
  for (const k of Object.keys(plans.months).sort().reverse()) for (const g of plans.months[k].legend) if (!names.has(g.mark)) names.set(g.mark, g.name)
  return [...names].map(([key, name]) => ({ key, name, color: MARK_COLOR[key] ?? "#999999" }))
}

const OwnerColor = createContext<(key: string) => string>((key) => MARK_COLOR[key] ?? "#999")

function PlanMark({ mark, color }: { mark?: string; color?: string }) {
  const colorOf = useContext(OwnerColor)
  const c = color ?? colorOf(mark ?? "")
  // 짙은 회색(팀)은 어두운 화면에서 묻히지 않게 밝게
  if (c === "#3a3a3a") return <span className="mt-[3px] size-2.5 shrink-0 rounded-[2px] bg-neutral-700 dark:bg-neutral-400" aria-hidden />
  return <span className="mt-[3px] size-2.5 shrink-0 rounded-[2px] ring-1 ring-black/10 dark:ring-white/25" style={{ backgroundColor: c }} aria-hidden />
}

// 색 고르기(팔레트)
function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label="담당자 색">
          <span className="size-4 rounded-sm ring-1 ring-black/10 dark:ring-white/25" style={{ backgroundColor: value }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-8 gap-1.5">
          {OWNER_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => onChange(c)}
              className="flex size-6 items-center justify-center rounded ring-1 ring-black/10 transition-transform hover:scale-110 dark:ring-white/25"
              style={{ backgroundColor: c }}
            >
              {value === c && <Check className="size-3.5 text-white mix-blend-difference" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// 담당자 관리: 이름·색 고치기, 추가, 삭제 → 통째로 저장
function OwnerManager({ owners, onBack }: { owners: PlanOwner[]; onBack: () => void }) {
  const [list, setList] = useState(owners)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (i: number, patch: Partial<PlanOwner>) => setList(list.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  const add = () => {
    const used = new Set(list.map((o) => o.color))
    setList([...list, { key: `p${Date.now().toString(36)}`, name: "", color: OWNER_PALETTE.find((c) => !used.has(c)) ?? OWNER_PALETTE[0] }])
  }
  const remove = async (i: number) => {
    if (!(await confirmDialog({ title: `담당자 '${list[i].name || "이름 없음"}'을 지울까요?`, description: "이미 등록된 일정 줄은 그대로 남고, 목록에서만 빠집니다.", confirmText: "삭제", destructive: true }))) return
    setList(list.filter((_, j) => j !== i))
  }
  const save = async () => {
    setPending(true)
    setError(null)
    try {
      await api("/schedule-plans/owners", { method: "PUT", body: { owners: list.map((o) => ({ ...o, name: o.name.trim() })) } })
      invalidate()
      onBack()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
      setPending(false)
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>담당자 관리</DialogTitle>
        <DialogDescription>색을 눌러 바꾸고, 이름을 고치거나 담당자를 추가·삭제합니다.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        {list.map((o, i) => (
          <div key={o.key} className="flex items-center gap-2">
            <ColorPick value={o.color} onChange={(c) => set(i, { color: c })} />
            <Input value={o.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="이름" maxLength={30} aria-label="담당자 이름" className="h-8" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${o.name} 삭제`} className="text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-center" onClick={add}>
          <Plus data-icon="inline-start" />
          담당자 추가
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeft data-icon="inline-start" />
          돌아가기
        </Button>
        <Button onClick={save} disabled={pending || list.some((o) => !o.name.trim())}>
          {pending ? "저장 중…" : "담당자 저장"}
        </Button>
      </DialogFooter>
    </>
  )
}

const WEEKLY_COLOR = "#ff00ff"
const isWeekly = (l: PlanLine) => !l.marks.length && l.text.startsWith("주간보고")

function PlanText({ line, owners, onEdit }: { line: PlanLine; owners: string; onEdit?: () => void }) {
  const Tag = onEdit ? "button" : "div"
  return (
    <Tag
      {...(onEdit ? { type: "button" as const, onClick: onEdit } : {})}
      className={`flex min-w-0 items-start gap-1 text-left text-xs leading-[1.4] break-keep ${onEdit ? "-mx-1 rounded px-1 hover:bg-muted" : ""}`}
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
function PlanDialog({ editing, owners, nameOf, onClose }: { editing: Editing; owners: PlanOwner[]; nameOf: (date: string, key: string) => string; onClose: () => void }) {
  const [date, setDate] = useState(editing.date)
  const [marks, setMarks] = useState<string[]>(editing.line?.marks ?? [])
  const [managing, setManaging] = useState(false)
  const [text, setText] = useState(editing.line?.text ?? "")
  const [done, setDone] = useState(editing.line?.done ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = owners.filter((o) => !marks.includes(o.key))
  const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))

  const run = async (method: "POST" | "PATCH" | "DELETE") => {
    if (method === "DELETE" && !(await confirmDialog({ title: "이 일정을 지울까요?", description: editing.line?.text, confirmText: "삭제", destructive: true }))) return
    setPending(true)
    setError(null)
    try {
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
        {managing ? (
          <OwnerManager owners={owners} onBack={() => setManaging(false)} />
        ) : (
        <>
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
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="plan-owner">담당자</FieldLabel>
                <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setManaging(true)}>
                  <Settings2 data-icon="inline-start" />
                  담당자 관리
                </Button>
              </div>
              {/* 이 일정의 담당자: X 로 이 날짜에서 빼기 */}
              {marks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {marks.map((m) => (
                    <span key={m} className="flex items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm">
                      <PlanMark mark={m} />
                      {nameOf(date, m) || "담당자"}
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`${nameOf(date, m)} 빼기`} onClick={() => setMarks(marks.filter((x) => x !== m))}>
                        <X />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              <Select value="" onValueChange={(v) => v && setMarks([...marks, v])}>
                <SelectTrigger id="plan-owner" className="w-full">
                  <SelectValue placeholder={marks.length ? "담당자 더 추가" : "담당자 없음 (주간보고·회의 등) · 눌러서 추가"} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      <PlanMark color={o.color} />
                      {o.name}
                    </SelectItem>
                  ))}
                  {!options.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">더 고를 담당자가 없습니다.</div>}
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
        </>
        )}
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
    const lines = (plans.days[key] ?? []).map((line, index) => ({ line, index }))
    // 화요일은 주간보고 날: 엑셀·등록에 없어도 보인다(index -1 은 고칠 수 없는 자동 줄)
    if (new Date(key).getDay() === 2 && !lines.some(({ line }) => isWeekly(line))) lines.unshift({ line: { marks: [], text: "주간보고", done: false, color: WEEKLY_COLOR }, index: -1 })
    return lines
      .filter(({ line: l }) => includeDone || !l.done)
      .filter(({ line: l }) => {
        if (who === "all" || !l.marks.length) return true
        if (!whoName) return false
        return l.marks.some((m) => nameOf(key, m).split(/\s*\/\s*/).some((n) => n.length >= 2 && whoName.includes(n)))
      })
  }
  // 담당자 이름: 그 달 엑셀 안내 → 담당자 목록. 색: 담당자 목록 → 엑셀 기본색
  const ownerList = plans ? (plans.owners ?? defaultOwners(plans)) : []
  const nameOf = (date: string, key: string) =>
    plans?.months[date.slice(0, 7)]?.legend.find((g) => g.mark === key)?.name ?? ownerList.find((o) => o.key === key)?.name ?? ""
  const colorOf = (key: string) => ownerList.find((o) => o.key === key)?.color ?? MARK_COLOR[key] ?? "#999"
  const ownersOf = (key: string, line: PlanLine) => line.marks.map((m) => nameOf(key, m)).filter(Boolean).join(", ")
  const edit = (date: string, index: number, line: PlanLine) => (canEditPlans && index >= 0 ? () => setEditing({ date, index, line }) : undefined)

  if (!requests) return <PageState error={error} />

  const weeks = monthWeeks(month)
  const monthStart = month
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const thisMonthCount = showPlans
    ? weeks.flat().filter((d) => d.getMonth() === month.getMonth()).reduce((n, d) => n + planLines(dateKey(d)).filter(({ line }) => !isWeekly(line)).length, 0)
    : items.filter((i) => i.start <= monthEnd && i.end >= monthStart).length
  const planMonth = showPlans ? plans?.months[monthKey(month)] : undefined
  const monthLegend = (() => {
    if (!showPlans || !plans) return []
    const keys = [...(planMonth?.legend.map((g) => g.mark) ?? [])]
    for (const [d, ls] of Object.entries(plans.days)) if (d.startsWith(monthKey(month))) for (const l of ls) for (const m of l.marks) if (!keys.includes(m)) keys.push(m)
    return keys.map((k) => ({ key: k, name: nameOf(`${monthKey(month)}-01`, k) })).filter((g) => g.name)
  })()
  const legend: RequestStatus[] = ["requested", "waiting", "in-progress", "review", "revising", "approved", ...(includeDone ? (["source-pending", "done"] as RequestStatus[]) : [])]

  return (
    <OwnerColor.Provider value={colorOf}>
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
          {monthLegend.length > 0 && (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <li className="font-medium text-foreground">예정일정 담당</li>
              {monthLegend.map((g) => (
                <li key={g.key} className="flex items-start gap-1">
                  <PlanMark mark={g.key} />
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
                          <span className={`min-w-0 truncate pt-1 text-xs text-destructive ${other ? "opacity-60" : ""}`} title={holiday}>
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
                            <button key={`w${index}`} type="button" onClick={onEdit} className="relative z-10 shrink-0 rounded px-0.5 pt-1 text-xs font-semibold hover:bg-muted">
                              {label}
                            </button>
                          ) : (
                            <span key={`w${index}`} className="shrink-0 pt-1 text-xs font-semibold">
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
        {editing && <PlanDialog key={`${editing.date}-${editing.index}`} editing={editing} owners={ownerList} nameOf={nameOf} onClose={() => setEditing(null)} />}
      </div>
    </div>
    </OwnerColor.Provider>
  )
}
