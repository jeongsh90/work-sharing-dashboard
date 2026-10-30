import { Bell, BellRing, Contrast, FilePlus2 } from "lucide-react"

import { AccountSwitcher } from "@/components/account-switcher"
import { useDesktopTest } from "@/components/desktop-test-dialog"
import type { Session } from "@/lib/auth"
import { markAllRead, useNotifications, type NotificationType } from "@/lib/notifications"
import { useTheme } from "@/lib/theme"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// 알림 종류별 툴팁 배경색. 화살표(svg)도 같은 색으로 칠한다. 빈 값은 기본 툴팁 색.
// 예: urgent: "bg-red-600 text-white [&_svg]:bg-red-600 [&_svg]:fill-red-600"
const NOTIFICATION_TOOLTIP_COLORS: Record<NotificationType, string> = {
  default: "",
}

function NotificationButton({ onOpen }: { onOpen: () => void }) {
  const { items, unread } = useNotifications()
  // 확인하지 않은 알림이 있으면 툴팁을 계속 띄운다. 종 아이콘이나 툴팁을 누르거나 알림함을 열면 닫힌다.
  const pending = items.find((n) => !n.read)

  const label = unread > 0 ? `알림 ${unread}건` : "알림"
  const open = () => {
    markAllRead()
    onOpen()
  }

  // 툴팁은 확인하지 않은 알림이 있을 때만 띄운다. 마우스를 올렸을 때 "알림" 툴팁은 띄우지 않는다.
  return (
    <Tooltip open={!!pending}>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={label} onClick={open}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background" />
          )}
        </Button>
      </TooltipTrigger>
      {pending ? (
        <TooltipContent
          side="bottom"
          className={`cursor-pointer ${NOTIFICATION_TOOLTIP_COLORS[pending.type]}`}
          onClick={open}
        >
          {pending.message}
          {unread > 1 && ` 외 ${unread - 1}건`}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}

// 내 PC 에서 알림이 뜨는지 바로 확인하는 버튼. 결과와 확인 단계는 창으로 보여 준다(desktop-test-dialog.tsx).
function DesktopTestButton() {
  const { run, dialog } = useDesktopTest()

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" aria-label="내 PC 알림 테스트" onClick={run}>
            <BellRing data-icon="inline-start" />
            <span className="hidden sm:inline">PC 알림 테스트</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">내 PC 에서 알림이 뜨는지 확인합니다</TooltipContent>
      </Tooltip>
      {dialog}
    </>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={toggle}>
          <Contrast />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// onNewRequest 를 주면(요청자) 맨 오른쪽에 디자인 요청 버튼을 둔다. 좁은 화면에서는 아이콘만 보인다.
// 맨 오른쪽: PC 알림 테스트 → 계정 전환(정해 둔 계정 묶음일 때만 보인다)
export function HeaderActions({
  onOpenNotifications,
  onNewRequest,
  currentId,
  onSwitched,
}: {
  onOpenNotifications: () => void
  onNewRequest?: () => void
  currentId: string
  onSwitched: (token: string, user: Session) => void
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <NotificationButton onOpen={onOpenNotifications} />
      <ThemeToggle />
      {onNewRequest && (
        <Button size="sm" className="ml-1" aria-label="디자인 요청" onClick={onNewRequest}>
          <FilePlus2 data-icon="inline-start" />
          <span className="hidden sm:inline">디자인 요청</span>
        </Button>
      )}
      <DesktopTestButton />
      <AccountSwitcher currentId={currentId} onSwitched={onSwitched} />
    </div>
  )
}
