import { useEffect, useRef, useState } from "react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { ArrowLeft, Camera, EllipsisVertical, ExternalLink, ImageIcon, ImagePlus, LoaderCircle, MessageCircle, Pencil, Plus, Search, Send, Trash2, Users, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { DateRangePicker } from "@/components/date-range-picker"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { AuthImage } from "@/components/requests/file-list"
import { ImageLightbox } from "@/components/requests/image-lightbox"
import { Tip } from "@/components/tip"
import { UserAvatar } from "@/components/user-avatar"
import { api, ApiError, uploadFile } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type FileInfo } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { invalidate, useApi } from "@/lib/store"

// 사진공부방(서버 apps/api/src/photo-study.ts): 관리자가 날짜마다 공지(제목·내용·링크)를 올리면
// 직원들이 그 아래에 사진과 사진에 대한 설명·피드백을 올리고, 서로 댓글로 이야기한다.
// 처음: 날짜별 공지 목록 / 공지를 누르면: 공지 + 올라온 사진 글(오래된 순) + 맨 아래 올리기 칸

type PhotoFile = { id: string; name: string; mime: string; size: number }
type Comment = { id: number; authorId: string; authorName: string; avatarId: string | null; body: string; createdAt: number }
type Post = { id: number; authorId: string; authorName: string; avatarId: string | null; body: string; createdAt: number; updatedAt: number; files: PhotoFile[]; comments: Comment[] }
type Topic = { id: number; day: string; title: string; body: string; link: string; authorId: string; authorName: string; createdAt: number; updatedAt: number }
type TopicSummary = Topic & { posts: number; people: number; photos: number; lastPostAt: number | null }
type TopicDetail = Topic & { posts: Post[] }

const FILES_MAX = 30
const asInfo = (f: PhotoFile): FileInfo => ({ ...f, kind: null, uploaderId: "", createdAt: 0 })
const dayDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const dayLabel = (day: string) => format(dayDate(day), "yyyy년 M월 d일 (EEE)", { locale: ko })
const dayShort = (day: string) => format(dayDate(day), "M.d (EEE)", { locale: ko })
const toDay = (d: Date) => format(d, "yyyy-MM-dd")
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// 클립보드 캡처는 이름이 image.png 하나라 시각을 붙여 구분한다
const named = (f: File) =>
  /^image\.(png|jpe?g|gif|webp)$/i.test(f.name) || !f.name ? new File([f], `사진_${format(new Date(), "yyyyMMdd_HHmmss")}.${f.type.split("/")[1] || "png"}`, { type: f.type }) : f

export function PhotoStudyPage({ session, id }: { session: Session; id?: string }) {
  const { data: topics, error } = useApi<TopicSummary[]>("/photo-study")
  const manager = isManager(session)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<Topic | "new" | null>(null)

  const dialog = (
    <TopicDialog
      topic={editing}
      onClose={() => setEditing(null)}
      onSaved={(t) => {
        setEditing(null)
        invalidate()
        navigate("photo-study", String(t.id))
      }}
    />
  )

  // 공지 하나: 목록으로 돌아가기 + 공지·사진 글
  if (id) {
    return (
      <div className={PAGE_GRID}>
        <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-10 xl:col-start-2">
          <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate("photo-study")}>
            <ArrowLeft data-icon="inline-start" />
            목록으로
          </Button>
          <TopicView key={id} id={Number(id)} session={session} onEdit={setEditing} />
        </div>
        {dialog}
      </div>
    )
  }

  if (!topics) return <PageState error={error} />
  const q = query.trim().toLowerCase()
  const list = topics.filter((t) => !q || `${t.title}\n${t.body}\n${t.day}`.toLowerCase().includes(q))

  // 처음: 날짜별 공지 목록만. 누르면 그 공지 페이지로
  return (
    <div className={PAGE_GRID}>
      <Section
        title="날짜별 공지"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{topics.length}개</span>}
        action={
          manager && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus data-icon="inline-start" />새 공지
            </Button>
          )
        }
        className="col-span-12"
      >
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·내용·날짜 검색" aria-label="공지 검색" className="pl-8" />
        </div>
        {topics.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center text-sm break-keep text-muted-foreground">
            <Camera className="size-8" aria-hidden />
            {manager ? "아직 공지가 없습니다. 새 공지를 올리면 직원들이 사진을 올릴 수 있습니다." : "아직 공지가 없습니다. 관리자가 공지를 올리면 여기에 날짜별로 쌓입니다."}
          </div>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">"{query}" 와 맞는 공지가 없습니다.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <li key={t.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => navigate("photo-study", String(t.id))}
                  className="flex h-full w-full flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="text-xs font-medium text-primary tabular-nums">{dayShort(t.day)}</span>
                  <span className="line-clamp-2 font-medium break-keep">{t.title}</span>
                  {t.body && <span className="line-clamp-2 text-sm break-keep text-muted-foreground [overflow-wrap:anywhere]">{t.body}</span>}
                  <span className="mt-auto flex items-center gap-3 pt-1 text-xs text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1">
                      <ImageIcon className="size-3.5" aria-hidden />
                      사진 {t.photos}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {t.people}명
                    </span>
                    {t.lastPostAt && <span className="ml-auto">{formatDateTime(new Date(t.lastPostAt))}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {dialog}
    </div>
  )
}

