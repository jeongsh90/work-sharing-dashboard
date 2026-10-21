import { LoaderCircle } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { BUSY_LABEL, busyLevel, designerTitle, initials, isActive, type BusyLevel, type DesignRequest, type Designer } from "@/lib/requests"
import { STATUS_TEXT } from "@/lib/status-colors"

// 카드 폭 = 본문 12칸 그리드의 칸 수(넓은 화면 2칸). 간격은 INNER_GRID(gap-4, md:gap-6)와 같다.
// 카드 비율은 포커 카드(63.5 × 88.9mm, 5:7).
// (100% - 간격 × (한 화면 장수 - 1)) / 한 화면 장수
const CARD_WIDTH =
  "basis-[calc((100%-1rem)/2)] md:basis-[calc((100%-3rem)/3)] lg:basis-[calc((100%-4.5rem)/4)] xl:basis-[calc((100%-7.5rem)/6)]"

// 카드 아래 "작업 중…" 표시는 카드 높이에 맞춰 이 건수까지만 보여 준다
const MAX_WORKING_MARKERS = 2

const BUSY_DOT: Record<BusyLevel, string> = {
  free: "bg-emerald-500",
  normal: "bg-amber-400",
  busy: "bg-red-500",
}

function WorkingMarker({ request }: { request: DesignRequest }) {
  const doing = request.status === "revising" ? "수정 중…" : "작업 중…"
  const color = STATUS_TEXT[request.status] // 상태 배지와 같은 색(작업 중 파랑, 수정 중 주황)
  return (
    <Marker>
      <MarkerIcon className={color}>
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      </MarkerIcon>
      {/* shimmer: 글자 위로 빛이 지나가는 효과(shadcn 유틸). 글자색을 바탕색으로 쓰고, 움직임 줄이기 설정이면 꺼진다 */}
      <MarkerContent className={`shimmer flex min-w-0 flex-1 text-xs ${color}`}>
        <span className="truncate font-medium">{request.title}</span>
        <span className="ml-1 shrink-0">{doing}</span>
      </MarkerContent>
    </Marker>
  )
}

export function DesignerCards({ designers, requests }: { designers: Designer[]; requests: DesignRequest[] }) {
  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin] md:gap-6">
      {designers.map((d) => {
        const mine = requests.filter((r) => isActive(r) && r.designers.includes(d.id))
        const working = mine
          .filter((r) => r.status === "in-progress" || r.status === "revising")
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        const level = busyLevel(mine.length)
        const hidden = working.length - MAX_WORKING_MARKERS
        return (
          <div
            key={d.id}
            className={`flex aspect-[5/7] min-w-0 shrink-0 snap-start flex-col rounded-xl border bg-card px-4 py-5 text-card-foreground ${CARD_WIDTH}`}
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="relative">
                <Avatar className="size-14">
                  <AvatarFallback className="text-base font-semibold">{initials(d.name)}</AvatarFallback>
                </Avatar>
                <span
                  className={`absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-card ${BUSY_DOT[level]}`}
                  aria-hidden
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{d.name}</p>
                <p className="text-xs text-muted-foreground">{designerTitle(d)}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  진행 <b className="text-foreground tabular-nums">{mine.length}</b> · 작업 중{" "}
                  <b className="text-foreground tabular-nums">{working.length}</b>
                </span>
              </div>
              <Badge variant="outline">{BUSY_LABEL[level]}</Badge>
            </div>
            {working.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-3">
                {working.slice(0, MAX_WORKING_MARKERS).map((r) => (
                  <WorkingMarker key={r.id} request={r} />
                ))}
                {hidden > 0 && <p className="pl-6 text-xs text-muted-foreground">외 {hidden}건</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
