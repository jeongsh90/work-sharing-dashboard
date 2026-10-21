import { HeaderActions } from "@/components/header-actions"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

// 화면 위에 고정(position: fixed)된 헤더.
// fixed 는 문서 흐름에서 빠지므로 왼쪽 위치를 사이드바 폭(펼침/접힘/모바일)에 맞추고,
// 헤더 높이만큼 빈 자리를 남겨 아래 내용이 가려지지 않게 한다.
export function AppHeader({
  title,
  titleClassName,
  onOpenNotifications,
}: {
  title: string
  titleClassName?: string
  onOpenNotifications: () => void
}) {
  const { state, isMobile } = useSidebar()
  const left = isMobile ? "0px" : state === "collapsed" ? "var(--sidebar-width-icon)" : "var(--sidebar-width)"

  return (
    <>
      <header
        className="fixed top-0 right-0 z-20 flex h-16 items-center gap-2 border-b bg-background px-4 transition-[left] duration-200 ease-linear"
        style={{ left }}
      >
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
        {/* key: 제목이 바뀔 때마다 새로 그려 페이드 효과가 다시 돈다 */}
        <h1 key={title} className={`text-sm font-medium ${titleClassName ?? ""}`}>
          {title}
        </h1>
        <HeaderActions onOpenNotifications={onOpenNotifications} />
      </header>
      <div className="h-16 shrink-0" aria-hidden />
    </>
  )
}