// 공지 하나: 공지 카드 → 사진 글(오래된 순) → 올리기 칸. 15초마다 새 글을 받는다
function TopicView({ id, session, onEdit }: { id: number; session: Session; onEdit: (t: Topic) => void }) {
  const { data, error } = useApi<TopicDetail>(`/photo-study/${id}`, 15_000)
  const manager = isManager(session)
  if (!data) return <PageState error={error} />

  const remove = async () => {
    if (!(await confirmDialog({ title: `"${data.title}" 공지를 지울까요?`, description: "올라온 사진과 댓글도 모두 지워지고 되돌릴 수 없습니다.", confirmText: "삭제", destructive: true }))) return
    try {
      await api(`/photo-study/${id}`, { method: "DELETE" })
      invalidate()
      navigate("photo-study")
    } catch (e) {
      await confirmDialog({ title: "지우지 못했습니다", description: errText(e, "다시 시도해 주세요."), confirmText: "확인" })
    }
  }

  return (
    <>
      {/* 공지 */}
      <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 md:p-5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-primary tabular-nums">{dayLabel(data.day)}</p>
            <h2 className="mt-1 text-lg font-semibold break-keep">{data.title}</h2>
          </div>
          {manager && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="공지 메뉴">
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(data)}>
                  <Pencil />
                  공지 고치기
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                  <Trash2 />
                  공지 삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {data.body && <p className="text-sm break-keep whitespace-pre-line [overflow-wrap:anywhere]">{data.body}</p>}
        {data.link && (
          <a href={data.link} target="_blank" rel="noreferrer noopener" className="flex max-w-full min-w-0 items-center gap-1.5 self-start rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted">
            <ExternalLink className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{data.link}</span>
          </a>
        )}
        <p className="text-xs text-muted-foreground">
          {data.authorName} · {formatDateTime(new Date(data.createdAt))}
        </p>
      </article>

      {/* 사진 글 */}
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">올라온 사진</h3>
        <span className="text-sm text-muted-foreground tabular-nums">{data.posts.length}개</span>
      </div>
      {data.posts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm break-keep text-muted-foreground">아직 올라온 사진이 없습니다. 아래에서 첫 사진을 올려 보세요.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.posts.map((p) => (
            <PostCard key={p.id} post={p} session={session} />
          ))}
        </ul>
      )}

      <Composer topicId={id} />
    </>
  )
}

