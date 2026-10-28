import { useRef, useState } from "react"
import { CircleAlert, Plus, Printer, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// 디자인 툴 > 데스크 명찰: 팀 이름·직급(직책)·이름을 넣어 가로 8.5cm × 세로 5.5cm 명찰을 인쇄한다.
// 모양은 Figma(셰프애찬 570-1433) 그대로: 850×550 좌표(1 = 0.1mm)의 SVG 로 그린다.
// 팀 이름·직급은 Gmarket Sans Medium, 이름은 Pretendard Regular(Figma 이름 크기·자리에 맞춤).
// 여러 명을 넣어 A4 에 왼쪽 위부터 2열 × 5줄로 놓고, 숨긴 iframe 에 담아 A4 로 인쇄한다(배율 100%, 여백 없음).

type Form = { team: string; rank: string; name: string }

const W = 850
const H = 550
const PAD = 41 // 왼쪽 글자 시작(이름·직급), 오른쪽도 이만큼 비운다

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const hasSpace = (s: string) => /\s/.test(s.trim())

// 셰프애찬 하트 심볼(Figma 그대로)
const SYMBOL = `<path d="M42.8743 67.0489C36.6243 54.5189 41.0343 40.6289 51.5843 36.0289C58.9143 32.8289 66.3843 34.9988 70.4143 38.5688C74.4443 34.9988 81.9043 32.8289 89.2443 36.0289C99.7943 40.6289 104.204 54.5189 97.9543 67.0489C89.8243 83.3389 70.4143 90.5289 70.4143 90.5289C70.4143 90.5289 51.0043 83.3389 42.8743 67.0489Z" fill="#EA5504"/>
<path d="M62.4543 45.0188C66.5043 40.9488 72.9443 40.5889 77.4343 44.1789C78.2843 44.8589 78.4343 46.1089 77.7443 46.9689C77.0643 47.8289 75.8143 47.9589 74.9543 47.2789C72.0543 44.9589 67.8843 45.1988 65.2643 47.8288C63.3343 49.7488 62.6543 52.5588 63.4643 55.1588C63.7943 56.2088 63.2143 57.3189 62.1643 57.6489C61.9643 57.7089 61.7643 57.7388 61.5643 57.7388C60.7243 57.7388 59.9343 57.1988 59.6643 56.3488C58.4043 52.3288 59.4743 47.9888 62.4443 45.0188H62.4543Z" fill="#fff"/>
<path d="M81.0343 70.6189C80.6443 71.8189 80.1143 74.2788 80.4943 78.0988C80.5643 78.7688 80.2743 79.4288 79.7443 79.8488C79.2143 80.2688 78.5043 80.3889 77.8643 80.1689C77.7543 80.1389 67.2943 76.5989 61.6743 80.6089C61.3243 80.8589 60.9243 80.9789 60.5243 80.9789C59.9043 80.9789 59.2943 80.6889 58.9043 80.1489C58.2643 79.2589 58.4743 78.0088 59.3643 77.3788C64.6143 73.6288 72.2943 74.6889 76.3843 75.6389C76.3643 70.5189 77.7943 67.9889 77.9743 67.6789C78.3343 67.0789 78.9843 66.7189 79.6743 66.7189C83.6943 66.7189 86.9543 63.4489 86.9543 59.4389C86.9543 55.4289 83.7543 52.4189 79.6743 52.4189C76.3043 52.4189 73.5543 55.2289 72.3243 59.9389C72.3143 59.9689 72.3043 60.0088 72.2943 60.0388C70.6043 66.3688 66.3243 70.2888 61.1243 70.2888C54.8143 70.2888 49.8743 65.5189 49.8743 59.4289C49.8743 55.6489 51.7543 52.1389 54.9043 50.0489C55.8143 49.4389 57.0543 49.6888 57.6543 50.5988C58.2643 51.5088 58.0143 52.7488 57.1043 53.3488C55.0643 54.7088 53.8443 56.9689 53.8443 59.4189C53.8443 63.3389 56.9743 66.2989 61.1243 66.2989C65.2743 66.2989 67.5343 62.4889 68.4743 58.9189C68.4843 58.8889 68.4943 58.8488 68.5043 58.8188C70.2143 52.4088 74.4843 48.4289 79.6743 48.4289C85.9843 48.4289 90.9243 53.2589 90.9243 59.4189C90.9243 65.1689 86.5943 69.9189 81.0243 70.5889L81.0343 70.6189Z" fill="#fff"/>`

// 한 줄 글자 폭(한글은 글자마다 폭이 같다: Gmarket 0.962em, Pretendard 0.864em). 영문·숫자는 조금 좁아 넉넉히 잡힌다.
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
  const nameSize = fit(name, 250, 0.864, 0.155, W - PAD * 2)
  // 이름이 줄면 글자 가운데 높이(Figma 기준 358)를 지킨다
  const nameY = 358.5 + (nameSize * (0.79 - 0.08)) / 2
  const size = print ? `width="85mm" height="55mm"` : `width="100%"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${size} style="display:block">
<rect width="${W}" height="${H}" fill="#fff"/>
<rect width="${W}" height="125" fill="#292525"/>
${SYMBOL}
<text x="111" y="78.5" fill="#fff" font-family="GmarketSans" font-weight="500" font-size="${teamSize}" letter-spacing="${0.2 * teamSize}">${esc(team)}</text>
${rank ? `<text x="40.6" y="221" fill="#FF4D00" font-family="GmarketSans" font-weight="500" font-size="${rankSize}" letter-spacing="${rankSpacing([...rank].length) * rankSize}">${esc(rank)}</text>` : ""}
<text x="45" y="${nameY}" fill="#161312" font-family="'Pretendard Variable', Pretendard" font-weight="400" font-size="${nameSize}" letter-spacing="${0.155 * nameSize}">${esc(name)}</text>
</svg>`
}

