import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, ApiError } from "@/lib/api"
import { ROLE_LABEL, updateStoredUser, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { PRESENCE_DOT, PRESENCE_LABEL, savePresence, type Presence } from "@/lib/presence"

export function MePage({ session, onSessionChange }: { session: Session; onSessionChange: (s: Session) => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState(false)

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return setMessage({ ok: false, text: "새 비밀번호는 8자 이상으로 정해 주세요." })
    setPending(true)
    try {
      const { user, token } = await api<{ user: Session; token: string }>("/me", {
        method: "PATCH",
        body: { currentPassword: current, newPassword: next },
      })
      updateStoredUser(user, token)
      setCurrent("")
      setNext("")
      setMessage({ ok: true, text: "비밀번호를 바꿨습니다." })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.message : "비밀번호를 바꾸지 못했습니다." })
    } finally {
      setPending(false)
    }
  }

  const rows = [
    ["아이디", session.id],
    ["이름", session.name],
    ["역할", ROLE_LABEL[session.role]],
    ["부서", session.department || "-"],
    ["직급·직책", [session.rank, session.position].filter(Boolean).join(" · ") || "-"],
  ]

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-8 xl:col-span-6">
        <Card>
          <CardHeader>
            <CardTitle>내 정보</CardTitle>
            <CardDescription>이름·부서·역할은 관리자가 팀 관리에서 바꿉니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {session.role === "designer" && (
          <Card>
            <CardHeader>
              <CardTitle>현재 상태</CardTitle>
              <CardDescription>홈의 디자인팀 카드에 보입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={session.presence}
                onValueChange={async (v) => onSessionChange(await savePresence(v as Presence))}
              >
                <SelectTrigger className="w-48" aria-label="현재 상태">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className={`size-2 rounded-full ${PRESENCE_DOT[p]}`} aria-hidden />
                      {PRESENCE_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>비밀번호 변경</CardTitle>
            <CardDescription>바꾸면 다른 기기의 로그인은 풀립니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} noValidate>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="pw-current">현재 비밀번호</FieldLabel>
                  <Input
                    id="pw-current"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pw-next">새 비밀번호(8자 이상)</FieldLabel>
                  <Input
                    id="pw-next"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                </Field>
                {message &&
                  (message.ok ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">{message.text}</p>
                  ) : (
                    <FieldError>{message.text}</FieldError>
                  ))}
                <Button type="submit" className="self-start" disabled={pending || !current || !next}>
                  {pending ? "바꾸는 중…" : "비밀번호 변경"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