function PostCard({ post, session }: { post: Post; session: Session }) {
  const mine = post.authorId === session.id
  const canEdit = mine || isManager(session)
  const [preview, setPreview] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(post.body)
  const [removed, setRemoved] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const files = editing ? post.files.filter((f) => !removed.includes(f.id)) : post.files

  const save = async () => {
    setPending(true)
    setError(null)
    try {
      await api(`/photo-study/posts/${post.id}`, { method: "PATCH", body: { body, removeFileIds: removed } })
      setEditing(false)
      invalidate()
    } catch (e) {
      setError(errText(e, "저장하지 못했습니다."))
    } finally {
      setPending(false)
    }
  }
  const remove = async () => {
    if (!(await confirmDialog({ title: "이 글을 지울까요?", description: "사진과 댓글도 함께 지워지고 되돌릴 수 없습니다.", confirmText: "삭제", destructive: true }))) return
    try {
      await api(`/photo-study/posts/${post.id}`, { method: "DELETE" })
      invalidate()
    } catch (e) {
      setError(errText(e, "지우지 못했습니다."))
    }
  }

  return (
    <li className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${mine ? "border-primary/30" : ""}`}>
      <div className="flex items-center gap-2.5">
        <UserAvatar name={post.authorName} avatarId={post.avatarId} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {post.authorName}
            {mine && <span className="ml-1 text-xs font-normal text-muted-foreground">(나)</span>}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(new Date(post.createdAt))}
            {post.updatedAt - post.createdAt > 1000 && " · 수정됨"}
          </p>
        </div>
        {canEdit && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="글 메뉴">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setBody(post.body)
                  setRemoved([])
                  setEditing(true)
                }}
              >
                <Pencil />
                고치기
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {files.length > 0 && (
        <ul className={`grid gap-2 ${files.length === 1 ? "grid-cols-1 sm:max-w-md" : "grid-cols-2 sm:grid-cols-3"}`}>
          {files.map((f, i) => (
            <li key={f.id} className="group/img relative">
              <Tip content="크게 보기">
                <button type="button" className="block w-full overflow-hidden rounded-lg border bg-muted" onClick={() => setPreview(i)}>
                  <AuthImage fileId={f.id} alt={f.name} size={files.length === 1 ? "w960" : "thumb"} className={files.length === 1 ? "max-h-[28rem] w-full object-contain" : "aspect-square w-full object-cover"} />
                </button>
              </Tip>
              {editing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  className="absolute top-1 right-1 rounded-full shadow-sm"
                  aria-label={`${f.name} 빼기`}
                  onClick={() => setRemoved((r) => [...r, f.id])}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ImageLightbox images={files.map(asInfo)} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} className="min-h-24 break-keep" aria-label="사진 설명·피드백" />
          {error && <FieldError>{error}</FieldError>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {post.body && <p className="text-sm break-keep whitespace-pre-line [overflow-wrap:anywhere]">{post.body}</p>}
          {error && <FieldError>{error}</FieldError>}
        </>
      )}

      <Comments post={post} session={session} />
    </li>
  )
}

function Comments({ post, session }: { post: Post; session: Session }) {
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!body.trim()) return
    setPending(true)
    setError(null)
    try {
      await api(`/photo-study/posts/${post.id}/comments`, { body: { body } })
      setBody("")
      invalidate()
    } catch (e) {
      setError(errText(e, "댓글을 남기지 못했습니다."))
    } finally {
      setPending(false)
    }
  }
  const remove = async (c: Comment) => {
    if (!(await confirmDialog({ title: "댓글을 지울까요?", confirmText: "삭제", destructive: true }))) return
    try {
      await api(`/photo-study/comments/${c.id}`, { method: "DELETE" })
      invalidate()
    } catch (e) {
      setError(errText(e, "지우지 못했습니다."))
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {post.comments.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {post.comments.map((c) => (
            <li key={c.id} className="group/c flex items-start gap-2">
              <UserAvatar name={c.authorName} avatarId={c.avatarId} className="size-7" fallbackClassName="text-xs" />
              <div className="min-w-0 flex-1 rounded-lg bg-muted/60 px-3 py-2">
                <p className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{c.authorName}</span>
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(new Date(c.createdAt))}</span>
                </p>
                <p className="mt-0.5 text-sm break-keep whitespace-pre-line [overflow-wrap:anywhere]">{c.body}</p>
              </div>
              {(c.authorId === session.id || isManager(session)) && (
                <Button variant="ghost" size="icon-xs" className="shrink-0 sm:opacity-0 sm:group-hover/c:opacity-100 sm:focus-visible:opacity-100" aria-label="댓글 지우기" onClick={() => void remove(c)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter 로 보내기, Shift+Enter 는 줄바꿈
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          maxLength={2000}
          rows={1}
          placeholder="댓글·피드백 남기기 (Enter 로 보내기)"
          aria-label="댓글"
          className="min-h-9 resize-none py-1.5 break-keep"
        />
        <Button type="submit" size="icon" variant="outline" disabled={pending || !body.trim()} aria-label="댓글 보내기">
          <MessageCircle />
        </Button>
      </form>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

// 사진 올리기: 버튼 · 끌어 놓기 · Ctrl+V. 사진과 설명(피드백)을 함께 올린다
function Composer({ topicId }: { topicId: number }) {
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<PhotoFile[]>([])
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // 다른 공지로 넘어가면 쓰던 것을 비운다(key 로 다시 만들어진다). 올리는 중인 사진은 끝나도 버린다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const attach = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"))
    if (images.length === 0) return setError("사진(이미지) 파일만 올릴 수 있습니다.")
    const room = FILES_MAX - files.length - uploading
    if (room <= 0) return setError(`사진은 한 번에 ${FILES_MAX}장까지 올릴 수 있습니다.`)
    setError(null)
    const take = images.slice(0, room)
    setUploading((n) => n + take.length)
    for (const f of take) {
      try {
        const up = await uploadFile(named(f))
        if (alive.current) setFiles((fs) => [...fs, up])
      } catch (e) {
        if (alive.current) setError(errText(e, "사진을 올리지 못했습니다."))
      } finally {
        if (alive.current) setUploading((n) => n - 1)
      }
    }
  }

  const submit = async () => {
    if (uploading > 0) return setError("사진을 올리는 중입니다. 끝나면 올려 주세요.")
    if (!body.trim() && files.length === 0) return setError("사진을 올리거나 내용을 적어 주세요.")
    setPending(true)
    setError(null)
    try {
      await api(`/photo-study/${topicId}/posts`, { body: { body, fileIds: files.map((f) => f.id) } })
      setBody("")
      setFiles([])
      invalidate()
    } catch (e) {
      setError(errText(e, "올리지 못했습니다."))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors ${dragOver ? "border-primary bg-primary/5" : ""}`}
      onPaste={(e) => {
        const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"))
        if (imgs.length === 0 || e.clipboardData.getData("text/plain")) return
        e.preventDefault()
        void attach(imgs)
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        setDragOver(false)
        void attach([...e.dataTransfer.files])
      }}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault()
          void submit()
        }
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">사진 올리기</h3>
        {files.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{files.length}장</span>}
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => fileInput.current?.click()} disabled={files.length + uploading >= FILES_MAX}>
          <ImagePlus data-icon="inline-start" />
          사진 첨부
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])]
            e.target.value = ""
            if (list.length) void attach(list)
          }}
        />
      </div>
      {files.length === 0 && uploading === 0 ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-lg border border-dashed px-3 py-6 text-center text-xs break-keep text-muted-foreground hover:bg-muted/50"
        >
          사진을 끌어다 놓거나, 눌러서 고르거나, 캡처를 Ctrl+V 로 붙여 넣으세요.
        </button>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {files.map((f, i) => (
            <li key={f.id} className="group/img relative">
              <button type="button" className="block w-full overflow-hidden rounded-lg border" onClick={() => setPreview(i)} aria-label={`${f.name} 크게 보기`}>
                <AuthImage fileId={f.id} alt={f.name} size="thumb" className="aspect-square w-full object-cover" />
              </button>
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                className="absolute top-1 right-1 rounded-full opacity-90 shadow-sm sm:opacity-0 sm:group-hover/img:opacity-100 sm:focus-visible:opacity-100"
                aria-label={`${f.name} 빼기`}
                onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
              >
                <X />
              </Button>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up${i}`} className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="올리는 중" />
            </li>
          ))}
        </ul>
      )}
      <ImageLightbox images={files.map(asInfo)} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="사진 설명, 촬영 포인트, 받고 싶은 피드백 등을 적어 주세요" aria-label="사진 설명·피드백" className="min-h-24 break-keep" />
      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Ctrl+Enter 로 올리기</span>
        <Button type="submit" size="sm" className="ml-auto" disabled={pending || uploading > 0 || (!body.trim() && files.length === 0)}>
          <Send data-icon="inline-start" />
          {pending ? "올리는 중…" : "올리기"}
        </Button>
      </div>
    </form>
  )
}

// 공지 쓰기·고치기(관리자): 날짜 · 제목 · 내용 · 링크
function TopicDialog({ topic, onClose, onSaved }: { topic: Topic | "new" | null; onClose: () => void; onSaved: (t: TopicDetail) => void }) {
  const [day, setDay] = useState<Date | undefined>(new Date())
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [link, setLink] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = topic && topic !== "new" ? topic : null

  useEffect(() => {
    if (!topic) return
    setDay(editing ? new Date(Number(editing.day.slice(0, 4)), Number(editing.day.slice(5, 7)) - 1, Number(editing.day.slice(8, 10))) : new Date())
    setTitle(editing?.title ?? "")
    setBody(editing?.body ?? "")
    setLink(editing?.link ?? "")
    setError(null)
  }, [topic]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!day) return setError("날짜를 골라 주세요.")
    if (!title.trim()) return setError("제목을 입력해 주세요.")
    let url = link.trim()
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
    setPending(true)
    setError(null)
    try {
      const payload = { day: toDay(day), title, body, link: url }
      const saved = editing
        ? await api<TopicDetail>(`/photo-study/${editing.id}`, { method: "PATCH", body: payload })
        : await api<TopicDetail>("/photo-study", { body: payload })
      onSaved(saved)
    } catch (e) {
      setError(errText(e, "저장하지 못했습니다."))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={topic !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "공지 고치기" : "새 공지"}</DialogTitle>
          <DialogDescription className="break-keep">{editing ? "고친 내용은 바로 모든 직원에게 보입니다." : "올리면 모든 직원에게 알림이 갑니다. 직원들은 이 공지 아래에 사진과 피드백을 올립니다."}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ps-day">날짜</FieldLabel>
              <DateRangePicker id="ps-day" single value={day ? { from: day, to: undefined } : undefined} onChange={(r) => setDay(r?.from)} placeholder="날짜를 골라 주세요" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ps-title">제목</FieldLabel>
              <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 자연광으로 음식 사진 찍기" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ps-body">공지 내용</FieldLabel>
              <Textarea id="ps-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder="오늘의 주제, 촬영 방법, 과제 등을 적어 주세요" className="min-h-32 break-keep" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ps-link">링크</FieldLabel>
              <Input id="ps-link" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https:// (참고 영상·자료 주소, 없으면 비워 두세요)" />
            </Field>
          </FieldGroup>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중…" : editing ? "저장" : "공지 올리기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
