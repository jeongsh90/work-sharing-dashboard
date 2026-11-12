import {
  Bell,
  Camera,
  ClipboardCheck,
  StickyNote,
  CalendarDays,
  FilePlus2,
  FileSearch,
  FolderArchive,
  FolderOpen,
  HardDrive,
  House,
  Inbox,
  Library,
  Info,
  LayoutGrid,
  ListChecks,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  Network,
  Server,
  KeyRound,
  ListOrdered,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "./auth"
import { isDesignWorker, useApi } from "./store"

// designTeam: 디자인팀 작업자(작업자 + 디자인팀 관리자)에게만 보인다
export type MenuItem = { id: string; title: string; icon: LucideIcon; roles?: Role[]; designTeam?: boolean }

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
      // 공지사항: 누구나 읽고 관리자가 쓴다
      { id: "notices", title: "공지사항", icon: Megaphone },
      // 디자인 요청: 모든 역할. 작업자는 말·전화 등으로 받은 요청을 대신 작성한다. 화면에서는 사이드메뉴 로고 아래 큰 버튼으로 보인다.
      { id: "request", title: "디자인 요청", icon: FilePlus2 },
      { id: "inbox", title: "받은 요청함", icon: Inbox, roles: TEAM },
      // 내 요청: 요청을 보내는 요청자·관리자만(작업자는 요청을 보내지 않는다)
      { id: "my-requests", title: "내 요청", icon: ListChecks, roles: ["requester", ...MANAGERS] },
      { id: "schedule", title: "디자인팀 일정", icon: CalendarDays },
      { id: "files", title: "최종 파일 보관함", icon: FolderArchive },
      // 파일공유자료실: 누구나 글·파일을 올려 함께 본다
      { id: "share", title: "파일공유자료실", icon: FolderOpen },
      // 사진공부방: 관리자가 날짜별 공지(내용·링크)를 올리면 직원들이 사진과 피드백을 올리고 댓글로 이야기한다
      { id: "photo-study", title: "사진공부방", icon: Camera },
      // 디자인팀 자료실: 작업에 쓰는 자료(PSD·AI·FIG 등)를 올려 두고 함께 쓴다. 작업자·관리자
      { id: "library", title: "디자인팀 자료실", icon: Library, roles: TEAM },
      // FTP: 슈퍼관리자가 등록한 FTP(카페24 등)를 사이트 안에서 보고 올리고 받는다
      { id: "ftp", title: "FTP", icon: HardDrive, roles: TEAM },
      { id: "org", title: "조직도", icon: Network },
      // 디자인 툴: 요청자·작업자·관리자 모두
      { id: "tools", title: "디자인 툴", icon: LayoutGrid },
    ],
  },
  {
    label: "관리",
    items: [
      { id: "team", title: "팀 관리", icon: Users, roles: MANAGERS },
      // 사내망 직통(슈퍼관리자): 같은 사무실 PC 의 IP 를 등록해 파일을 서버로 바로 주고받게 한다
      { id: "lan", title: "사내망 직통", icon: Zap, roles: ["superadmin"] },
      { id: "ftp-servers", title: "FTP 서버", icon: Server, roles: ["superadmin"] },
      // 계정 정보(슈퍼관리자): 외부 서비스 계정 모음. 비밀번호는 서버에 암호화
      { id: "accounts", title: "계정 정보", icon: KeyRound, roles: ["superadmin"] },
      // 구글 색인 보고서(슈퍼관리자): 서치콘솔 색인 요청 보고서를 날짜별로 올려 두고 본다
      { id: "index-reports", title: "구글 색인 보고서", icon: FileSearch, roles: ["superadmin"] },
    ],
  },
  {
    label: "개인",
    items: [
      { id: "notifications", title: "알림함", icon: Bell },
      // 체크리스트: 계정마다 자기 것만(모든 역할)
      { id: "checklist", title: "체크리스트", icon: ClipboardCheck },
      // 메모: 계정마다 자기 것만(모든 역할). 왼쪽 작성 · 오른쪽 목록
      { id: "memo", title: "메모", icon: StickyNote },
      // 업무일지: 디자인팀 작업자(작업자 + 정상훈 등 디자인팀 관리자)
      { id: "worklog", title: "업무일지", icon: NotebookPen, designTeam: true },
      // 메뉴 관리: 내 메뉴 순서·버튼·버튼 색(누구나 자기 것). 메뉴 권한 탭은 슈퍼관리자만
      { id: "menu-settings", title: "메뉴 관리", icon: ListOrdered },
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

// ── 메뉴 관리(개인 → 메뉴 관리) ──
// 메뉴 권한(서버 /menu-settings, 슈퍼관리자가 정해 모두에게 적용): 메뉴 id → 보이는 역할.
//   기본으로 허용된 역할 안에서만 줄일 수 있다(서버 API 도 같은 역할만 받으므로).
export type MenuSettings = { roles: Record<string, Role[]>; updatedBy: string | null; updatedAt: number | null }
// 내 메뉴(서버 /menu-prefs, 계정마다 자기 것)
//   order: 묶음 이름 → 메뉴 id 순서. 없는 메뉴(새 메뉴)는 그 묶음 끝에 붙는다.
//   buttons: 사이드메뉴 맨 위(로고 아래)에 큰 버튼으로 둘 메뉴. 버튼이 된 메뉴는 목록에서 빠진다. 정하지 않았으면 디자인 요청 하나.
//   colors: 버튼 색(BUTTON_COLORS 의 key). 없으면 기본(primary)
export type MenuPrefs = { order: Record<string, string[]>; buttons: string[] | null; colors: Record<string, string>; updatedAt: number | null; sharedOrder?: boolean }

export const ALL_ROLES: Role[] = ["superadmin", "admin", "designer", "requester"]
export const DEFAULT_BUTTONS = ["request"]
// 권한을 바꾸지 않는 묶음·메뉴: 개인 묶음(각자 자기 것), 홈(갈 곳이 없을 때 돌아가는 곳)
export const PERSONAL_GROUP = "개인"
export const LOCKED_ROLE_MENUS = ["home", "menu-settings"]
// 버튼으로 둘 수 없는 메뉴: 홈은 로고가 버튼이다
export const NO_BUTTON_MENUS = ["home"]

// 버튼 색: button 은 펼친 메뉴 큰 버튼, icon 은 접힌 메뉴 아이콘 버튼, swatch 는 고르는 칸
export const BUTTON_COLORS: { key: string; label: string; button: string; swatch: string }[] = [
  { key: "default", label: "기본", button: "", swatch: "bg-primary" },
  { key: "blue", label: "파랑", button: "bg-blue-600 text-white hover:bg-blue-600/90 hover:text-white active:bg-blue-600/90 active:text-white", swatch: "bg-blue-600" },
  { key: "sky", label: "하늘", button: "bg-sky-500 text-white hover:bg-sky-500/90 hover:text-white active:bg-sky-500/90 active:text-white", swatch: "bg-sky-500" },
  { key: "emerald", label: "초록", button: "bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white active:bg-emerald-600/90 active:text-white", swatch: "bg-emerald-600" },
  { key: "amber", label: "노랑", button: "bg-amber-500 text-black hover:bg-amber-500/90 hover:text-black active:bg-amber-500/90 active:text-black", swatch: "bg-amber-500" },
  { key: "orange", label: "주황", button: "bg-orange-500 text-white hover:bg-orange-500/90 hover:text-white active:bg-orange-500/90 active:text-white", swatch: "bg-orange-500" },
  { key: "rose", label: "빨강", button: "bg-rose-600 text-white hover:bg-rose-600/90 hover:text-white active:bg-rose-600/90 active:text-white", swatch: "bg-rose-600" },
  { key: "pink", label: "분홍", button: "bg-pink-500 text-white hover:bg-pink-500/90 hover:text-white active:bg-pink-500/90 active:text-white", swatch: "bg-pink-500" },
  { key: "violet", label: "보라", button: "bg-violet-600 text-white hover:bg-violet-600/90 hover:text-white active:bg-violet-600/90 active:text-white", swatch: "bg-violet-600" },
  { key: "slate", label: "회색", button: "bg-slate-600 text-white hover:bg-slate-600/90 hover:text-white active:bg-slate-600/90 active:text-white", swatch: "bg-slate-600" },
  { key: "outline", label: "테두리", button: "border border-sidebar-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent", swatch: "border-2 border-foreground/40 bg-background" },
]
export const buttonColor = (key?: string) => BUTTON_COLORS.find((c) => c.key === key) ?? BUTTON_COLORS[0]

export const defaultRoles = (i: MenuItem): Role[] => i.roles ?? ALL_ROLES
export const canSetRoles = (group: string, id: string) => group !== PERSONAL_GROUP && !LOCKED_ROLE_MENUS.includes(id)

// 내 순서대로 묶음 안 메뉴를 늘어놓는다
export function orderedGroups(prefs?: Pick<MenuPrefs, "order"> | null) {
  return MENU_GROUPS.map((g) => {
    const saved = prefs?.order[g.label] ?? []
    const rank = (id: string) => {
      const i = saved.indexOf(id)
      return i < 0 ? saved.length + g.items.findIndex((x) => x.id === id) : i
    }
    return { ...g, items: [...g.items].sort((a, b) => rank(a.id) - rank(b.id)) }
  })
}

// 이 메뉴가 보이는 역할(권한 설정 적용)
export function rolesOf(group: string, item: MenuItem, settings?: Pick<MenuSettings, "roles"> | null): Role[] {
  const base = defaultRoles(item)
  const saved = canSetRoles(group, item.id) ? settings?.roles[item.id] : undefined
  return saved ? base.filter((r) => saved.includes(r)) : base
}

// hidden: 계정별 권한으로 막힌 메뉴(예: 사진공부방 접근 권한이 없으면 photo-study)
export function menuFor(user: { role: Role; department: string }, settings?: Pick<MenuSettings, "roles"> | null, prefs?: Pick<MenuPrefs, "order"> | null, hidden: string[] = []) {
  const visible = (group: string, i: MenuItem) =>
    !hidden.includes(i.id) && rolesOf(group, i, settings).includes(user.role) && (!i.designTeam || isDesignWorker(user))
  return orderedGroups(prefs)
    .map((g) => ({ ...g, items: g.items.filter((i) => visible(g.label, i)) }))
    .filter((g) => g.items.length > 0)
}

// 맨 위 버튼으로 둘 메뉴 id
export function buttonIds(prefs?: Pick<MenuPrefs, "buttons"> | null) {
  return new Set((prefs?.buttons ?? DEFAULT_BUTTONS).filter((id) => !NO_BUTTON_MENUS.includes(id)))
}

// 메뉴에 없는 화면의 제목
export const PAGE_TITLES: Record<string, string> = {
  ...Object.fromEntries(MENU_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.title])),
  "request-detail": "요청 상세",
  "notice-detail": "공지사항",
  "notice-edit": "공지사항 작성",
}

// 메뉴 권한(사이드메뉴·주소 막기에 함께 쓴다)과 내 메뉴. 받기 전에는 기본 메뉴
export const useMenuSettings = (enabled = true) => useApi<MenuSettings>(enabled ? "/menu-settings" : null, 60_000).data
export const useMenuPrefs = (enabled = true) => useApi<MenuPrefs>(enabled ? "/menu-prefs" : null, 300_000).data

// 계정별 권한으로 막힌 메뉴: 사진공부방 접근 권한(메뉴 관리 → 메뉴 권한에서 계정을 고른다)
export function useHiddenMenus(enabled = true) {
  const photo = useApi<{ member: boolean }>(enabled ? "/photo-study/access" : null, 60_000).data
  return photo?.member === false ? ["photo-study"] : []
}
