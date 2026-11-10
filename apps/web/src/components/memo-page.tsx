import { useEffect, useMemo, useRef, useState } from "react"
import { ImageIcon, ImagePlus, LoaderCircle, NotebookText, Pin, PinOff, Plus, Save, Search, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { AuthImage } from "@/components/requests/file-list"
import { ImageLightbox } from "@/components/requests/image-lightbox"
import { Tip } from "@/components/tip"
import { api, ApiError, uploadFile } from "@/lib/api"
import { PAGE_GRID, SHEET_STACK } from "@/lib/layout"
import { formatDateTime, type FileInfo } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"

// 메모(개인 메뉴): 계정마다 자기 메모만(서버 apps/api/src/memos.ts). 왼쪽에서 쓰고, 오른쪽 목록에서 골라 고친다.
// 제목을 비우면 내용 첫 줄이 제목처럼 보인다. 고정한 메모는 목록 맨 위.

type MemoFile = { id: string; name: string; mime: string; size: number }
type Memo = { id: number; title: string; body: string; pinned: boolean; files: MemoFile[]; createdAt: number; updatedAt: number }

const FILES_MAX = 30
const idsKey = (fs: MemoFile[]) => fs.map((f) => f.id).join(",")
// 미리보기(ImageLightbox)는 FileInfo 를 받는다
const asInfo = (f: MemoFile): FileInfo => ({ ...f, kind: null, uploaderId: "", createdAt: 0 })
// 클립보드 캡처는 이름이 image.png 하나라 시각을 붙여 구분한다
const stamp = (d = new Date()) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("") +
  "_" +
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("")
const named = (f: File) =>
  /^image\.(png|jpe?g|gif|webp)$/i.test(f.name) || !f.name
    ? new File([f], `캡처_${stamp()}.${f.type.split("/")[1] || "png"}`, { type: f.type })
    : f

const headline = (m: Pick<Memo, "title" | "body"> & { files?: MemoFile[] }) =>
  m.title.trim() || m.body.trim().split("\n")[0]?.trim() || (m.files?.length ? `이미지 ${m.files.length}장` : "(빈 메모)")

// inSheet: 헤더 버튼으로 연 오른쪽 시트 안(위아래로 쌓고, 목록은 시트와 함께 스크롤)
export function MemoPage({ inSheet = false }: { inSheet?: boolean } = {}) {
  const { data, error: loadError } = useApi<Memo[]>("/memos")
  // 저장 직후 목록에 바로 보이게 서버 응답으로 고쳐 두고, 다시 받으면 서버 것으로
  const [memos, setMemos] = useState<Memo[] | null>(null)
  useEffect(() => {
    if (data) setMemos(data)
  }, [data])

  const [editingId, setEditingId] = useState<number | null>(null) // null = 새 메모
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [files, setFiles] = useState<MemoFile[]>([])
  const [saved, setSaved] = useState({ title: "", body: "", files: "" }) // 마지막으로 저장(또는 불러온) 내용
  const [uploading, setUploading] = useState(0)
  const [preview, setPreview] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const dirty = title !== saved.title || body !== saved.body || idsKey(files) !== saved.files
  const empty = !title.trim() && !body.trim() && files.length === 0

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (memos ?? []).filter((m) => !q || `${m.title}\n${m.body}`.toLowerCase().includes(q))
  }, [memos, query])

  if (!memos) return <PageState error={loadError} />

  // 고치던 내용이 있으면 버릴지 묻는다
  const leaveOk = async () =>
    !dirty || empty
      ? true
      : await confirmDialog({ title: "저장하지 않은 내용이 있습니다", description: "지금 쓰던 내용을 버리고 넘어갈까요?", confirmText: "버리고 넘어가기", destructive: true })

  const load = (m: Memo | null) => {
    setEditingId(m?.id ?? null)
    setTitle(m?.title ?? "")
    setBody(m?.body ?? "")
    setFiles(m?.files ?? [])
    setSaved({ title: m?.title ?? "", body: m?.body ?? "", files: idsKey(m?.files ?? []) })
    setPreview(null)
    setError(null)
    setNotice(null)
  }
  const open = async (m: Memo | null) => {
    if (m?.id === editingId && m) return
    if (await leaveOk()) load(m)
  }

  // 이미지 붙이기: 버튼·클립보드(Ctrl+V)·끌어 놓기. 올린 뒤 저장해야 메모에 남는다
  const attach = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"))
    if (images.length === 0) return setError("이미지 파일만 붙일 수 있습니다.")
    const room = FILES_MAX - files.length - uploading
    if (room <= 0) return setError(`이미지는 메모 하나에 ${FILES_MAX}장까지 붙일 수 있습니다.`)
    setError(null)
    const take = images.slice(0, room)
    setUploading((n) => n + take.length)
    for (const f of take) {
      try {
        const up = await uploadFile(named(f))
        setFiles((fs) => [...fs, up])
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "이미지를 올리지 못했습니다.")
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const save = async () => {
    if (uploading > 0) return setError("이미지를 올리는 중입니다. 끝나면 저장해 주세요.")
    if (empty) return setError("제목이나 내용을 입력해 주세요.")
    setPending(true)
    setError(null)
    try {
      const memo = editingId
        ? await api<Memo>(`/memos/${editingId}`, { method: "PATCH", body: { title, body, files: files.map((f) => f.id) } })
        : await api<Memo>("/memos", { body: { title, body, files: files.map((f) => f.id) } })
      setMemos((ms) => [memo, ...(ms ?? []).filter((x) => x.id !== memo.id)].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt))
      setEditingId(memo.id)
      setSaved({ title: memo.title, body: memo.body, files: idsKey(memo.files) })
      setTitle(memo.title)
      setBody(memo.body)
      setFiles(memo.files)
      setNotice(`${formatDateTime(new Date(memo.updatedAt))} 저장했습니다.`)
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  const remove = async (m: Memo) => {
    if (!(await confirmDialog({ title: `"${headline(m)}" 메모를 지울까요?`, description: "지운 메모는 되돌릴 수 없습니다.", confirmText: "삭제", destructive: true }))) return
    try {
      await api(`/memos/${m.id}`, { method: "DELETE" })
      setMemos((ms) => ms && ms.filter((x) => x.id !== m.id))
      if (editingId === m.id) load(null)
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "지우지 못했습니다.")
    }
  }

  const togglePin = async (m: Memo) => {
    setMemos((ms) => ms && ms.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt))
    await api(`/memos/${m.id}`, { method: "PATCH", body: { pinned: !m.pinned } }).catch(() => {})
    invalidate()
  }

  const current = memos.find((m) => m.id === editingId) ?? null

  return (
    <div className={inSheet ? SHEET_STACK : PAGE_GRID}>
      {/* 왼쪽: 작성 */}
      <Section
        title={editingId ? "메모 고치기" : "새 메모"}
        aside={dirty && !empty ? <span className="text-xs text-amber-600 dark:text-amber-400">저장 안 됨</span> : null}
        action={
          <Button variant="outline" size="sm" onClick={() => void open(null)} disabled={!editingId && empty}>
            <Plus data-icon="inline-start" />새 메모
          </Button>
        }
        className={inSheet ? "" : "col-span-12 lg:col-span-5"}
      >
        <form
          className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors ${dragOver ? "border-primary bg-primary/5" : ""}`}
          onPaste={(e) => {
            // 캡처 이미지(클립보드)는 첨부로. 글이 함께 있으면(엑셀 등) 글 붙여넣기를 그대로 둔다
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
            void save()
          }}
          onKeyDown={(e) => {
            // Ctrl+S / Ctrl+Enter 로 저장
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) {
              e.preventDefault()
              void save()
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="memo-title">제목</FieldLabel>
              <Input id="memo-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="비우면 내용 첫 줄이 제목이 됩니다" />
            </Field>
            <Field>
              <FieldLabel htmlFor="memo-body">내용</FieldLabel>
              <Textarea
                id="memo-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={20000}
                placeholder="메모를 적어 주세요"
                className={inSheet ? "min-h-48 break-keep" : "min-h-80 break-keep lg:min-h-[28rem]"}
              />
            </Field>
            <Field>
              <div className="flex items-center gap-2">
                <FieldLabel>이미지</FieldLabel>
                {files.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{files.length}장</span>}
                <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => fileInput.current?.click()} disabled={files.length + uploading >= FILES_MAX}>
                  <ImagePlus data-icon="inline-start" />
                  이미지 첨부
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
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs break-keep text-muted-foreground">
                  캡처한 이미지를 Ctrl+V 로 붙여 넣거나, 파일을 끌어다 놓으세요.
                </p>
              ) : (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {files.map((f, i) => (
                    <li key={f.id} className="group/img relative">
                      <Tip content={`${f.name} 크게 보기`}>
                        <button type="button" className="block w-full overflow-hidden rounded-lg border" onClick={() => setPreview(i)}>
                          <AuthImage fileId={f.id} alt={f.name} size="thumb" className="aspect-square min-h-0 w-full object-cover" />
                        </button>
                      </Tip>
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
            </Field>
          </FieldGroup>
          <ImageLightbox images={files.map(asInfo)} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
          {error && <FieldError>{error}</FieldError>}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {notice ?? (current ? `마지막 저장 ${formatDateTime(new Date(current.updatedAt))}` : "Ctrl+S 로 저장")}
            </span>
            <div className="ml-auto flex gap-2">
              {current && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void remove(current)}>
                  <Trash2 data-icon="inline-start" />
                  삭제
                </Button>
              )}
              <Button type="submit" size="sm" disabled={pending || uploading > 0 || empty || (!!editingId && !dirty)}>
                <Save data-icon="inline-start" />
                {pending ? "저장 중…" : "저장"}
              </Button>
            </div>
          </div>
        </form>
        <p className="text-xs break-keep text-muted-foreground">내 계정에서만 보이는 메모입니다(계정 전환으로 묶인 계정끼리는 함께 봅니다).</p>
      </Section>

      {/* 오른쪽: 목록 */}
      <Section
        title="메모 목록"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{memos.length}개</span>}
        className={inSheet ? "" : "col-span-12 lg:col-span-7"}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·내용 검색" aria-label="메모 검색" className="pl-8" />
        </div>
        {memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            <NotebookText className="size-8" />
            아직 메모가 없습니다. 왼쪽에서 써서 저장하면 여기에 쌓입니다.
          </div>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">"{query}" 와 맞는 메모가 없습니다.</p>
        ) : (
          <ListScroll inSheet={inSheet}>
            <ul className="flex flex-col gap-2">
              {list.map((m) => {
                const active = m.id === editingId
                const preview = (m.title.trim() ? m.body : m.body.split("\n").slice(1).join("\n")).trim()
                return (
                  <li
                    key={m.id}
                    className={`group flex items-start gap-2 rounded-xl border p-3 transition-colors ${active ? "border-primary bg-accent" : "bg-card hover:bg-muted/50"}`}
                  >
                    <button type="button" onClick={() => void open(m)} aria-current={active ? "true" : undefined} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
                      <span className="flex items-center gap-1.5">
                        {m.pinned && <Pin className="size-3.5 shrink-0 text-primary" aria-label="고정됨" />}
                        <span className="truncate font-medium">{headline(m)}</span>
                      </span>
                      {preview && <span className="mt-1 line-clamp-2 text-sm break-keep whitespace-pre-line text-muted-foreground">{preview}</span>}
                      <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(new Date(m.updatedAt))}
                        {m.files.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <ImageIcon className="size-3.5" aria-hidden />
                            {m.files.length}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label={m.pinned ? `${headline(m)} 고정 풀기` : `${headline(m)} 맨 위에 고정`} onClick={() => void togglePin(m)}>
                        {m.pinned ? <PinOff /> : <Pin />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${headline(m)} 지우기`} onClick={() => void remove(m)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </ListScroll>
        )}
      </Section>
    </div>
  )
}

// 목록 스크롤: 페이지에서는 목록만 따로(부드럽게) 스크롤, 시트 안에서는 시트와 함께 스크롤한다
function ListScroll({ inSheet, children }: { inSheet: boolean; children: React.ReactNode }) {
  if (inSheet) return <>{children}</>
  return <SmoothScrollArea className="max-h-[calc(100svh-14rem)] overflow-y-auto pr-1">{children}</SmoothScrollArea>
}
