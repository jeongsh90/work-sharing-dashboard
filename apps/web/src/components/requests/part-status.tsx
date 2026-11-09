import { useState } from "react"
import { ChevronDown } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { confirmDialog } from "@/components/confirm-dialog"
import { api, ApiError } from "@/lib/api"
import { invalidate } from "@/lib/store"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

// 개별 컨펌: 작업자 한 사람의 이번 차수 상태(작업 중 / 컨펌 대기).
// 슈퍼관리자·관리자는 눌러서 바꾼다(서버 setPartStatus). 올린 시안 파일은 지우지 않는다.
export function PartStatus({
  requestId,
  userId,
  name,
  done,
  canChange,
}: {
  requestId: number
  userId: string
  name: string
  done: boolean
  canChange: boolean
}) {
  const [pending, setPending] = useState(false)
  const status = done ? "review" : "in-progress"
  const label = done ? "컨펌 대기" : "작업 중"
  const badge = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BG[status]} ${STATUS_TEXT[status]}`

  if (!canChange) return <span className={badge}>{label}</span>

  const change = async (next: boolean) => {
    if (next === done || pending) return
    const nextLabel = next ? "컨펌 대기" : "작업 중"
    const ok = await confirmDialog({
      title: `${name}님 상태를 ${nextLabel}(으)로 바꿀까요?`,
      description: next
        ? "이 작업자는 이번 차수 시안을 올린 것으로 처리됩니다. 모든 작업자가 컨펌 대기가 되면 요청자에게 컨펌 요청이 갑니다."
        : "이 작업자는 이번 차수 시안을 다시 올려야 합니다(이미 올린 시안은 지우지 않습니다). 요청이 컨펌 대기였다면 작업 중으로 돌아갑니다.",
      confirmText: "바꾸기",
    })
    if (!ok) return
    setPending(true)
    try {
      await api(`/requests/${requestId}/part-status`, { body: { userId, done: next } })
      invalidate()
    } catch (e) {
      await confirmDialog({ title: "바꾸지 못했습니다", description: e instanceof ApiError ? e.message : "잠시 후 다시 시도해 주세요.", confirmText: "확인" })
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`${badge} cursor-pointer hover:opacity-80 disabled:opacity-50`} disabled={pending} aria-label={`${name} 상태 바꾸기 (지금 ${label})`}>
          {pending ? "바꾸는 중…" : label}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{name} 상태 (관리자)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={done ? "done" : "working"} onValueChange={(v) => void change(v === "done")}>
          <DropdownMenuRadioItem value="working">작업 중</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="done">컨펌 대기</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
