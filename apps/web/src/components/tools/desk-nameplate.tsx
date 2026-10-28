import { useState } from "react"
import { CircleAlert, Printer } from "lucide-react"
import "@fontsource/noto-sans-kr/400.css"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// 디자인 툴 > 데스크 명찰: 팀 이름·직급(직책)·이름을 넣어 가로 8.5cm × 세로 5.5cm 명찰을 인쇄한다.
// 모양은 Figma(셰프애찬 570-1433) 그대로: 850×550 좌표(1 = 0.1mm)의 SVG 로 그린다.
// 팀 이름·직급은 Gmarket Sans Medium, 이름은 Noto Sans KR Regular(Figma 와 같은 글꼴).
// 인쇄는 숨긴 iframe 에 명찰만 담아 @page 크기를 85mm × 55mm 로 맞춘다(배율 100%, 여백 없음).

type Form = { team: string; rank: string; name: string }

const SAMPLE: Form = { team: "디자인팀", rank: "과장", name: "홍길동" }
const W = 850
const H = 550
const PAD = 41 // 왼쪽 글자 시작(이름·직급), 오른쪽도 이만큼 비운다

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const hasSpace = (s: string) => /\s/.test(s.trim())

// 셰프애찬 하트 심볼(Figma 그대로)
const SYMBOL = `<path d="M42.8743 67.0489C36.6243 54.5189 41.0343 40.6289 51.5843 36.0289C58.9143 32.8289 66.3843 34.9988 70.4143 38.5688C74.4443 34.9988 81.9043 32.8289 89.2443 36.0289C99.7943 40.6289 104.204 54.5189 97.9543 67.0489C89.8243 83.3389 70.4143 90.5289 70.4143 90.5289C70.4143 90.5289 51.0043 83.3389 42.8743 67.0489Z" fill="#EA5504"/>
<path d="M62.4543 45.0188C66.5043 40.9488 72.9443 40.5889 77.4343 44.1789C78.2843 44.8589 78.4343 46.1089 77.7443 46.9689C77.0643 47.8289 75.8143 47.9589 74.9543 47.2789C72.0543 44.9589 67.8843 45.1988 65.2643 47.8288C63.3343 49.7488 62.6543 52.5588 63.4643 55.1588C63.7943 56.2088 63.2143 57.3189 62.1643 57.6489C61.9643 57.7089 61.7643 57.7388 61.5643 57.7388C60.7243 57.7388 59.9343 57.1988 59.6643 56.3488C58.4043 52.3288 59.4743 47.9888 62.4443 45.0188H62.4543Z" fill="#fff"/>
<path d="M81.0343 70.6189C80.6443 71.8189 80.1143 74.2788 80.4943 78.0988C80.5643 78.7688 80.2743 79.4288 79.7443 79.8488C79.2143 80.2688 78.5043 80.3889 77.8643 80.1689C77.7543 80.1389 67.2943 76.5989 61.6743 80.6089C61.3243 80.8589 60.9243 80.9789 60.5243 80.9789C59.9043 80.9789 59.2943 80.6889 58.9043 80.1489C58.2643 79.2589 58.4743 78.0088 59.3643 77.3788C64.6143 73.6288 72.2943 74.6889 76.3843 75.6389C76.3643 70.5189 77.7943 67.9889 77.9743 67.6789C78.3343 67.0789 78.9843 66.7189 79.6743 66.7189C83.6943 66.7189 86.9543 63.4489 86.9543 59.4389C86.9543 55.4289 83.7543 52.4189 79.6743 52.4189C76.3043 52.4189 73.5543 55.2289 72.3243 59.9389C72.3143 59.9689 72.3043 60.0088 72.2943 60.0388C70.6043 66.3688 66.3243 70.2888 61.1243 70.2888C54.8143 70.2888 49.8743 65.5189 49.8743 59.4289C49.8743 55.6489 51.7543 52.1389 54.9043 50.0489C55.8143 49.4389 57.0543 49.6888 57.6543 50.5988C58.2643 51.5088 58.0143 52.7488 57.1043 53.3488C55.0643 54.7088 53.8443 56.9689 53.8443 59.4189C53.8443 63.3389 56.9743 66.2989 61.1243 66.2989C65.2743 66.2989 67.5343 62.4889 68.4743 58.9189C68.4843 58.8889 68.4943 58.8488 68.5043 58.8188C70.2143 52.4088 74.4843 48.4289 79.6743 48.4289C85.9843 48.4289 90.9243 53.2589 90.9243 59.4189C90.9243 65.1689 86.5943 69.9189 81.0243 70.5889L81.0343 70.6189Z" fill="#fff"/>`

