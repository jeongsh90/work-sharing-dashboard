import { useId, useState } from "react"
import { Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BottomBar } from "@/components/bottom-bar"
import { DateRangePicker, type DateRange } from "@/components/date-range-picker"
import { FilePicker } from "@/components/requests/file-picker"
import { FileChip } from "@/components/requests/file-list"
import { api, ApiError, uploadAll } from "@/lib/api"
import type { Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import {
  WORK_TYPES,
  type FileInfo,
  type RequestDetailDto,
  type RequestItem,
  type Urgency,
} from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { invalidate } from "@/lib/store"

// 작업 기간: 날짜는 범위 선택(시작일 ~ 마감일), 마감 시각은 따로 고른다.
const pad = (n: number) => String(n).padStart(2, "0")

// 마감 시각 목록: 09:00 ~ 21:00, 30분 단위
const DUE_TIMES = Array.from({ length: 25 }, (_, i) => `${pad(9 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`)

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

// 디자인 요청서. 새 요청과 요청 수정(보완)에 같이 쓴다.
export function RequestForm({
  session,
  initial,
  onDone,
  onCancel,
}: {
  session: Session
  initial?: RequestDetailDto
  onDone: (id: number) => void
  onCancel?: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [workType, setWorkType] = useState(initial?.workType ?? "")
  const [department, setDepartment] = useState(initial?.department ?? session.department)
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initial
      ? {
          from: startOfDay(new Date(initial.requestedStartAt ?? initial.dueAt)),
          to: startOfDay(new Date(initial.dueAt)),
        }
      : defaultRange(),
  )
  const [dueTime, setDueTime] = useState(() => {
    if (!initial) return "18:00"
    const d = new Date(initial.dueAt)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  // 예전에 고른 시각이 목록에 없으면 목록에 더해 보여 준다.
  const dueTimes = DUE_TIMES.includes(dueTime) ? DUE_TIMES : [...DUE_TIMES, dueTime].sort()
  // 긴급 처리 요청 체크. 체크하면 긴급도 '급함'. 예전에 '매우 급함'으로 들어온 요청은 체크를 유지하면 그대로 둔다.
  const [urgent, setUrgent] = useState(!!initial && initial.urgency !== "normal")
  const urgency: Urgency = !urgent ? "normal" : initial?.urgency === "critical" ? "critical" : "urgent"
  // 묶음이 없던 예전 요청은 요청 내용을 첫 묶음에 넣어 보여 준다.
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial?.items.length
      ? initial.items.map(toRow)
      : initial?.description
        ? [{ ...EMPTY_ITEM, body: initial.description }]
        : [EMPTY_ITEM],
  )
  const [kept, setKept] = useState<FileInfo[]>(initial?.references ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  // 새 요청은 오늘 이전 날짜를 고를 수 없다. 기준 날짜는 화면을 열 때 한 번 잡는다.
  const [today] = useState(() => startOfDay(new Date()))
  // 보내기 막대는 화면 하단 고정(BottomBar, 폼 바깥에 그려진다)이라 form 속성으로 이 폼에 연결한다.
  const formId = useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = "제목을 입력해 주세요."
    if (!workType) next.workType = "작업 종류를 골라 주세요."
    // 하루만 고르면 시작일과 마감일이 같다.
    const startDay = range?.from
    const dueDay = range?.to ?? range?.from
    const dueAt = dueDay ? withTime(dueDay, dueTime) : null
    if (!startDay || !dueAt) next.period = "작업 기간을 골라 주세요."
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
        dueAt: dueAt!.getTime(),
        fileIds: uploaded.map((f) => f.id),
        keepFileIds: kept.map((f) => f.id),
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
            <FieldLabel htmlFor="req-period">작업 기간 (시작일 ~ 마감일)</FieldLabel>
            <DateRangePicker
              id="req-period"
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
            <Select value={dueTime} onValueChange={setDueTime}>
              <SelectTrigger id="req-due-time" className="w-full">
                <SelectValue />
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
            <Button type="button" variant="outline" className="h-14 px-8 text-base" onClick={onCancel} disabled={pending}>
              취소
            </Button>
          )}
          <Button type="submit" form={formId} className="h-14 px-10 text-base" disabled={pending}>
            {pending ? "보내는 중…" : initial ? "수정 내용 저장" : "요청 보내기"}
          </Button>
        </div>
        {errors.form && <FieldError>{errors.form}</FieldError>}
      </BottomBar>
    </form>
  )
}

export function RequestFormPage({ session }: { session: Session }) {
  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-1 lg:col-span-8 lg:col-start-3 xl:col-span-6 xl:col-start-4">
        <h2 className="text-base font-semibold">새 디자인 요청</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          요청을 보내면 디자인팀에 알림이 가고, 담당 작업자가 정해지면 알림으로 알려 드립니다.
        </p>
        <RequestForm session={session} onDone={(id) => openRequest(id)} />
      </div>
    </div>
  )
}
