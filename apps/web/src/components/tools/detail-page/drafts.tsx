import { useState } from "react"
import { FolderOpen, LoaderCircle, Save, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { confirmDialog } from "@/components/confirm-dialog"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { api, apiFetch, ApiError, uploadFile } from "@/lib/api"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi, useUserNames } from "@/lib/store"
import { nextId, type Picture, type Section } from "./sections"

// 상세페이지 임시 저장(서버 apps/api/src/detail-drafts.ts): 입력 내용 + 넣은 그림을 저장해 두고 불러와 이어서 만든다.
// 그림은 /api/uploads 로 올린 파일 id 로 바꿔 저장한다(같은 그림은 한 번만 올림). 불러오면 다시 그림 파일로 받아 넣는다.

export type DraftState = { product: string; category: string; number: string; sections: Section[] }
export type CurrentDraft = { id: string; title: string; savedAt: number }
type PicRef = { fileId: string; name: string; width: number; height: number }
type DraftListItem = { id: string; title: string; authorId: string; updatedBy: string; updatedAt: number; images: number }

// 이미 올린 그림(File → 파일 id). 다시 저장할 때 또 올리지 않는다
const uploaded = new WeakMap<File, string>()

// 섹션 안의 그림을 모두 바꾼다(올리기 / 되받기)
async function mapPictures<A, B>(sections: Section[], fn: (p: A) => Promise<B>): Promise<Section[]> {
  const one = async (p: unknown) => (p ? await fn(p as A) : null)
  const out: Section[] = []
  for (const s of sections) {
    const x = s as Record<string, unknown> & Section
    if (s.kind === "hero" || s.kind === "photo" || s.kind === "gif" || s.kind === "notice") out.push({ ...x, image: await one(x.image) } as Section)
    else if (s.kind === "ship") {
      const products = []
      for (const pr of s.products) products.push({ ...pr, image: await one(pr.image) })
      const ice = []
      for (const pr of s.ice) ice.push({ ...pr, image: await one(pr.image) })
      out.push({ ...s, products, ice } as Section)
    } else out.push(s)
  }
  return out
}

async function serialize(state: DraftState) {
  const fileIds: string[] = []
  const sections = await mapPictures<Picture, PicRef>(state.sections, async (p) => {
    let fileId = uploaded.get(p.file)
    if (!fileId) {
      fileId = (await uploadFile(p.file)).id
      uploaded.set(p.file, fileId)
    }
    fileIds.push(fileId)
    return { fileId, name: p.name, width: p.width, height: p.height }
  })
  return { data: { ...state, sections }, fileIds }
}

async function deserialize(data: DraftState): Promise<DraftState> {
  const sections = await mapPictures<PicRef, Picture>(data.sections ?? [], async (r) => {
    const res = await apiFetch(`/files/${r.fileId}`)
    if (!res.ok) throw new ApiError(res.status, `그림(${r.name})을 불러오지 못했습니다.`)
    const blob = await res.blob()
    const file = new File([blob], r.name, { type: blob.type })
    uploaded.set(file, r.fileId)
    return { url: URL.createObjectURL(file), name: r.name, width: r.width, height: r.height, file }
  })
  // 섹션·항목 번호는 이 화면에서 새로 매긴다(새로 더하는 섹션과 겹치지 않게)
  const fresh = sections.map((s) => {
    const base = { ...s, id: nextId() } as Section
    if (base.kind === "qa") return { ...base, items: base.items.map((it) => ({ ...it, id: nextId() })) }
    if (base.kind === "ship") {
      return { ...base, products: base.products.map((p) => ({ ...p, id: nextId() })), ice: base.ice.map((p) => ({ ...p, id: nextId() })) }
    }
    return base
  })
  return { product: data.product ?? "", category: data.category ?? "", number: data.number ?? "", sections: fresh }
}

