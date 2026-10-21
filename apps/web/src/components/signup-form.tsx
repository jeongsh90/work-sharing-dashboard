import { useState } from "react"
import { CircleCheck } from "lucide-react"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, ApiError } from "@/lib/api"
import { COMPANY_EMAIL_DOMAIN } from "@/lib/auth"
import { navigate } from "@/lib/router"

// 회원가입. 가입 신청 후 슈퍼관리자가 승인해야 로그인할 수 있다(팀 관리 > 가입 승인 대기).
export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
  const [form, setForm] = useState({
    id: "",
    name: "",
    department: "",
    rank: "",
    role: "requester",
    password: "",
    confirm: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  // 고치기 시작한 칸의 오류 문구는 바로 지운다.
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: e.target.value })
    if (errors[key]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    const id = form.id.trim().toLowerCase()
    if (!id.endsWith(`@${COMPANY_EMAIL_DOMAIN}`) || id === `@${COMPANY_EMAIL_DOMAIN}`) {
      next.id = `회사 이메일(@${COMPANY_EMAIL_DOMAIN})을 입력해 주세요.`
    }
    if (!form.name.trim()) next.name = "이름을 입력해 주세요."
    if (!form.department.trim()) next.department = "부서를 입력해 주세요."
    if (form.password.length < 8) next.password = "비밀번호는 8자 이상으로 정해 주세요."
    else if (form.password !== form.confirm) next.confirm = "비밀번호가 서로 다릅니다."
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setPending(true)
    try {
      const { confirm: _confirm, ...body } = form
      await api("/signup", { body: { ...body, id } })
      setDone(true)
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "가입 신청을 보내지 못했습니다." })
    } finally {
      setPending(false)
    }
  }

  const invalid = (key: string) => (errors[key] ? true : undefined)

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          {done ? (
            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center md:p-8">
              <CircleCheck className="size-10 text-emerald-600" aria-hidden />
              <h1 className="text-2xl font-bold">가입 신청 완료</h1>
              <p className="text-balance text-muted-foreground">
                슈퍼관리자가 승인하면 {form.id.trim().toLowerCase()} 로 로그인할 수 있습니다.
              </p>
              <Button className="mt-2" onClick={() => navigate("home")}>
                로그인 화면으로
              </Button>
            </div>
          ) : (
            <form className="p-6 md:p-8" onSubmit={submit} noValidate>
              <FieldGroup className="gap-5">
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold">회원가입</h1>
                  <p className="text-balance text-muted-foreground">회사 이메일로 가입 신청하세요</p>
                </div>
                <Field data-invalid={invalid("id")}>
                  <FieldLabel htmlFor="su-id">회사 이메일</FieldLabel>
                  <Input
                    id="su-id"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    value={form.id}
                    onChange={set("id")}
                    placeholder={`휴대폰번호@${COMPANY_EMAIL_DOMAIN}`}
                    aria-invalid={invalid("id")}
                  />
                  {errors.id && <FieldError>{errors.id}</FieldError>}
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field data-invalid={invalid("name")}>
                    <FieldLabel htmlFor="su-name">이름</FieldLabel>
                    <Input id="su-name" autoComplete="name" value={form.name} onChange={set("name")} aria-invalid={invalid("name")} />
                    {errors.name && <FieldError>{errors.name}</FieldError>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="su-rank">직급</FieldLabel>
                    <Input id="su-rank" value={form.rank} onChange={set("rank")} placeholder="예: 대리" />
                  </Field>
                  <Field data-invalid={invalid("department")}>
                    <FieldLabel htmlFor="su-dept">부서</FieldLabel>
                    <Input
                      id="su-dept"
                      value={form.department}
                      onChange={set("department")}
                      placeholder="예: MD 1팀"
                      aria-invalid={invalid("department")}
                    />
                    {errors.department && <FieldError>{errors.department}</FieldError>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="su-role">사용 목적</FieldLabel>
                    <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                      <SelectTrigger id="su-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="requester">디자인 요청 (요청자)</SelectItem>
                        <SelectItem value="designer">디자인 작업 (작업자)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field data-invalid={invalid("password")}>
                  <FieldLabel htmlFor="su-pw">비밀번호 (8자 이상)</FieldLabel>
                  <Input
                    id="su-pw"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={set("password")}
                    aria-invalid={invalid("password")}
                  />
                  {errors.password && <FieldError>{errors.password}</FieldError>}
                </Field>
                <Field data-invalid={invalid("confirm")}>
                  <FieldLabel htmlFor="su-confirm">비밀번호 확인</FieldLabel>
                  <Input
                    id="su-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={set("confirm")}
                    aria-invalid={invalid("confirm")}
                  />
                  {errors.confirm && <FieldError>{errors.confirm}</FieldError>}
                </Field>
                {errors.form && <FieldError>{errors.form}</FieldError>}
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending ? "신청하는 중…" : "가입 신청"}
                  </Button>
                </Field>
                <FieldDescription className="text-center">
                  이미 계정이 있으신가요? <a href="#/">로그인</a>
                </FieldDescription>
              </FieldGroup>
            </form>
          )}
          <div className="relative hidden flex-col justify-end gap-1 bg-muted p-8 md:flex">
            <p className="text-sm text-muted-foreground">DESIGN REQUEST &amp; SCHEDULE</p>
            <p className="text-xl font-bold">디자인 요청·일정 관리 시스템</p>
            <p className="mt-2 text-sm text-muted-foreground">가입 신청은 슈퍼관리자가 확인한 뒤 승인합니다.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
