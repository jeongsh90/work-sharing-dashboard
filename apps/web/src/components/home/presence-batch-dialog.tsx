import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api"
import { PRESENCE_DOT, PRESENCE_LABEL, type Presence } from "@/lib/presence"
import { cn } from "@/lib/utils"

// 관리자: 디자인팀 상태를 여러 명 한 번에 바꾼다(퇴근·회의 중 등). 처음엔 모두 골라 둔다.
export function PresenceBatchDialog({
  designers,
  presence,
  onApply,
  onClose,
}: {
  designers: { id: string; name: string }[]
  presence: Record<string, Presence>
  onApply: (ids: string[], p: Presence) => Promise<void>
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(designers.map((d) => d.id)))
  const [status, setStatus] = useState<Presence | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const all = picked.size === designers.length

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const apply = async () => {
    if (!status || picked.size === 0) return
    setPending(true)
    setError(null)
    try {
      await onApply([...picked], status)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "바꾸지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>상태 일괄 변경</DialogTitle>
          <DialogDescription>바꿀 사람과 상태를 고르세요. 디자인팀 카드에 바로 보입니다.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="flex cursor-pointer items-center gap-2 border-b pb-2 font-medium">
            <Checkbox
              checked={all ? true : picked.size > 0 ? "indeterminate" : false}
              onCheckedChange={(v) => setPicked(v === true ? new Set(designers.map((d) => d.id)) : new Set())}
            />
            전체 ({picked.size}/{designers.length})
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {designers.map((d) => {
              const now = presence[d.id] ?? "off"
              return (
                <Label key={d.id} className="flex cursor-pointer items-center gap-2 font-normal">
                  <Checkbox checked={picked.has(d.id)} onCheckedChange={(v) => toggle(d.id, v === true)} />
                  <span className="truncate">{d.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <span className={cn("size-1.5 rounded-full", PRESENCE_DOT[now])} aria-hidden />
                    {PRESENCE_LABEL[now]}
                  </span>
                </Label>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">바꿀 상태</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
              <Button
                key={p}
                type="button"
                variant={status === p ? "default" : "outline"}
                aria-pressed={status === p}
                onClick={() => setStatus(p)}
              >
                <span className={cn("size-2 rounded-full", PRESENCE_DOT[p])} aria-hidden />
                {PRESENCE_LABEL[p]}
              </Button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={!status || picked.size === 0 || pending} onClick={apply}>
            {pending ? "바꾸는 중…" : `${picked.size}명 변경`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
