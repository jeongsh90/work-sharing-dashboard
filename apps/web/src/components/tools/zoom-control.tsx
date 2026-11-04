import { useEffect, useRef, useState } from "react"
import { Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"

// 디자인 툴 미리보기 보기 배율: 처음 70%, − / + 로 40% ~ 100%(10% 단위). 가운데 숫자를 누르면 칸 너비에 맞춤(zoom = null)
export const DEFAULT_ZOOM = 0.7
export const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

export function ZoomControl({ zoom, scale, onZoom, className = "absolute top-2 right-2 z-10" }: { zoom: number | null; scale: number; onZoom: (z: number | null) => void; className?: string }) {
  const smaller = [...ZOOMS].reverse().find((z) => z < scale - 0.001)
  const bigger = ZOOMS.find((z) => z > scale + 0.001)
  return (
    <div className={`${className} flex items-center gap-0.5 rounded-full border bg-background/90 p-0.5 shadow-md backdrop-blur`} role="group" aria-label="보기 배율">
      <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="작게 보기" disabled={!smaller} onClick={() => smaller && onZoom(smaller)}>
        <Minus />
      </Button>
      <button
        type="button"
        className="min-w-12 rounded-full px-1 text-xs font-medium tabular-nums hover:bg-accent"
        title={zoom === null ? "칸 너비에 맞춤" : "누르면 칸 너비에 맞춤"}
        onClick={() => onZoom(null)}
      >
        {Math.round(scale * 100)}%
      </button>
      <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="크게 보기" disabled={!bigger} onClick={() => bigger && onZoom(bigger)}>
        <Plus />
      </Button>
    </div>
  )
}

// 860 폭 미리보기의 배율 상태. boxRef 를 미리보기 칸에 달면 "칸 너비에 맞춤" 배율을 따라 잰다
export function useZoom() {
  const boxRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(DEFAULT_ZOOM)
  const [zoom, setZoom] = useState<number | null>(DEFAULT_ZOOM) // null = 칸 너비에 맞춤
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFit(Math.min(1, el.clientWidth / 860)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { boxRef, zoom, setZoom, scale: zoom ?? fit }
}
