import { useEffect, useRef } from "react"

import { cn } from "cn"

// 파티클 배경: 작은 점들이 천천히 떠다니고, 마우스 쪽으로 살짝 끌린다(Magic UI Particles 와 같은 동작).
// 부모 크기를 꽉 채운다. color 는 점 색(CSS 색), quantity 는 점 개수.
// 움직임 줄이기 설정이면 점을 한 번만 그리고 움직이지 않는다.
type Particle = {
  x: number
  y: number
  dx: number
  dy: number
  size: number
  alpha: number
  targetAlpha: number
  magnetism: number
  offsetX: number
  offsetY: number
}

export function Particles({
  className,
  quantity = 120,
  color = "#ffffff",
  size = 0.5,
  staticity = 50,
  ease = 50,
}: {
  className?: string
  quantity?: number
  color?: string
  size?: number
  staticity?: number // 클수록 마우스에 덜 끌린다
  ease?: number // 클수록 천천히 따라간다
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!wrap || !canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    let width = 0
    let height = 0
    let particles: Particle[] = []
    const mouse = { x: 0, y: 0 }
    let frame = 0

    const make = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      dx: (Math.random() - 0.5) * 0.2,
      dy: (Math.random() - 0.5) * 0.2,
      size: Math.random() * 2 + size,
      alpha: 0,
      targetAlpha: Math.random() * 0.6 + 0.1,
      magnetism: 0.1 + Math.random() * 4,
      offsetX: 0,
      offsetY: 0,
    })

    const resize = () => {
      width = wrap.offsetWidth
      height = wrap.offsetHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = Array.from({ length: quantity }, make)
    }

    const draw = (p: Particle) => {
      ctx.beginPath()
      ctx.arc(p.x + p.offsetX, p.y + p.offsetY, p.size, 0, 2 * Math.PI)
      ctx.globalAlpha = p.alpha
      ctx.fill()
    }

    const tick = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = color
      particles = particles.map((p) => {
        // 가장자리에 가까울수록 흐려진다
        const edge = Math.min(p.x + p.offsetX - p.size, width - p.x - p.offsetX - p.size, p.y + p.offsetY - p.size, height - p.y - p.offsetY - p.size)
        const fade = Math.max(0, Math.min(1, edge / 20))
        p.alpha = fade < 1 ? p.targetAlpha * fade : Math.min(p.targetAlpha, p.alpha + 0.02)
        p.x += p.dx
        p.y += p.dy
        p.offsetX += (mouse.x / (staticity / p.magnetism) - p.offsetX) / ease
        p.offsetY += (mouse.y / (staticity / p.magnetism) - p.offsetY) / ease
        const out = p.x < -p.size || p.x > width + p.size || p.y < -p.size || p.y > height + p.size
        if (!out) draw(p)
        return out ? make() : p
      })
      frame = requestAnimationFrame(tick)
    }

    // 마우스 위치: 캔버스 가운데 기준
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left - width / 2
      const y = e.clientY - rect.top - height / 2
      if (Math.abs(x) < width / 2 && Math.abs(y) < height / 2) {
        mouse.x = x
        mouse.y = y
      }
    }

    resize()
    if (still) {
      ctx.fillStyle = color
      particles.forEach((p) => {
        p.alpha = p.targetAlpha
        draw(p)
      })
    } else {
      frame = requestAnimationFrame(tick)
      window.addEventListener("pointermove", onMove)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("pointermove", onMove)
    }
  }, [quantity, color, size, staticity, ease])

  return (
    <div ref={wrapRef} className={cn("pointer-events-none", className)} aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  )
}
