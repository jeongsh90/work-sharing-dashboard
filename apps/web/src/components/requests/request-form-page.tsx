import { useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FilePicker } from "@/components/requests/file-picker"
import { FileChip } from "@/components/requests/file-list"
import { api, ApiError, uploadAll } from "@/lib/api"
import type { Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import {
  toLocalInput,
  URGENCY_LABEL,
  WORK_TYPES,
  type FileInfo,
  type RequestDetailDto,
  type Urgency,
} from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { invalidate } from "@/lib/store"

// 기본 마감: 사흘 뒤 오후 6시
function defaultDue() {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  d.setHours(18, 0, 0, 0)
  return toLocalInput(d)
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
  const [dueAt, setDueAt] = useState(initial ? toLocalInput(new Date(initial.dueAt)) : defaultDue())
  const [urgency, setUrgency] = useState<Urgency>(initial?.urgency ?? "normal")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [kept, setKept] = useState<FileInfo[]>(initial?.references ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!title.trim()) next.title = "제목을 입력해 주세요."
    if (!workType) next.workType = "작업 종류를 골라 주세요."
    if (!dueAt) next.dueAt = "마감 일시를 입력해 주세요."
    else if (!initial && new Date(dueAt) < new Date()) next.dueAt = "마감 일시가 이미 지났습니다."
    if (!description.trim()) next.description = "요청 내용을 입력해 주세요."
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
        description,
        dueAt: new Date(dueAt).getTime(),
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

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={invalid("title")}>
          <FieldLabel htmlFor="req-title">제목</FieldLabel>
          <Input
            id="req-title"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 11월 1주차 메인 배너 - 겨울 국밥 기획전"
            aria-invalid={invalid("title")}
          />
          {errors.title && <FieldError>{errors.title}</FieldError>}
        </Field>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field data-invalid={invalid("workType")}>
            <FieldLabel htmlFor="req-type">작업 종류</FieldLabel>
            <Select value={workType} onValueChange={setWorkType}>
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
          <Field data-invalid={invalid("dueAt")}>
            <FieldLabel htmlFor="req-due">마감 일시</FieldLabel>
            <Input
              id="req-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-invalid={invalid("dueAt")}
            />
            {errors.dueAt && <FieldError>{errors.dueAt}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="req-urgency">긴급도</FieldLabel>
            <Select value={urgency} onValueChange={(v) => setUrgency(v as Urgency)}>
              <SelectTrigger id="req-urgency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {URGENCY_LABEL[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field data-invalid={invalid("description")}>
          <FieldLabel htmlFor="req-desc">요청 내용</FieldLabel>
          <Textarea
            id="req-desc"
            value={description}
            maxLength={5000}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-40"
            placeholder={"사용처와 규격, 들어갈 문구, 참고할 링크 등을 적어 주세요.\n예: 자사몰 PC 메인 1920×600 / 문구: 겨울엔 뜨끈한 국밥 한 그릇"}
            aria-invalid={invalid("description")}
          />
          {errors.description && <FieldError>{errors.description}</FieldError>}
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
          <FilePicker files={files} onChange={setFiles} hint="이미지, PDF, 문서 등 한 파일 100MB까지" />
          <FieldDescription>참고 이미지나 기존 시안이 있으면 같이 올려 주세요.</FieldDescription>
        </Field>
        {errors.form && <FieldError>{errors.form}</FieldError>}
        <Field orientation="horizontal" className="justify-end">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              취소
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "보내는 중…" : initial ? "수정 내용 저장" : "요청 보내기"}
          </Button>
        </Field>
      </FieldGroup>
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
