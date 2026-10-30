import { useMemo, useRef, useState } from "react"
import { Download, EllipsisVertical, FilePlus2, Paperclip, Pencil, Search, Trash2, Upload, X } from "lucide-react"

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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { DateRangePicker, type DateRange } from "@/components/date-range-picker"
import { OTHER, PREVIEWABLE, TYPES, TypeBadge, typeOf } from "@/components/file-type"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { AuthImage } from "@/components/requests/file-list"
import { ImageLightbox } from "@/components/requests/image-lightbox"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { api, ApiError, downloadLargeFile, formatBytes, uploadFileWithProgress } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type FileInfo } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"

// 파일공유자료실: 로그인한 누구나 글과 파일을 올려 함께 본다(부서 상관없이).
// 위: 분류 · 검색 · 형식 · 올린 사람 · 기간 필터 / 아래: 공유한 글(내용 + 첨부 파일)
// 화면 어디에 파일을 끌어 놓아도 글쓰기 창이 그 파일을 붙인 채로 열린다.

type ShareFile = { id: string; name: string; mime: string; size: number }
type SharePost = {
  id: number
  title: string
  body: string
  category: string
  authorId: string
  authorName: string
  createdAt: number
  updatedAt: number
  files: ShareFile[]
}

// 처음부터 고를 수 있는 분류. 글을 쓸 때 새 분류를 적으면 그것도 목록에 생긴다.
const DEFAULT_CATEGORIES = ["업무 자료", "양식·서식", "사진·이미지", "회의 자료", "교육·매뉴얼", "기타"]
const NEW_CATEGORY = "__new__"
const NO_CATEGORY = "미분류"

// 한 화면에 보이는 글 수. 넘으면 다음 장으로
const PAGE_SIZE = 20

// 형식 필터: 파일 있는 글 / 글만 / 파일 형식별
const KIND_FILTERS = [
  { key: "all", label: "모든 글" },
  { key: "files", label: "파일 있는 글" },
  { key: "text", label: "글만" },
]

// 올린 날이 고른 기간(시작일 0시 ~ 끝일 다음 날 0시) 안인지
function inRange(at: number, range: DateRange | undefined) {
  if (!range?.from) return true
  const from = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime()
  const toDay = range.to ?? range.from
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1).getTime()
  return at >= from && at < to
}