// 여러 명: 한 사람씩 입력 칸을 추가하고, 체크한 사람만 A4 에 왼쪽 위부터 차례로(2열 × 5줄) 놓는다.
type Entry = Form & { id: number; checked: boolean }
type Errors = Partial<Record<keyof Form, string>>

// A4(210×297mm) 배치: 왼쪽 위(왼쪽 10mm·위 6mm)부터 명찰(85×55mm)을 사이를 띄워(가로 5mm·세로 3mm) 2열 × 5줄 = 10장. 아래 여백은 4mm 남는다
const A4 = { w: 210, h: 297 }
const CARD = { w: 85, h: 55 }
const MARGIN = { left: 10, top: 6 }
const GAP = { x: 5, y: 3 }
const COLS = 2
const ROWS = 5
const PER_PAGE = COLS * ROWS
const slot = (i: number) => ({ left: MARGIN.left + (i % COLS) * (CARD.w + GAP.x), top: MARGIN.top + Math.floor(i / COLS) * (CARD.h + GAP.y) })
const pagesOf = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / PER_PAGE) }, (_, p) => list.slice(p * PER_PAGE, (p + 1) * PER_PAGE))

const trimmed = (f: Form): Form => ({ team: f.team.trim(), rank: f.rank.trim(), name: f.name.trim() })
// 이름·직급이 모두 비면 아직 안 쓴 칸(추가하기로 팀 이름만 이어 받은 칸 포함)이라 미리보기·인쇄에서 뺀다
const isBlank = (f: Form) => !f.rank.trim() && !f.name.trim()

function validate(f: Form) {
  const e: Errors = {}
  if (!f.name.trim()) e.name = "이름을 입력해 주세요."
  for (const k of ["team", "rank", "name"] as const) if (hasSpace(f[k])) e[k] = "띄어쓰기 없이 입력해 주세요."
  return e
}

