import { CalendarClock } from "lucide-react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { StatusBadge, UrgencyBadge } from "@/components/home/status-badge"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { UserAvatar } from "@/components/user-avatar"
import { dueText, type DesignRequest, type Designer, type RequestStatus } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

// 홈 디자이너 카드 → 오른쪽 시트: 그 작업자가 받은 요청 중 진행 중인 것(작업 중·작업 대기·검토 대기)을 묶음별로 보인다.
// 묶음은 카드 가운데 태그(designer-cards WEEK_TAGS)와 같은 기준. 요청을 누르면 상세로 간다.
export const QUEUE_GROUPS: {
  label: string
  statuses: RequestStatus[]
  color: RequestStatus
}[] = [
  {
    label: "작업 중",
    statuses: ["in-progress", "revising", "approved"],
    color: "in-progress",
  },
  {
    label: "작업 대기",
    statuses: ["requested", "needs-info", "waiting"],
    color: "waiting",
  },
  { label: "검토 대기", statuses: ["review"], color: "review" },
]

// 마감 가까운 순(보류·계속 업무는 뒤로)
const dueOrder = (r: DesignRequest) => (r.onHold ? 2 : r.ongoing ? 1 : 0)
const byDue = (a: DesignRequest, b: DesignRequest) => dueOrder(a) - dueOrder(b) || a.dueAt.getTime() - b.dueAt.getTime()

export function DesignerQueueSheet({
  designer,
  requests,
  onClose,
}: {
  designer: (Designer & { avatarId?: string | null }) | null
  requests: DesignRequest[]
  onClose: () => void
}) {
  const mine = designer ? requests.filter((r) => r.designers.includes(designer.id)) : []
  const groups = QUEUE_GROUPS.map((g) => ({
    ...g,
    items: mine.filter((r) => g.statuses.includes(r.status)).sort(byDue),
  }))
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <Sheet open={designer !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" data-lenis-prevent>
        {designer && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-3 pr-8">
                <UserAvatar name={designer.name} avatarId={designer.avatarId} className="size-10" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{designer.name} 받은 요청</SheetTitle>
                  <SheetDescription>진행 중 {total}건 · 작업 중, 작업 대기, 검토 대기</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SmoothScrollArea className="min-h-0 flex-1 overflow-y-auto" contentClassName="flex flex-col gap-5 p-4">
              {groups.map((g) => (
                <section key={g.label} className="flex flex-col gap-2" aria-label={g.label}>
                  <h3
                    className={`flex items-center justify-between rounded-md px-2 py-1 text-sm font-medium tabular-nums ${STATUS_BG[g.color]} ${STATUS_TEXT[g.color]}`}
                  >
                    <span>{g.label}</span>
                    <span>{g.items.length}건</span>
                  </h3>
                  {g.items.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">없습니다.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {g.items.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onClose()
                              openRequest(r.id)
                            }}
                            className="flex w-full flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex items-start gap-2">
                              <span className="min-w-0 flex-1 font-medium break-keep">{r.title}</span>
                              <StatusBadge request={r} />
                            </span>
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                {r.requester}
                                {r.department ? ` · ${r.department}` : ""}
                              </span>
                              <span className="flex items-center gap-1 tabular-nums">
                                <CalendarClock className="size-3.5" aria-hidden />
                                {dueText(r)}
                              </span>
                              <UrgencyBadge urgency={r.urgency} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </SmoothScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
