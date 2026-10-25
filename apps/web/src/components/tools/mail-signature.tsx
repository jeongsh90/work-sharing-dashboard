import { useState } from "react"
import { Check, Copy, Download, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// 디자인 툴 > 메일 서명: 회사 서명 양식(셰프애찬)에 부서·팀·이름·연락처를 넣어 메일 서명 HTML 을 만든다.
// 메일 프로그램에 붙여 넣을 수 있게 "서명 복사"는 서식째(HTML) 클립보드에 담는다.

type Form = {
  department: string
  team: string
  name: string
  rank: string
  phones: string[]
  fax: string
  email: string
  addresses: string[] // 여러 개면 A. 줄을 하나씩
}

const EMPTY: Form = {
  department: "",
  team: "",
  name: "",
  rank: "",
  phones: [""],
  fax: "",
  email: "",
  addresses: ["대전광역시 동구 계족로 167, 9층 셰프애찬"],
}

const LOGO = "https://yorihaeyou.cafe24.com/mail/logo/logo.png"
const RED = "rgb(215, 40, 47)"
const TEXT = "rgb(51, 51, 51)"

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// 연락처 한 줄(E. M. F. A.)
function contactRow(label: string, value: string) {
  return `<tr><td style="font-weight: 700; vertical-align: top; padding: 0px; width: 22px;"><p style="margin: 0px;"><span>${label}</span></p></td><td style="vertical-align: top; padding: 0px;"><p style="margin: 0px;">${value}</p></td></tr>`
}

// 회사 서명 양식 그대로(메일 프로그램이 읽을 수 있게 표와 인라인 스타일만 쓴다)
function signatureHtml(f: Form) {
  const phones = f.phones.map((p) => p.trim()).filter(Boolean)
  const addresses = f.addresses.map((a) => a.trim()).filter(Boolean)
  const rows = [
    ...phones.map((p) => contactRow("M.", `<span>${esc(p)}</span>`)),
    f.fax.trim() ? contactRow("F.", `<span>${esc(f.fax.trim())}</span>`) : "",
    contactRow(
      "E.",
      `<a style="text-decoration: none; color: ${TEXT};" target="_blank" href="mailto:${esc(f.email.trim())}"><span>${esc(f.email.trim())}</span></a>`,
    ),
    ...addresses.map((a) => contactRow("A.", `<span>${esc(a)}</span>`)),
  ].join("")
  const line = `<table style="border-collapse: collapse; border-spacing: 0px; vertical-align: text-bottom; width: 100%;" cellpadding="0"><tbody><tr style="height: 1px;"><td style="background: ${RED}; font-size: 0px; line-height: 0; padding: 0px;"><p style="margin: 0px;"><span>&nbsp;</span></p></td></tr></tbody></table>`
  const org = [f.department.trim(), f.team.trim()].filter(Boolean).map(esc).join(" / ")
  const rank = f.rank.trim() ? `<span style="font-size: 14px; font-weight: 700; letter-spacing: 1px;">&nbsp;${esc(f.rank.trim())}</span>` : ""

  return `<table style="background: rgb(255, 255, 255); border-collapse: separate; border-spacing: 0px; font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', Arial, sans-serif; vertical-align: text-bottom; width: 520px; border: 1px solid rgb(217, 217, 217);" cellpadding="0"><tbody>
<tr><td style="font-size: 13px; color: ${TEXT}; line-height: 18px; padding: 24px 24px 0px 34px; letter-spacing: 0.5px;"><p style="margin: 0px;"><span>${org}</span></p></td></tr>
<tr><td style="color: ${TEXT}; line-height: 34px; padding: 6px 24px 0px 34px;"><p style="margin: 0px;"><span style="font-size: 28px; font-weight: 700; letter-spacing: 12px;">${esc(f.name.trim())}</span>${rank}</p></td></tr>
<tr style="height: 34px;"><td style="font-size: 0px; line-height: 0; padding: 0px;"><p style="margin: 0px;"><span>&nbsp;</span></p></td></tr>
<tr><td style="padding: 0px;"><table style="border-collapse: collapse; border-spacing: 0px; vertical-align: text-bottom; width: 518px;" cellpadding="0"><tbody><tr>
<td style="vertical-align: middle; padding: 0px; width: 330px;">${line}</td>
<td style="vertical-align: middle; padding: 0px 10px; width: 150px;"><p style="margin: 0px;"><img style="vertical-align: bottom; width: 150px; height: 36px; border: none;" alt="셰프애찬" src="${LOGO}" width="150" height="36"></p></td>
<td style="vertical-align: middle; padding: 0px;">${line}</td>
</tr></tbody></table></td></tr>
<tr><td style="font-size: 15px; font-weight: 700; line-height: 20px; padding: 18px 24px 0px 30px;"><p style="margin: 0px;"><a style="text-decoration: none; color: ${RED};" target="_blank" href="https://www.owenfood.com"><span>www.owenfood.com</span></a></p></td></tr>
<tr><td style="padding: 4px 24px 24px 30px;"><table style="border-collapse: collapse; border-spacing: 0px; font-size: 13px; color: ${TEXT}; vertical-align: text-bottom; line-height: 20px;" cellpadding="0"><tbody>${rows}</tbody></table></td></tr>
</tbody></table>`
}

// 필수 칸 표시(별표). 색은 테마 변수(destructive)를 쓴다
const Required = () => (
  <span className="text-destructive" aria-label="필수">
    *
  </span>
)

// 필수: 부서·팀·이름·메일
function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f.department.trim()) e.department = "부서를 입력해 주세요."
  if (!f.team.trim()) e.team = "팀을 입력해 주세요."
  if (!f.name.trim()) e.name = "이름을 입력해 주세요."
  if (!f.email.trim()) e.email = "메일 주소를 입력해 주세요."
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "메일 주소 형식이 올바르지 않습니다."
  return e
}

