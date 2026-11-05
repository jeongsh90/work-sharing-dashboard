import { useEffect, useId, useState } from "react"
import { Plus, Save, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BottomBar } from "@/components/bottom-bar"
import { confirmDialog } from "@/components/confirm-dialog"
import { DateRangePicker, type DateRange } from "@/components/date-range-picker"
import { FilePicker } from "@/components/requests/file-picker"
import { FileChip } from "@/components/requests/file-list"
import { NO_ACCOUNT, PersonPicker } from "@/components/requests/person-picker"
import { api, ApiError, uploadAll } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import {
  REQUEST_SOURCES,
  WORK_TYPES,
  type FileInfo,
  type RequestDetailDto,
  type RequestItem,
  type Urgency,
} from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { invalidate, isDesignWorker, useUsers } from "@/lib/store"

// 작업 기간: 날짜는 범위 선택(시작일 ~ 마감일), 마감 시각은 따로 고른다.
const pad = (n: number) => String(n).padStart(2, "0")

// 마감 시각 목록: 08:00 ~ 17:00(근무 시간), 30분 단위
const DUE_TIMES = Array.from({ length: 19 }, (_, i) => `${pad(8 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`)

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// 기본 기간: 오늘 ~ 사흘 뒤
function defaultRange(): DateRange {
  const today = startOfDay(new Date())
  const due = new Date(today)
  due.setDate(due.getDate() + 3)
  return { from: today, to: due }
}

function withTime(day: Date, time: string) {
  const [h, m] = time.split(":").map(Number)
  const d = startOfDay(day)
  d.setHours(h, m, 0, 0)
  return d
}

// 요청 내용 한 묶음: 사이즈(제목·너비·높이) + 요청 내용. 숫자 칸은 입력 중 빈 값도 받으려고 글자로 둔다.
type ItemRow = { label: string; width: string; height: string; body: string }

const EMPTY_ITEM: ItemRow = { label: "", width: "", height: "", body: "" }

const toRow = (item: RequestItem): ItemRow => ({
  label: item.label,
  width: item.width === null ? "" : String(item.width),
  height: item.height === null ? "" : String(item.height),
  body: item.body,
})

const isBlank = (row: ItemRow) => !row.label.trim() && !row.width && !row.height && !row.body.trim()

// 이 묶음에서 빠진 값. 너비·높이는 비워 두면 자유라 검사하지 않는다.
function missing(row: ItemRow) {
  return { label: !row.label.trim(), body: !row.body.trim() }
}

function ItemFields({
  rows,
  onChange,
  showErrors,
  error,
}: {
  rows: ItemRow[]
  onChange: (rows: ItemRow[]) => void
  showErrors: boolean
  error?: string // 내용 추가 버튼 위에 보인다
}) {
  const update = (i: number, key: keyof ItemRow, value: string) =>
    onChange(
      rows.map((r, j) =>
        j === i ? { ...r, [key]: key === "width" || key === "height" ? value.replace(/[^0-9]/g, "") : value } : r,
      ),
    )

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const miss = showErrors ? missing(row) : { label: false, body: false }
          return (
            <li key={i} className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={row.label}
                  onChange={(e) => update(i, "label", e.target.value)}
                  placeholder="제목 (예: 자사몰 PC 메인)"
                  aria-label={`내용 ${i + 1} 제목`}
                  aria-invalid={miss.label || undefined}
                  maxLength={60}
                  className="min-w-0 flex-1"
                />
                <Input
                  value={row.width}
                  onChange={(e) => update(i, "width", e.target.value)}
                  inputMode="numeric"
                  placeholder="너비"
                  aria-label={`내용 ${i + 1} 너비`}
                  className="w-20 shrink-0 tabular-nums sm:w-24"
                />
                <span className="text-sm text-muted-foreground" aria-hidden>
                  ×
                </span>
                <Input
                  value={row.height}
                  onChange={(e) => update(i, "height", e.target.value)}
                  inputMode="numeric"
                  placeholder="높이"
                  aria-label={`내용 ${i + 1} 높이`}
                  className="w-20 shrink-0 tabular-nums sm:w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`내용 ${i + 1} 삭제`}
                  disabled={rows.length === 1 && isBlank(row)}
                  onClick={() => onChange(rows.length === 1 ? [EMPTY_ITEM] : rows.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Textarea
                value={row.body}
                onChange={(e) => update(i, "body", e.target.value)}
                placeholder={"들어갈 문구, 참고할 링크 등 이 사이즈에 필요한 내용을 적어 주세요.\n예: 문구: 겨울엔 뜨끈한 국밥 한 그릇"}
                aria-label={`내용 ${i + 1} 요청 내용`}
                aria-invalid={miss.body || undefined}
                maxLength={5000}
                className="min-h-28"
              />
            </li>
          )
        })}
      </ol>
      {error && <FieldError>{error}</FieldError>}
      <Button type="button" size="sm" className="self-center" onClick={() => onChange([...rows, EMPTY_ITEM])}>
        <Plus data-icon="inline-start" />
        내용 추가
      </Button>
    </div>
  )
}

