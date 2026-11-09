import { lazy, Suspense, useState } from "react"
import { Bell, BellRing, ClipboardCheck, Contrast, FilePlus2, StickyNote } from "lucide-react"

import { AccountSwitcher } from "@/components/account-switcher"
import { useDesktopTest } from "@/components/desktop-test-dialog"
import type { Session } from "@/lib/auth"
import { markAllRead, useNotifications, type NotificationType } from "@/lib/notifications"
import { useTheme } from "@/lib/theme"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"

// 체크리스트·메모: 어느 화면에서든 헤더 버튼으로 오른쪽 시트를 열어 바로 쓴다(개인 메뉴 화면과 같은 내용·같은 데이터)
const ChecklistPage = lazy(() => import("@/components/checklist-page").then((m) => ({ default: m.ChecklistPage })))
const MemoPage = lazy(() => import("@/components/memo-page").then((m) => ({ default: m.MemoPage })))

type QuickPanel = "checklist" | "memo"
const PANEL = {
  checklist: { title: "체크리스트", icon: ClipboardCheck, description: "개인 메뉴의 체크리스트와 같은 내용입니다." },
  memo: { title: "메모", icon: StickyNote, description: "개인 메뉴의 메모와 같은 내용입니다. 저장하지 않고 닫으면 쓰던 내용은 사라집니다." },
} as const

function QuickPanels() {
  const [open, setOpen] = useState<QuickPanel | null>(null)
  return (
    <>
      {(Object.keys(PANEL) as QuickPanel[]).map((k) => {
        const Icon = PANEL[k].icon
        return (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" aria-label={PANEL[k].title} onClick={() => setOpen(k)}>
                <Icon data-icon="inline-start" />
                <span className="hidden sm:inline">{PANEL[k].title}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{PANEL[k].title} 열기</TooltipContent>
          </Tooltip>
        )
      })}
      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-xl" data-lenis-prevent>
          {open && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>{PANEL[open].title}</SheetTitle>
                <SheetDescription>{PANEL[open].description}</SheetDescription>
              </SheetHeader>
              <SmoothScrollArea className="min-h-0 flex-1 overflow-y-auto">
                <Suspense fallback={<p className="p-6 text-center text-sm text-muted-foreground">여는 중…</p>}>
                  {open === "checklist" ? <ChecklistPage inSheet /> : <MemoPage inSheet />}
                </Suspense>
              </SmoothScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

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
// 맨 오른쪽: PC 알림 테스트 → 계정 전환(정해 둔 계정 묶음일 때만 보인다) → 체크리스트 · 메모(오른쪽 시트)
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
      <QuickPanels />
    </div>
  )
}
