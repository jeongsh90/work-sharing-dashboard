import { FilePlus2 } from "lucide-react"

import type { Session } from "@/lib/auth"
import { menuFor } from "@/lib/menu"
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

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
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => onNavigate("home")} tooltip="홈">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <FilePlus2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">디자인 요청·일정</span>
                <span className="truncate text-xs">관리 시스템</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {menuFor(session.role).map((group) => (
          <SidebarGroup key={group.label}>
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