// 한 줄 글자 폭(한글은 글자마다 폭이 같다: Gmarket 0.962em, Noto 0.92em). 영문·숫자는 조금 좁아 넉넉히 잡힌다.
const lineWidth = (text: string, size: number, advance: number, spacing: number) => {
  const n = [...text].length
  return n * advance * size + Math.max(0, n - 1) * spacing * size
}
// 칸 너비(max)를 넘으면 글자 크기를 줄인다
const fit = (text: string, size: number, advance: number, spacing: number, max: number) =>
  Math.min(size, (size * max) / Math.max(1, lineWidth(text, size, advance, spacing)))

// 직급 글자 사이: 두 글자(과장·팀장)는 Figma 처럼 넓게, 길수록 좁게
const rankSpacing = (n: number) => (n <= 2 ? 0.73 : n === 3 ? 0.3 : 0.05)

// 명찰 한 장(미리보기와 인쇄가 같은 SVG). 인쇄는 85mm × 55mm, 미리보기는 칸 너비에 맞춘다.
function nameplateSvg(f: Form, print = false) {
  const team = f.team.trim()
  const rank = f.rank.trim()
  const name = f.name.trim()
  const teamSize = fit(team, 54, 0.962, 0.2, W - 111 - PAD)
  const rankSize = fit(rank, 80, 0.962, rankSpacing([...rank].length), W - PAD * 2)
  const nameSize = fit(name, 238, 0.92, 0.16, W - PAD * 2)
  // 이름이 줄면 글자 가운데 높이(Figma 기준 358)를 지킨다
  const nameY = 358.5 + (nameSize * (0.83 - 0.08)) / 2
  const size = print ? `width="85mm" height="55mm"` : `width="100%"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${size} style="display:block">
<rect width="${W}" height="${H}" fill="#fff"/>
<rect width="${W}" height="125" fill="#292525"/>
${SYMBOL}
<text x="111" y="78.5" fill="#fff" font-family="GmarketSans" font-weight="500" font-size="${teamSize}" letter-spacing="${0.2 * teamSize}">${esc(team)}</text>
${rank ? `<text x="40.6" y="221" fill="#FF4D00" font-family="GmarketSans" font-weight="500" font-size="${rankSize}" letter-spacing="${rankSpacing([...rank].length) * rankSize}">${esc(rank)}</text>` : ""}
<text x="${PAD}" y="${nameY}" fill="#161312" font-family="'Noto Sans KR'" font-weight="400" font-size="${nameSize}" letter-spacing="${0.16 * nameSize}">${esc(name)}</text>
</svg>`
}

function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f.name.trim()) e.name = "이름을 입력해 주세요."
  for (const k of ["team", "rank", "name"] as const) if (hasSpace(f[k])) e[k] = "띄어쓰기 없이 입력해 주세요."
  return e
}

