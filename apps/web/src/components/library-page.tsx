import { useMemo, useRef, useState } from "react"
import { Download, EllipsisVertical, FolderPlus, Pencil, Search, Trash2, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { AuthImage } from "@/components/requests/file-list"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { api, ApiError, downloadLargeFile, formatBytes, uploadFileWithProgress } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"

// 디자인팀 자료실: 작업할 때 쓰는 자료(PSD·AI·FIG 템플릿, 로고, 폰트, 이미지 소스 등)를 올려 두고 함께 내려받는다.
// 화면 어디에 파일을 끌어 놓아도 올리기 창이 열린다.

type LibraryItem = {
  id: number
  category: string
  note: string
  uploaderId: string
  uploaderName: string
  createdAt: number
  updatedAt: number
  file: { id: string; name: string; mime: string; size: number }
}

// 처음부터 고를 수 있는 분류. 올릴 때 새 분류를 적으면 그것도 목록에 생긴다.
const DEFAULT_CATEGORIES = ["템플릿", "로고·CI", "폰트", "이미지 소스", "아이콘·일러스트", "가이드", "기타"]
const NEW_CATEGORY = "__new__"
const NO_CATEGORY = "미분류"

// 파일 형식 표시(확장자 기준). 색은 각 프로그램의 대표 색에 맞췄다.
const TYPES: { key: string; label: string; exts: string[]; className: string }[] = [
  { key: "psd", label: "PSD", exts: ["psd", "psb"], className: "bg-[#001e36] text-[#31a8ff]" },
  { key: "ai", label: "AI", exts: ["ai", "eps"], className: "bg-[#330000] text-[#ff9a00]" },
  { key: "fig", label: "FIG", exts: ["fig"], className: "bg-[#1e1e1e] text-[#a259ff] ring-1 ring-white/15" },
  { key: "pdf", label: "PDF", exts: ["pdf"], className: "bg-red-600 text-white" },
  { key: "image", label: "이미지", exts: ["jpg", "jpeg", "png", "gif", "webp", "svg", "tif", "tiff", "bmp", "heic"], className: "bg-emerald-600 text-white" },
  { key: "font", label: "폰트", exts: ["ttf", "otf", "woff", "woff2"], className: "bg-slate-700 text-white" },
  { key: "zip", label: "압축", exts: ["zip", "rar", "7z", "alz", "egg"], className: "bg-amber-600 text-white" },
]
const OTHER = { key: "etc", label: "기타", exts: [], className: "bg-muted text-muted-foreground" }

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "")
const typeOf = (name: string) => TYPES.find((t) => t.exts.includes(extOf(name))) ?? OTHER
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

function TypeBadge({ name, className = "" }: { name: string; className?: string }) {
  const t = typeOf(name)
  const ext = extOf(name)
  return (
    <span className={`flex items-center justify-center rounded-lg font-bold tracking-tight ${t.className} ${className}`}>
      {(t === OTHER ? ext || "FILE" : t.key === "image" || t.key === "font" || t.key === "zip" ? ext : t.label).toUpperCase().slice(0, 5)}
    </span>
  )
}

