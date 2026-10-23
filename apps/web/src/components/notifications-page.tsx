import { useState } from "react"
import {
  Bell,
  CircleCheck,
  CircleX,
  FileImage,
  FilePlus2,
  FileUp,
  MessageSquare,
  MessageSquareText,
  Play,
  Undo2,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { DesktopNotifyToggle } from "@/components/desktop-notify-toggle"
import { Section } from "@/components/home/home-page"
import { PAGE_GRID } from "@/lib/layout"
import { useNotifications, type AppNotification } from "@/lib/notifications"
import { navigate, openRequest } from "@/lib/router"

// 알림함: shadcn Trace 로 날짜별 묶음을 접었다 펼치고, 알림 한 줄마다 종류 아이콘·내용·시각을 보여 준다.
// 새 알림(이 화면을 열기 전까지 안 읽은 것)은 반짝이게(running), 반려·취소는 빨갛게(error) 표시한다.

const pad = (n: number) => String(n).padStart(2, "0")

// 알림 문구로 종류를 고른다(서버 알림 문구: apps/api/src/requests.ts, suggestions.ts).
// 문구는 "무슨 일: 요청 제목" 꼴이라 제목에 든 낱말에 휘둘리지 않게 앞부분만 본다.
function kindOf(full: string): { icon: LucideIcon; error?: boolean } {
  const message = full.split(": ")[0]
  if (message.includes("새 디자인 요청")) return { icon: FilePlus2 }
  if (message.includes("반려")) return { icon: Undo2, error: true }
  if (message.includes("취소")) return { icon: CircleX, error: true }
  if (message.includes("원본")) return { icon: FileUp }
  if (message.includes("완료") || message.includes("컨펌되었")) return { icon: CircleCheck }
  if (message.includes("컨펌 요청")) return { icon: FileImage }
  if (message.includes("작업을 시작")) return { icon: Play }
  if (message.includes("담당") || message.includes("작업자")) return { icon: UserRound }
  if (message.includes("가입")) return { icon: UserPlus }
  if (message.includes("건의")) return { icon: MessageSquareText }
  if (message.includes("댓글")) return { icon: MessageSquare }
  return { icon: Bell }
}

function dayLabel(d: Date, today: Date) {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86_400_000)
  if (days === 0) return "오늘"
  if (days === 1) return "어제"
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function open(n: AppNotification) {
  if (n.requestId) openRequest(n.requestId)
  else if (n.link) navigate(n.link)
}

export function NotificationsPage() {
  const { items } = useNotifications()
  // 이 화면을 열면 모두 읽음 처리되므로, 처음 열 때 안 읽었던 알림을 기억해 새 알림으로 표시한다.
  const [fresh] = useState(() => new Set(items.filter((n) => !n.read).map((n) => n.id)))
  const [today] = useState(() => new Date())

  // 날짜별로 묶기(최근 날짜가 위)
  const groups: { label: string; list: AppNotification[] }[] = []
  for (const n of items) {
    const label = dayLabel(new Date(n.createdAt), today)
    const last = groups.at(-1)
    if (last?.label === label) last.list.push(n)
    else groups.push({ label, list: [n] })
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="알림"
        aside={<span className="text-sm text-muted-foreground">{items.length}건</span>}
        className="col-span-12 lg:col-span-8 xl:col-span-6"
      >
        <DesktopNotifyToggle compact />
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
            <Bell className="size-5" aria-hidden />
            받은 알림이 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            {groups.map((g, gi) => {
              const newCount = g.list.filter((n) => fresh.has(n.id)).length
              return (
                <TraceCollapsible key={g.label} defaultOpen={gi < 2 || newCount > 0}>
                  <TraceCollapsibleTrigger>
                    <TraceLine>
                      <TraceTitle className="font-medium text-foreground">{g.label}</TraceTitle>
                      <TraceDescription>
                        {g.list.length}건{newCount > 0 && ` · 새 알림 ${newCount}`}
                      </TraceDescription>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  <TraceCollapsibleContent>
                    <Trace>
                      {g.list.map((n) => {
                        const kind = kindOf(n.message)
                        const at = new Date(n.createdAt)
                        const isNew = fresh.has(n.id)
                        return (
                          <button
                            key={n.id}
                            type="button"
                            disabled={!n.requestId && !n.link}
                            onClick={() => open(n)}
                            className="disabled:cursor-default"
                          >
                            <TraceLine status={kind.error ? "error" : isNew ? "running" : undefined}>
                              <TraceIcon>
                                <kind.icon />
                              </TraceIcon>
                              <TraceTitle className={isNew ? "font-medium text-foreground" : undefined}>{n.message}</TraceTitle>
                              <TraceDescription>
                                {pad(at.getHours())}:{pad(at.getMinutes())}
                              </TraceDescription>
                            </TraceLine>
                          </button>
                        )
                      })}
                    </Trace>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
