import { useEffect } from "react"
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { AuthImage } from "@/components/requests/file-list"
import { downloadFile, formatBytes } from "@/lib/api"
import type { FileInfo } from "@/lib/requests"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 여러 이미지를 차례로 받는다(한꺼번에 누르면 브라우저가 일부를 막을 수 있어 간격을 둔다)
async function downloadAll(files: FileInfo[]) {
  for (const f of files) {
    await downloadFile(f.id, f.name)
    await sleep(400)
  }
}

// 이미지 슬라이드 보기(모달). 이전·다음 버튼과 키보드 ←/→ 로 넘기고, 슬라이드마다 내려받기 버튼이 있다.
// fullscreen: 화면 전체를 덮고, 이미지는 원래 크기(폭은 화면까지)로 보여 세로로 긴 이미지는 스크롤해서 본다.
export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
  fullscreen = false,
}: {
  fullscreen?: boolean
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
      <DialogContent
        className={
          fullscreen
            ? "flex h-svh max-h-svh w-screen max-w-none flex-col gap-3 rounded-none p-4 sm:max-w-none"
            : "flex max-h-[95svh] flex-col gap-3 p-4 sm:max-w-5xl"
        }
        data-lenis-prevent
        showCloseButton={false}
      >
        {current && (
          <>
            {/* 제목 줄: 파일 이름 · 전체 다운로드(외곽선) · 이 이미지 다운로드 · 닫기 */}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm">{current.name}</DialogTitle>
                <DialogDescription className="text-xs tabular-nums">
                  {i + 1} / {images.length} · {formatBytes(current.size)}
                </DialogDescription>
              </div>
              {images.length > 1 && (
                <Button size="sm" variant="outline" aria-label="전체 다운로드" onClick={() => void downloadAll(images)}>
                  <Download data-icon="inline-start" />
                  <span className="hidden sm:inline">전체 다운로드</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{images.length}</span>
                </Button>
              )}
              <Button size="sm" aria-label="이 이미지 다운로드" onClick={() => downloadFile(current.id, current.name)}>
                <Download data-icon="inline-start" />
                <span className="hidden sm:inline">이 이미지 다운로드</span>
              </Button>
              <DialogClose asChild>
                <Button size="icon-sm" variant="ghost" aria-label="닫기">
                  <X />
                </Button>
              </DialogClose>
            </div>
            <div
              className={`relative min-h-0 flex-1 rounded-lg bg-muted/40 ${fullscreen ? "overflow-auto" : "flex items-center justify-center overflow-hidden"}`}
            >
              <AuthImage
                key={current.id}
                fileId={current.id}
                alt={current.name}
                className={fullscreen ? "mx-auto block h-auto max-w-full" : "max-h-[75svh] w-auto max-w-full object-contain"}
              />
              {images.length > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`${fullscreen ? "fixed left-6" : "absolute left-2"} top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur`}
                    aria-label="이전 이미지"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`${fullscreen ? "fixed right-6" : "absolute right-2"} top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur`}
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
