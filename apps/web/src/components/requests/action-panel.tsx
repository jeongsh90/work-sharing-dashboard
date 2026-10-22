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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BottomBar } from "@/components/bottom-bar"
import { FilePicker } from "@/components/requests/file-picker"
import { api, ApiError, uploadAll } from "@/lib/api"
import type { RequestAction, RequestDetailDto } from "@/lib/requests"
import { invalidate, isDesignWorker, useUsers } from "@/lib/store"

// 진행 동작 버튼. 어떤 버튼이 보일지는 서버가 준 actions 로 정한다(apps/api/src/requests.ts).

type DialogSpec = {
  title: string
  description: string
  confirm: string
  note?: { label: string; placeholder: string; required?: boolean }
  files?: { label: string; hint: string; images?: boolean; required?: boolean }
  designers?: boolean
  destructive?: boolean
}

type ActionSpec = { label: string; dialog?: DialogSpec }

const ACTIONS: Partial<Record<RequestAction, ActionSpec>> = {
  take: { label: "내가 맡기" },
  assign: {
    label: "담당 지정",
    dialog: {
      title: "담당 작업자 지정",
      description: "첫 번째로 고른 사람이 주 담당입니다. 요청됨 상태면 작업 대기로 바뀝니다.",
      confirm: "지정",
      designers: true,
    },
  },
  start: { label: "작업 시작" },
  submit: {
    label: "컨펌 요청",
    dialog: {
      title: "시안 컨펌 요청",
      description: "시안 이미지를 올리면 요청자에게 컨펌 요청 알림이 갑니다.",
      confirm: "컨펌 요청 보내기",
      files: { label: "시안 이미지", hint: "PNG·JPG·GIF·WEBP 이미지, 여러 장 가능", images: true, required: true },
      note: { label: "전달 메모", placeholder: "확인할 부분이나 수정 반영 내용을 적어 주세요(선택)" },
    },
  },
  approve: {
    label: "컨펌",
    dialog: {
      title: "시안 컨펌",
      description: "이 시안으로 확정합니다. 작업자가 최종 파일을 정리해 작업 완료 처리합니다.",
      confirm: "컨펌",
      note: { label: "메모", placeholder: "전달할 말이 있으면 적어 주세요(선택)" },
    },
  },
  reject: {
    label: "반려",
    dialog: {
      title: "시안 반려",
      description: "작업자에게 수정 요청이 갑니다. 이미지에 꽂은 핀 댓글도 함께 전달됩니다.",
      confirm: "반려",
      destructive: true,
      note: { label: "반려 사유", placeholder: "전체적으로 고칠 점을 적어 주세요. 핀 댓글이 있으면 비워 둬도 됩니다." },
    },
  },
  complete: {
    label: "작업 완료",
    dialog: {
      title: "작업 완료",
      description: "요청자에게 완료 알림이 가고 최종 파일 보관함에 올라갑니다.",
      confirm: "작업 완료",
      files: { label: "최종 파일", hint: "원본(PSD·AI)이나 최종 이미지(선택)" },
      note: { label: "메모", placeholder: "선택" },
    },
  },
  "request-info": {
    label: "보완 요청",
    dialog: {
      title: "요청 보완 요청",
      description: "요청자에게 무엇을 더 알려 줘야 하는지 전달합니다.",
      confirm: "보완 요청",
      note: { label: "보완할 내용", placeholder: "예: 배너 규격과 들어갈 문구를 알려 주세요", required: true },
    },
  },
  resubmit: {
    label: "보완 완료",
    dialog: {
      title: "보완 완료",
      description: "요청 내용을 고친 뒤 눌러 주세요. 디자인팀에 다시 알림이 갑니다.",
      confirm: "보완 완료",
      note: { label: "메모", placeholder: "보완한 내용(선택)" },
    },
  },
  cancel: {
    label: "요청 취소",
    dialog: {
      title: "요청 취소",
      description: "취소한 요청은 되돌릴 수 없습니다.",
      confirm: "요청 취소",
      destructive: true,
      note: { label: "취소 사유", placeholder: "선택" },
    },
  },
}

// 진행 버튼 크기: 기본 버튼의 1.5배(높이 48px)
const BAR_BUTTON = "h-12 px-6 text-base"

// 진행 버튼 색: 누르면 바뀌는 상태의 배지 색(lib/status-colors.ts 와 같은 계열)으로 칠한다.
// 예) 작업 시작 → 작업 중(파랑), 컨펌 요청 → 시안 확인(보라), 반려 → 수정 중(주황), 작업 완료 → 완료(초록)
// 모두 외곽선 형태: 테두리·글자만 상태 색, 마우스를 올리면 같은 색으로 옅게 칠한다.
const ACTION_COLOR: Partial<Record<RequestAction, string>> = {
  take: "border-sky-500 text-sky-700 hover:bg-sky-500/10 hover:text-sky-700 dark:border-sky-500/70 dark:text-sky-300 dark:hover:bg-sky-500/15 dark:hover:text-sky-300",
  assign: "border-sky-500 text-sky-700 hover:bg-sky-500/10 hover:text-sky-700 dark:border-sky-500/70 dark:text-sky-300 dark:hover:bg-sky-500/15 dark:hover:text-sky-300",
  start: "border-blue-500 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:border-blue-500/70 dark:text-blue-300 dark:hover:bg-blue-500/15 dark:hover:text-blue-300",
  submit: "border-violet-500 text-violet-700 hover:bg-violet-500/10 hover:text-violet-700 dark:border-violet-500/70 dark:text-violet-300 dark:hover:bg-violet-500/15 dark:hover:text-violet-300",
  approve: "border-teal-500 text-teal-700 hover:bg-teal-500/10 hover:text-teal-700 dark:border-teal-500/70 dark:text-teal-300 dark:hover:bg-teal-500/15 dark:hover:text-teal-300",
  reject: "border-orange-500 text-orange-700 hover:bg-orange-500/10 hover:text-orange-700 dark:border-orange-500/70 dark:text-orange-300 dark:hover:bg-orange-500/15 dark:hover:text-orange-300",
  complete: "border-emerald-500 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:border-emerald-500/70 dark:text-emerald-300 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-300",
  "request-info": "border-amber-500 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:border-amber-500/70 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:hover:text-amber-300",
  resubmit: "border-slate-500 text-slate-700 hover:bg-slate-500/10 hover:text-slate-700 dark:border-slate-500/70 dark:text-slate-300 dark:hover:bg-slate-500/15 dark:hover:text-slate-300",
  // 취소는 되돌릴 수 없으므로 빨간색
  cancel: "border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/60",
}

