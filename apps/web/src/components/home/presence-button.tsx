import { ChevronUp, UsersRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Session } from "@/lib/auth"
import { PRESENCE_DOT, PRESENCE_LABEL, savePresence, type Presence } from "@/lib/presence"

// 홈 화면 오른쪽 아래에 떠 있는 내 현재 상태 버튼(작업자·디자인팀 관리자만).
// 누르면 상태를 고르는 메뉴가 열리고, 고르면 바로 디자인팀 카드에 반영된다.
// 위치는 오른쪽 아래 버튼 묶음(FloatingDock)이 정한다.
// onBatch: 관리자만. 메뉴 아래에 "상태 일괄 변경"을 두고 누르면 일괄 변경 창을 연다.
export function PresenceButton({
  session,
  onSessionChange,
  onBatch,
}: {
  session: Session
  onSessionChange: (s: Session) => void
  onBatch?: () => void
}) {
  const now = (session.presence in PRESENCE_LABEL ? session.presence : "off") as Presence

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-12 gap-2 rounded-full px-5 text-base shadow-lg" aria-label="내 현재 상태 바꾸기">
            <span className={`size-2.5 rounded-full ${PRESENCE_DOT[now]}`} aria-hidden />
            {PRESENCE_LABEL[now]}
            <ChevronUp className="opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="min-w-40">
          <DropdownMenuLabel className="text-xs text-muted-foreground">내 현재 상태</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={now}
            onValueChange={async (v) => onSessionChange(await savePresence(v as Presence))}
          >
            {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                <span className={`size-2 rounded-full ${PRESENCE_DOT[p]}`} aria-hidden />
                {PRESENCE_LABEL[p]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {onBatch && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onBatch}>
                <UsersRound />
                상태 일괄 변경
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
    </DropdownMenu>
  )
}
