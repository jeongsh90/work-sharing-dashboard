import { useState } from "react"

import { cn } from "cn"
import { COMPANY_EMAIL_DOMAIN, login, type Session } from "@/lib/auth"
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
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setNotice(null)
    const result = await login(String(form.get("id") ?? ""), String(form.get("password") ?? ""))
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
                  placeholder={`49634613@${COMPANY_EMAIL_DOMAIN}`}
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
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending ? "로그인 중…" : "로그인"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                계정이 없으신가요?{" "}
                <a
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    setNotice("회원가입 페이지는 준비 중입니다.")
                  }}
                >
                  회원가입
                </a>
                {notice && <span className="mt-1 block">{notice}</span>}
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden flex-col justify-end gap-1 bg-muted p-8 md:flex">
            <p className="text-sm text-muted-foreground">DESIGN REQUEST &amp; SCHEDULE</p>
            <p className="text-xl font-bold">디자인 요청·일정 관리 시스템</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
