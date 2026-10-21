import { LoaderCircle } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  BUSY_LABEL,
  busyLevel,
  designerTitle,
  initials,
  isActive,
  isThisWeek,
  type DesignRequest,
  type Designer,
  type RequestStatus,
} from "@/lib/requests"
import { PRESENCE_DOT, PRESENCE_LABEL, type Presence } from "@/lib/presence"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

// 카드 폭 = 본문 12칸 그리드의 칸 수(넓은 화면 2칸). 간격은 INNER_GRID(gap-4, md:gap-6)와 같다.
// 카드 비율은 포커 카드(63.5 × 88.9mm, 5:7).
// (100% - 간격 × (한 화면 장수 - 1)) / 한 화면 장수
const CARD_WIDTH =
  "basis-[calc((100%-1rem)/2)] md:basis-[calc((100%-3rem)/3)] lg:basis-[calc((100%-4.5rem)/4)] xl:basis-[calc((100%-7.5rem)/6)]"

// 카드 아래 "작업 중…" 표시는 이 건수까지만 보여 주고 나머지는 "외 n건"으로 묶는다
const MAX_WORKING_MARKERS = 1

// 카드 가운데 태그: 이번 주 작업을 상태 묶음별로 센다. 색은 대표 상태의 배지 색.
const WEEK_TAGS: { label: string; statuses: RequestStatus[]; color: RequestStatus }[] = [
  { label: "작업 중", statuses: ["in-progress", "revising"], color: "in-progress" },
  { label: "작업 대기", statuses: ["requested", "needs-info", "waiting"], color: "waiting" },
  { label: "검토 대기", statuses: ["review"], color: "review" },
  { label: "완료", statuses: ["done"], color: "done" },
]

function WorkingMarker({ request }: { request: DesignRequest }) {
  const doing = request.status === "revising" ? "수정 중…" : "작업 중…"
  const color = STATUS_TEXT[request.status] // 상태 배지와 같은 색(작업 중 파랑, 수정 중 주황)
  return (
    <Marker>
      <MarkerIcon className={color}>
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      </MarkerIcon>
      {/* shimmer: 글자 위로 빛이 지나가는 효과(shadcn 유틸). 글자색을 바탕색으로 쓰고, 움직임 줄이기 설정이면 꺼진다.
          프로젝트명은 기본 회색, 상태 글자만 상태 색으로 구분한다 */}
      <MarkerContent className="flex min-w-0 flex-1 text-xs">
        <span className="shimmer truncate font-medium">{request.title}</span>
        <span className={`shimmer ml-1 shrink-0 ${color}`}>{doing}</span>
      </MarkerContent>
    </Marker>
  )
}

export function DesignerCards({
  designers,
  requests,
  presence,
}: {
  designers: Designer[]
  requests: DesignRequest[]
  presence: Record<string, Presence>
}) {
  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin] md:gap-6">
      {designers.map((d) => {
        const now: Presence = presence[d.id] ?? "off"
        // 바쁜 정도는 이번 주와 상관없이 진행 중인 전체 건수로 정한다.
        const level = busyLevel(requests.filter((r) => isActive(r) && r.designers.includes(d.id)).length)
        // 태그와 작업 표시는 이번 주(마감일 기준) 작업만. 완료일 데이터가 생기면 완료는 완료일 기준으로 바꾼다.
        const thisWeek = requests.filter((r) => r.designers.includes(d.id) && isThisWeek(r.dueAt))
        const tags = WEEK_TAGS.map((t) => ({ ...t, count: thisWeek.filter((r) => t.statuses.includes(r.status)).length }))
        const working = thisWeek
          .filter((r) => r.status === "in-progress" || r.status === "revising")
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        const hidden = working.length - MAX_WORKING_MARKERS
        return (
          <div
            key={d.id}
            className={`relative flex aspect-[5/7] min-w-0 shrink-0 snap-start flex-col rounded-xl border bg-card px-4 py-5 text-card-foreground ${CARD_WIDTH}`}
          >
            {/* 왼쪽 위: 작업자 현재 상태, 오른쪽 위: 바쁜 정도 */}
            <Badge variant="outline" className="absolute top-3 left-3 gap-1.5">
              <span className={`size-2 rounded-full ${PRESENCE_DOT[now]}`} aria-hidden />
              {PRESENCE_LABEL[now]}
            </Badge>
            <Badge variant="outline" className="absolute top-3 right-3 text-muted-foreground">
              {BUSY_LABEL[level]}
            </Badge>
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="relative">
                <Avatar className="size-14">
                  <AvatarFallback className="text-base font-semibold">{initials(d.name)}</AvatarFallback>
                </Avatar>
                <span
                  className={`absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-card ${PRESENCE_DOT[now]}`}
                  aria-hidden
                />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{d.name}</p>
                <p className="text-xs text-muted-foreground">{designerTitle(d)}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-1" aria-label="이번 주 작업">
                {tags.map((t) => (
                  <Badge key={t.label} variant="secondary" className={`${STATUS_BG[t.color]} ${STATUS_TEXT[t.color]} tabular-nums`}>
                    {t.label} {t.count}건
                  </Badge>
                ))}
              </div>
            </div>
            {/* 작업 표시 영역: "외 n건" 줄까지 포함해 모든 카드에서 높이를 같게 둔다 */}
            <div className="flex h-14 flex-col justify-center gap-1 border-t pt-3">
              {working.length > 0 ? (
                <>
                  {working.slice(0, MAX_WORKING_MARKERS).map((r) => (
                    <WorkingMarker key={r.id} request={r} />
                  ))}
                  <p className="h-4 text-center text-xs text-muted-foreground">{hidden > 0 && `외 ${hidden}건`}</p>
                </>
              ) : (
                <p className="text-center text-xs text-muted-foreground">진행 중인 프로젝트가 없습니다.</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