// 숨긴 iframe 에 명찰만 넣고 인쇄 창을 연다. 글꼴을 다 받은 뒤에 인쇄한다.
function printNameplate(f: Form) {
  const html = nameplateSvg(f, true)
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  // 명찰 글꼴(Gmarket Sans·Noto Sans KR)을 그대로 쓰려고 앱의 스타일을 함께 담는다
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("")
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>@page{size:85mm 55mm;margin:0}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${html}</body></html>`,
  )
  doc.close()
  const go = () => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // 글꼴을 다 받은 뒤 인쇄(이름 글꼴은 글자 묶음별로 나뉘어 있어 넣은 글자로 받는다)
  void Promise.all([doc.fonts.load("500 50px GmarketSans", f.team + f.rank), doc.fonts.load("400 50px 'Noto Sans KR'", f.name)]).then(go)
}

export function DeskNameplateTool() {
  const [form, setForm] = useState<Form>({ team: "", rank: "", name: "" })
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  // 미리보기는 이름을 넣기 전까지 예시 값으로 채운다
  const preview = form.name.trim() ? form : { team: form.team || SAMPLE.team, rank: form.rank || SAMPLE.rank, name: SAMPLE.name }

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setForm((f) => ({ ...f, [key]: value }))
    // 쓰는 중에도 띄어쓰기가 들어가면 바로 알려 준다
    setErrors((er) => ({ ...er, [key]: hasSpace(value) ? "띄어쓰기 없이 입력해 주세요." : undefined }))
  }

  const print = () => {
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).length > 0) return
    printNameplate({ team: form.team.trim(), rank: form.rank.trim(), name: form.name.trim() })
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 p-4 md:p-6">
      {/* 왼쪽: 주의사항 + 입력 */}
      <form
        className="col-span-12 flex flex-col gap-6 lg:col-span-5"
        onSubmit={(e) => {
          e.preventDefault()
          print()
        }}
      >
        <Alert>
          <CircleAlert />
          <AlertTitle>작성할 때 주의해 주세요</AlertTitle>
          <AlertDescription className="break-keep">
            <ul className="list-disc pl-4">
              <li>
                모든 칸은 <b className="text-foreground">띄어쓰기 없이</b> 써 주세요. (예: 디자인 팀 → 디자인팀)
              </li>
              <li>팀 이름, 직급(직책), 이름 순서로 넣어 주세요. 직급과 직책 가운데 명찰에 보일 것 하나만 넣습니다.</li>
              <li>인쇄 창에서 배율은 100%(실제 크기), 여백은 없음으로 두어야 8.5cm × 5.5cm 로 나옵니다.</li>
            </ul>
          </AlertDescription>
        </Alert>
        <FieldGroup>
          <Field data-invalid={!!errors.team}>
            <FieldLabel htmlFor="np-team">팀 이름</FieldLabel>
            <Input id="np-team" value={form.team} onChange={set("team")} placeholder="예: 디자인팀" aria-invalid={!!errors.team} />
            {errors.team && <FieldError>{errors.team}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.rank}>
            <FieldLabel htmlFor="np-rank">직급·직책</FieldLabel>
            <Input id="np-rank" value={form.rank} onChange={set("rank")} placeholder="예: 과장, 팀장" aria-invalid={!!errors.rank} />
            {errors.rank ? <FieldError>{errors.rank}</FieldError> : <FieldDescription>비워 두면 팀 이름만 보입니다.</FieldDescription>}
          </Field>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="np-name">
              이름{" "}
              <span className="text-destructive" aria-label="필수">
                *
              </span>
            </FieldLabel>
            <Input id="np-name" value={form.name} onChange={set("name")} placeholder="예: 홍길동" aria-invalid={!!errors.name} />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
          <Button type="submit" size="lg" className="w-full">
            <Printer data-icon="inline-start" />
            인쇄하기
          </Button>
        </FieldGroup>
      </form>

      {/* 오른쪽: 미리보기(칸 너비에 맞춰 크게) */}
      <div className="col-span-12 flex min-w-0 flex-col gap-3 lg:col-span-7">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold">미리보기</h3>
          <span className="text-xs text-muted-foreground">가로 8.5cm × 세로 5.5cm (화면은 확대)</span>
        </div>
        <div className="rounded-xl border bg-muted/40 p-6">
          {/* SVG 라 칸 너비에 맞춰 그대로 커진다 */}
          <div className="mx-auto max-w-[170mm] shadow-md" dangerouslySetInnerHTML={{ __html: nameplateSvg(preview) }} />
        </div>
        {!form.name.trim() && <p className="text-xs text-muted-foreground">이름을 넣기 전에는 예시 값으로 보입니다.</p>}
      </div>
    </div>
  )
}
