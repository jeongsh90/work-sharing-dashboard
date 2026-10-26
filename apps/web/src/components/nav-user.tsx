import { Bell, LogOut, Settings, UserRound } from "lucide-react"

import { ROLE_LABEL, type Session } from "@/lib/auth"
import { PRESENCE_DOT, PRESENCE_LABEL, savePresence, type Presence } from "@/lib/presence"
import { isDesignWorker } from "@/lib/store"
import { UserAvatar } from "@/components/user-avatar"
import { AccountSwitchItems, useAccountSwitch, type OnSwitched } from "@/components/account-switcher"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

function UserSummary({ session }: { session: Session }) {
  return (
    <>
      <UserAvatar name={session.name} avatarId={session.avatarId} className="h-8 w-8 rounded-lg" fallbackClassName="rounded-lg" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{session.name}</span>
        <span className="truncate text-xs">
          {ROLE_LABEL[session.role]} · {session.id}
        </span>
      </div>
    </>
  )
}

export function NavUser({
  session,
  onNavigate,
  onSessionChange,
  onLogout,
  onSwitched,
}: {
  session: Session
  onNavigate: (id: string) => void
  onSessionChange: (session: Session) => void
  onLogout: () => void
  onSwitched: OnSwitched
}) {
  const { isMobile } = useSidebar()
  // 계정 전환 묶음(서버 SWITCH_ACCOUNTS)에 든 계정이면 메뉴 안에 전환할 계정을 모두 보여 준다.
  const sw = useAccountSwitch(onSwitched)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserSummary session={session} />
              <Settings className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserSummary session={session} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* 작업자는 여기서 바로 현재 상태를 바꾼다(홈 디자인팀 카드에 보임) */}
            {isDesignWorker(session) && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">현재 상태</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={session.presence}
                  onValueChange={async (v) => onSessionChange(await savePresence(v as Presence))}
                >
                  {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      <span className={`size-2 rounded-full ${PRESENCE_DOT[p]}`} aria-hidden />
                      {PRESENCE_LABEL[p]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onNavigate("me")}>
                <UserRound />
                내 정보
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNavigate("notifications")}>
                <Bell />
                알림함
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {sw.accounts.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">계정 전환</DropdownMenuLabel>
                <AccountSwitchItems currentId={session.id} {...sw} />
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
