import {
  Bell,
  CalendarDays,
  FilePlus2,
  FolderArchive,
  House,
  Inbox,
  Info,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Network,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "./auth"

export type MenuItem = { id: string; title: string; icon: LucideIcon; roles?: Role[] }

const MANAGERS: Role[] = ["superadmin", "admin"]
const TEAM: Role[] = [...MANAGERS, "designer"]

// 메뉴 구조도 v0.2(Figma) 기준. roles 가 없으면 모든 역할에 보인다.
// 홈은 관리자·작업자·요청자 모두 같은 화면이다.
// bottom: 사이드메뉴 맨 아래에 붙는 묶음
export const MENU_GROUPS: { label: string; items: MenuItem[]; bottom?: boolean }[] = [
  {
    label: "업무",
    items: [
      { id: "home", title: "홈", icon: House },
      // 디자인 요청: 요청자·관리자만(작업자 화면에는 없다). 화면에서는 사이드메뉴 로고 아래 큰 버튼으로 보인다.
      { id: "request", title: "디자인 요청", icon: FilePlus2, roles: ["requester", ...MANAGERS] },
      { id: "inbox", title: "받은 요청함", icon: Inbox, roles: TEAM },
      // 내 요청: 요청을 보내는 요청자·관리자만(작업자는 요청을 보내지 않는다)
      { id: "my-requests", title: "내 요청", icon: ListChecks, roles: ["requester", ...MANAGERS] },
      { id: "schedule", title: "디자인팀 일정", icon: CalendarDays },
      { id: "files", title: "최종 파일 보관함", icon: FolderArchive },
      { id: "org", title: "조직도", icon: Network },
      // 디자인팀 작업 도구 모음(디자인팀·관리자)
      { id: "tools", title: "디자인 툴", icon: LayoutGrid, roles: TEAM },
    ],
  },
  {
    label: "관리",
    items: [{ id: "team", title: "팀 관리", icon: Users, roles: MANAGERS }],
  },
  {
    label: "개인",
    items: [
      { id: "notifications", title: "알림함", icon: Bell },
      { id: "me", title: "내 정보", icon: UserRound },
    ],
  },
  {
    label: "지원",
    bottom: true,
    items: [
      { id: "feedback", title: "건의게시판", icon: MessageSquareText },
      { id: "version", title: "버전 정보", icon: Info },
    ],
  },
]

export function menuFor(role: Role) {
  return MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter(
    (g) => g.items.length > 0,
  )
}

// 메뉴에 없는 화면의 제목
export const PAGE_TITLES: Record<string, string> = {
  ...Object.fromEntries(MENU_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.title])),
  "request-detail": "요청 상세",
}
