import { useEffect, useRef, useState } from "react"
import { Check, Download, MapPin, Maximize2, Pencil, RotateCcw, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { AuthImage } from "@/components/requests/file-list"
import { ImageLightbox } from "@/components/requests/image-lightbox"
import { api, ApiError, downloadFile, fileUrl, sizeForWidth, sizeRank, type ImageSize } from "@/lib/api"
import type { Session } from "@/lib/auth"
import { timeAgo, type CommentDto, type PinDto, type RequestDetailDto, type SubmissionDto } from "@/lib/requests"
import { scrollToElement } from "@/lib/smooth-scroll"
import { useUserNames } from "@/lib/store"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { useFloatingZoom } from "@/components/home/floating-dock"
import { DEFAULT_ZOOM, ZoomControl } from "@/components/tools/zoom-control"

// 시안 이미지 위에 핀을 꽂고, 핀마다 댓글을 단다.
// 핀 위치는 이미지 크기 대비 비율(0~1)로 저장해 화면 폭이 달라도 같은 자리에 보인다.

type Draft = { fileId: string; x: number; y: number }

const PIN_BASE =
  "absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-semibold shadow-md ring-2 ring-white transition-transform tabular-nums"

function pinColor(pin: PinDto, selected: boolean) {
  if (pin.resolvedAt) return `bg-muted-foreground text-white ${selected ? "scale-125" : ""}`
  return `bg-rose-600 text-white ${selected ? "scale-125 ring-4 ring-rose-300" : ""}`
}

export function ReviewBoard({
  detail,
  submission,
  session,
  onChanged,
  pinnable,
}: {
  detail: RequestDetailDto
  submission: SubmissionDto
  session: Session
  onChanged: () => void
  pinnable?: boolean
}) {
  const latest = detail.submissions[detail.submissions.length - 1]
  // pinnable: 개별 컨펌은 상세 화면이 정한다(그 작업자가 컨펌 대기이고 그 사람 최신 시안일 때)
  const canPin = detail.actions.includes("pin") && (pinnable ?? latest?.id === submission.id)
  const canComment = detail.actions.includes("comment")
  const canResolveAll = detail.actions.includes("resolve")
  const userName = useUserNames()

  const fileIds = new Set(submission.files.map((f) => f.id))
  const pins = detail.pins.filter((p) => fileIds.has(p.fileId))
  const number = new Map(pins.map((p, i) => [p.id, i + 1]))
  const open = pins.filter((p) => !p.resolvedAt).length

  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // 전체 화면 보기(모달). 핀을 꽂을 수 없을 땐 이미지를 누르면, 꽂을 수 있을 땐 오른쪽 위 버튼으로 연다.
  const images = submission.files.filter((f) => f.mime.startsWith("image/"))
  const [viewing, setViewing] = useState<number | null>(null)
  // 보기 배율: 시안 칸 너비 기준 처음 70%, − / + 로 40% ~ 100%(숫자 누르면 칸에 맞춤 = 100%). 핀은 비율 위치라 그대로 따라간다
  const [zoom, setZoom] = useState<number | null>(DEFAULT_ZOOM)
  const scale = zoom ?? 1
  // 시안 이미지 칸 너비에 맞춘 크기로 받는다(칸보다 작은 이미지는 원래 크기). 창을 줄일 때는 다시 받지 않는다.
  const columnRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState<ImageSize | null>(null)
  useEffect(() => {
    const el = columnRef.current
    if (!el) return
    const update = () => {
      const next = sizeForWidth(el.clientWidth)
      setImageSize((cur) => (sizeRank(next) > sizeRank(cur) ? next : cur))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 다른 차수(반려된 시안 포함) 이미지도 뒤에서 미리 받아 둔다. 세로로 아주 긴 시안은 몇 MB 라 탭을 누를 때 기다리지 않게
  useEffect(() => {
    if (!imageSize) return
    let alive = true
    const others = detail.submissions.filter((s) => s.id !== submission.id).flatMap((s) => s.files.filter((f) => f.mime.startsWith("image/")))
    void (async () => {
      for (const f of others) {
        if (!alive) return
        await fileUrl(f.id, imageSize).catch(() => {})
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSize])

  // 오른쪽 아래 떠 있는 "크게 보기": 화면에 가장 많이 보이는 시안 이미지를 전체 화면으로 연다
  useFloatingZoom(() => {
    const col = columnRef.current
    if (!col || !col.offsetParent || images.length === 0) return false
    let best = 0
    let bestArea = -1
    col.querySelectorAll<HTMLElement>("[data-image-index]").forEach((el) => {
      const r = el.getBoundingClientRect()
      const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
      if (h > bestArea) {
        bestArea = h
        best = Number(el.dataset.imageIndex)
      }
    })
    setViewing(best)
    return true
  })

  const select = (id: number, scrollTo: "image" | "thread") => {
    setSelected(id)
    const el = document.getElementById(scrollTo === "image" ? `pin-${id}` : `thread-${id}`)
    if (el && scrollTo === "image") scrollToElement(el)
    if (el && scrollTo === "thread") el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      <div ref={columnRef} className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-8">
        {canPin && (
          <p className="flex items-center gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            <MapPin className="size-4 shrink-0" aria-hidden />
            수정할 곳을 이미지에서 누르면 핀이 꽂히고 댓글을 남길 수 있습니다.
          </p>
        )}
        {images.length > 0 && (
          // 배율 버튼: 시안 칸 오른쪽 위에 붙어 내려도 따라온다(자리는 차지하지 않음)
          <div className="pointer-events-none sticky top-20 z-20 -mb-14 flex h-10 justify-end pr-2">
            <ZoomControl zoom={zoom} scale={scale} onZoom={setZoom} className="pointer-events-auto relative" />
          </div>
        )}
        {submission.files.map((file) => (
          <figure key={file.id} className="flex flex-col gap-1" style={images.includes(file) ? { width: `${scale * 100}%` } : undefined}>
            <div
              data-image-index={images.includes(file) ? images.indexOf(file) : undefined}
              className={`relative min-h-12 w-fit max-w-full min-w-12 overflow-visible rounded-lg border bg-muted/30 ${canPin ? "cursor-crosshair" : "cursor-zoom-in"}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-pin],[data-draft]")) return
                if (!canPin) {
                  if (images.includes(file)) setViewing(images.indexOf(file))
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                setSelected(null)
                setDraft({
                  fileId: file.id,
                  x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
                  y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
                })
              }}
            >
              {imageSize && (
                <AuthImage fileId={file.id} alt={file.name} size={imageSize} className="block h-auto max-w-full rounded-lg select-none" />
              )}
              {images.includes(file) && (
                <Button
                  type="button"
                  data-pin
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-2 right-2 opacity-80 shadow-md hover:opacity-100"
                  aria-label="전체 화면으로 보기"
                  onClick={() => setViewing(images.indexOf(file))}
                >
                  <Maximize2 />
                </Button>
              )}
              {pins
                .filter((p) => p.fileId === file.id)
                .map((p) => (
                  <button
                    key={p.id}
                    id={`pin-${p.id}`}
                    type="button"
                    data-pin
                    className={`${PIN_BASE} ${pinColor(p, selected === p.id)}`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    aria-label={`핀 ${number.get(p.id)}${p.resolvedAt ? " (해결됨)" : ""}`}
                    onClick={() => select(p.id, "thread")}
                  >
                    {p.resolvedAt ? <Check className="size-3.5" /> : number.get(p.id)}
                  </button>
                ))}
              {draft?.fileId === file.id && (
                <DraftPin
                  draft={draft}
                  number={pins.length + 1}
                  onCancel={() => setDraft(null)}
                  onSaved={(id) => {
                    setDraft(null)
                    setSelected(id)
                    onChanged()
                  }}
                />
              )}
            </div>
            <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button variant="ghost" size="xs" onClick={() => downloadFile(file.id, file.name)}>
                <Download data-icon="inline-start" />
                받기
              </Button>
            </figcaption>
          </figure>
        ))}
      </div>

      <aside className="col-span-12 xl:col-span-4">
        <div className="flex flex-col gap-3 xl:sticky xl:top-20">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">핀 댓글</h3>
            <Badge variant="secondary" className="tabular-nums">
              {pins.length}개 · 미해결 {open}
            </Badge>
          </div>
          {pins.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {canPin ? "아직 핀이 없습니다. 이미지를 눌러 첫 핀을 꽂아 보세요." : "이 시안에는 핀 댓글이 없습니다."}
            </p>
          ) : (
            <SmoothScrollArea className="max-h-[calc(100svh-10rem-var(--bottom-bar-h,0px))] overflow-y-auto pr-1">
            <ol className="flex flex-col gap-2">
              {pins.map((p) => (
                <PinThread
                  key={p.id}
                  pin={p}
                  number={number.get(p.id)!}
                  selected={selected === p.id}
                  onSelect={() => select(p.id, "image")}
                  canComment={canComment}
                  canResolve={canResolveAll || p.authorId === session.id}
                  canManage={(authorId) => authorId === session.id || session.role === "superadmin"}
                  userName={userName}
                  onChanged={onChanged}
                />
              ))}
            </ol>
            </SmoothScrollArea>
          )}
        </div>
      </aside>
      <ImageLightbox images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} fullscreen />
    </div>
  )
}

function DraftPin({
  draft,
  number,
  onCancel,
  onSaved,
}: {
  draft: Draft
  number: number
  onCancel: () => void
  onSaved: (pinId: number) => void
}) {
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [draft])

  const save = async () => {
    if (!body.trim()) return setError("수정할 내용을 적어 주세요.")
    setPending(true)
    try {
      const { id } = await api<{ id: number }>(`/files/${draft.fileId}/pins`, { body: { x: draft.x, y: draft.y, body } })
      onSaved(id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "핀을 저장하지 못했습니다.")
      setPending(false)
    }
  }

  // 오른쪽 끝 가까이 꽂으면 입력 상자를 핀 왼쪽에 띄운다.
  const side = draft.x > 0.55 ? { right: `calc(${(1 - draft.x) * 100}% + 20px)` } : { left: `calc(${draft.x * 100}% + 20px)` }

  return (
    <>
      <span
        data-draft
        className={`${PIN_BASE} bg-rose-600 text-white ring-4 ring-rose-300`}
        style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}
        aria-hidden
      >
        {number}
      </span>
      <div
        data-draft
        className="absolute z-10 flex w-72 max-w-[calc(100%-2rem)] -translate-y-4 cursor-auto flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
        style={{ top: `${draft.y * 100}%`, ...side }}
      >
        <p className="text-xs font-medium">핀 {number} · 수정 요청</p>
        <Textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save()
            if (e.key === "Escape") onCancel()
          }}
          placeholder="예: 로고를 조금 더 크게 해 주세요"
          className="min-h-20 text-sm"
          maxLength={2000}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            취소
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? "저장 중…" : "핀 등록"}
          </Button>
        </div>
      </div>
    </>
  )
}

function PinThread({
  pin,
  number,
  selected,
  onSelect,
  canComment,
  canResolve,
  canManage,
  userName,
  onChanged,
}: {
  pin: PinDto
  number: number
  selected: boolean
  onSelect: () => void
  canComment: boolean
  canResolve: boolean
  canManage: (authorId: string) => boolean // 쓴 사람·슈퍼관리자: 고치기·지우기
  userName: (id: string) => string
  onChanged: () => void
}) {
  const [reply, setReply] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await work()
      onChanged()
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
      return false
    } finally {
      setPending(false)
    }
  }

  const [first, ...replies] = pin.comments
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)

  const saveEdit = async () => {
    if (!editing || !editing.body.trim()) return
    if (await run(() => api(`/comments/${editing.id}`, { method: "PATCH", body: { body: editing.body } }))) setEditing(null)
  }
  // 핀 내용(첫 글)을 지우면 핀과 답글까지 함께 지워진다
  const remove = async (c: CommentDto) => {
    const isPin = c.id === first?.id
    const ok = await confirmDialog(
      isPin
        ? { title: `핀 ${number}을 지울까요?`, description: replies.length ? `답글 ${replies.length}개도 함께 지워지고 되돌릴 수 없습니다.` : "되돌릴 수 없습니다.", confirmText: "삭제", destructive: true }
        : { title: "답글을 지울까요?", description: "되돌릴 수 없습니다.", confirmText: "삭제", destructive: true },
    )
    if (ok) await run(() => api(`/comments/${c.id}`, { method: "DELETE" }))
  }
  // 고치기·지우기 버튼(쓴 사람·슈퍼관리자에게만)
  const tools = (c: CommentDto, label: string) =>
    canManage(c.authorId) && editing?.id !== c.id ? (
      <span className="ml-auto flex shrink-0">
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} 고치기`} disabled={pending} onClick={() => setEditing({ id: c.id, body: c.body })}>
          <Pencil />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} 지우기`} disabled={pending} onClick={() => void remove(c)}>
          <Trash2 />
        </Button>
      </span>
    ) : null
  const editor = (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={editing?.body ?? ""}
        onChange={(e) => setEditing((cur) => cur && { ...cur, body: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void saveEdit()
          if (e.key === "Escape") setEditing(null)
        }}
        aria-label="내용 고치기"
        maxLength={2000}
        className="min-h-16 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(null)}>
          취소
        </Button>
        <Button type="button" size="sm" disabled={pending || !editing?.body.trim()} onClick={() => void saveEdit()}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  )
  const edited = (c: CommentDto) => (c.editedAt ? <span>(수정됨)</span> : null)

  return (
    <li
      id={`thread-${pin.id}`}
      className={`flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm transition-colors ${
        selected ? "border-rose-400 ring-1 ring-rose-400" : ""
      } ${pin.resolvedAt ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`핀 ${number} 보기`}
          onClick={onSelect}
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white tabular-nums ${
            pin.resolvedAt ? "bg-muted-foreground" : "bg-rose-600"
          }`}
        >
          {number}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{userName(pin.authorId)}</span>
            {timeAgo(new Date(pin.createdAt))}
            {first && edited(first)}
            {pin.resolvedAt && <Badge variant="secondary">해결됨</Badge>}
            {first && tools(first, `핀 ${number}`)}
          </div>
          {first && editing?.id === first.id ? (
            <div className="mt-1">{editor}</div>
          ) : (
            <button type="button" className="mt-0.5 block w-full text-left whitespace-pre-wrap break-words" onClick={onSelect}>
              {first?.body}
            </button>
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <ul className="ml-8 flex flex-col gap-2 border-l pl-3">
          {replies.map((c) => (
            <li key={c.id}>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{userName(c.authorId)}</span> {timeAgo(new Date(c.createdAt))} {edited(c)}
                {tools(c, "답글")}
              </div>
              {editing?.id === c.id ? editor : <p className="whitespace-pre-wrap break-words">{c.body}</p>}
            </li>
          ))}
        </ul>
      )}
      {error && !(canComment || canResolve) && <p className="ml-8 text-xs text-destructive">{error}</p>}
      {(canComment || canResolve) && (
        <div className="ml-8 flex flex-col gap-2">
          {canComment && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!reply.trim()) return
                if (await run(() => api(`/pins/${pin.id}/comments`, { body: { body: reply } }))) setReply("")
              }}
            >
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="답글"
                aria-label={`핀 ${number} 답글`}
                maxLength={2000}
                className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={pending || !reply.trim()}>
                등록
              </Button>
            </form>
          )}
          {canResolve && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={pending}
              onClick={() => run(() => api(`/pins/${pin.id}/resolve`, { body: { resolved: !pin.resolvedAt } }))}
            >
              {pin.resolvedAt ? <RotateCcw data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              {pin.resolvedAt ? "해결 취소" : "반영 완료로 표시"}
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </li>
  )
}
