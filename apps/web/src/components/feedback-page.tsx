import { useEffect, useState } from "react"
import { Pencil, SquarePen, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { timeAgo } from "@/lib/requests"
import { markSeen } from "@/lib/seen"
import { invalidate, useApi, useUserNames } from "@/lib/store"

// 건의게시판. 누구나 쓰고, 관리자가 처리 상태와 답변을 남긴다(apps/api/src/suggestions.ts).

type SuggestionStatus = "open" | "reviewing" | "done" | "declined"

type Suggestion = {
  id: number
  authorId: string
  authorName: string
  title: string
  body: string
  status: SuggestionStatus
  reply: string
  repliedBy: string | null
  repliedAt: number | null
  createdAt: number
}

const STATUS: Record<SuggestionStatus, { label: string; className: string }> = {
  open: { label: "접수", className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  reviewing: { label: "검토 중", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  done: { label: "반영 완료", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  declined: { label: "보류", className: "bg-muted text-muted-foreground" },
}

function WriteForm() {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return setError("제목과 내용을 입력해 주세요.")
    setPending(true)
    setError(null)
    try {
      await api("/suggestions", { body: { title, body } })
      setTitle("")
      setBody("")
      setDone(true)
      invalidate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "등록하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>건의하기</CardTitle>
        <CardDescription>불편한 점이나 있었으면 하는 기능을 자유롭게 적어 주세요. 관리자가 확인 후 답변드립니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="fb-title">제목</FieldLabel>
              <Input
                id="fb-title"
                value={title}
                maxLength={100}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setDone(false)
                }}
                placeholder="예: 요청서에 참고 링크 칸이 있었으면 좋겠어요"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="fb-body">내용</FieldLabel>
              <Textarea
                id="fb-body"
                value={body}
                maxLength={5000}
                onChange={(e) => {
                  setBody(e.target.value)
                  setDone(false)
                }}
                className="min-h-28"
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <div className="flex items-center justify-end gap-3">
              {done && <span className="text-sm text-emerald-700 dark:text-emerald-300">등록했습니다.</span>}
              <Button type="submit" disabled={pending}>
                {pending ? "등록 중…" : "건의 등록"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function SuggestionItem({ item, session }: { item: Suggestion; session: Session }) {
  const manager = isManager(session)
  const userName = useUserNames()
  const [status, setStatus] = useState(item.status)
  const [reply, setReply] = useState(item.reply)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canDelete = manager || (item.authorId === session.id && item.status === "open")
  const changed = status !== item.status || reply.trim() !== item.reply

  const run = async (work: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await work()
      invalidate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처리하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <Badge variant="secondary" className={STATUS[item.status].className}>
          {STATUS[item.status].label}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            {item.authorName} · {timeAgo(new Date(item.createdAt))}
          </p>
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${item.title} 삭제`}
            disabled={pending}
            onClick={() => window.confirm("이 건의글을 지울까요?") && run(() => api(`/suggestions/${item.id}`, { method: "DELETE" }))}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap break-words">{item.body}</p>
      {item.reply && !manager && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="mb-1 text-xs text-muted-foreground">
            답변 · {userName(item.repliedBy)} {item.repliedAt ? `· ${timeAgo(new Date(item.repliedAt))}` : ""}
          </p>
          <p className="whitespace-pre-wrap break-words">{item.reply}</p>
        </div>
      )}
      {manager && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">처리 상태</span>
            <Select value={status} onValueChange={(v) => setStatus(v as SuggestionStatus)}>
              <SelectTrigger size="sm" className="w-32" aria-label="처리 상태">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS) as SuggestionStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {item.repliedAt && (
              <span className="ml-auto text-xs text-muted-foreground">
                답변 {userName(item.repliedBy)} · {timeAgo(new Date(item.repliedAt))}
              </span>
            )}
          </div>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="답변(작성자에게 알림이 갑니다)"
            aria-label={`${item.title} 답변`}
            maxLength={5000}
            className="min-h-16 bg-background"
          />
          <Button
            size="sm"
            className="self-end"
            disabled={pending || !changed}
            onClick={() => run(() => api(`/suggestions/${item.id}`, { method: "PATCH", body: { status, reply } }))}
          >
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  )
}

type RoadmapStatus = "예정" | "검토 중" | "진행 중" | "완료"
type RoadmapItem = { id: number; title: string; status: RoadmapStatus }
const ROADMAP_STATUSES: RoadmapStatus[] = ["예정", "검토 중", "진행 중", "완료"]

const ROADMAP_STYLE: Record<RoadmapStatus, string> = {
  예정: "bg-muted text-muted-foreground",
  "검토 중": "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "진행 중": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  완료: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
}

// 업데이트 예정 기능 쓰기·고치기 창. item 이 없으면 새로 쓴다.
function RoadmapDialog({ item, onClose }: { item: RoadmapItem | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "")
  const [status, setStatus] = useState<RoadmapStatus>(item?.status ?? "예정")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (method: "POST" | "PATCH" | "DELETE") => {
    if (method === "DELETE" && !window.confirm(`"${item?.title}" 항목을 지울까요?`)) return
    setPending(true)
    setError(null)
    try {
      const path = item ? `/roadmap/${item.id}` : "/roadmap"
      await api(path, { method, body: method === "DELETE" ? undefined : { title, status } })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "업데이트 예정 기능 수정" : "업데이트 예정 기능 추가"}</DialogTitle>
          <DialogDescription>건의게시판 오른쪽 목록에 보입니다.</DialogDescription>
        </DialogHeader>
        <form
          id="roadmap-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(item ? "PATCH" : "POST")
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="roadmap-title">기능</FieldLabel>
              <Input
                id="roadmap-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 디자인팀 일정 주간 보기"
                maxLength={100}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="roadmap-status">상태</FieldLabel>
              <Select value={status} onValueChange={(v) => setStatus(v as RoadmapStatus)}>
                <SelectTrigger id="roadmap-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROADMAP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter className="sm:justify-between">
          {item ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => run("DELETE")}>
              <Trash2 data-icon="inline-start" />
              삭제
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" form="roadmap-form" disabled={pending || !title.trim()}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 업데이트 예정 기능 한 줄. 완료한 기능은 줄을 그어 흐리게
function RoadmapRow({ item: r, canEdit, onEdit }: { item: RoadmapItem; canEdit: boolean; onEdit: () => void }) {
  return (
    <li className="group flex items-start gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
      <Badge variant="secondary" className={`shrink-0 ${ROADMAP_STYLE[r.status]}`}>
        {r.status}
      </Badge>
      <span className={`min-w-0 flex-1 break-words ${r.status === "완료" ? "text-muted-foreground line-through" : ""}`}>{r.title}</span>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`${r.title} 수정`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      )}
    </li>
  )
}

// 건의게시판 오른쪽: 업데이트 예정 기능(서버 roadmap). admin·정상훈만 쓰고 고친다(서버 ROADMAP_EDITORS).
function Roadmap() {
  const { data } = useApi<{ canEdit: boolean; items: RoadmapItem[] }>("/roadmap", 300_000)
  const [editing, setEditing] = useState<RoadmapItem | "new" | null>(null)
  const canEdit = data?.canEdit ?? false

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>업데이트 예정 기능</CardTitle>
        <CardDescription>건의와 운영 의견을 모아 순서대로 반영합니다.</CardDescription>
        {canEdit && (
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="업데이트 예정 기능 추가" title="추가" onClick={() => setEditing("new")}>
              <SquarePen />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {data && data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 적어 둔 예정 기능이 없습니다.</p>
        ) : (
          // 진행 중인 항목 먼저, 완료한 항목은 아래 "완료" 묶음으로 나눈다
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col divide-y">
              {data?.items
                .filter((r) => r.status !== "완료")
                .map((r) => <RoadmapRow key={r.id} item={r} canEdit={canEdit} onEdit={() => setEditing(r)} />)}
            </ul>
            {data?.items.some((r) => r.status === "완료") && (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  완료
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </p>
                <ul className="flex flex-col divide-y">
                  {data.items
                    .filter((r) => r.status === "완료")
                    .map((r) => <RoadmapRow key={r.id} item={r} canEdit={canEdit} onEdit={() => setEditing(r)} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
      {editing && (
        <RoadmapDialog
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export function FeedbackPage({ session }: { session: Session }) {
  const { data, error } = useApi<Suggestion[]>("/suggestions", 60_000)
  // 들어와서 목록을 받으면 지금 가장 최근 글까지 읽은 것으로 본다(메뉴의 N 표시가 사라진다).
  const latest = data?.reduce((max, s) => Math.max(max, s.id), 0) ?? 0
  useEffect(() => {
    if (latest > 0) markSeen(session.id, "feedback", String(latest))
  }, [latest, session.id])

  return (
    <div className={PAGE_GRID}>
      <aside className="col-span-12 lg:order-last lg:col-span-4">
        <Roadmap />
      </aside>
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-8">
        <WriteForm />
        <Section title="건의 목록" aside={data && <span className="text-sm text-muted-foreground">{data.length}건</span>}>
          {!data ? (
            <PageState error={error} />
          ) : data.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">아직 건의글이 없습니다.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {data.map((item) => (
                <SuggestionItem key={`${item.id}-${item.status}-${item.reply}`} item={item} session={session} />
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  )
}
