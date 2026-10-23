import { CirclePause, LoaderCircle, MessageCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import {
  designerTitle,
  isActive,
  isThisWeek,
  type DesignRequest,
  type Designer,
  type RequestStatus,
} from "@/lib/requests"
import { INNER_GRID } from "@/lib/layout"
import { PRESENCE_DOT, PRESENCE_LABEL, type Presence } from "@/lib/presence"
import { STATUS_BEAM, STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

// 카드 칸 수: 본문 12칸 그리드에서 넓은 화면 2칸(한 줄 6장), 좁아지면 3·4·6칸. 넘치면 다음 줄로 내려간다.
// 카드 비율은 포커 카드(63.5 × 88.9mm, 5:7).
const CARD_SPAN = "col-span-6 md:col-span-4 lg:col-span-3 xl:col-span-2"

// 카드 아래 "작업 중…" 표시는 이 건수까지만 보여 주고 나머지는 "외 n건"으로 묶는다
const MAX_WORKING_MARKERS = 1

// 카드 가운데 태그: 작업을 상태 묶음별로 센다. 색은 대표 상태의 배지 색.
// 진행 중인 묶음(작업 중·작업 대기·검토 대기)은 마감일과 상관없이 전부, 완료는 이번 주에 완료한 것만 센다.
const WEEK_TAGS: { label: string; statuses: RequestStatus[]; color: RequestStatus }[] = [
  { label: "작업 중", statuses: ["in-progress", "revising", "approved"], color: "in-progress" },
  { label: "작업 대기", statuses: ["requested", "needs-info", "waiting"], color: "waiting" },
  { label: "검토 대기", statuses: ["review"], color: "review" },
  { label: "완료", statuses: ["done", "source-pending"], color: "done" },
]

// presence: 작업자의 현재 상태. 작업 중이 아니면(퇴근·회의 중 등) 도는 표시·반짝임을 멈추고 그 상태를 글로 보인다.
function WorkingMarker({ request, presence }: { request: DesignRequest; presence: Presence }) {
  if (presence !== "working") {
    return (
      <Marker>
        <MarkerIcon className="text-muted-foreground">
          <CirclePause />
        </MarkerIcon>
        <MarkerContent className="flex min-w-0 flex-1 justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-medium">{request.title}</span>
          <span className="flex shrink-0 items-center gap-1">
            <span className={`size-1.5 rounded-full ${PRESENCE_DOT[presence]}`} aria-hidden />
            {PRESENCE_LABEL[presence]}
          </span>
        </MarkerContent>
      </Marker>
    )
  }
  const doing = request.status === "revising" ? "수정 중…" : "작업 중…"
  const color = STATUS_TEXT[request.status] // 상태 배지와 같은 색(작업 중 파랑, 수정 중 주황)
  return (
    <Marker>
      <MarkerIcon className={color}>
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      </MarkerIcon>
      {/* shimmer: 글자 위로 빛이 지나가는 효과(shadcn 유틸). 글자색을 바탕색으로 쓰고, 움직임 줄이기 설정이면 꺼진다.
          프로젝트명은 기본 회색, 상태 글자만 상태 색으로 구분한다 */}
      <MarkerContent className="flex min-w-0 flex-1 justify-between gap-2 text-xs">
        <span className="shimmer min-w-0 flex-1 truncate font-medium">{request.title}</span>
        <span className={`shimmer shrink-0 ${color}`}>{doing}</span>
      </MarkerContent>
    </Marker>
  )
}

export function DesignerCards({
  designers,
  requests,
  presence,
  onChangePresence,
}: {
  designers: (Designer & { avatarId?: string | null })[]
  requests: DesignRequest[]
  presence: Record<string, Presence>
  onChangePresence?: (id: string, p: Presence) => void // 관리자만: 상태 배지를 눌러 바꾼다
}) {
  return (
    <div className={INNER_GRID}>
      {designers.map((d) => {
        const now: Presence = presence[d.id] ?? "off"
        // 진행 중인 작업은 마감이 이번 주가 아니어도 모두 보인다(카드 활성화·테두리 빛·작업 표시).
        // 완료는 이번 주에 완료한 것만(완료 시각 기준).
        const mine = requests.filter((r) => r.designers.includes(d.id))
        const counted = mine.filter((r) => isActive(r) || (r.completedAt !== null && isThisWeek(r.completedAt)))
        const tags = WEEK_TAGS.map((t) => ({ ...t, count: counted.filter((r) => t.statuses.includes(r.status)).length }))
        const working = mine
          .filter((r) => r.status === "in-progress" || r.status === "revising")
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        const hidden = working.length - MAX_WORKING_MARKERS
        // 활성 카드: 현재 상태가 작업 중이고 진행 중인 작업(작업 중·수정 중)이 있을 때.
        // 퇴근·자리 비움·회의 중·외근·휴가이거나 진행 중인 작업이 없으면 흐리게(50%) 하고 테두리 빛도 끈다.
        const activeCard = now === "working" && working.length > 0
        return (
          <div
            key={d.id}
            className={`@container relative flex aspect-[5/7] min-w-0 flex-col rounded-xl border bg-card px-4 pt-11 pb-5 text-card-foreground shadow-md transition-opacity ${activeCard ? "" : "opacity-50"} ${CARD_SPAN}`}
          >
            {/* 작업 중인 카드는 테두리를 따라 빛이 돈다. 색은 카드 아래에 보이는 작업의 상태 색(작업 중 파랑, 수정 중 주황 등) */}
            {activeCard && (
              <>
                <span
                  className="border-beam"
                  style={{ "--beam-color": STATUS_BEAM[working[0].status] } as React.CSSProperties}
                  aria-hidden
                />
              </>
            )}
            {/* 왼쪽 위: 작업자 현재 상태, 오른쪽 위: 1:1 채팅(준비 중) */}
            {onChangePresence ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="absolute top-3 left-3 rounded-full" aria-label={`${d.name} 상태 바꾸기`}>
                    <Badge variant="outline" className="cursor-pointer gap-1.5 hover:bg-accent">
                      <span className={`size-2 rounded-full ${PRESENCE_DOT[now]}`} aria-hidden />
                      {PRESENCE_LABEL[now]}
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-36">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{d.name} 상태</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={now} onValueChange={(v) => onChangePresence(d.id, v as Presence)}>
                    {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
                      <DropdownMenuRadioItem key={p} value={p}>
                        <span className={`size-2 rounded-full ${PRESENCE_DOT[p]}`} aria-hidden />
                        {PRESENCE_LABEL[p]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Badge variant="outline" className="absolute top-3 left-3 gap-1.5">
                <span className={`size-2 rounded-full ${PRESENCE_DOT[now]}`} aria-hidden />
                {PRESENCE_LABEL[now]}
              </Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                {/* 1:1 채팅은 준비 중이라 아직 아무 일도 하지 않는다 */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-2 right-2 text-muted-foreground"
                  aria-label={`${d.name}에게 1:1 채팅 (준비 중)`}
                >
                  <MessageCircle />
                </Button>
              </TooltipTrigger>
              <TooltipContent>1:1 채팅 (준비 중)</TooltipContent>
            </Tooltip>
            {/* 프로필(사진·이름) 묶음과 작업 태그를 위쪽부터 차례로 쌓는다 */}
            <div className="flex flex-1 flex-col items-center gap-3">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <UserAvatar name={d.name} avatarId={d.avatarId} className="size-14" fallbackClassName="text-base font-semibold" />
                  <span
                    className={`absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-card ${PRESENCE_DOT[now]}`}
                    aria-hidden
                  />
                </div>
                <div className="text-center">
                  <p className="text-card-name font-semibold">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{designerTitle(d)}</p>
                </div>
              </div>
              {/* 카드 안쪽 폭이 200px 이상이면 2행 2열, 좁으면 한 열(글자가 넘치지 않게) */}
              <div className="grid w-full grid-cols-1 gap-1 @[200px]:grid-cols-2" aria-label="작업 현황">
                {tags.map((t) => (
                  <Badge
                    key={t.label}
                    variant="secondary"
                    className={`w-full justify-between gap-1 px-1.5 ${STATUS_BG[t.color]} ${STATUS_TEXT[t.color]} tabular-nums`}
                  >
                    <span>{t.label}</span>
                    <span>{t.count}건</span>
                  </Badge>
                ))}
              </div>
            </div>
            {/* 작업 표시 영역: 높이는 내용만큼. "외 n건"은 아래에 겹쳐(absolute) 띄워 높이에 넣지 않는다 */}
            <div className="relative flex flex-col justify-center border-t pt-3">
              {working.length > 0 ? (
                <>
                  {working.slice(0, MAX_WORKING_MARKERS).map((r) => (
                    <WorkingMarker key={r.id} request={r} presence={now} />
                  ))}
                  {hidden > 0 && (
                    <p className="absolute inset-x-0 top-full text-center text-xs text-muted-foreground">외 {hidden}건</p>
                  )}
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
