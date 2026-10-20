import {
  Bell,
  CalendarDays,
  FilePlus2,
  FolderArchive,
  House,
  Inbox,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"

export type MenuItem = { id: string; title: string; icon: LucideIcon }

// 메뉴 구조도 v0.2(Figma) 기준. 지금 계정은 슈퍼관리자뿐이라 모든 메뉴를 보여 준다.
export const MENU_GROUPS: { label: string; items: MenuItem[] }[] = [
  {
    label: "업무",
    items: [
      { id: "home", title: "홈", icon: House },
      { id: "request", title: "디자인 요청", icon: FilePlus2 },
      { id: "inbox", title: "받은 요청함", icon: Inbox },
      { id: "schedule", title: "디자인팀 일정", icon: CalendarDays },
      { id: "files", title: "최종 파일 보관함", icon: FolderArchive },
    ],
  },
  {
    label: "관리",
    items: [
      { id: "team", title: "팀 관리", icon: Users },
      { id: "admin", title: "관리자", icon: Settings },
    ],
  },
  {
    label: "개인",
    items: [
      { id: "notifications", title: "알림함", icon: Bell },
      { id: "me", title: "내 정보", icon: UserRound },
    ],
  },
]