export function MailSignatureTool() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [done, setDone] = useState<string | null>(null)
  const html = signatureHtml(form)

  const set = (key: keyof Omit<Form, "phones" | "addresses">) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setErrors((er) => ({ ...er, [key]: undefined }))
  }
  // 여러 개 입력하는 칸(휴대폰·주소)
  const setAt = (key: "phones" | "addresses", i: number, v: string) =>
    setForm((f) => ({ ...f, [key]: f[key].map((p, j) => (j === i ? v : p)) }))
  const removeAt = (key: "phones" | "addresses", i: number) => setForm((f) => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }))
  const addOne = (key: "phones" | "addresses") => setForm((f) => ({ ...f, [key]: [...f[key], ""] }))

  // 필수 칸을 확인하고 통과하면 실행
  const guard = (work: () => Promise<void> | void, label: string) => async () => {
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).length > 0) return
    await work()
    setDone(label)
    setTimeout(() => setDone(null), 1800)
  }

  const copyRich = guard(async () => {
    // 서식째 복사(메일 서명 칸에 붙여 넣으면 양식 그대로). 지원하지 않는 브라우저는 HTML 글자로 복사
    if (window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([html], { type: "text/plain" }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(html)
    }
  }, "rich")
  const copyCode = guard(() => navigator.clipboard.writeText(html), "code")
  const download = guard(() => {
    const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`], {
      type: "text/html",
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `메일서명_${form.name.trim() || "이름"}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }, "file")

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 p-4 md:p-6">
      {/* 왼쪽: 입력 */}
      <form className="col-span-12 lg:col-span-5" onSubmit={(e) => e.preventDefault()}>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field data-invalid={!!errors.department}>
              <FieldLabel htmlFor="sig-dept">부서 <Required /></FieldLabel>
              <Input id="sig-dept" value={form.department} onChange={set("department")} placeholder="예: Future strategy" aria-invalid={!!errors.department} />
              {errors.department && <FieldError>{errors.department}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.team}>
              <FieldLabel htmlFor="sig-team">팀 <Required /></FieldLabel>
              <Input id="sig-team" value={form.team} onChange={set("team")} placeholder="예: CS팀" aria-invalid={!!errors.team} />
              {errors.team && <FieldError>{errors.team}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="sig-name">이름 <Required /></FieldLabel>
              <Input id="sig-name" value={form.name} onChange={set("name")} placeholder="예: 김선영" aria-invalid={!!errors.name} />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="sig-rank">직급</FieldLabel>
              <Input id="sig-rank" value={form.rank} onChange={set("rank")} placeholder="예: 주임" />
            </Field>
          </div>

          <Field>
            <FieldLabel>휴대폰</FieldLabel>
            <div className="flex flex-col gap-2">
              {form.phones.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={p} onChange={(e) => setAt("phones", i, e.target.value)} placeholder="예: 010-1234-5678" aria-label={`휴대폰 ${i + 1}`} inputMode="tel" />
                  {form.phones.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`휴대폰 ${i + 1} 지우기`}
                      onClick={() => removeAt("phones", i)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => addOne("phones")}>
                <Plus data-icon="inline-start" />
                번호 추가
              </Button>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="sig-fax">팩스</FieldLabel>
            <Input id="sig-fax" value={form.fax} onChange={set("fax")} placeholder="예: 042-123-4567" inputMode="tel" />
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="sig-email">메일 <Required /></FieldLabel>
            <Input id="sig-email" type="email" value={form.email} onChange={set("email")} placeholder="예: 12345678@owenfood.com" aria-invalid={!!errors.email} />
            {errors.email && <FieldError>{errors.email}</FieldError>}
          </Field>
          <Field>
            <FieldLabel>주소</FieldLabel>
            <div className="flex flex-col gap-2">
              {form.addresses.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={a} onChange={(e) => setAt("addresses", i, e.target.value)} placeholder="예: 대전광역시 동구 계족로 167, 9층 셰프애찬" aria-label={`주소 ${i + 1}`} />
                  {form.addresses.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`주소 ${i + 1} 지우기`} onClick={() => removeAt("addresses", i)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => addOne("addresses")}>
                <Plus data-icon="inline-start" />
                주소 추가
              </Button>
            </div>
            <FieldDescription>비운 주소는 서명에서 빠집니다.</FieldDescription>
          </Field>
        </FieldGroup>
      </form>

      {/* 오른쪽: 미리보기 + 복사·내려받기 */}
      <div className="col-span-12 flex min-w-0 flex-col gap-4 lg:col-span-7">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto font-semibold">미리보기</h3>
          <Button variant="outline" size="sm" onClick={download}>
            {done === "file" ? <Check data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            HTML 파일
          </Button>
          <Button variant="outline" size="sm" onClick={copyCode}>
            {done === "code" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {done === "code" ? "복사됨" : "HTML 코드 복사"}
          </Button>
          <Button size="sm" onClick={copyRich}>
            {done === "rich" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {done === "rich" ? "복사됨" : "서명 복사"}
          </Button>
        </div>
        {/* 서명은 흰 바탕 기준이라 다크 모드에서도 흰 판 위에 보여 준다 */}
        <div className="overflow-x-auto rounded-xl border bg-white p-6">
          <div className="w-fit" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <p className="text-xs text-muted-foreground">
          "서명 복사"를 누른 뒤 메일 프로그램의 서명 설정 칸에 붙여 넣으세요. HTML 을 직접 넣는 곳이면 "HTML 코드 복사"를 쓰세요.
        </p>
      </div>
    </div>
  )
}
