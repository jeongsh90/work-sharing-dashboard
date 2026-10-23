import { useEffect } from "react"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { AuthImage } from "@/components/requests/file-list"
import { downloadFile, formatBytes } from "@/lib/api"
import type { FileInfo } from "@/lib/requests"

// 이미지 슬라이드 보기(모달). 이전·다음 버튼과 키보드 ←/→ 로 넘기고, 슬라이드마다 내려받기 버튼이 있다.
export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: FileInfo[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const open = index !== null && images.length > 0
  const i = index ?? 0
  const current = images[i]
  const go = (step: number) => onIndex((i + step + images.length) % images.length)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95svh] flex-col gap-3 p-4 sm:max-w-5xl" data-lenis-prevent>
        {current && (
          <>
            <div className="flex items-center gap-3 pr-8">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm">{current.name}</DialogTitle>
                <DialogDescription className="text-xs tabular-nums">
                  {i + 1} / {images.length} · {formatBytes(current.size)}
                </DialogDescription>
              </div>
              <Button size="sm" onClick={() => downloadFile(current.id, current.name)}>
                <Download data-icon="inline-start" />
                다운로드
              </Button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
              <AuthImage key={current.id} fileId={current.id} alt={current.name} className="max-h-[75svh] w-auto max-w-full object-contain" />
              {images.length > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur"
                    aria-label="이전 이미지"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur"
                    aria-label="다음 이미지"
                    onClick={() => go(1)}
                  >
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
            {/* 아래 작은 그림 줄: 눌러서 바로 이동 */}
            {images.length > 1 && (
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {images.map((f, n) => (
                  <li key={f.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => onIndex(n)}
                      aria-label={`${n + 1}번째 이미지 보기`}
                      className={`block size-14 overflow-hidden rounded-md border-2 transition-opacity ${
                        n === i ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      <AuthImage fileId={f.id} alt="" className="size-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
