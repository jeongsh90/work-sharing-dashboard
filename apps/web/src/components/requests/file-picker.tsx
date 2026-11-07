import { useEffect, useId, useRef, useState } from "react"
import { FileText, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/api"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"

// 파일 고르기: 끌어 놓거나 눌러서 고른다. 고른 파일은 보내기 버튼을 누를 때 uploadAll(lib/api)로 올린다.
export function FilePicker({
  files,
  onChange,
  accept,
  hint,
  invalid,
  paste = false,
}: {
  files: File[]
  onChange: (files: File[]) => void
  accept?: string // 예: "image/*"
  hint?: string
  invalid?: boolean
  paste?: boolean // 켜면 이 화면 어디서든 Ctrl+V 로 클립보드의 이미지·파일을 붙인다
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [pasted, setPasted] = useState(0) // 방금 붙여 넣은 개수(잠깐 알림)

  const add = (list: FileList | File[] | null) => {
    if (!list) return
    const picked = Array.from(list).filter((f) => !accept?.startsWith("image") || f.type.startsWith("image/"))
    onChange([...files, ...picked])
    return picked.length
  }

  // 클립보드 붙여넣기: 파일(캡처·복사한 이미지, 탐색기에서 복사한 파일)이 있으면 첨부로 넣는다.
  // 글자도 함께 있으면(입력 칸에 글을 붙이는 경우) 글 붙여넣기는 그대로 두고 파일만 더한다.
  const latest = useRef({ files, add })
  latest.current = { files, add }
  useEffect(() => {
    if (!paste) return
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData
      if (!data) return
      const list = Array.from(data.files)
      if (list.length === 0) return
      const stamp = new Date()
      const pad = (n: number) => String(n).padStart(2, "0")
      const base = `붙여넣은 이미지_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
      // 캡처 이미지는 이름이 "image.png" 로 와서 겹치므로 시각 + 번호로 이름을 붙인다(같은 초에 여러 번 붙여도 안 겹치게)
      const taken = new Set(latest.current.files.map((f) => f.name))
      const named = list.map((f) => {
        if (!/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) && f.name) return f
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg")
        let name = `${base}.${ext}`
        for (let k = 2; taken.has(name); k++) name = `${base}_${k}.${ext}`
        taken.add(name)
        return new File([f], name, { type: f.type, lastModified: f.lastModified })
      })
      if (!data.types.includes("text/plain")) e.preventDefault()
      const n = latest.current.add(named) ?? 0
      if (n > 0) {
        setPasted(n)
        setTimeout(() => setPasted(0), 2500)
      }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [paste])

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50 ${
          over ? "border-primary bg-muted/50" : invalid ? "border-destructive" : ""
        }`}
      >
        <Paperclip className="size-4 text-muted-foreground" aria-hidden />
        <span>{paste ? "파일을 끌어 놓거나 눌러서 고르세요 · 복사한 이미지는 Ctrl+V" : "파일을 끌어 놓거나 눌러서 고르세요"}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {pasted > 0 && (
          <span className="text-xs font-medium text-primary" role="status">
            붙여 넣은 파일 {pasted}개를 첨부했습니다
          </span>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ""
          }}
        />
      </label>
      {files.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground tabular-nums">선택한 파일 {files.length}개</p>
          {/* 최대 6개(넓은 화면 2열 × 3줄, 좁은 화면 1열 × 6줄)까지 보이고 나머지는 이 안에서 스크롤 */}
          <SmoothScrollArea className="max-h-[388px] overflow-y-auto pr-1 sm:max-h-[190px]">
          <ul className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2">
            {files.map((file, i) => (
              <PickedFile key={`${file.name}-${i}`} file={file} onRemove={() => onChange(files.filter((_, j) => j !== i))} />
            ))}
          </ul>
          </SmoothScrollArea>
        </>
      )}
    </div>
  )
}

function PickedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  // 미리 보기 주소는 그릴 때마다 새로 만들고 지운다(개발 모드에서 두 번 붙었다 떨어져도 깨지지 않게).
  const isImage = file.type.startsWith("image/")
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const url = URL.createObjectURL(file)
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
      {isImage ? (
        <img ref={imgRef} alt="" className="size-10 shrink-0 rounded object-cover" />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${file.name} 빼기`} onClick={onRemove}>
        <X />
      </Button>
    </li>
  )
}
