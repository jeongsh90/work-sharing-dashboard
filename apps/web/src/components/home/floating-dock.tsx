import { createPortal } from "react-dom"
import { FileImage, Inbox, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PresenceButton } from "@/components/home/presence-button"
import type { Session } from "@/lib/auth"
import { isActive, type DesignRequest } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { isDesignWorker } from "@/lib/store"

// 홈 화면 오른쪽 아래에 떠 있는 버튼 묶음. 위에서부터
// 컨펌 대기(관리자·요청자) → 받은 요청(디자인팀·관리자, 미배정 건수) → 내 현재 상태(작업자)
// 페이지 페이드 효과(transform) 동안 위치가 튀지 않게 문서 맨 바깥(body)에 그린다.

function DockButton({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          className="relative size-12 rounded-full shadow-lg [&_svg:not([class*='size-'])]:size-5"
          aria-label={`${label} ${count}건`}
          onClick={onClick}
        >
          <Icon />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white tabular-nums ring-2 ring-background">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {label} {count}건
      </TooltipContent>
    </Tooltip>
  )
}

// 홈 아래 여백 계산용: 이 사용자에게 보이는 버튼 수
export function dockItemCount(session: Session) {
  const manager = session.role === "admin" || session.role === "superadmin"
  return (
    Number(manager || session.role === "requester") +
    Number(manager || session.role === "designer") +
    Number(isDesignWorker(session))
  )
}

export function FloatingDock({
  session,
  requests,
  onSessionChange,
}: {
  session: Session
  requests: DesignRequest[]
  onSessionChange: (s: Session) => void
}) {
  const manager = session.role === "admin" || session.role === "superadmin"
  const requester = session.role === "requester"
  // 컨펌 대기: 관리자는 전체, 요청자는 내 요청 중 시안 확인 상태
  const review = requests.filter((r) => r.status === "review" && (manager || r.requesterId === session.id)).length
  // 받은 요청: 아직 담당 작업자가 없는 진행 중 요청
  const unassigned = requests.filter((r) => isActive(r) && r.designers.length === 0).length

  return createPortal(
    <div className="fixed right-6 bottom-6 z-30 flex flex-col items-end gap-3">
      {(manager || requester) && (
        <DockButton
          icon={FileImage}
          label="컨펌 대기"
          count={review}
          onClick={() => navigate(manager ? "inbox" : "my-requests")}
        />
      )}
      {(manager || session.role === "designer") && (
        <DockButton icon={Inbox} label="받은 요청 · 미배정" count={unassigned} onClick={() => navigate("inbox")} />
      )}
      {isDesignWorker(session) && <PresenceButton session={session} onSessionChange={onSessionChange} />}
    </div>,
    document.body,
  )
}
