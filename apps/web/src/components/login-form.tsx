import { useState } from "react"

import { cn } from "cn"
import { COMPANY_EMAIL_DOMAIN, login, rememberedId, type Session } from "@/lib/auth"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  onLogin,
  ...props
}: React.ComponentProps<"div"> & { onLogin: (session: Session) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // 아이디 기억: 저장해 둔 아이디가 있으면 미리 채우고 체크해 둔다.
  const [savedId] = useState(rememberedId)
  const [rememberId, setRememberId] = useState(() => savedId !== "")
  const [keepLoggedIn, setKeepLoggedIn] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    const result = await login(String(form.get("id") ?? ""), String(form.get("password") ?? ""), {
      rememberId,
      keepLoggedIn,
    })
    setPending(false)
    if (result.ok) {
      onLogin(result.session)
    } else {
      setError(result.error)
      const password = event.currentTarget.elements.namedItem("password")
      if (password instanceof HTMLInputElement) password.value = ""
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">로그인</h1>
                <p className="text-balance text-muted-foreground">
                  회사 이메일 계정으로 로그인하세요
                </p>
              </div>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="id">회사 이메일</FieldLabel>
                <Input
                  id="id"
                  name="id"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={`휴대폰번호@${COMPANY_EMAIL_DOMAIN}`}
                  defaultValue={savedId}
                  aria-invalid={error ? true : undefined}
                  required
                />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="password">비밀번호</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  required
                />
                {error && <FieldError>{error}</FieldError>}
              </Field>
              {/* 비밀번호는 저장하지 않는다. 로그인 상태 유지는 서버가 30일짜리 로그인을 내준다. */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <Checkbox checked={rememberId} onCheckedChange={(v) => setRememberId(v === true)} />
                  아이디 기억
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <Checkbox checked={keepLoggedIn} onCheckedChange={(v) => setKeepLoggedIn(v === true)} />
                  로그인 상태 유지
                </Label>
              </div>
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending ? "로그인 중…" : "로그인"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                계정이 없으신가요?{" "}
                <a href="#/signup">회원가입</a>
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden flex-col justify-end gap-1 bg-muted p-8 md:flex">
            <p className="text-sm text-muted-foreground">DESIGN REQUEST &amp; WORK</p>
            <p className="text-xl font-bold">디자인 요청·작업 관리 시스템</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
