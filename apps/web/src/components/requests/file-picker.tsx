import { useEffect, useId, useRef, useState } from "react"
import { FileText, Paperclip, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/api"

// 파일 고르기: 끌어 놓거나 눌러서 고른다. 고른 파일은 보내기 버튼을 누를 때 uploadAll(lib/api)로 올린다.
export function FilePicker({
  files,
  onChange,
  accept,
  hint,
  invalid,
}: {
  files: File[]
  onChange: (files: File[]) => void
  accept?: string // 예: "image/*"
  hint?: string
  invalid?: boolean
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const add = (list: FileList | null) => {
    if (!list) return
    const picked = Array.from(list).filter((f) => !accept?.startsWith("image") || f.type.startsWith("image/"))
    onChange([...files, ...picked])
  }

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
        <span>파일을 끌어 놓거나 눌러서 고르세요</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
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
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {files.map((file, i) => (
            <PickedFile key={`${file.name}-${i}`} file={file} onRemove={() => onChange(files.filter((_, j) => j !== i))} />
          ))}
        </ul>
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