export function LibraryPage({ session }: { session: Session }) {
  const { data, error } = useApi<LibraryItem[]>("/library", 60_000)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [type, setType] = useState("all")
  const [uploading, setUploading] = useState<File[] | null>(null)
  const [editing, setEditing] = useState<LibraryItem | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)

  const categories = useMemo(() => {
    const used = new Map<string, number>()
    for (const item of data ?? []) used.set(item.category || NO_CATEGORY, (used.get(item.category || NO_CATEGORY) ?? 0) + 1)
    return [...used.entries()].sort(
      (a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0], "ko"),
    )
  }, [data])

  if (!data) return <PageState error={error} />

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (item) =>
      (!category || (item.category || NO_CATEGORY) === category) &&
      (type === "all" || typeOf(item.file.name).key === type) &&
      (!q || [item.file.name, item.category, item.note, item.uploaderName].some((v) => v.toLowerCase().includes(q))),
  )
  const filtered = !!category || type !== "all" || !!q
  const canEdit = (item: LibraryItem) => item.uploaderId === session.id || isManager(session)

  const remove = async (item: LibraryItem) => {
    if (!(await confirmDialog({ title: `"${item.file.name}" 자료를 지울까요?`, description: "지우면 자료실에서 사라집니다.", confirmText: "삭제", destructive: true })))
      return
    await api(`/library/${item.id}`, { method: "DELETE" })
    invalidate()
  }

  // 파일을 끌어 오면 화면 전체에 놓을 자리를 보여 준다
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files")

  return (
    <div
      className={PAGE_GRID}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const files = [...e.dataTransfer.files]
        if (files.length > 0) setUploading(files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background/90 px-12 py-10 text-primary">
            <Upload className="size-8" />
            <p className="font-semibold">여기에 놓으면 자료실에 올립니다</p>
          </div>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ""
          if (files.length > 0) setUploading(files)
        }}
      />
      <Section
        title="디자인팀 자료실"
        aside={
          <span className="text-sm text-muted-foreground tabular-nums">
            {filtered ? `${list.length} / ${data.length}개` : `${data.length}개`}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-32" aria-label="파일 형식">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 형식</SelectItem>
                {[...TYPES, OTHER].map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="파일 이름·메모·올린 사람"
                aria-label="자료 검색"
                className="pl-8"
              />
            </div>
            <Button onClick={() => picker.current?.click()}>
              <Upload data-icon="inline-start" />
              자료 올리기
            </Button>
          </div>
        }
      >
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="분류">
            <CategoryChip active={!category} label="전체" count={data.length} onClick={() => setCategory(null)} />
            {categories.map(([c, n]) => (
              <CategoryChip key={c} active={category === c} label={c} count={n} onClick={() => setCategory(category === c ? null : c)} />
            ))}
          </div>
        )}

        {data.length === 0 ? (
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-14 text-center text-sm text-muted-foreground hover:bg-muted/40"
          >
            <FolderPlus className="size-8" />
            <span className="font-medium text-foreground">아직 올린 자료가 없습니다</span>
            <span>PSD·AI·FIG 템플릿, 로고, 폰트, 이미지 소스 등 작업에 필요한 자료를 올려 두세요. 파일을 이 화면에 끌어 놓아도 됩니다.</span>
          </button>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">조건에 맞는 자료가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-12 gap-4">
            {list.map((item) => (
              <li key={item.id} className="col-span-12 flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/50 sm:col-span-6 lg:col-span-4 xl:col-span-3">
                <button
                  type="button"
                  className="group relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/50"
                  onClick={() => void downloadLargeFile(item.file.id, item.file.name)}
                  title={`${item.file.name} 내려받기`}
                >
                  {PREVIEWABLE.has(item.file.mime) ? (
                    <AuthImage fileId={item.file.id} size="thumb" alt={item.file.name} className="size-full object-contain" />
                  ) : (
                    <TypeBadge name={item.file.name} className="size-20 text-xl" />
                  )}
                  {/* 마우스를 올리면(또는 키보드로 고르면) 내려받기 표시 */}
                  <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="flex size-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                      <Download className="size-5" />
                    </span>
                    <span className="text-sm font-medium">내려받기</span>
                    <span className="text-xs text-white/70 tabular-nums">{formatBytes(item.file.size)}</span>
                  </span>
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                  <div className="flex items-start gap-2">
                    <TypeBadge name={item.file.name} className="mt-0.5 h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                    <span className="min-w-0 flex-1 text-sm font-medium break-all" title={item.file.name}>
                      {item.file.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 shrink-0" aria-label="자료 메뉴">
                          <EllipsisVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void downloadLargeFile(item.file.id, item.file.name)}>
                          <Download />
                          내려받기
                        </DropdownMenuItem>
                        {canEdit(item) && (
                          <>
                            <DropdownMenuItem onSelect={() => setEditing(item)}>
                              <Pencil />
                              고치기
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => void remove(item)}>
                              <Trash2 />
                              지우기
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {item.note && <p className="text-xs break-keep whitespace-pre-line text-muted-foreground">{item.note}</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-xs text-muted-foreground">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{item.category || NO_CATEGORY}</span>
                    <span className="tabular-nums">{formatBytes(item.file.size)}</span>
                    <span>{item.uploaderName}</span>
                    <span className="tabular-nums">{formatDateTime(new Date(item.createdAt))}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {uploading && (
        <UploadDialog
          files={uploading}
          categories={categories.map(([c]) => c)}
          defaultCategory={category && category !== NO_CATEGORY ? category : ""}
          onClose={() => setUploading(null)}
        />
      )}
      {editing && <EditDialog key={editing.id} item={editing} categories={categories.map(([c]) => c)} onClose={() => setEditing(null)} />}
    </div>
  )
}

// 기본 분류는 정해 둔 순서대로, 새로 만든 분류는 그 뒤에, 미분류는 맨 끝
function order(c: string) {
  if (c === NO_CATEGORY) return 1000
  const i = DEFAULT_CATEGORIES.indexOf(c)
  return i === -1 ? 500 : i
}

function CategoryChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" className="rounded-full" role="tab" aria-selected={active} onClick={onClick}>
      {label}
      <span className={`tabular-nums ${active ? "opacity-80" : "text-muted-foreground"}`}>{count}</span>
    </Button>
  )
}

// 분류 고르기: 기본 분류 + 이미 쓰는 분류, 맨 아래 "새 분류"를 고르면 직접 적는다
function CategoryField({
  id,
  value,
  onChange,
  categories,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  categories: string[]
}) {
  const options = [...new Set([...DEFAULT_CATEGORIES, ...categories.filter((c) => c !== NO_CATEGORY)])].sort((a, b) => order(a) - order(b))
  const [custom, setCustom] = useState(!!value && !options.includes(value))
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={custom ? NEW_CATEGORY : value || undefined}
        onValueChange={(v) => {
          if (v === NEW_CATEGORY) {
            setCustom(true)
            onChange("")
          } else {
            setCustom(false)
            onChange(v)
          }
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="분류 고르기" />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_CATEGORY}>새 분류 직접 입력…</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={20} placeholder="새 분류 이름 (예: 명절 패키지)" autoFocus aria-label="새 분류 이름" />
      )}
    </div>
  )
}

function UploadDialog({
  files: initial,
  categories,
  defaultCategory,
  onClose,
}: {
  files: File[]
  categories: string[]
  defaultCategory: string
  onClose: () => void
}) {
  const [files, setFiles] = useState(initial)
  const [category, setCategory] = useState(defaultCategory)
  const [note, setNote] = useState("")
  const [progress, setProgress] = useState<number[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = progress !== null
  const total = files.reduce((s, f) => s + f.size, 0)
  const done = progress ? files.reduce((s, f, i) => s + f.size * (progress[i] ?? 0), 0) : 0

  const submit = async () => {
    if (files.length === 0) return
    setError(null)
    setProgress(files.map(() => 0))
    try {
      const ids: string[] = []
      for (const [i, file] of files.entries()) {
        const up = await uploadFileWithProgress(file, (r) => setProgress((p) => p && p.map((v, j) => (j === i ? r : v))))
        ids.push(up.id)
        setProgress((p) => p && p.map((v, j) => (j === i ? 1 : v)))
      }
      await api("/library", { body: { fileIds: ids, category: category.trim(), note: note.trim() } })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "올리지 못했습니다. 다시 시도해 주세요.")
      setProgress(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>자료 올리기</DialogTitle>
          <DialogDescription>
            {files.length}개 · {formatBytes(total)}. 큰 파일은 올리는 데 시간이 걸릴 수 있습니다. 다 올라갈 때까지 창을 닫지 마세요.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <SmoothScrollArea className="max-h-60 overflow-y-auto rounded-lg border" contentClassName="flex flex-col divide-y">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex flex-col gap-1.5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <TypeBadge name={f.name} className="h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={f.name}>
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                  {!busy && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${f.name} 빼기`}
                      onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                {progress && <Progress value={(progress[i] ?? 0) * 100} />}
              </div>
            ))}
          </SmoothScrollArea>
          <Field>
            <FieldLabel htmlFor="library-category">분류</FieldLabel>
            <CategoryField id="library-category" value={category} onChange={setCategory} categories={categories} />
          </Field>
          <Field>
            <FieldLabel htmlFor="library-note">메모</FieldLabel>
            <Textarea
              id="library-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="예: 2026 추석 선물세트 상세페이지 템플릿 (폰트: 프리텐다드)"
              className="min-h-16 break-keep"
            />
            <FieldDescription>올리는 파일 모두에 같은 분류·메모가 붙습니다. 나중에 하나씩 고칠 수 있습니다.</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter className="items-center">
          {busy && <span className="mr-auto text-xs text-muted-foreground tabular-nums">{Math.round((done / Math.max(total, 1)) * 100)}% 올리는 중…</span>}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || files.length === 0} onClick={() => void submit()}>
            <Upload data-icon="inline-start" />
            {busy ? "올리는 중…" : `${files.length}개 올리기`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ item, categories, onClose }: { item: LibraryItem; categories: string[]; onClose: () => void }) {
  const [name, setName] = useState(item.file.name)
  const [category, setCategory] = useState(item.category)
  const [note, setNote] = useState(item.note)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setPending(true)
    setError(null)
    try {
      await api(`/library/${item.id}`, { method: "PATCH", body: { name: name.trim(), category: category.trim(), note: note.trim() } })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>자료 고치기</DialogTitle>
          <DialogDescription>파일 이름·분류·메모를 고칩니다.</DialogDescription>
        </DialogHeader>
        <form
          id="library-edit"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="library-name">파일 이름</FieldLabel>
              <Input id="library-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </Field>
            <Field>
              <FieldLabel htmlFor="library-edit-category">분류</FieldLabel>
              <CategoryField id="library-edit-category" value={category} onChange={setCategory} categories={categories} />
            </Field>
            <Field>
              <FieldLabel htmlFor="library-edit-note">메모</FieldLabel>
              <Textarea id="library-edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-h-16 break-keep" />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="library-edit" disabled={pending || !name.trim()}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
