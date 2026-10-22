import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageState } from "@/components/page-state"
import { PAGE_GRID } from "@/lib/layout"
import { isActive, STATUS_LABEL, statusText, type DesignRequest, type RequestStatus } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { STATUS_BEAM } from "@/lib/status-colors"
import { useDesigners, useRequests, useUserNames } from "@/lib/store"

// 디자인팀 일정(달력). 프로젝트마다 작업 기간(시작일 ~ 마감일)을 한 달 달력 위에 가로 막대로 그린다.
// 여러 날·여러 주에 걸친 일정은 주마다 이어지는 막대로 보인다. 막대를 누르면 요청 상세로 간다.

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]
const LANE_HEIGHT = 22 // 막대 한 줄 높이(px)
const LANE_GAP = 4

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()

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

export function SchedulePage() {
  const { requests, error } = useRequests()
  const designers = useDesigners()
  const userName = useUserNames()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [includeDone, setIncludeDone] = useState(false)
  const [who, setWho] = useState("all")
  const [today] = useState(() => startOfDay(new Date()))

  const items = useMemo(
    () =>
      (requests ?? [])
        .filter((r) => r.status !== "canceled" && (includeDone || isActive(r)))
        .filter((r) => (who === "all" ? true : who === "unassigned" ? r.designers.length === 0 : r.designers.includes(who)))
        .map((r) => ({ request: r, ...period(r) })),
    [requests, includeDone, who],
  )

  if (!requests) return <PageState error={error} />

  const weeks = monthWeeks(month)
  const monthStart = month
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const thisMonthCount = items.filter((i) => i.start <= monthEnd && i.end >= monthStart).length
  const legend: RequestStatus[] = ["requested", "waiting", "in-progress", "review", "revising", "approved", ...(includeDone ? (["source-pending", "done"] as RequestStatus[]) : [])]

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-4">
        {/* 달 이동과 보기 조건 */}
        <div className="flex flex-wrap items-center gap-3">
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
          </div>
        </div>

        {/* 상태 색 안내 */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: STATUS_BEAM[s] }} aria-hidden />
              {STATUS_LABEL[s]}
            </li>
          ))}
        </ul>

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
            const { bars, lanes } = layoutWeek(week, items)
            return (
              <div
                key={week[0].getTime()}
                className="relative border-b last:border-b-0"
                style={{ minHeight: 32 + Math.max(lanes, 2) * (LANE_HEIGHT + LANE_GAP) + 8 }}
              >
                {/* 날짜 칸 */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {week.map((day) => {
                    const other = day.getMonth() !== month.getMonth()
                    const isToday = sameDay(day, today)
                    return (
                      <div key={day.getTime()} className={`border-r p-1.5 last:border-r-0 ${other ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""}`}>
                        <span
                          className={`inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
                            isToday ? "bg-primary font-semibold text-primary-foreground" : other ? "text-muted-foreground/60" : ""
                          }`}
                        >
                          {day.getDate()}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {/* 일정 막대 */}
                <div
                  className="relative grid grid-cols-7 px-0.5 pt-8 pb-2"
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
                        title={`${r.title}\n${statusText(r)} · ${names}\n${period(r).start.toLocaleDateString("ko-KR")} ~ ${r.dueAt.toLocaleString("ko-KR")}`}
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
              </div>
            )
          })}
        </div>
        {items.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {includeDone ? "표시할 일정이 없습니다." : "진행 중인 프로젝트가 없습니다. 완료 포함을 켜면 끝난 작업도 볼 수 있습니다."}
          </p>
        )}
      </div>
    </div>
  )
}
