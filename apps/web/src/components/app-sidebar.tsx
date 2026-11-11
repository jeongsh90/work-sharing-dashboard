import { useEffect, useState } from "react"
import { ChevronDown, FilePlus2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { isManager, type Session } from "@/lib/auth"
import { buttonIds, menuFor, useMenuSettings } from "@/lib/menu"
import type { NoticeSummary } from "@/lib/notices"
import { useNotifications } from "@/lib/notifications"
import { isRequesterOf, type RequestSummaryDto } from "@/lib/requests"
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
  useSidebar,
} from "@/components/ui/sidebar"

const CLOSED_KEY = "wsd:sidebar-closed-groups"

// 메뉴 N 표시: 다른 사람이 새로 올린 내용이 있으면 하루 동안 N 을 띄운다. 그 메뉴를 열어 보면 꺼진다.
// (버전 정보는 아직 보지 않은 새 버전이 있으면)
const DAY = 24 * 60 * 60 * 1000
const TRACKED = ["notices", "inbox", "my-requests", "files", "share", "library", "feedback", "notifications", "index-reports"] as const

function useFreshMenus(session: Session, activeId: string) {
  const userId = session.id
  const team = isManager(session) || session.role === "designer"
  const { data: requests } = useApi<RequestSummaryDto[]>("/requests")
  const { data: suggestions } = useApi<{ authorId: string; createdAt: number }[]>("/suggestions", 60_000)
  const { data: notices } = useApi<NoticeSummary[]>("/notices", 60_000)
  const { data: library } = useApi<{ uploaderId: string; createdAt: number }[]>(team ? "/library" : null, 60_000)
  const { data: share } = useApi<{ authorId: string; createdAt: number }[]>("/share", 60_000)
  // 구글 색인 보고서(슈퍼관리자): 새로 올리거나 바뀐 보고서
  const { data: indexReports } = useApi<{ updatedAt: number }[]>(session.role === "superadmin" ? "/index-reports" : null, 60_000)
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
  const mineReq = (r: RequestSummaryDto) => isRequesterOf(r, userId) || r.createdBy === userId
  const newest: Record<(typeof TRACKED)[number], number> = {
    notices: latest((notices ?? []).filter((n) => n.authorId !== userId && !n.read).map((n) => n.createdAt)),
    // 받은 요청함: 다른 사람이 새로 보낸 요청
    inbox: latest((requests ?? []).filter((r) => !mineReq(r)).map((r) => r.createdAt)),
    // 내 요청: 내 요청에 생긴 변화(보낸 뒤 상태가 바뀐 것)
    "my-requests": latest((requests ?? []).filter((r) => isRequesterOf(r, userId) && r.updatedAt - r.createdAt > 5_000).map((r) => r.updatedAt)),
    // 최종 파일 보관함: 새로 완료된 작업
    files: latest((requests ?? []).filter((r) => r.completedAt).map((r) => r.completedAt!)),
    share: latest((share ?? []).filter((s) => s.authorId !== userId).map((s) => s.createdAt)),
    library: latest((library ?? []).filter((l) => l.uploaderId !== userId).map((l) => l.createdAt)),
    feedback: latest((suggestions ?? []).filter((x) => x.authorId !== userId).map((x) => x.createdAt)),
    notifications: latest(notifications.filter((n) => !n.read).map((n) => n.createdAt)),
    "index-reports": latest((indexReports ?? []).map((r) => r.updatedAt)),
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
  // 메뉴 관리에서 "버튼"으로 고른 메뉴(기본: 디자인 요청)는 목록 대신 로고 아래 큰 버튼으로 둔다
  const settings = useMenuSettings()
  const groups = menuFor(session, settings)
  const asButton = buttonIds(settings)
  const buttons = groups.flatMap((g) => g.items).filter((i) => asButton.has(i.id))
  // 1차 묶음(업무·관리·개인·지원) 접기: 접어 둔 묶음은 이 브라우저에 기억한다
  const { state } = useSidebar()
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]")
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
    } catch {
      return []
    }
  })
  const toggleGroup = (label: string, open: boolean) =>
    setClosed((prev) => {
      const next = open ? prev.filter((x) => x !== label) : [...new Set([...prev, label])]
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next))
      } catch {
        /* 저장 못 해도 화면은 그대로 */
      }
      return next
    })

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
        {buttons.length > 0 && (
          <>
            {/* 펼친 메뉴: 큰 버튼 */}
            <div className="mt-1 flex flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
              {buttons.map((item) => (
                <div key={item.id} className="relative">
                  <Button size="xl" className="w-full" onClick={() => onNavigate(item.id)}>
                    <item.icon data-icon="inline-start" />
                    {item.title}
                  </Button>
                  {fresh.has(item.id) && (
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-destructive px-1.5 text-[11px] leading-5 font-medium text-white">N</span>
                  )}
                </div>
              ))}
            </div>
            {/* 접힌 메뉴: 아래 메뉴 아이콘과 같은 크기·위치의 아이콘 버튼(기본 버튼 색) */}
            <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
              {buttons.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    aria-label={item.title}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                    onClick={() => onNavigate(item.id)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </>
        )}
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => ({ ...group, items: group.items.filter((item) => !asButton.has(item.id)) })).filter((group) => group.items.length > 0 || group.bottom).map((group) => {
          // 아이콘만 보이게 접힌 사이드메뉴에서는 묶음 제목이 없으므로 늘 펼친다
          const open = state === "collapsed" || !closed.includes(group.label)
          const hasFresh = group.items.some((item) => fresh.has(item.id))
          const hasActive = group.items.some((item) => item.id === activeId)
          return (
          <Collapsible
            key={group.label}
            open={open}
            onOpenChange={(o) => toggleGroup(group.label, o)}
            className={`group/collapsible ${group.bottom ? "mt-auto" : ""}`}
          >
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                {group.label}
                {/* 접힌 묶음 안에 새 글(N)이나 지금 보는 메뉴가 있으면 점으로 알린다 */}
                {!open && (hasFresh || hasActive) && (
                  <span className={`ml-1.5 size-1.5 rounded-full ${hasFresh ? "bg-destructive" : "bg-sidebar-primary"}`} aria-label={hasFresh ? "새 내용 있음" : "보고 있는 메뉴"} />
                )}
                <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
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
              {/* 지원 아래: 서버 D 드라이브 용량(정상훈·슈퍼관리자만) */}
              {group.bottom && <DiskUsage />}
            </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
          </Collapsible>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} onNavigate={onNavigate} onSessionChange={onSessionChange} onLogout={onLogout} onSwitched={onSwitched} />
      </SidebarFooter>
    </Sidebar>
  )
}
