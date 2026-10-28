import { useEffect, useRef, useState } from "react"
import { CircleAlert, Printer } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// 디자인 툴 > 데스크 명찰: 팀 이름·직급(직책)·이름을 넣어 가로 8.5cm × 세로 5.5cm 명찰을 인쇄한다.
// 인쇄는 숨긴 iframe 에 명찰만 담아 @page 크기를 85mm × 55mm 로 맞춘다(배율 100%, 여백 없음).

type Form = { team: string; rank: string; name: string }

const LOGO = "https://yorihaeyou.cafe24.com/mail/logo/logo.png"
const RED = "rgb(215, 40, 47)"
const TEXT = "rgb(34, 34, 34)"
const SAMPLE: Form = { team: "디자인팀", rank: "과장", name: "홍길동" }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const hasSpace = (s: string) => /\s/.test(s.trim())

// 이름이 길면 글자를 줄여 한 줄에 들어가게
function nameSize(name: string) {
  const n = [...name].length
  return n <= 3 ? 13 : n === 4 ? 11 : n <= 6 ? 8.5 : 6.5
}

// 명찰 한 장(미리보기와 인쇄가 같은 HTML 을 쓴다). 단위는 mm
function nameplateHtml(f: Form) {
  const org = [f.team.trim(), f.rank.trim()].filter(Boolean).map(esc).join(`<span style="color:${RED};margin:0 1.6mm">|</span>`)
  const name = esc(f.name.trim())
  return `<div style="box-sizing:border-box;width:85mm;height:55mm;background:#fff;color:${TEXT};font-family:GmarketSans,'Malgun Gothic',sans-serif;display:flex;flex-direction:column;overflow:hidden;position:relative">
<div style="height:2.2mm;background:${RED}"></div>
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2mm;padding:0 6mm">
${org ? `<div style="font-size:4mm;font-weight:500;letter-spacing:0.3mm;white-space:nowrap">${org}</div>` : ""}
<div style="font-size:${nameSize(f.name.trim())}mm;font-weight:700;letter-spacing:${[...f.name.trim()].length <= 3 ? 2.4 : 1}mm;line-height:1.1;white-space:nowrap;margin-right:-${[...f.name.trim()].length <= 3 ? 2.4 : 1}mm">${name}</div>
</div>
<div style="display:flex;align-items:center;gap:3mm;padding:0 6mm 4.5mm">
<div style="flex:1;height:0.3mm;background:${RED}"></div>
<img src="${LOGO}" alt="셰프애찬" style="height:6mm;width:auto;display:block">
<div style="flex:1;height:0.3mm;background:${RED}"></div>
</div>
</div>`
}

function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f.name.trim()) e.name = "이름을 입력해 주세요."
  for (const k of ["team", "rank", "name"] as const) if (hasSpace(f[k])) e[k] = "띄어쓰기 없이 입력해 주세요."
  return e
}

// 숨긴 iframe 에 명찰만 넣고 인쇄 창을 연다. 로고 그림을 다 받은 뒤에 인쇄한다.
function printNameplate(html: string) {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  // 명찰 글꼴(Gmarket Sans)을 그대로 쓰려고 앱의 스타일을 함께 담는다
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
  const img = doc.querySelector("img")
  const ready = Promise.all([
    doc.fonts?.load("700 13mm GmarketSans").then(() => doc.fonts.load("500 4mm GmarketSans")),
    img && !img.complete ? new Promise((r) => ((img.onload = r), (img.onerror = r))) : null,
  ])
  void ready.then(go)
}

export function DeskNameplateTool() {
  const [form, setForm] = useState<Form>({ team: "", rank: "", name: "" })
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  // 미리보기 배율: 칸 안쪽 너비에 맞춘다(최대 2배)
  const boxRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1.5)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(() => {
      const inner = box.clientWidth - 48 // p-6 양쪽
      setZoom(Math.max(0.5, Math.min(2, inner / ((85 * 96) / 25.4))))
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
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
    printNameplate(nameplateHtml(form))
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
        <div ref={boxRef} className="overflow-hidden rounded-xl border bg-muted/40 p-6">
          {/* 85mm×55mm 를 칸 너비에 맞게 키운다(자리도 키운 만큼 잡는다) */}
          <div className="mx-auto" style={{ width: `${85 * zoom}mm`, height: `${55 * zoom}mm` }}>
            <div className="origin-top-left shadow-md" style={{ scale: zoom }} dangerouslySetInnerHTML={{ __html: nameplateHtml(preview) }} />
          </div>
        </div>
        {!form.name.trim() && <p className="text-xs text-muted-foreground">이름을 넣기 전에는 예시 값으로 보입니다.</p>}
      </div>
    </div>
  )
}
