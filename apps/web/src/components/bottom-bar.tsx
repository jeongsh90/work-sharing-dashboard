import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { useSidebar } from "@/components/ui/sidebar"

// 화면 하단 고정 막대(요청서 보내기, 요청 상세 진행 버튼).
// 페이지 영역은 나타날 때 페이드 효과(transform)가 걸려, 그 안의 fixed 요소는 효과가 끝날 때까지
// 페이지 기준으로 놓였다가 제자리로 튄다. 그래서 문서 맨 바깥(body)에 직접 그린다.
// 왼쪽 끝은 헤더처럼 사이드바 폭(펼침/접힘/모바일)에 맞춘다.
// 막대 높이는 --bottom-bar-h 로 알려 준다(화면에 붙어 다니는 칸이 막대에 가리지 않게 높이에서 뺀다).
export function BottomBar({ children }: { children: React.ReactNode }) {
  const { state, isMobile } = useSidebar()
  // body 에 그려서 사이드바 감싸개의 --sidebar-width 변수를 못 받으므로 같은 값(ui/sidebar.tsx)을 대체값으로 둔다
  const left = isMobile ? "0px" : state === "collapsed" ? "var(--sidebar-width-icon, 3rem)" : "var(--sidebar-width, 16rem)"
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty("--bottom-bar-h", `${el.offsetHeight}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty("--bottom-bar-h")
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      className="fixed right-0 bottom-0 z-20 flex flex-col items-center gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur transition-[left] duration-200 ease-linear"
      style={{ left }}
    >
      {children}
    </div>,
    document.body,
  )
}
