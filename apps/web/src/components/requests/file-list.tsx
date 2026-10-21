import { Download, FileText, ImageOff, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { downloadFile, formatBytes, useFileUrl } from "@/lib/api"
import type { FileInfo } from "@/lib/requests"

// 로그인이 필요한 서버 이미지를 보여 준다.
export function AuthImage({
  fileId,
  alt,
  className,
  onLoad,
}: {
  fileId: string
  alt: string
  className?: string
  onLoad?: () => void
}) {
  const { url, error } = useFileUrl(fileId)
  if (error) {
    return (
      <div className={`flex items-center justify-center gap-2 bg-muted p-6 text-sm text-muted-foreground ${className ?? ""}`}>
        <ImageOff className="size-4" aria-hidden />
        이미지를 불러오지 못했습니다.
      </div>
    )
  }
  if (!url) {
    return (
      <div className={`flex min-h-40 items-center justify-center bg-muted ${className ?? ""}`}>
        <LoaderCircle className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="불러오는 중" />
      </div>
    )
  }
  return <img src={url} alt={alt} className={className} onLoad={onLoad} draggable={false} />
}

// 파일 이름과 내려받기 버튼
export function FileChip({ file }: { file: FileInfo }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="max-w-full"
      onClick={() => downloadFile(file.id, file.name)}
      title={`${file.name} 내려받기`}
    >
      <FileText data-icon="inline-start" />
      <span className="truncate">{file.name}</span>
      <span className="text-muted-foreground">{formatBytes(file.size)}</span>
      <Download data-icon="inline-end" />
    </Button>
  )
}

// 이미지는 작은 그림으로, 나머지는 이름으로 보여 준다.
export function FileGallery({ files, empty }: { files: FileInfo[]; empty?: string }) {
  if (files.length === 0) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null
  const images = files.filter((f) => f.mime.startsWith("image/"))
  const others = files.filter((f) => !f.mime.startsWith("image/"))
  return (
    <div className="flex flex-col gap-3">
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="block w-full overflow-hidden rounded-lg border"
                onClick={() => downloadFile(f.id, f.name)}
                title={`${f.name} 내려받기`}
              >
                <AuthImage fileId={f.id} alt={f.name} className="aspect-square w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {others.map((f) => (
            <li key={f.id} className="max-w-full">
              <FileChip file={f} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
