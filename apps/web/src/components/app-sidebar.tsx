import { useEffect } from "react"
import { FilePlus2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import { isManager, type Session } from "@/lib/auth"
import { menuFor } from "@/lib/menu"
import type { NoticeSummary } from "@/lib/notices"
import { useNotifications } from "@/lib/notifications"
import type { RequestSummaryDto } from "@/lib/requests"
import { markSeen, useSeen } from "@/lib/seen"
import { useApi } from "@/lib/store"
import { APP_VERSION } from "@/lib/version"
import { NavUser } from "@/components/nav-user"
import { DiskUsage } from "@/components/disk-usage"
import type { OnSwitched } from "@/components/account-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// 메뉴 N 표시: 다른 사람이 새로 올린 내용이 있으면 하루 동안 N 을 띄운다. 그 메뉴를 열어 보면 꺼진다.
// (버전 정보는 아직 보지 않은 새 버전이 있으면)
const DAY = 24 * 60 * 60 * 1000
const TRACKED = ["notices", "inbox", "my-requests", "files", "share", "library", "feedback", "notifications"] as const

function useFreshMenus(session: Session, activeId: string) {
  const userId = session.id
  const team = isManager(session) || session.role === "designer"
  const { data: requests } = useApi<RequestSummaryDto[]>("/requests")
  const { data: suggestions } = useApi<{ authorId: string; createdAt: number }[]>("/suggestions", 60_000)
  const { data: notices } = useApi<NoticeSummary[]>("/notices", 60_000)
  const { data: library } = useApi<{ uploaderId: string; createdAt: number }[]>(team ? "/library" : null, 60_000)
  const { data: share } = useApi<{ authorId: string; createdAt: number }[]>("/share", 60_000)
  const { items: notifications } = useNotifications()
  const seenVersion = useSeen(userId, "version")
  // 메뉴마다 마지막으로 연 때(이 브라우저)
  const seen = Object.fromEntries(TRACKED.map((id) => [id, Number(useSeen(userId, `menu:${id}`) ?? 0)])) as Record<(typeof TRACKED)[number], number>

  // 메뉴를 열 때와 떠날 때 "본 때"를 남긴다(열어 둔 동안 들어온 것은 떠날 때 본 것으로)
  useEffect(() => {
    if (!(TRACKED as readonly string[]).includes(activeId)) return
    markSeen(userId, `menu:${activeId}`, String(Date.now()))
    return () => markSeen(userId, `menu:${activeId}`, String(Date.now()))
  }, [userId, activeId])

  const latest = (list: number[]) => (list.length ? Math.max(...list) : 0)
  const mineReq = (r: RequestSummaryDto) => r.requesterId === userId || r.createdBy === userId
  const newest: Record<(typeof TRACKED)[number], number> = {
    notices: latest((notices ?? []).filter((n) => n.authorId !== userId && !n.read).map((n) => n.createdAt)),
    // 받은 요청함: 다른 사람이 새로 보낸 요청
    inbox: latest((requests ?? []).filter((r) => !mineReq(r)).map((r) => r.createdAt)),
    // 내 요청: 내 요청에 생긴 변화(보낸 뒤 상태가 바뀐 것)
    "my-requests": latest((requests ?? []).filter((r) => r.requesterId === userId && r.updatedAt - r.createdAt > 5_000).map((r) => r.updatedAt)),
    // 최종 파일 보관함: 새로 완료된 작업
    files: latest((requests ?? []).filter((r) => r.completedAt).map((r) => r.completedAt!)),
    share: latest((share ?? []).filter((s) => s.authorId !== userId).map((s) => s.createdAt)),
    library: latest((library ?? []).filter((l) => l.uploaderId !== userId).map((l) => l.createdAt)),
    feedback: latest((suggestions ?? []).filter((x) => x.authorId !== userId).map((x) => x.createdAt)),
    notifications: latest(notifications.filter((n) => !n.read).map((n) => n.createdAt)),
  }
  const now = Date.now()
  const fresh = new Set<string>()
  for (const id of TRACKED) if (id !== activeId && newest[id] > Math.max(seen[id], now - DAY)) fresh.add(id)
  if (seenVersion !== APP_VERSION) fresh.add("version")
  return fresh
}

export function AppSidebar({
  session,
  activeId,
  onNavigate,
  onSessionChange,
  onLogout,
  onSwitched,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  session: Session
  activeId: string
  onNavigate: (id: string) => void
  onSessionChange: (session: Session) => void
  onLogout: () => void
  onSwitched: OnSwitched
}) {
  const fresh = useFreshMenus(session, activeId)
  // "디자인 요청"은 메뉴 목록 대신 로고 아래 큰 버튼으로 둔다(작업자는 대신 작성)
  const requestButton = true

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* 로고: 누르면 홈. 마우스를 올려도 배경·툴팁은 없다 */}
            <SidebarMenuButton
              size="lg"
              aria-label="홈"
              className="hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
              onClick={() => onNavigate("home")}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <FilePlus2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">디자인 요청·작업</span>
                <span className="truncate text-xs">관리 시스템</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {requestButton && (
          <>
            {/* 펼친 메뉴: 큰 버튼 */}
            <Button
              size="xl"
              className="mt-1 w-full group-data-[collapsible=icon]:hidden"
              onClick={() => onNavigate("request")}
            >
              <FilePlus2 data-icon="inline-start" />
              디자인 요청
            </Button>
            {/* 접힌 메뉴: 아래 메뉴 아이콘과 같은 크기·위치의 아이콘 버튼(기본 버튼 색) */}
            <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="디자인 요청"
                  aria-label="디자인 요청"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  onClick={() => onNavigate("request")}
                >
                  <FilePlus2 />
                  <span>디자인 요청</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        )}
      </SidebarHeader>
      <SidebarContent>
        {menuFor(session).map((group) => (
          <SidebarGroup key={group.label} className={group.bottom ? "mt-auto" : undefined}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.filter((item) => !(requestButton && item.id === "request")).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={item.id === activeId}
                      tooltip={item.title}
                      onClick={() => onNavigate(item.id)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {fresh.has(item.id) && (
                      <SidebarMenuBadge className="bg-destructive px-1.5 text-[11px] text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
                        N
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {/* 지원 아래: 서버 D 드라이브 용량(정상훈·슈퍼관리자만) */}
              {group.bottom && <DiskUsage />}
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} onNavigate={onNavigate} onSessionChange={onSessionChange} onLogout={onLogout} onSwitched={onSwitched} />
      </SidebarFooter>
    </Sidebar>
  )
}
