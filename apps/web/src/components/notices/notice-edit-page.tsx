import { useEffect, useState } from "react"
import { FileText, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageState } from "@/components/page-state"
import { FilePicker } from "@/components/requests/file-picker"
import { NOTICE_COLUMN } from "@/components/notices/notice-detail-page"
import { RichEditor } from "@/components/notices/rich-editor"
import { api, ApiError, formatBytes, uploadAll } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { CATEGORY_STYLE, NOTICE_CATEGORIES, toStoredHtml, toViewHtml, type NoticeCategory, type NoticeDetail, type NoticeFile } from "@/lib/notices"
import { navigate } from "@/lib/router"
import { invalidate } from "@/lib/store"

// 공지사항 쓰기·고치기(관리자). id 가 "new" 면 새 글.
type Draft = { title: string; html: string; category: NoticeCategory; pinned: boolean; files: NoticeFile[] }

export function NoticeEditPage({ id }: { id: string }) {
  const isNew = id === "new"
  const [draft, setDraft] = useState<Draft | null>(isNew ? { title: "", html: "", category: "notice", pinned: false, files: [] } : null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    if (isNew) return
    let alive = true
    api<NoticeDetail>(`/notices/${id}`).then(
      async (d) => {
        // 본문 그림을 에디터에서 보이게 주소를 채워 넣는다(저장할 때 다시 뺀다)
        const html = await toViewHtml(d.body)
        if (alive) setDraft({ title: d.title, html, category: d.category ?? "notice", pinned: d.pinned, files: d.files })
      },
      (e: Error) => alive && setLoadError(e.message),
    )
    return () => {
      alive = false
    }
  }, [id, isNew])
  if (!draft) return <PageState error={loadError} />
  return <NoticeForm key={id} id={id} initial={draft} />
}

function NoticeForm({ id, initial }: { id: string; initial: Draft }) {
  const isNew = id === "new"
  const [title, setTitle] = useState(initial.title)
  const [html, setHtml] = useState(initial.html)
  const [category, setCategory] = useState<NoticeCategory>(initial.category)
  const [pinned, setPinned] = useState(initial.pinned)
  const [notify, setNotify] = useState(true)
  const [kept, setKept] = useState(initial.files)
  const [added, setAdded] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [titleError, setTitleError] = useState(false)
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!title.trim()) {
      setTitleError(true)
      return
    }
    setPending(true)
    setError(null)
    try {
      const uploaded = await uploadAll(added)
      const body = {
        title: title.trim(),
        body: toStoredHtml(html),
        category,
        pinned,
        fileIds: [...kept.map((f) => f.id), ...uploaded.map((f) => f.id)],
        ...(isNew && { notify }),
      }
      const res = isNew
        ? await api<{ id: number }>("/notices", { body })
        : await api<{ id: number }>(`/notices/${id}`, { method: "PATCH", body })
      invalidate()
      navigate("notice-detail", String(res.id))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다. 다시 시도해 주세요.")
      setPending(false)
    }
  }

  return (
    <div className={PAGE_GRID}>
      <form
        className={`${NOTICE_COLUMN} flex flex-col gap-1`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 className="text-base font-semibold">{isNew ? "공지사항 쓰기" : "공지사항 고치기"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {isNew ? "등록하면 모든 사람의 공지사항 메뉴에 N 표시가 뜨고, 알림을 켜 두면 알림도 갑니다." : "고친 내용은 바로 반영됩니다."}
        </p>
        <FieldGroup>
          {/* 말머리: 제목 앞에 붙는 배지. 하나만 고른다(체크하면 다른 것은 풀린다) */}
          <Field>
            <FieldLabel>말머리</FieldLabel>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="말머리">
              {NOTICE_CATEGORIES.map((c) => (
                <Label
                  key={c}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 font-semibold transition-colors ${category === c ? `border-transparent ${CATEGORY_STYLE[c].className}` : "text-muted-foreground hover:bg-accent"}`}
                >
                  <Checkbox checked={category === c} onCheckedChange={(v) => v === true && setCategory(c)} aria-label={CATEGORY_STYLE[c].label} />
                  {CATEGORY_STYLE[c].label}
                </Label>
              ))}
            </div>
          </Field>
          <Field data-invalid={titleError}>
            <FieldLabel htmlFor="notice-title">제목</FieldLabel>
            <Input
              id="notice-title"
              value={title}
              maxLength={150}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleError(false)
              }}
              placeholder="예: 11월 디자인 요청 마감 시간 안내"
              aria-invalid={titleError}
              autoFocus={isNew}
            />
            {titleError && <FieldError>제목을 입력해 주세요.</FieldError>}
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Label className="flex cursor-pointer items-center gap-2 font-normal">
              <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(v === true)} />
              목록 맨 위에 고정
            </Label>
            {isNew && (
              <Label className="flex cursor-pointer items-center gap-2 font-normal">
                <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} />
                모든 사람에게 알림 보내기
              </Label>
            )}
          </div>
          <Field>
            <FieldLabel>내용</FieldLabel>
            <RichEditor initialHtml={initial.html} onChange={setHtml} onError={setError} />
          </Field>
          <Field>
            <FieldLabel>첨부 파일</FieldLabel>
            {kept.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-lg border p-1">
                {kept.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${f.name} 빼기`}
                      onClick={() => setKept((list) => list.filter((x) => x.id !== f.id))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <FilePicker files={added} onChange={setAdded} hint="여러 개를 함께 올릴 수 있습니다." />
            <FieldDescription>본문 그림은 에디터의 그림 버튼으로 넣고, 내려받을 파일은 여기에 붙입니다.</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => (isNew ? navigate("notices") : navigate("notice-detail", id))}
            >
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중…" : isNew ? "등록" : "저장"}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  )
}
