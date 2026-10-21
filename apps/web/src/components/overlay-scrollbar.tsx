import { useEffect, useRef, useState } from "react"
import { cn } from "cn"

// 기본 스크롤바 대신 쓰는 겹침 스크롤바.
// 처음에는 보이지 않고, 스크롤하면 서서히 나타났다가 스크롤이 멈추고 2초 뒤 서서히 사라진다.
// 막대를 끌어서 스크롤할 수도 있다. 위치와 크기는 className(absolute/fixed 와 크기)으로 정한다.
const HIDE_AFTER_MS = 2000
const MIN_THUMB = 24

type Target = HTMLElement | Window

export function OverlayScrollbar({
  target,
  orientation = "vertical",
  className,
}: {
  target: () => Target | null | undefined
  orientation?: "vertical" | "horizontal"
  className?: string
}) {
  const vertical = orientation === "vertical"
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = target()
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!el || !track || !thumb) return
    const isWindow = el === window
    const node = isWindow ? document.documentElement : (el as HTMLElement)

    const metrics = () =>
      vertical
        ? { pos: isWindow ? window.scrollY : node.scrollTop, size: isWindow ? window.innerHeight : node.clientHeight, total: node.scrollHeight }
        : { pos: isWindow ? window.scrollX : node.scrollLeft, size: isWindow ? window.innerWidth : node.clientWidth, total: node.scrollWidth }
    const trackLength = () => (vertical ? track.clientHeight : track.clientWidth)

    const update = () => {
      const { pos, size, total } = metrics()
      const can = total > size + 1
      setScrollable(can)
      if (!can) return
      const length = trackLength()
      const thumbLength = Math.max(MIN_THUMB, (length * size) / total)
      const offset = ((length - thumbLength) * pos) / (total - size)
      thumb.style[vertical ? "height" : "width"] = `${thumbLength}px`
      thumb.style.transform = vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const reveal = () => {
      setVisible(true)
      clearTimeout(timer)
      timer = setTimeout(() => setVisible(false), HIDE_AFTER_MS)
    }
    const onScroll = () => {
      update()
      reveal()
    }

    // 막대 끌기
    let drag: { start: number; startPos: number } | null = null
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault()
      thumb.setPointerCapture(e.pointerId)
      drag = { start: vertical ? e.clientY : e.clientX, startPos: metrics().pos }
      reveal()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return
      const { size, total } = metrics()
      const length = trackLength()
      const thumbLength = Math.max(MIN_THUMB, (length * size) / total)
      const moved = (vertical ? e.clientY : e.clientX) - drag.start
      const next = drag.startPos + (moved * (total - size)) / Math.max(1, length - thumbLength)
      el.scrollTo(vertical ? { top: next } : { left: next })
      reveal()
    }
    const onPointerUp = () => {
      drag = null
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", update)
    thumb.addEventListener("pointerdown", onPointerDown)
    thumb.addEventListener("pointermove", onPointerMove)
    thumb.addEventListener("pointerup", onPointerUp)
    const resize = new ResizeObserver(update)
    resize.observe(isWindow ? document.body : node)
    if (!isWindow && node.firstElementChild) resize.observe(node.firstElementChild)
    update()

    return () => {
      clearTimeout(timer)
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", update)
      thumb.removeEventListener("pointerdown", onPointerDown)
      thumb.removeEventListener("pointermove", onPointerMove)
      thumb.removeEventListener("pointerup", onPointerUp)
      resize.disconnect()
    }
    // 대상과 방향은 처음 한 번만 정한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={trackRef}
      aria-hidden
      data-slot="overlay-scrollbar"
      className={cn(
        "pointer-events-none z-30 transition-opacity duration-300 ease-out",
        visible && scrollable ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <div
        ref={thumbRef}
        className={cn(
          "rounded-full bg-foreground/30 hover:bg-foreground/50",
          vertical ? "w-full" : "h-full",
          visible && scrollable ? "pointer-events-auto" : "pointer-events-none",
        )}
      />
    </div>
  )
}
