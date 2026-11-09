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
import { LANE_LABEL, LANE_STATUSES, laneText, type Lane, type LaneStatus } from "@/lib/requests"
import { invalidate } from "@/lib/store"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

// 개별 컨펌: 작업자 한 사람의 진행 상태 배지.
// 슈퍼관리자·관리자는 눌러서 바로 바꾼다(서버 setPartStatus). 올린 시안·원본 파일은 지우지 않는다.
export function PartStatus({
  requestId,
  lane,
  name,
  canChange,
}: {
  requestId: number
  lane: Lane
  name: string
  canChange: boolean
}) {
  const [pending, setPending] = useState(false)
  const label = laneText(lane)
  const badge = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BG[lane.status]} ${STATUS_TEXT[lane.status]}`

  if (!canChange) return <span className={badge}>{label}</span>

  const change = async (next: LaneStatus) => {
    if (next === lane.status || pending) return
    const ok = await confirmDialog({
      title: `${name}님 상태를 ${LANE_LABEL[next]}(으)로 바꿀까요?`,
      description:
        "관리자가 바로 바꾸는 것이라 시안 올리기·컨펌 없이 상태만 바뀝니다(올린 시안·원본 파일은 지우지 않습니다). 요청 전체 상태는 작업자 상태들에 맞춰 다시 정해집니다.",
      confirmText: "바꾸기",
    })
    if (!ok) return
    setPending(true)
    try {
      await api(`/requests/${requestId}/part-status`, { body: { userId: lane.userId, status: next } })
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
        <button
          type="button"
          className={`${badge} cursor-pointer hover:opacity-80 disabled:opacity-50`}
          disabled={pending}
          aria-label={`${name} 상태 바꾸기 (지금 ${label})`}
        >
          {pending ? "바꾸는 중…" : label}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{name} 상태 (관리자)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={lane.status} onValueChange={(v) => void change(v as LaneStatus)}>
          {LANE_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {LANE_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