export function DraftBar({
  state,
  current,
  onSaved,
  onLoad,
}: {
  state: DraftState
  current: CurrentDraft | null
  onSaved: (d: CurrentDraft) => void
  onLoad: (state: DraftState, d: CurrentDraft) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState<"new" | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const save = async (title: string, asNew: boolean) => {
    setBusy("저장 중")
    setError(null)
    try {
      const body = { title, ...(await serialize(state)) }
      const r =
        current && !asNew
          ? await api<{ id: string; updatedAt: number }>(`/tools/detail-drafts/${current.id}`, { method: "PUT", body })
          : await api<{ id: string; updatedAt: number }>("/tools/detail-drafts", { body })
      onSaved({ id: r.id, title, savedAt: r.updatedAt })
      setNaming(null)
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const load = async (item: DraftListItem) => {
    if (
      state.sections.length > 0 &&
      !(await confirmDialog({
        title: `"${item.title}" 을(를) 불러올까요?`,
        description: "지금 화면에 만들던 내용은 사라집니다(저장하지 않았다면 먼저 임시 저장하세요).",
        confirmText: "불러오기",
      }))
    )
      return
    setBusy("불러오는 중")
    setError(null)
    try {
      const d = await api<{ id: string; title: string; data: DraftState; updatedAt: number }>(`/tools/detail-drafts/${item.id}`)
      onLoad(await deserialize(d.data), { id: d.id, title: d.title, savedAt: d.updatedAt })
      setListOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "불러오지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => (current ? void save(current.title, false) : setNaming("new"))}>
          {busy === "저장 중" ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Save data-icon="inline-start" />}
          임시 저장
        </Button>
        {current && (
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setNaming("new")}>
            새 이름으로 저장
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setListOpen(true)}>
          {busy === "불러오는 중" ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <FolderOpen data-icon="inline-start" />}
          불러오기
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {current ? `"${current.title}" · ${formatDateTime(new Date(current.savedAt))} 저장` : "저장 안 됨"}
        </span>
      </div>
      {error && <FieldError>{error}</FieldError>}

      <NameDialog
        open={naming !== null}
        initial={current ? `${current.title} (사본)` : state.product.trim()}
        busy={busy === "저장 중"}
        onClose={() => setNaming(null)}
        onSave={(title) => void save(title, true)}
      />
      <DraftList open={listOpen} onClose={() => setListOpen(false)} onPick={(d) => void load(d)} busy={busy !== null} />
    </div>
  )
}

function NameDialog({ open, initial, busy, onClose, onSave }: { open: boolean; initial: string; busy: boolean; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState(initial)
  const [shownFor, setShownFor] = useState(false)
  if (open !== shownFor) {
    setShownFor(open)
    if (open) setTitle(initial)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>임시 저장</DialogTitle>
          <DialogDescription>나중에 불러오기에서 이 이름으로 찾습니다.</DialogDescription>
        </DialogHeader>
        <form
          id="dp-draft-name"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) onSave(title.trim())
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="dp-draft-title">이름</FieldLabel>
              <Input id="dp-draft-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 통영생굴무침 (고시 대기)" autoFocus />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="dp-draft-name" disabled={busy || !title.trim()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DraftList({ open, onClose, onPick, busy }: { open: boolean; onClose: () => void; onPick: (d: DraftListItem) => void; busy: boolean }) {
  const { data, error } = useApi<DraftListItem[]>(open ? "/tools/detail-drafts" : null)
  const userName = useUserNames()
  const [query, setQuery] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const rows = (data ?? []).filter((d) => !query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase()))

  const remove = async (d: DraftListItem) => {
    if (!(await confirmDialog({ title: `"${d.title}" 을(를) 지울까요?`, description: "저장해 둔 내용과 그림이 지워집니다.", confirmText: "삭제", destructive: true }))) return
    setFailed(null)
    try {
      await api(`/tools/detail-drafts/${d.id}`, { method: "DELETE" })
      invalidate()
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : "지우지 못했습니다.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>임시 저장 불러오기</DialogTitle>
          <DialogDescription>저장해 둔 상세페이지를 불러와 이어서 만듭니다.</DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 찾기" aria-label="이름으로 찾기" />
        {failed && <FieldError>{failed}</FieldError>}
        <SmoothScrollArea className="max-h-96 overflow-y-auto" contentClassName="flex flex-col gap-1">
          {!data ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{error ?? "불러오는 중…"}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">임시 저장한 것이 없습니다.</p>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border p-2">
                <button type="button" className="flex min-w-0 flex-1 flex-col text-left disabled:opacity-50" disabled={busy} onClick={() => onPick(d)}>
                  <span className="truncate font-medium hover:underline">{d.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {userName(d.updatedBy)} · {formatDateTime(new Date(d.updatedAt))} · 그림 {d.images}장
                  </span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label={`${d.title} 지우기`} onClick={() => void remove(d)}>
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </SmoothScrollArea>
      </DialogContent>
    </Dialog>
  )
}
