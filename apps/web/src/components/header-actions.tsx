import { useEffect, useRef, useState } from "react"
import { Bell, Contrast } from "lucide-react"

import { markAllRead, useNotifications } from "@/lib/notifications"
import { useTheme } from "@/lib/theme"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// 새 알림이 왔을 때 아이콘 아래 툴팁을 보여 주는 시간
const ARRIVAL_TOOLTIP_MS = 4000

function NotificationButton({ onOpen }: { onOpen: () => void }) {
  const { items, unread } = useNotifications()
  const latest = items[0]
  const [hover, setHover] = useState(false)
  const [arrived, setArrived] = useState(false)
  const lastSeenId = useRef(latest?.id)

  useEffect(() => {
    if (!latest || latest.id === lastSeenId.current) return
    lastSeenId.current = latest.id
    setArrived(true)
    const timer = setTimeout(() => setArrived(false), ARRIVAL_TOOLTIP_MS)
    return () => clearTimeout(timer)
  }, [latest])

  const label = unread > 0 ? `알림 ${unread}건` : "알림"

  return (
    <Tooltip open={arrived || hover} onOpenChange={setHover}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={label}
          onClick={() => {
            setArrived(false)
            markAllRead()
            onOpen()
          }}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {arrived && latest ? latest.message : label}
      </TooltipContent>
    </Tooltip>
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

export function HeaderActions({ onOpenNotifications }: { onOpenNotifications: () => void }) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <NotificationButton onOpen={onOpenNotifications} />
      <ThemeToggle />
    </div>
  )
}
