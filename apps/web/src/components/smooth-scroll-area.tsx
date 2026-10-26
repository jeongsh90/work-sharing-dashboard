import { useRef, type ReactNode } from "react"

import { useSmoothScroll } from "@/lib/smooth-scroll"

// 안쪽에서 따로 스크롤되는 영역도 페이지처럼 부드럽게(Lenis). className 에 높이 제한과 overflow 를 준다.
// 창(Dialog) 안에서도 쓴다: 바깥 페이지 스크롤은 data-lenis-prevent 로 막고, 이 영역은 자기 Lenis 로 움직인다.
export function SmoothScrollArea({
  className,
  contentClassName,
  children,
  orientation = "vertical",
}: {
  className?: string
  contentClassName?: string
  children: ReactNode
  orientation?: "vertical" | "horizontal"
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSmoothScroll({ orientation, gestureOrientation: orientation === "horizontal" ? "both" : "vertical" }, ref)
  return (
    <div ref={ref} className={className} data-lenis-prevent>
      <div className={contentClassName}>{children}</div>
    </div>
  )
}
