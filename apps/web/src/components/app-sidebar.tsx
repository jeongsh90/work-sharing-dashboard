import { FilePlus2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { Session } from "@/lib/auth"
import { menuFor } from "@/lib/menu"
import { useSeen } from "@/lib/seen"
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

// 메뉴 N 표시: 건의게시판에 다른 사람의 새 글이 있거나, 아직 보지 않은 새 버전이 있으면
function useFreshMenus(userId: string) {
  const { data } = useApi<{ id: number; authorId: string }[]>("/suggestions", 60_000)
  const seenFeedback = Number(useSeen(userId, "feedback") ?? 0)
  const seenVersion = useSeen(userId, "version")
  const fresh = new Set<string>()
  if (data?.some((s) => s.authorId !== userId && s.id > seenFeedback)) fresh.add("feedback")
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
  const fresh = useFreshMenus(session.id)
  // 요청자·관리자: "디자인 요청"은 메뉴 목록 대신 로고 아래 큰 버튼으로 둔다(작업자는 메뉴 그대로)
  const requestButton = session.role === "requester" || session.role === "admin" || session.role === "superadmin"

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
          <Button
            size="xl"
            className="mt-1 w-full group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
            aria-label="디자인 요청"
            onClick={() => onNavigate("request")}
          >
            <FilePlus2 data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">디자인 요청</span>
          </Button>
        )}
      </SidebarHeader>
      <SidebarContent>
        {menuFor(session.role).map((group) => (
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