// 기본 분류는 정해 둔 순서대로, 새로 만든 분류는 그 뒤에, 미분류는 맨 끝
function order(c: string) {
  if (c === NO_CATEGORY) return 1000
  const i = DEFAULT_CATEGORIES.indexOf(c)
  return i === -1 ? 500 : i
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function SharePage({ session }: { session: Session }) {
  const { data, error } = useApi<SharePost[]>("/share", 60_000)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [kind, setKind] = useState("all")
  const [author, setAuthor] = useState("all")
  const [range, setRange] = useState<DateRange | undefined>()
  const [page, setPage] = useState(1)
  const [writing, setWriting] = useState<{ post?: SharePost; files: File[] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const categories = useMemo(() => {
    const used = new Map<string, number>()
    for (const p of data ?? []) used.set(p.category || NO_CATEGORY, (used.get(p.category || NO_CATEGORY) ?? 0) + 1)
    return [...used.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0], "ko"))
  }, [data])
  const authors = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of data ?? []) map.set(p.authorId, p.authorName)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"))
  }, [data])

  if (!data) return <PageState error={error} />

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (p) =>
      (!category || (p.category || NO_CATEGORY) === category) &&
      (kind === "all" ||
        (kind === "files" ? p.files.length > 0 : kind === "text" ? p.files.length === 0 : p.files.some((f) => typeOf(f.name).key === kind))) &&
      (author === "all" || p.authorId === author) &&
      inRange(p.createdAt, range) &&
      (!q || [p.title, p.body, p.category, p.authorName, ...p.files.map((f) => f.name)].some((v) => v.toLowerCase().includes(q))),
  )
  const filtered = !!category || kind !== "all" || author !== "all" || !!range?.from || !!q
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const go = (next: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    setPage(Math.min(Math.max(next, 1), pageCount))
    window.scrollTo({ top: 0 })
  }
  // 필터를 바꾸면 첫 장부터
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const clearFilters = () => {
    setQuery("")
    setCategory(null)
    setKind("all")
    setAuthor("all")
    setRange(undefined)
    setPage(1)
  }

  const remove = async (post: SharePost) => {
    if (!(await confirmDialog({ title: `"${post.title}" 글을 지울까요?`, description: "붙인 파일도 함께 지워집니다.", confirmText: "삭제", destructive: true })))
      return
    await api(`/share/${post.id}`, { method: "DELETE" })
    invalidate()
  }

  // 파일을 끌어 오면 화면 전체에 놓을 자리를 보여 준다(글쓰기 창이 열려 있으면 창이 받는다)
  const hasFiles = (e: React.DragEvent) => !writing && e.dataTransfer.types.includes("Files")

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
        if (files.length > 0) setWriting({ files })
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background/90 px-12 py-10 text-primary">
            <Upload className="size-8" />
            <p className="font-semibold">여기에 놓으면 새 글에 붙입니다</p>
          </div>
        </div>
      )}
      <Section
        title="파일공유자료실"
        aside={
          <span className="text-sm text-muted-foreground tabular-nums">
            {filtered ? `${list.length} / ${data.length}건` : `${data.length}건`}
          </span>
        }
        action={
          <Button onClick={() => setWriting({ files: [] })}>
            <FilePlus2 data-icon="inline-start" />
            글쓰기
          </Button>
        }
      >
        {/* 위: 검색·필터 */}
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => reset(setQuery)(e.target.value)}
                placeholder="제목·내용·파일 이름·올린 사람 검색"
                aria-label="공유 자료 검색"
                className="pl-8"
              />
            </div>
            <Select value={kind} onValueChange={reset(setKind)}>
              <SelectTrigger className="w-36" aria-label="형식">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_FILTERS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>파일 형식</SelectLabel>
                  {[...TYPES, OTHER].map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={author} onValueChange={reset(setAuthor)}>
              <SelectTrigger className="w-36" aria-label="올린 사람">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 사람</SelectItem>
                {session && authors.some(([id]) => id === session.id) && <SelectItem value={session.id}>내가 올린 글</SelectItem>}
                <SelectSeparator />
                {authors
                  .filter(([id]) => id !== session.id)
                  .map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <div className="w-60">
                <DateRangePicker id="share-range" value={range} onChange={reset(setRange)} placeholder="올린 기간" />
              </div>
              {range?.from && (
                <Button variant="ghost" size="icon-sm" aria-label="기간 지우기" onClick={() => reset(setRange)(undefined)}>
                  <X />
                </Button>
              )}
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                필터 지우기
              </Button>
            )}
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="분류">
              <CategoryChip active={!category} label="전체" count={data.length} onClick={() => reset(setCategory)(null)} />
              {categories.map(([c, n]) => (
                <CategoryChip key={c} active={category === c} label={c} count={n} onClick={() => reset(setCategory)(category === c ? null : c)} />
              ))}
            </div>
          )}
        </div>

        {/* 아래: 공유한 글 */}
        {data.length === 0 ? (
          <button
            type="button"
            onClick={() => setWriting({ files: [] })}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-14 text-center text-sm text-muted-foreground hover:bg-muted/40"
          >
            <FilePlus2 className="size-8" />
            <span className="font-medium text-foreground">아직 공유한 자료가 없습니다</span>
            <span className="break-keep">함께 보면 좋은 파일이나 글을 올려 주세요. 파일을 이 화면에 끌어 놓아도 됩니다.</span>
          </button>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">조건에 맞는 자료가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {visible.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                canEdit={post.authorId === session.id || isManager(session)}
                onEdit={() => setWriting({ post, files: [] })}
                onRemove={() => void remove(post)}
              />
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" text="이전" aria-label="이전 페이지" onClick={go(current - 1)} />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <PaginationItem key={n}>
                  <PaginationLink href="#" isActive={n === current} onClick={go(n)}>
                    {n}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext href="#" text="다음" aria-label="다음 페이지" onClick={go(current + 1)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </Section>

      {writing && (
        <PostDialog
          key={writing.post?.id ?? "new"}
          post={writing.post}
          files={writing.files}
          categories={categories.map(([c]) => c)}
          defaultCategory={category && category !== NO_CATEGORY ? category : ""}
          onClose={() => setWriting(null)}
        />
      )}
    </div>
  )
}

function CategoryChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" className="rounded-full" role="tab" aria-selected={active} onClick={onClick}>
      {label}
      <span className={`tabular-nums ${active ? "opacity-80" : "text-muted-foreground"}`}>{count}</span>
    </Button>
  )
}