// 버튼 순서: 주요 동작 먼저, 취소는 맨 끝
const ORDER: RequestAction[] = ["take", "start", "submit", "approve", "reject", "complete", "resubmit", "assign", "request-info", "cancel"]

export function ActionPanel({
  detail,
  onEdit,
  onChanged,
}: {
  detail: RequestDetailDto
  onEdit: () => void
  onChanged: (next: RequestDetailDto) => void
}) {
  const [open, setOpen] = useState<RequestAction | null>(null)
  const [pending, setPending] = useState<RequestAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const perform = async (action: RequestAction, body: Record<string, unknown> = {}) => {
    const next = await api<RequestDetailDto>(`/requests/${detail.id}/actions/${action}`, { body })
    invalidate()
    onChanged(next)
  }

  const direct = async (action: RequestAction) => {
    setPending(action)
    setError(null)
    try {
      await perform(action)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "처리하지 못했습니다.")
    } finally {
      setPending(null)
    }
  }

  const available = ORDER.filter((a) => detail.actions.includes(a) && ACTIONS[a])
  const spec = open ? ACTIONS[open] : null

  if (available.length === 0 && !detail.actions.includes("edit")) return null

  return (
    <>
      {/* 화면 하단 고정 막대. 가려지는 내용이 없게 상세 화면이 아래쪽 여백(pb-28)을 둔다 */}
      <BottomBar>
        <div className="flex flex-wrap justify-center gap-2">
          {available.map((a) => {
            const s = ACTIONS[a]!
            return (
              <Button
                key={a}
                variant="outline"
                className={`${BAR_BUTTON} ${ACTION_COLOR[a] ?? ""}`}
                disabled={pending !== null}
                onClick={() => (s.dialog ? setOpen(a) : direct(a))}
              >
                {pending === a ? "처리 중…" : s.label}
              </Button>
            )
          })}
          {detail.actions.includes("edit") && (
            <Button variant="outline" className={BAR_BUTTON} onClick={onEdit}>
              요청 수정
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </BottomBar>
      {open && spec?.dialog && (
        <ActionDialog
          key={open}
          spec={spec.dialog}
          detail={detail}
          onClose={() => setOpen(null)}
          onConfirm={async (body) => {
            await perform(open, body)
            setOpen(null)
          }}
        />
      )}
    </>
  )
}

function ActionDialog({
  spec,
  detail,
  onClose,
  onConfirm,
}: {
  spec: DialogSpec
  detail: RequestDetailDto
  onClose: () => void
  onConfirm: (body: Record<string, unknown>) => Promise<void>
}) {
  const { users } = useUsers()
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [designerIds, setDesignerIds] = useState<string[]>(detail.designers)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // 담당 후보: 작업자(디자인팀 관리자 포함) 전체와 이미 담당인 사람
  const candidates = users?.filter((u) => u.active && u.approved && (isDesignWorker(u) || detail.designers.includes(u.id))) ?? []

  const confirm = async () => {
    if (spec.note?.required && !note.trim()) return setError(`${spec.note.label}을(를) 적어 주세요.`)
    if (spec.files?.required && files.length === 0) return setError(`${spec.files.label}을(를) 올려 주세요.`)
    if (spec.designers && designerIds.length === 0) return setError("담당 작업자를 한 명 이상 골라 주세요.")
    setPending(true)
    setError(null)
    try {
      const uploaded = await uploadAll(files)
      await onConfirm({ note, fileIds: uploaded.map((f) => f.id), designerIds })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "처리하지 못했습니다.")
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {spec.designers && (
            <Field>
              <FieldLabel>담당 작업자</FieldLabel>
              <ul className="grid grid-cols-2 gap-2">
                {candidates.map((u) => {
                  const checked = designerIds.includes(u.id)
                  const order = designerIds.indexOf(u.id)
                  return (
                    <li key={u.id}>
                      <Label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 font-normal has-data-[state=checked]:border-primary">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setDesignerIds(v ? [...designerIds, u.id] : designerIds.filter((id) => id !== u.id))
                          }
                        />
                        <span className="flex-1">{u.name}</span>
                        {order === 0 && <span className="text-xs text-muted-foreground">주 담당</span>}
                      </Label>
                    </li>
                  )
                })}
              </ul>
            </Field>
          )}
          {spec.files && (
            <Field>
              <FieldLabel>{spec.files.label}</FieldLabel>
              <FilePicker
                files={files}
                onChange={setFiles}
                accept={spec.files.images ? "image/*" : undefined}
                hint={spec.files.hint}
              />
            </Field>
          )}
          {spec.note && (
            <Field>
              <FieldLabel htmlFor="action-note">{spec.note.label}</FieldLabel>
              <Textarea
                id="action-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={spec.note.placeholder}
                maxLength={2000}
                className="min-h-24"
              />
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            닫기
          </Button>
          <Button variant={spec.destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending ? "처리 중…" : spec.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
