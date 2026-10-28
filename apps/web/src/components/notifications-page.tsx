import { useEffect, useState } from "react"
import {
  Bell,
  CircleCheck,
  CircleX,
  ClipboardList,
  FileImage,
  FilePlus2,
  FileUp,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Play,
  RotateCcw,
  Undo2,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { DesktopNotifyToggle } from "@/components/desktop-notify-toggle"
import { Section } from "@/components/home/home-page"
import { PAGE_GRID } from "@/lib/layout"
import { markAllRead, takeJustRead, useNotifications, type AppNotification } from "@/lib/notifications"
import { navigate, openRequest } from "@/lib/router"
import { cn } from "@/lib/utils"

// 알림함: 프로젝트(요청)별로 알림을 묶어 shadcn Alert 카드 하나로 보여 준다.
// 카드 제목은 요청 제목, 내용은 그 요청에 온 알림을 최근 것부터 몇 줄. 요청과 관계없는 알림(가입·건의)은 한 건씩 카드로.
// 새 알림(이 화면을 열기 전까지 안 읽은 것)이 있는 카드는 "새 알림" 배지·더 굵은 테두리(보통 2px, 새 알림 3px)·같은 색 그림자. 카드 테두리·아이콘 색은 최근 알림 종류를 따른다.

const pad = (n: number) => String(n).padStart(2, "0")
const MAX_LINES = 4

// 알림 문구는 "무슨 일: 요청 제목" 꼴이다(서버 알림 문구: apps/api/src/requests.ts, suggestions.ts).
function split(full: string) {
  const i = full.indexOf(": ")
  return i < 0 ? { what: full, subject: "" } : { what: full.slice(0, i), subject: full.slice(i + 2) }
}

// 알림 종류별 색: 카드 테두리와 아이콘을 같은 색으로. 요청 상태 배지와 같은 계열을 쓴다(lib/status-colors.ts).
// 글자(알림 문구)와 아이콘 모양이 함께 있어 색만으로 구분하지 않는다.
const TONE = {
  slate: "border-slate-500/40 *:[svg]:text-slate-500",
  amber: "border-amber-500/50 *:[svg]:text-amber-500",
  sky: "border-sky-500/50 *:[svg]:text-sky-500",
  blue: "border-blue-500/50 *:[svg]:text-blue-500",
  violet: "border-violet-500/50 *:[svg]:text-violet-500",
  lime: "border-lime-500/50 *:[svg]:text-lime-600",
  emerald: "border-emerald-500/50 *:[svg]:text-emerald-500",
  red: "border-red-500/50 *:[svg]:text-red-500",
  orange: "border-orange-500/50 *:[svg]:text-orange-500",
  teal: "border-teal-500/50 *:[svg]:text-teal-500",
  pink: "border-pink-500/50 *:[svg]:text-pink-500",
  indigo: "border-indigo-500/50 *:[svg]:text-indigo-500",
} as const

// 확인 안 한 알림(새 알림) 카드는 같은 색 그림자로 띄워 강조한다
const GLOW: Record<keyof typeof TONE, string> = {
  slate: "shadow-slate-500/40",
  amber: "shadow-amber-500/50",
  sky: "shadow-sky-500/50",
  blue: "shadow-blue-500/50",
  violet: "shadow-violet-500/50",
  lime: "shadow-lime-500/50",
  emerald: "shadow-emerald-500/50",
  red: "shadow-red-500/50",
  orange: "shadow-orange-500/50",
  teal: "shadow-teal-500/50",
  pink: "shadow-pink-500/50",
  indigo: "shadow-indigo-500/50",
}

// 알림 문구로 종류를 고른다. 제목에 든 낱말에 휘둘리지 않게 앞부분만 본다.
function kindOf(full: string): { icon: LucideIcon; tone: keyof typeof TONE } {
  const message = split(full).what
  if (message.includes("새 디자인 요청")) return { icon: FilePlus2, tone: "amber" }
  if (message.includes("새 공지사항")) return { icon: Megaphone, tone: "orange" }
  if (message.includes("새 주간보고")) return { icon: ClipboardList, tone: "blue" }
  // 작업 취소(되돌리기) 알림은 "취소" 낱말이 들어 있어도 빨갛게 하지 않는다
  if (message.includes("되돌려")) return { icon: RotateCcw, tone: "slate" }
  if (message.includes("요청자 확인")) return { icon: Bell, tone: "amber" }
  if (message.includes("반려")) return { icon: Undo2, tone: "red" }
  if (message.includes("취소")) return { icon: CircleX, tone: "red" }
  if (message.includes("원본")) return { icon: FileUp, tone: "lime" }
  if (message.includes("완료") || message.includes("컨펌되었")) return { icon: CircleCheck, tone: "emerald" }
  if (message.includes("컨펌 요청")) return { icon: FileImage, tone: "violet" }
  if (message.includes("작업을 시작")) return { icon: Play, tone: "blue" }
  if (message.includes("담당") || message.includes("작업자")) return { icon: UserRound, tone: "sky" }
  if (message.includes("가입")) return { icon: UserPlus, tone: "teal" }
  if (message.includes("건의")) return { icon: MessageSquareText, tone: "pink" }
  if (message.includes("댓글")) return { icon: MessageSquare, tone: "indigo" }
  return { icon: Bell, tone: "slate" }
}

// 시:분(날짜는 위 날짜 제목으로 보인다)
function timeLabel(at: number) {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 날짜 제목: 오늘 · 어제 · 10월 23일 (금)
function dayLabel(at: number, today: Date) {
  const d = new Date(at)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86_400_000)
  if (days === 0) return "오늘"
  if (days === 1) return "어제"
  const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()]
  const year = d.getFullYear() !== today.getFullYear() ? `${d.getFullYear()}년 ` : ""
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${week})`
}

// 날짜별로 나누고(최근 날짜가 위), 그날 안에서 다시 프로젝트별로 묶는다.
function groupByDay(items: AppNotification[], today: Date) {
  const days: { label: string; list: AppNotification[] }[] = []
  for (const n of items) {
    const label = dayLabel(n.createdAt, today)
    const last = days.at(-1)
    if (last?.label === label) last.list.push(n)
    else days.push({ label, list: [n] })
  }
  return days.map((d) => ({ label: d.label, count: d.list.length, groups: groupByProject(d.list) }))
}

function open(n: AppNotification) {
  if (n.requestId) openRequest(n.requestId)
  else if (n.link) navigate(n.link)
}

type Group = { key: string; title: string; list: AppNotification[] }

// 알림은 최근 것이 앞에 오므로, 처음 나온 순서대로 묶으면 최근 소식이 있는 프로젝트가 위로 간다.
function groupByProject(items: AppNotification[]) {
  const groups: Group[] = []
  const byRequest = new Map<number, Group>()
  for (const n of items) {
    if (n.requestId === null) {
      const { what, subject } = split(n.message)
      groups.push({ key: `n${n.id}`, title: subject ? `${what}: ${subject}` : what, list: [n] })
      continue
    }
    let g = byRequest.get(n.requestId)
    if (!g) {
      g = { key: `r${n.requestId}`, title: split(n.message).subject || n.message, list: [] }
      byRequest.set(n.requestId, g)
      groups.push(g)
    }
    g.list.push(n)
  }
  return groups
}

export function NotificationsPage() {
  const { items } = useNotifications()
  // 이 화면을 열면 모두 읽음 처리되므로(App 이 화면보다 먼저 처리한다), 그때 읽음으로 바뀐 알림과
  // 화면을 보는 동안 새로 들어온 알림을 기억해 새 알림으로 표시한다.
  const [fresh, setFresh] = useState(() => {
    const ids = takeJustRead()
    for (const n of items) if (!n.read) ids.add(n.id)
    return ids
  })
  useEffect(() => {
    const unread = items.filter((n) => !n.read)
    if (unread.length === 0) return
    setFresh((prev) => new Set([...prev, ...unread.map((n) => n.id)]))
    markAllRead()
    takeJustRead()
  }, [items])
  const [today] = useState(() => new Date())
  const days = groupByDay(items, today)

  return (
    <div className={PAGE_GRID}>
      <Section
        title="알림"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{items.length}건</span>}
        className="col-span-12 lg:col-span-8 lg:col-start-3 xl:col-span-6 xl:col-start-4"
      >
        <DesktopNotifyToggle compact />
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
            <Bell className="size-5" aria-hidden />
            받은 알림이 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {days.map((day) => (
              <section key={day.label} className="flex flex-col gap-3">
                {/* 날짜 제목 */}
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {day.label}
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">{day.count}건</span>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </h3>
                {day.groups.map((g) => {
                  const latest = g.list[0]
                  const kind = kindOf(latest.message)
                  const newCount = g.list.filter((n) => fresh.has(n.id)).length
                  const project = latest.requestId !== null
                  const clickable = project || !!latest.link
                  return (
                    <Alert
                      key={g.key}
                      role="status"
                      onClick={clickable ? () => open(latest) : undefined}
                      className={cn(
                        "px-4 py-3 pr-28 has-data-[slot=alert-action]:pr-28",
                        clickable && "cursor-pointer transition-colors hover:bg-accent/50",
                        "border-2",
                        TONE[kind.tone],
                        newCount > 0 && ["border-3 shadow-[0_0_18px_2px]", GLOW[kind.tone]],
                      )}
                    >
                      <kind.icon />
                      <AlertTitle className="truncate">{g.title}</AlertTitle>
                      <AlertDescription>
                        {project ? (
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {g.list.slice(0, MAX_LINES).map((n) => (
                              <li key={n.id} className={cn("flex gap-2", fresh.has(n.id) && "text-foreground")}>
                                <span className="shrink-0 text-muted-foreground/70 tabular-nums">{timeLabel(n.createdAt)}</span>
                                <span className="min-w-0">{split(n.message).what}</span>
                              </li>
                            ))}
                            {g.list.length > MAX_LINES && (
                              <li className="text-muted-foreground/70">외 {g.list.length - MAX_LINES}건</li>
                            )}
                          </ul>
                        ) : (
                          <span className="tabular-nums">{timeLabel(latest.createdAt)}</span>
                        )}
                      </AlertDescription>
                      <AlertAction className="top-3 right-4 flex items-center gap-2">
                        {newCount > 0 && <Badge>새 알림 {newCount}</Badge>}
                        {project && <span className="text-xs text-muted-foreground tabular-nums">{g.list.length}건</span>}
                      </AlertAction>
                    </Alert>
                  )
                })}
              </section>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