// 글 한 건: 분류·제목·올린 사람 / 내용(길면 접힘) / 이미지 미리보기 + 파일 목록
function PostCard({ post, canEdit, onEdit, onRemove }: { post: SharePost; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const images = post.files.filter((f) => PREVIEWABLE.has(f.mime))
  const others = post.files.filter((f) => !PREVIEWABLE.has(f.mime))
  const long = post.body.length > 240 || post.body.split("\n").length > 5
  const total = post.files.reduce((s, f) => s + f.size, 0)
  const lightbox: FileInfo[] = images.map((f) => ({ ...f, kind: null, uploaderId: post.authorId, createdAt: post.createdAt }))

  const downloadAll = async () => {
    for (const f of post.files) {
      await downloadLargeFile(f.id, f.name)
      await sleep(400)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{post.category || NO_CATEGORY}</span>
            <h3 className="min-w-0 font-semibold break-keep">{post.title}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{post.authorName}</span>
            <span className="tabular-nums">{formatDateTime(new Date(post.createdAt))}</span>
            {post.updatedAt - post.createdAt > 60_000 && <span>(수정됨)</span>}
          </div>
        </div>
        {post.files.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => void downloadAll()}>
            <Download data-icon="inline-start" />
            전체 받기
            <span className="text-muted-foreground tabular-nums">{formatBytes(total)}</span>
          </Button>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="글 메뉴">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                고치기
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 />
                지우기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {post.body && (
        <div className="flex flex-col items-start gap-1">
          <p className={`text-sm break-keep whitespace-pre-line ${long && !expanded ? "line-clamp-5" : ""}`}>{post.body}</p>
          {long && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "접기" : "더 보기"}
            </Button>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {images.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className="aspect-square overflow-hidden rounded-lg border bg-muted/50"
              onClick={() => setViewing(i)}
              title={f.name}
            >
              <AuthImage fileId={f.id} size="thumb" alt={f.name} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {others.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                onClick={() => void downloadLargeFile(f.id, f.name)}
                title={`${f.name} 내려받기`}
              >
                <TypeBadge name={f.name} className="h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                <Download className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ImageLightbox images={lightbox} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </li>
  )
}

// 분류 고르기: 기본 분류 + 이미 쓰는 분류, 맨 아래 "새 분류"를 고르면 직접 적는다
function CategoryField({ id, value, onChange, categories }: { id: string; value: string; onChange: (v: string) => void; categories: string[] }) {
  const options = [...new Set([...DEFAULT_CATEGORIES, ...categories.filter((c) => c !== NO_CATEGORY)])].sort((a, b) => order(a) - order(b))
  const [custom, setCustom] = useState(!!value && !options.includes(value))
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={custom ? NEW_CATEGORY : value || undefined}
        onValueChange={(v) => {
          setCustom(v === NEW_CATEGORY)
          onChange(v === NEW_CATEGORY ? "" : v)
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
      {custom && <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={20} placeholder="새 분류 이름" autoFocus aria-label="새 분류 이름" />}
    </div>
  )
}

// 글쓰기·고치기: 제목 · 분류 · 내용 · 파일(새로 붙이기 / 붙인 파일 빼기)
function PostDialog({
  post,
  files: initial,
  categories,
  defaultCategory,
  onClose,
}: {
  post?: SharePost
  files: File[]
  categories: string[]
  defaultCategory: string
  onClose: () => void
}) {
  const [title, setTitle] = useState(post?.title ?? "")
  const [category, setCategory] = useState(post?.category ?? defaultCategory)
  const [body, setBody] = useState(post?.body ?? "")
  const [kept, setKept] = useState(post?.files ?? [])
  const [files, setFiles] = useState(initial)
  const [progress, setProgress] = useState<number[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const busy = progress !== null
  const total = files.reduce((s, f) => s + f.size, 0)
  const done = progress ? files.reduce((s, f, i) => s + f.size * (progress[i] ?? 0), 0) : 0
  const add = (more: File[]) => setFiles((list) => [...list, ...more])

  const submit = async () => {
    if (!title.trim()) return setError("제목을 입력해 주세요.")
    setError(null)
    setProgress(files.map(() => 0))
    try {
      const ids: string[] = []
      for (const [i, file] of files.entries()) {
        const up = await uploadFileWithProgress(file, (r) => setProgress((p) => p && p.map((v, j) => (j === i ? r : v))))
        ids.push(up.id)
        setProgress((p) => p && p.map((v, j) => (j === i ? 1 : v)))
      }
      const fields = { title: title.trim(), category: category.trim(), body: body.trim(), fileIds: ids }
      if (post) {
        const keptIds = new Set(kept.map((f) => f.id))
        await api(`/share/${post.id}`, {
          method: "PATCH",
          body: { ...fields, removeFileIds: post.files.filter((f) => !keptIds.has(f.id)).map((f) => f.id) },
        })
      } else {
        await api("/share", { body: fields })
      }
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "올리지 못했습니다. 다시 시도해 주세요.")
      setProgress(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        onInteractOutside={(e) => busy && e.preventDefault()}
        onDragOver={(e) => {
          if (busy || !e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (busy || !e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setDragging(false)
          add([...e.dataTransfer.files])
        }}
      >
        <DialogHeader>
          <DialogTitle>{post ? "글 고치기" : "자료 공유하기"}</DialogTitle>
          <DialogDescription>로그인한 모든 사람이 볼 수 있습니다. 큰 파일은 다 올라갈 때까지 창을 닫지 마세요.</DialogDescription>
        </DialogHeader>
        <form
          id="share-post"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="share-title">제목</FieldLabel>
              <Input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} disabled={busy} autoFocus={!post} />
            </Field>
            <Field>
              <FieldLabel htmlFor="share-category">분류</FieldLabel>
              <CategoryField id="share-category" value={category} onChange={setCategory} categories={categories} />
            </Field>
            <Field>
              <FieldLabel htmlFor="share-body">내용</FieldLabel>
              <Textarea
                id="share-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
                disabled={busy}
                placeholder="자료 설명이나 공유할 내용을 적어 주세요."
                className="min-h-28 break-keep"
              />
            </Field>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>파일</FieldLabel>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => picker.current?.click()}>
                  <Paperclip data-icon="inline-start" />
                  파일 붙이기
                </Button>
              </div>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const more = [...(e.target.files ?? [])]
                  e.target.value = ""
                  add(more)
                }}
              />
              {kept.length + files.length === 0 ? (
                <p
                  className={`rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground ${dragging ? "border-primary bg-primary/5 text-primary" : ""}`}
                >
                  파일을 여기에 끌어 놓거나 "파일 붙이기"를 누르세요. 파일 없이 글만 올려도 됩니다.
                </p>
              ) : (
                <SmoothScrollArea
                  className={`max-h-56 overflow-y-auto rounded-lg border ${dragging ? "border-primary" : ""}`}
                  contentClassName="flex flex-col divide-y"
                >
                  {kept.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-3 py-2">
                      <TypeBadge name={f.name} className="h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-sm" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                      {!busy && (
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${f.name} 빼기`} onClick={() => setKept((l) => l.filter((x) => x.id !== f.id))}>
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex flex-col gap-1.5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TypeBadge name={f.name} className="h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                        <span className="min-w-0 flex-1 truncate text-sm" title={f.name}>
                          {f.name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                        {!busy && (
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`${f.name} 빼기`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                            <X />
                          </Button>
                        )}
                      </div>
                      {progress && <Progress value={(progress[i] ?? 0) * 100} />}
                    </div>
                  ))}
                </SmoothScrollArea>
              )}
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter className="items-center">
          {busy && files.length > 0 && (
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">{Math.round((done / Math.max(total, 1)) * 100)}% 올리는 중…</span>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="share-post" disabled={busy || !title.trim()}>
            <Upload data-icon="inline-start" />
            {busy ? "올리는 중…" : post ? "저장" : "올리기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