// 숨긴 iframe 에 A4 쪽들만 넣고 인쇄 창을 연다. 글꼴을 다 받은 뒤에 인쇄한다.
function printSheets(list: Form[]) {
  const pages = pagesOf(list)
    .map(
      (cards) =>
        `<div class="page">${cards
          .map((f, i) => {
            const { left, top } = slot(i)
            return `<div class="card" style="left:${left}mm;top:${top}mm">${nameplateSvg(f, true)}</div>`
          })
          .join("")}</div>`,
    )
    .join("")
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  // 명찰 글꼴(Gmarket Sans·Pretendard)을 그대로 쓰려고 앱의 스타일을 함께 담는다
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("")
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>
@page{size:A4 portrait;margin:0}
html,body{margin:0;padding:0;background:#fff}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:${A4.w}mm;height:${A4.h}mm;overflow:hidden;break-after:page}
.page:last-child{break-after:auto}
.card{position:absolute;width:${CARD.w}mm;height:${CARD.h}mm;outline:0.1mm solid #d4d4d4}
</style></head><body>${pages}</body></html>`,
  )
  doc.close()
  const go = () => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // 이름 글꼴은 글자 묶음별로 나뉘어 있어 넣은 글자로 받는다
  const text = (k: keyof Form) => list.map((f) => f[k]).join("")
  void Promise.all([doc.fonts.load("500 50px GmarketSans", text("team") + text("rank")), doc.fonts.load("400 50px 'Pretendard Variable'", text("name"))]).then(go)
}

let nextId = 1
const newEntry = (team = ""): Entry => ({ id: nextId++, team, rank: "", name: "", checked: true })

export function DeskNameplateTool() {
  const [entries, setEntries] = useState<Entry[]>(() => [newEntry()])
  const [errors, setErrors] = useState<Record<number, Errors>>({})
  const nameRefs = useRef(new Map<number, HTMLInputElement>())

  // 미리보기·인쇄 대상: 체크했고 비어 있지 않은 사람
  const targets = entries.filter((e) => e.checked && !isBlank(e))
  const sheets = pagesOf(targets)
  const allChecked = entries.every((e) => e.checked)

  const patch = (id: number, p: Partial<Entry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)))
  const set = (id: number, key: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    const value = ev.target.value
    patch(id, { [key]: value })
    // 쓰는 중에도 띄어쓰기가 들어가면 바로 알려 준다
    setErrors((er) => ({ ...er, [id]: { ...er[id], [key]: hasSpace(value) ? "띄어쓰기 없이 입력해 주세요." : undefined } }))
  }
  // 추가하기: 새 칸을 맨 아래에 만들고(팀 이름은 바로 위 사람 것을 이어 받는다) 이름 칸으로 옮긴다
  const add = () => {
    const entry = newEntry(entries.at(-1)?.team.trim() ?? "")
    setEntries((list) => [...list, entry])
    requestAnimationFrame(() => {
      const input = nameRefs.current.get(entry.id)
      input?.scrollIntoView({ behavior: "smooth", block: "center" })
      input?.focus({ preventScroll: true })
    })
  }
  const remove = (id: number) => {
    setEntries((list) => (list.length > 1 ? list.filter((e) => e.id !== id) : [newEntry()]))
    setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => Number(k) !== id)))
  }

  const print = () => {
    const found: Record<number, Errors> = {}
    for (const e of targets) {
      const v = validate(e)
      if (Object.keys(v).length > 0) found[e.id] = v
    }
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      nameRefs.current.get(Number(first))?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    if (targets.length > 0) printSheets(targets.map(trimmed))
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 p-4 md:p-6">
      {/* 오른쪽(넓은 화면): 주의사항 + 사람 목록 */}
      <form
        className="col-span-12 flex flex-col gap-4 lg:order-2 lg:col-span-6"
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
              <li>A4 한 장에 10명(2열 × 5줄)씩 왼쪽 위부터 차례로 놓입니다. 체크한 사람만 인쇄됩니다.</li>
              <li>인쇄 창에서 용지는 A4, 배율은 100%(실제 크기), 여백은 없음으로 두어야 명찰이 8.5cm × 5.5cm 로 나옵니다.</li>
            </ul>
          </AlertDescription>
        </Alert>

        <div className="flex items-center gap-2">
          <Checkbox
            id="np-all"
            checked={allChecked ? true : entries.some((e) => e.checked) ? "indeterminate" : false}
            onCheckedChange={(v) => setEntries((list) => list.map((e) => ({ ...e, checked: v === true })))}
          />
          <label htmlFor="np-all" className="text-sm font-medium">
            전체 선택
          </label>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {entries.length}명 중 {targets.length}명 인쇄
          </span>
        </div>

        <ol className="flex flex-col gap-3">
          {entries.map((e, i) => {
            const er = errors[e.id] ?? {}
            return (
              <li key={e.id} className={`rounded-xl border p-3 transition-opacity ${e.checked ? "" : "opacity-60"}`}>
                <div className="mb-2 flex items-center gap-2">
                  <Checkbox id={`np-check-${e.id}`} checked={e.checked} onCheckedChange={(v) => patch(e.id, { checked: v === true })} />
                  <label htmlFor={`np-check-${e.id}`} className="text-sm font-semibold tabular-nums">
                    {i + 1}번
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={`${i + 1}번 지우기`} onClick={() => remove(e.id)}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field data-invalid={!!er.team}>
                    <FieldLabel htmlFor={`np-team-${e.id}`}>팀 이름</FieldLabel>
                    <Input id={`np-team-${e.id}`} value={e.team} onChange={set(e.id, "team")} placeholder="디자인팀" aria-invalid={!!er.team} />
                    {er.team && <FieldError>{er.team}</FieldError>}
                  </Field>
                  <Field data-invalid={!!er.rank}>
                    <FieldLabel htmlFor={`np-rank-${e.id}`}>직급·직책</FieldLabel>
                    <Input id={`np-rank-${e.id}`} value={e.rank} onChange={set(e.id, "rank")} placeholder="과장" aria-invalid={!!er.rank} />
                    {er.rank && <FieldError>{er.rank}</FieldError>}
                  </Field>
                  <Field data-invalid={!!er.name}>
                    <FieldLabel htmlFor={`np-name-${e.id}`}>
                      이름{" "}
                      <span className="text-destructive" aria-label="필수">
                        *
                      </span>
                    </FieldLabel>
                    <Input
                      id={`np-name-${e.id}`}
                      ref={(el) => {
                        if (el) nameRefs.current.set(e.id, el)
                        else nameRefs.current.delete(e.id)
                      }}
                      value={e.name}
                      onChange={set(e.id, "name")}
                      placeholder="홍길동"
                      aria-invalid={!!er.name}
                    />
                    {er.name && <FieldError>{er.name}</FieldError>}
                  </Field>
                </div>
              </li>
            )
          })}
        </ol>

        <Button type="button" variant="outline" className="w-full" onClick={add}>
          <Plus data-icon="inline-start" />
          추가하기
        </Button>
        <Button type="submit" size="lg" className="w-full" disabled={targets.length === 0}>
          <Printer data-icon="inline-start" />
          인쇄하기 {targets.length > 0 && `(${targets.length}명 · A4 ${sheets.length}장)`}
        </Button>
        <FieldDescription>체크를 풀면 목록에는 남고 미리보기·인쇄에서만 빠집니다.</FieldDescription>
      </form>

      {/* 왼쪽(넓은 화면): A4 미리보기(실제 비율). 내려도 화면에 붙어 있다 */}
      <div className="col-span-12 flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:order-1 lg:col-span-6 lg:self-start">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold">미리보기</h3>
          <span className="text-xs text-muted-foreground">A4(210 × 297mm) · 명찰 8.5 × 5.5cm · 한 장에 10명</span>
        </div>
        <div className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-4">
          {(sheets.length > 0 ? sheets : [[]]).map((cards, p) => (
            <div key={p} className="relative w-full bg-white shadow-md" style={{ aspectRatio: `${A4.w} / ${A4.h}` }} aria-label={`A4 ${p + 1}장`}>
              {cards.map((f, i) => {
                const { left, top } = slot(i)
                return (
                  <div
                    key={f.id}
                    className="absolute outline outline-neutral-300"
                    style={{
                      left: `${(left / A4.w) * 100}%`,
                      top: `${(top / A4.h) * 100}%`,
                      width: `${(CARD.w / A4.w) * 100}%`,
                      height: `${(CARD.h / A4.h) * 100}%`,
                    }}
                    dangerouslySetInnerHTML={{ __html: nameplateSvg(trimmed(f)) }}
                  />
                )
              })}
              {cards.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm break-keep text-neutral-400">
                  이름을 넣으면 왼쪽 위부터 차례로 놓입니다.
                </p>
              )}
              {sheets.length > 1 && (
                <span className="absolute right-2 bottom-1 text-[10px] text-neutral-400 tabular-nums">
                  {p + 1} / {sheets.length}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
