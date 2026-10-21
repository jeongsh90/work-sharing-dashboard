import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api"
import { EVENT_LABEL, STATUS_LABEL, timeAgo, type RequestDetailDto } from "@/lib/requests"
import { STATUS_TEXT } from "@/lib/status-colors"
import { invalidate, useUserNames } from "@/lib/store"

// 진행 기록(상태 변경)과 요청 전체 댓글을 시간 순으로 한 줄에 보여 준다.
export function Timeline({ detail }: { detail: RequestDetailDto }) {
  const userName = useUserNames()
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = [
    ...detail.events.map((e) => ({ key: `e${e.id}`, at: e.createdAt, event: e, comment: null })),
    ...detail.comments.map((c) => ({ key: `c${c.id}`, at: c.createdAt, event: null, comment: c })),
  ].sort((a, b) => a.at - b.at)

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setPending(true)
    setError(null)
    try {
      await api(`/requests/${detail.id}/comments`, { body: { body } })
      setBody("")
      invalidate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "댓글을 남기지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {items.map(({ key, at, event, comment }, i) => (
          <li key={key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span className="absolute top-4 bottom-0 left-[5px] w-px bg-border" aria-hidden />}
            <span
              className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ${comment ? "border-2 border-muted-foreground bg-card" : "bg-foreground"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{userName(event?.actorId ?? comment?.authorId)}</span>
                {event && <span>{EVENT_LABEL[event.type] ?? event.type}</span>}
                {event?.toStatus && event.toStatus !== event.fromStatus && (
                  <span className={STATUS_TEXT[event.toStatus]}>→ {STATUS_LABEL[event.toStatus]}</span>
                )}
                <span>{timeAgo(new Date(at))}</span>
              </p>
              {event?.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{event.note}</p>}
              {comment && <p className="mt-0.5 whitespace-pre-wrap break-words">{comment.body}</p>}
            </div>
          </li>
        ))}
      </ol>
      {detail.actions.includes("comment") && (
        <form onSubmit={send} className="flex flex-col gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="요청 전체에 대한 댓글"
            aria-label="댓글"
            maxLength={2000}
            className="min-h-16"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" variant="secondary" className="self-end" disabled={pending || !body.trim()}>
            댓글 남기기
          </Button>
        </form>
      )}
    </div>
  )
}