// 임시저장한 요청서(새 요청만, 한 사람당 하나). data 는 화면 입력 그대로, files 는 먼저 올려 둔 참고 자료
type DraftData = {
  title?: string
  workType?: string
  department?: string
  ongoing?: boolean
  from?: number | null
  to?: number | null
  dueTime?: string
  urgent?: boolean
  items?: ItemRow[]
  coIds?: string[]
  proxyOn?: boolean
  requesterId?: string
  requesterName?: string
  source?: string
  takeSelf?: boolean
}
export type RequestDraft = { data: DraftData; files: FileInfo[]; updatedAt: number }

const draftTime = (t: number) =>
  new Date(t).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })

// 디자인 요청서. 새 요청과 요청 수정(보완)에 같이 쓴다.
export function RequestForm({
  session,
  initial,
  draft,
  onDiscardDraft,
  onDone,
  onCancel,
}: {
  session: Session
  initial?: RequestDetailDto
  draft?: RequestDraft | null // 새 요청에서 불러온 임시저장
  onDiscardDraft?: () => void // 임시저장을 지우고 새로 쓰기
  onDone: (id: number) => void
  onCancel?: () => void
}) {
  const d: DraftData = (!initial && draft?.data) || {}
  const [title, setTitle] = useState(initial?.title ?? d.title ?? "")
  const [workType, setWorkType] = useState(initial?.workType ?? d.workType ?? "")
  const [department, setDepartment] = useState(initial?.department ?? d.department ?? session.department)
  // 계속 업무(마감 없음): 체크하면 시작일만 고르고 마감 시각은 쓰지 않는다.
  const [ongoing, setOngoing] = useState(initial?.ongoing ?? d.ongoing ?? false)
  // 보류(요청 수정에서만): 일정은 그대로 두고 잠시 멈춘다. 마감 지남·이번 주 마감에서 빠진다.
  const [onHold, setOnHold] = useState(initial?.onHold ?? false)
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initial
      ? initial.ongoing
        ? { from: startOfDay(new Date(initial.requestedStartAt ?? initial.createdAt)), to: undefined }
        : {
            from: startOfDay(new Date(initial.requestedStartAt ?? initial.dueAt)),
            to: startOfDay(new Date(initial.dueAt)),
          }
      : d.from
        ? { from: new Date(d.from), to: d.to ? new Date(d.to) : undefined }
        : defaultRange(),
  )
  const [dueTime, setDueTime] = useState(() => {
    if (!initial) return d.dueTime && /^\d\d:\d\d$/.test(d.dueTime) ? d.dueTime : "17:00"
    if (initial.ongoing) return "17:00"
    const due = new Date(initial.dueAt)
    return `${pad(due.getHours())}:${pad(due.getMinutes())}`
  })
  // 예전에 고른 시각이 목록에 없으면 목록에 더해 보여 준다.
  const dueTimes = DUE_TIMES.includes(dueTime) ? DUE_TIMES : [...DUE_TIMES, dueTime].sort()
  // 긴급 처리 요청 체크. 체크하면 긴급도 '급함'. 예전에 '매우 급함'으로 들어온 요청은 체크를 유지하면 그대로 둔다.
  const [urgent, setUrgent] = useState(initial ? initial.urgency !== "normal" : !!d.urgent)
  const urgency: Urgency = !urgent ? "normal" : initial?.urgency === "critical" ? "critical" : "urgent"
  // 묶음이 없던 예전 요청은 요청 내용을 첫 묶음에 넣어 보여 준다.
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial?.items.length
      ? initial.items.map(toRow)
      : initial?.description
        ? [{ ...EMPTY_ITEM, body: initial.description }]
        : d.items?.length
          ? d.items.map((r) => ({ ...EMPTY_ITEM, ...r }))
          : [EMPTY_ITEM],
  )
  // 남겨 둘 참고 자료: 요청 수정이면 이미 붙은 파일, 새 요청이면 임시저장할 때 올려 둔 파일
  const [kept, setKept] = useState<FileInfo[]>(initial?.references ?? draft?.files ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  // 새 요청은 오늘 이전 날짜를 고를 수 없다. 기준 날짜는 화면을 열 때 한 번 잡는다.
  const [today] = useState(() => startOfDay(new Date()))
  const sameDay =
    !ongoing && range?.from?.getTime() === today.getTime() && (range.to ?? range.from).getTime() === today.getTime()
  // 보내기 막대는 화면 하단 고정(BottomBar, 폼 바깥에 그려진다)이라 form 속성으로 이 폼에 연결한다.
  const formId = useId()
  // 대신 작성(새 요청만): 말·전화 등으로 받은 요청을 작업자·관리자가 옮겨 적는다. 작업자는 늘 대신 작성이다.
  const designer = session.role === "designer"
  const canProxy = !initial && (designer || isManager(session))
  const [proxyOn, setProxyOn] = useState(designer || !!d.proxyOn)
  const proxy = canProxy && proxyOn
  const [requesterId, setRequesterId] = useState(d.requesterId ?? "")
  const [requesterName, setRequesterName] = useState(d.requesterName ?? "")
  const [source, setSource] = useState<string>(d.source && (REQUEST_SOURCES as readonly string[]).includes(d.source) ? d.source : "구두")
  // 디자인팀(작업자·디자인팀 관리자)은 등록하면서 바로 담당을 맡을 수 있다(기본 켬)
  const canTake = designer || isDesignWorker(session)
  const [takeSelf, setTakeSelf] = useState(d.takeSelf ?? true)
  // 공동 요청자: 같은 팀(요청 부서)에서 함께 요청하는 사람(여러 명). 원래 요청자처럼 알림·내 요청·컨펌을 한다
  const [coIds, setCoIds] = useState<string[]>(initial?.coRequesters ?? d.coIds ?? [])
  const mainRequester = initial ? initial.requesterId : proxy ? (requesterId && requesterId !== NO_ACCOUNT ? requesterId : session.id) : session.id

  // 임시저장(새 요청만): 검사 없이 지금 입력을 저장한다. 새로 고른 파일은 먼저 올려 두고 남겨 둘 참고 자료로 옮긴다.
  const [savedAt, setSavedAt] = useState<number | null>(draft?.updatedAt ?? null)
  const [saving, setSaving] = useState(false)
  const busy = pending || saving
  async function saveDraft() {
    setSaving(true)
    clear("form")
    try {
      const uploaded = await uploadAll(files)
      const now = Date.now()
      const nextKept: FileInfo[] = [
        ...kept,
        ...uploaded.map((f) => ({ ...f, kind: null, uploaderId: session.id, createdAt: now })),
      ]
      setKept(nextKept)
      setFiles([])
      const data: DraftData = {
        title,
        workType,
        department,
        ongoing,
        from: range?.from?.getTime() ?? null,
        to: range?.to?.getTime() ?? null,
        dueTime,
        urgent,
        items,
        coIds,
        proxyOn,
        requesterId,
        requesterName,
        source,
        takeSelf,
      }
      const r = await api<{ updatedAt: number }>("/request-draft", {
        method: "PUT",
        body: { data, fileIds: nextKept.map((f) => f.id) },
      })
      setSavedAt(r.updatedAt)
    } catch (error) {
      setErrors((prev) => ({ ...prev, form: error instanceof ApiError ? error.message : "임시저장하지 못했습니다." }))
    } finally {
      setSaving(false)
    }
  }

  async function discardDraft() {
    const ok = await confirmDialog({
      title: "임시저장을 지우고 새로 쓸까요?",
      description: "임시저장한 내용과 함께 올려 둔 참고 자료도 지워집니다.",
      confirmText: "지우고 새로 쓰기",
      destructive: true,
    })
    if (!ok) return
    try {
      await api("/request-draft?files=1", { method: "DELETE" })
      onDiscardDraft?.()
    } catch (error) {
      setErrors((prev) => ({ ...prev, form: error instanceof ApiError ? error.message : "임시저장을 지우지 못했습니다." }))
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (proxy) {
      if (!requesterId) next.requester = "요청한 사람을 골라 주세요."
      else if (requesterId === NO_ACCOUNT && !requesterName.trim()) next.requester = "요청한 사람의 이름을 적어 주세요."
    }
    if (!title.trim()) next.title = "제목을 입력해 주세요."
    if (!workType) next.workType = "작업 종류를 골라 주세요."
    // 하루만 고르면 시작일과 마감일이 같다.
    const startDay = range?.from
    const dueDay = range?.to ?? range?.from
    const dueAt = dueDay ? withTime(dueDay, dueTime) : null
    if (ongoing) {
      if (!startDay) next.period = "시작일을 골라 주세요."
    } else if (!startDay || !dueAt) next.period = "작업 기간을 골라 주세요."
    else if (!initial && dueAt < new Date()) next.period = "마감 일시가 이미 지났습니다. 마감일이나 시각을 바꿔 주세요."
    // 완전히 빈 묶음은 빼고 보낸다. 쓰기 시작한 묶음은 제목·요청 내용을 채워야 한다(너비·높이는 비우면 자유).
    const filled = items.filter((r) => !isBlank(r))
    if (filled.length === 0) next.items = "요청 내용을 한 개 이상 입력해 주세요."
    else if (filled.some((r) => Object.values(missing(r)).some(Boolean))) {
      next.items = "각 내용의 제목과 요청 내용을 입력해 주세요."
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setPending(true)
    try {
      const uploaded = await uploadAll(files)
      const body = {
        title,
        workType,
        department,
        urgency,
        items: filled.map((r) => ({
          label: r.label.trim(),
          width: r.width ? Number(r.width) : null,
          height: r.height ? Number(r.height) : null,
          body: r.body.trim(),
        })),
        requestedStartAt: startDay!.getTime(),
        ongoing,
        onHold,
        dueAt: ongoing ? undefined : dueAt!.getTime(),
        // 새 요청: 임시저장 때 올려 둔 파일(kept)도 함께 붙인다. 요청 수정: kept 는 남겨 둘 기존 파일
        fileIds: [...uploaded.map((f) => f.id), ...(initial ? [] : kept.map((f) => f.id))],
        keepFileIds: kept.map((f) => f.id),
        ...(!initial && { clearDraft: true }),
        coRequesterIds: coIds.filter((uid) => uid !== mainRequester),
        ...(proxy && {
          proxy:
            requesterId === NO_ACCOUNT ? { requesterName: requesterName.trim(), source } : { requesterId, source },
          takeSelf: canTake && takeSelf,
        }),
      }
      const id = initial
        ? (await api<RequestDetailDto>(`/requests/${initial.id}`, { method: "PATCH", body })).id
        : (await api<{ id: number }>("/requests", { body })).id
      invalidate()
      onDone(id)
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "요청을 보내지 못했습니다." })
    } finally {
      setPending(false)
    }
  }

  const invalid = (key: string) => (errors[key] ? true : undefined)
  // 고치기 시작한 칸의 오류 문구는 바로 지운다(다음 보내기 때 다시 검사).
  const clear = (key: string) => {
    if (errors[key]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
  }

  return (
    <form id={formId} onSubmit={submit} noValidate>
      <FieldGroup>
        {!initial && draft && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <span className="break-keep">임시저장한 요청서를 불러왔습니다 ({draftTime(draft.updatedAt)} 저장)</span>
            <Button type="button" variant="outline" size="sm" onClick={discardDraft} disabled={busy}>
              지우고 새로 쓰기
            </Button>
          </div>
        )}
        {canProxy && (
          <div className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            {designer ? (
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">대신 작성</p>
                <p className="text-xs text-muted-foreground">말·전화·메신저로 받은 요청을 요청서로 옮겨 적습니다. 요청한 사람에게 알림이 갑니다.</p>
              </div>
            ) : (
              <Label className="flex cursor-pointer items-start gap-2 font-normal">
                <Checkbox className="mt-0.5" checked={proxyOn} onCheckedChange={(v) => setProxyOn(v === true)} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">대신 작성</span>
                  <span className="text-xs text-muted-foreground">말·전화·메신저로 받은 다른 사람의 요청을 요청서로 옮겨 적습니다.</span>
                </span>
              </Label>
            )}
            {proxy && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field data-invalid={invalid("requester")}>
                  <FieldLabel htmlFor="req-requester">요청한 사람</FieldLabel>
                  <PersonPicker
                    id="req-requester"
                    value={requesterId}
                    invalid={!!errors.requester}
                    onChange={(id, user) => {
                      setRequesterId(id)
                      clear("requester")
                      // 요청 부서는 고른 사람의 부서로 채운다(고친 뒤에도 바꿀 수 있다)
                      setDepartment(user?.department ?? "")
                    }}
                  />
                  {requesterId === NO_ACCOUNT && (
                    <Input
                      value={requesterName}
                      maxLength={30}
                      onChange={(e) => {
                        setRequesterName(e.target.value)
                        clear("requester")
                      }}
                      placeholder="요청한 사람 이름 (예: 홍길동 과장)"
                      aria-label="요청한 사람 이름"
                      aria-invalid={invalid("requester")}
                    />
                  )}
                  {errors.requester && <FieldError>{errors.requester}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="req-source">받은 경로</FieldLabel>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger id="req-source" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s === "구두" ? "구두 (말로)" : s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {canTake && (
                  <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal sm:col-span-2">
                    <Checkbox checked={takeSelf} onCheckedChange={(v) => setTakeSelf(v === true)} />
                    내가 담당 (등록하면 바로 작업 대기로 넘어갑니다)
                  </Label>
                )}
                {requesterId === NO_ACCOUNT && (
                  <FieldDescription className="sm:col-span-2">
                    계정이 없는 사람의 요청은 시안 컨펌도 작성한 사람이 대신 합니다.
                  </FieldDescription>
                )}
              </div>
            )}
          </div>
        )}
        <CoRequesterPicker mainId={mainRequester} department={department} value={coIds} onChange={setCoIds} />
        <Field data-invalid={invalid("title")}>
          <FieldLabel htmlFor="req-title">제목</FieldLabel>
          <Input
            id="req-title"
            value={title}
            maxLength={100}
            onChange={(e) => {
              setTitle(e.target.value)
              clear("title")
            }}
            placeholder="예: 11월 1주차 메인 배너 - 겨울 국밥 기획전"
            aria-invalid={invalid("title")}
          />
          {errors.title && <FieldError>{errors.title}</FieldError>}
        </Field>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field data-invalid={invalid("workType")}>
            <FieldLabel htmlFor="req-type">작업 종류</FieldLabel>
            <Select
              value={workType}
              onValueChange={(v) => {
                setWorkType(v)
                clear("workType")
              }}
            >
              <SelectTrigger id="req-type" className="w-full" aria-invalid={invalid("workType")}>
                <SelectValue placeholder="골라 주세요" />
              </SelectTrigger>
              <SelectContent>
                {WORK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.workType && <FieldError>{errors.workType}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="req-dept">요청 부서</FieldLabel>
            <Input id="req-dept" value={department} maxLength={40} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
          <Field data-invalid={invalid("period")}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="req-period">{ongoing ? "작업 시작일 (계속 업무)" : "작업 기간 (시작일 ~ 마감일)"}</FieldLabel>
              <div className="flex items-center gap-3">
                {initial && (
                  <Label className="flex cursor-pointer items-center gap-1.5 text-sm font-normal text-muted-foreground">
                    <Checkbox checked={onHold} onCheckedChange={(v) => setOnHold(v === true)} />
                    보류
                  </Label>
                )}
                {/* 당일: 오늘 시작해 오늘 마감. 기간이 오늘 하루면 저절로 체크된다. 끄면 기본 기간으로 */}
                <Label className="flex cursor-pointer items-center gap-1.5 text-sm font-normal text-muted-foreground">
                  <Checkbox
                    checked={sameDay}
                    onCheckedChange={(v) => {
                      setOngoing(false)
                      setRange(v === true ? { from: today, to: today } : defaultRange())
                      clear("period")
                    }}
                  />
                  당일
                </Label>
                <Label className="flex cursor-pointer items-center gap-1.5 text-sm font-normal text-muted-foreground">
                  <Checkbox
                    checked={ongoing}
                    onCheckedChange={(v) => {
                      setOngoing(v === true)
                      clear("period")
                    }}
                  />
                  계속 업무
                </Label>
              </div>
            </div>
            <DateRangePicker
              id="req-period"
              single={ongoing}
              placeholder={ongoing ? "시작일을 골라 주세요" : undefined}
              value={range}
              onChange={(r) => {
                setRange(r)
                clear("period")
              }}
              disabled={initial ? undefined : { before: today }}
              invalid={!!errors.period}
            />
            {errors.period && <FieldError>{errors.period}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="req-due-time">마감 시각</FieldLabel>
            <Select value={dueTime} onValueChange={setDueTime} disabled={ongoing || onHold}>
              <SelectTrigger id="req-due-time" className="w-full">
                {onHold ? <span className="text-red-600 dark:text-red-400">마감 없음(보류)</span> : ongoing ? <span className="text-muted-foreground">마감 없음(계속 업무)</span> : <SelectValue />}
              </SelectTrigger>
              <SelectContent>
                {dueTimes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field data-invalid={invalid("items")}>
          <FieldLabel>사이즈 · 요청 내용</FieldLabel>
          <FieldDescription>
            사이즈별로 요청 내용을 적어 주세요. 자유 사이즈면 너비·높이는 비워 두세요.
          </FieldDescription>
          <ItemFields
            rows={items}
            onChange={(rows) => {
              setItems(rows)
              clear("items")
            }}
            showErrors={!!errors.items}
            error={errors.items}
          />
        </Field>
        <Field>
          <FieldLabel>참고 자료</FieldLabel>
          {kept.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {kept.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <FileChip file={f} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${f.name} 빼기`}
                    onClick={() => setKept(kept.filter((k) => k.id !== f.id))}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <FilePicker files={files} onChange={setFiles} hint="이미지, PDF, 문서 등 크기 제한 없음" />
          <FieldDescription>참고 이미지나 기존 시안이 있으면 같이 올려 주세요.</FieldDescription>
        </Field>
        {/* 하단 고정 막대에 가려지지 않게 빈 공간 */}
        <div className="h-24 shrink-0" aria-hidden />
      </FieldGroup>
      {/* 화면 하단 고정 막대: 긴급처리요청 체크 · (취소) · 요청 보내기 */}
      <BottomBar>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <label className="mr-2 flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} />
            긴급처리요청
          </label>
          {onCancel && (
            <Button type="button" variant="outline" className="h-14 px-8 text-base" onClick={onCancel} disabled={busy}>
              취소
            </Button>
          )}
          {!initial && (
            <Button type="button" variant="outline" className="h-14 px-8 text-base" onClick={saveDraft} disabled={busy}>
              <Save />
              {saving ? "저장 중…" : "임시저장"}
            </Button>
          )}
          <Button type="submit" form={formId} className="h-14 px-10 text-base" disabled={busy}>
            {pending ? "보내는 중…" : initial ? "수정 내용 저장" : proxy ? "요청서 등록" : "요청 보내기"}
          </Button>
        </div>
        {savedAt && !initial && !errors.form && (
          <p className="text-center text-xs text-muted-foreground">임시저장됨 · {draftTime(savedAt)}</p>
        )}
        {errors.form && <FieldError>{errors.form}</FieldError>}
      </BottomBar>
    </form>
  )
}

export function RequestFormPage({ session }: { session: Session }) {
  const designer = session.role === "designer"
  // 임시저장한 요청서가 있으면 불러와 이어서 쓴다(불러오기 전에는 폼을 그리지 않는다)
  const [draft, setDraft] = useState<RequestDraft | null | undefined>(undefined)
  const [formKey, setFormKey] = useState(0)
  useEffect(() => {
    let alive = true
    api<RequestDraft | null>("/request-draft")
      .then((r) => alive && setDraft(r))
      .catch(() => alive && setDraft(null))
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-1 lg:col-span-8 lg:col-start-3 xl:col-span-6 xl:col-start-4">
        <h2 className="text-base font-semibold">{designer ? "디자인 요청서 작성" : "새 디자인 요청"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {designer
            ? "시스템 밖(말·전화·메신저 등)으로 받은 요청을 요청서로 남깁니다. 요청한 사람이 계정이 있으면 그 사람의 요청으로 들어가 진행 상황과 시안 컨펌을 그 사람이 봅니다."
            : "요청을 보내면 디자인팀에 알림이 가고, 담당 작업자가 정해지면 알림으로 알려 드립니다."}
        </p>
        {draft !== undefined && (
          <RequestForm
            key={formKey}
            session={session}
            draft={draft}
            onDiscardDraft={() => {
              setDraft(null)
              setFormKey((k) => k + 1)
            }}
            onDone={(id) => openRequest(id)}
          />
        )}
      </div>
    </div>
  )
}

// 함께 요청하는 사람: 요청 부서와 같은 팀 사람을 여러 명 고른다(띄어쓰기만 다른 부서 이름은 같은 팀). 원래 요청자는 빼고 보여 준다
function CoRequesterPicker({ mainId, department, value, onChange }: { mainId: string; department: string; value: string[]; onChange: (ids: string[]) => void }) {
  const { users } = useUsers()
  const team = department.replace(/s+/g, "")
  const people = (users ?? [])
    .filter((u) => u.active && u.approved && u.id !== mainId && ((team && u.department.replace(/s+/g, "") === team) || value.includes(u.id)))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
  if (people.length === 0) return null
  return (
    <Field>
      <FieldLabel>함께 요청하는 사람 (선택, 여러 명)</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {people.map((u) => {
          const checked = value.includes(u.id)
          return (
            <Label
              key={u.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
            >
              <Checkbox checked={checked} onCheckedChange={(v) => onChange(v ? [...value, u.id] : value.filter((id) => id !== u.id))} />
              {u.name}
              {u.rank && <span className="text-xs text-muted-foreground">{u.rank}</span>}
            </Label>
          )
        })}
      </div>
      <FieldDescription className="break-keep">
        같은 팀({department.trim()}) 동료를 함께 넣으면 그 사람도 알림을 받고 내 요청에 보이며, 시안 컨펌·반려를 할 수 있습니다.
      </FieldDescription>
    </Field>
  )
}
