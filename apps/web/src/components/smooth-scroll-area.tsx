import { useRef, type ReactNode } from "react"

import { useSmoothScroll } from "@/lib/smooth-scroll"

// 안쪽에서 따로 스크롤되는 영역도 페이지처럼 부드럽게(Lenis). className 에 높이 제한과 overflow 를 준다.
// 끝까지 스크롤하면 바깥 스크롤(페이지·창)이 이어서 움직인다(바깥 Lenis 의 allowNestedScroll). 창 자체는 DialogContent 의 data-lenis-prevent 로 뒤 페이지와 나눈다.
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
    <div ref={ref} className={className}>
      <div className={contentClassName}>{children}</div>
    </div>
  )
}
