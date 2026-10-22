import { FilePlus2 } from "lucide-react"

import type { Session } from "@/lib/auth"
import { menuFor } from "@/lib/menu"
import { useSeen } from "@/lib/seen"
import { useApi } from "@/lib/store"
import { APP_VERSION } from "@/lib/version"
import { NavUser } from "@/components/nav-user"
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
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  session: Session
  activeId: string
  onNavigate: (id: string) => void
  onSessionChange: (session: Session) => void
  onLogout: () => void
}) {
  const fresh = useFreshMenus(session.id)

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
      </SidebarHeader>
      <SidebarContent>
        {menuFor(session.role).map((group) => (
          <SidebarGroup key={group.label} className={group.bottom ? "mt-auto" : undefined}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} onNavigate={onNavigate} onSessionChange={onSessionChange} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  )
}
