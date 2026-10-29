import { useRef, useState } from "react"
import { Check, CircleAlert, Copy, Plus, Printer, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// 디자인 툴 > 데스크 명찰: 팀 이름·직급(직책)·이름을 넣어 가로 8.5cm × 세로 5.5cm 명찰을 인쇄한다.
// 모양은 Figma(셰프애찬 570-1433) 그대로: 850×550 좌표(1 = 0.1mm)의 SVG 로 그린다.
// 팀 이름·직급은 Gmarket Sans Medium, 이름은 SB 어그로 Medium. 띠·이름 색은 부서 색에서 고른다.
// 한 사람마다 명찰 두 장을 위아래로 붙여(위는 거꾸로) 가운데 선을 접으면 앞뒤로 보이는 탁상 명찰이 된다(직원이름표_본사 양식).
// 여러 명을 넣어 A4 에 왼쪽 위부터 2열 × 2줄(4명)로 놓고, 숨긴 iframe 에 담아 A4 로 인쇄한다(배율 100%, 여백 없음).

type Form = { team: string; rank: string; name: string; color: string }

// 부서 색(직원이름표_본사 아래 색 띠). 띠와 이름에 같은 색을 쓰고, 회색 부서는 이름만 조금 더 진하게. 고르면 팀 이름(team)도 채운다
const COLORS = [
  { id: "b2b", label: "B2B", team: "B2B사업부", band: "#1D570B", name: "#1D570B" },
  { id: "f3", label: "F3", team: "F3생산본부", band: "#3F4044", name: "#303133" },
  { id: "buy", label: "구매", team: "구매팀", band: "#7767A8", name: "#7767A8" },
  { id: "order", label: "발주", team: "발주팀", band: "#00B1F1", name: "#00B1F1" },
  { id: "hr", label: "인사총무", team: "인사총무팀", band: "#3F4044", name: "#303133" },
  { id: "settle", label: "정산", team: "정산팀", band: "#3D6B61", name: "#3D6B61" },
  { id: "account", label: "회계", team: "회계팀", band: "#3F441B", name: "#3F441B" },
] as const
const colorOf = (id: string) => COLORS.find((c) => c.id === id) ?? COLORS[0]

const W = 850
const H = 550
const PAD = 41 // 왼쪽 글자 시작(이름·직급), 오른쪽도 이만큼 비운다
const TEAM_X = 118 // 팀 이름 시작(심볼 오른쪽 끝 100.6 에서 조금 띄움. Figma 는 111)

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

// 명찰 한 장(850×550)의 그림
function cardSvg(f: Form) {
  const team = f.team.trim()
  const rank = f.rank.trim()
  const name = f.name.trim()
  const teamSize = fit(team, 54, 0.962, 0.2, W - TEAM_X - PAD)
  const rankSize = fit(rank, 80, 0.962, rankSpacing([...rank].length), W - PAD * 2)
  // SB 어그로 한글 폭 0.94em, 글자는 기준선 위 0.75em·아래 0.14em
  const nameSize = fit(name, 250, 0.94, 0.03, W - PAD * 2)
  const color = colorOf(f.color)
  // 팀 이름은 색 띠(높이 125) 가운데에 심볼과 나란히. 이름은 글자 가운데를 372 에 둔다(Figma 는 358)
  const nameY = 372 + nameSize * 0.3
  return `<rect width="${W}" height="${H}" fill="#fff"/>
<rect width="${W}" height="125" fill="${color.band}"/>
${SYMBOL}
<text x="${TEAM_X}" y="${62.5 + (teamSize * (0.75 - 0.1)) / 2}" fill="#fff" font-family="GmarketSans" font-weight="500" font-size="${teamSize}" letter-spacing="${0.2 * teamSize}">${esc(team)}</text>
${rank ? `<text x="40.6" y="221" fill="#FF4D00" font-family="GmarketSans" font-weight="500" font-size="${rankSize}" letter-spacing="${rankSpacing([...rank].length) * rankSize}">${esc(rank)}</text>` : ""}
<text x="${PAD}" y="${nameY}" fill="${color.name}" font-family="SBAggro" font-weight="500" font-size="${nameSize}" letter-spacing="${0.03 * nameSize}">${esc(name)}</text>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#e4e5e7" stroke-width="2"/>`
}

// 한 사람(미리보기와 인쇄가 같은 SVG): 위 장은 거꾸로, 아래 장은 바로. 두 장의 띠가 가운데(접는 선)에서 만난다.
// 테두리(#e4e5e7)는 자르는 선이자 가운데 접는 선. 인쇄는 85mm × 110mm, 미리보기는 칸 너비에 맞춘다.
function nameplateSvg(f: Form, print = false) {
  const size = print ? `width="85mm" height="110mm"` : `width="100%"`
  const card = cardSvg(f)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H * 2}" ${size} style="display:block">
<g transform="rotate(180 ${W / 2} ${H / 2})">${card}</g>
<g transform="translate(0 ${H})">${card}</g>
</svg>`
}

// 여러 명: 한 사람씩 입력 칸을 추가하고, 체크한 사람만 A4 에 왼쪽 위부터 차례로(2열 × 2줄) 놓는다.
type Entry = Form & { id: number; checked: boolean }
type Errors = Partial<Record<"team" | "rank" | "name", string>>

// A4(210×297mm) 배치: 한 사람(명찰 두 장, 85×110mm)을 사이를 띄워(가로 5mm·세로 10mm) 2열 × 2줄 = 4명, 묶음 전체를 A4 가운데(위아래·좌우)에 놓는다
const A4 = { w: 210, h: 297 }
const CARD = { w: 85, h: 110 }
const MARGIN = { left: (210 - (85 * 2 + 5)) / 2, top: (297 - (110 * 2 + 10)) / 2 } // 17.5mm · 33.5mm
const GAP = { x: 5, y: 10 }
const COLS = 2
const ROWS = 2
const PER_PAGE = COLS * ROWS
const MAX_ENTRIES = PER_PAGE // 한 번에 넣을 수 있는 사람 수(A4 한 장 4명)
const slot = (i: number) => ({ left: MARGIN.left + (i % COLS) * (CARD.w + GAP.x), top: MARGIN.top + Math.floor(i / COLS) * (CARD.h + GAP.y) })
const pagesOf = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / PER_PAGE) }, (_, p) => list.slice(p * PER_PAGE, (p + 1) * PER_PAGE))

const trimmed = (f: Form): Form => ({ team: f.team.trim(), rank: f.rank.trim(), name: f.name.trim(), color: f.color })
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
  // 명찰 글꼴(Gmarket Sans·SB 어그로)을 그대로 쓰려고 앱의 스타일을 함께 담는다
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("")
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>
@page{size:A4 portrait;margin:0}
html,body{margin:0;padding:0;background:#fff}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:${A4.w}mm;height:${A4.h}mm;overflow:hidden;break-after:page}
.page:last-child{break-after:auto}
.card{position:absolute;width:${CARD.w}mm;height:${CARD.h}mm}
</style></head><body>${pages}</body></html>`,
  )
  doc.close()
  const go = () => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 1000)
  }
  const text = (k: keyof Errors) => list.map((f) => f[k]).join("")
  void Promise.all([doc.fonts.load("500 50px GmarketSans", text("team") + text("rank")), doc.fonts.load("500 50px SBAggro", text("name"))]).then(go)
}

let nextId = 1
const newEntry = (team = "", color: string = COLORS[0].id): Entry => ({ id: nextId++, team, rank: "", name: "", color, checked: true })

export function DeskNameplateTool() {
  const [entries, setEntries] = useState<Entry[]>(() => [newEntry()])
  const [errors, setErrors] = useState<Record<number, Errors>>({})
  const nameRefs = useRef(new Map<number, HTMLInputElement>())

  // 미리보기·인쇄 대상: 체크했고 비어 있지 않은 사람
  const targets = entries.filter((e) => e.checked && !isBlank(e))
  const sheets = pagesOf(targets)
  const allChecked = entries.every((e) => e.checked)

  const patch = (id: number, p: Partial<Entry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)))
  const set = (id: number, key: keyof Errors) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    const value = ev.target.value
    patch(id, { [key]: value })
    // 쓰는 중에도 띄어쓰기가 들어가면 바로 알려 준다
    setErrors((er) => ({ ...er, [id]: { ...er[id], [key]: hasSpace(value) ? "띄어쓰기 없이 입력해 주세요." : undefined } }))
  }
  // 최대 A4 한 장(4명)까지만 늘릴 수 있다
  const full = entries.length >= MAX_ENTRIES
  const focusName = (id: number) =>
    requestAnimationFrame(() => {
      const input = nameRefs.current.get(id)
      input?.scrollIntoView({ behavior: "smooth", block: "center" })
      input?.focus({ preventScroll: true })
    })
  // 추가하기: 새 칸을 맨 아래에 만들고(팀 이름·부서 색은 바로 위 사람 것을 이어 받는다) 이름 칸으로 옮긴다
  const add = () => {
    if (full) return
    const last = entries.at(-1)
    const entry = newEntry(last?.team.trim() ?? "", last?.color)
    setEntries((list) => [...list, entry])
    focusName(entry.id)
  }
  // 복사하기: 같은 내용(팀·직급·이름)을 바로 아래에 하나 더 만든다(같은 명찰을 여러 장 뽑을 때). 이름을 넣어야 쓸 수 있다
  const duplicate = (src: Entry) => {
    if (full || !src.name.trim()) return
    const entry = { ...newEntry(), team: src.team, rank: src.rank, name: src.name, color: src.color }
    setEntries((list) => list.flatMap((e) => (e.id === src.id ? [e, entry] : [e])))
    focusName(entry.id)
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
              <li>한 사람마다 명찰이 위아래 2장(위는 거꾸로) 붙어 나옵니다. 테두리를 따라 자르고 가운데 선을 접으면 앞뒤로 보이는 탁상 명찰이 됩니다.</li>
              <li>부서 색을 고르면 위 띠와 이름이 그 색으로 바뀌고 팀 이름이 자동으로 들어갑니다. 팀 이름은 고른 뒤에 고쳐 쓸 수 있습니다.</li>
              <li>A4 한 장에 최대 4명(2열 × 2줄)까지 왼쪽 위부터 차례로 놓입니다. 체크한 사람만 인쇄됩니다.</li>
              <li>
                각 칸 오른쪽 위 <Copy className="inline size-3.5 align-[-2px]" aria-label="복사하기" /> 복사하기를 누르면 같은 내용(팀 이름·직급·이름)이 바로 아래에 하나 더 생깁니다. 이름을 넣어야 복사되고, 4명이 차면 추가하기·복사하기가 막힙니다.
              </li>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={`${i + 1}번 복사하기`}
                    title={full ? `최대 ${MAX_ENTRIES}명까지 넣을 수 있습니다` : !e.name.trim() ? "이름을 넣어야 복사할 수 있습니다" : "같은 내용으로 하나 더"}
                    disabled={full || !e.name.trim()}
                    onClick={() => duplicate(e)}
                  >
                    <Copy />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${i + 1}번 지우기`} title="지우기" onClick={() => remove(e.id)}>
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
                <div className="mt-2 flex flex-col gap-1.5">
                  <span className="text-sm font-medium">부서 색</span>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${i + 1}번 부서 색`}>
                    {COLORS.map((c) => {
                      const on = e.color === c.id
                      return (
                        <Button
                          key={c.id}
                          type="button"
                          size="sm"
                          role="radio"
                          aria-checked={on}
                          className={`border-0 text-white hover:opacity-90 ${on ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "opacity-70"}`}
                          style={{ backgroundColor: c.band }}
                          onClick={() => {
                            patch(e.id, { color: c.id, team: c.team })
                            setErrors((er) => ({ ...er, [e.id]: { ...er[e.id], team: undefined } }))
                          }}
                        >
                          {on && <Check data-icon="inline-start" />}
                          {c.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        <Button type="button" variant="outline" className="w-full" disabled={full} onClick={add}>
          <Plus data-icon="inline-start" />
          {full ? `최대 ${MAX_ENTRIES}명까지 넣을 수 있습니다` : "추가하기"}
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
          <span className="text-xs text-muted-foreground">A4(210 × 297mm) · 명찰 8.5 × 5.5cm 앞뒤 2장 · 한 장에 4명</span>
        </div>
        <div className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-4">
          {(sheets.length > 0 ? sheets : [[]]).map((cards, p) => (
            <div key={p} className="relative w-full bg-white shadow-md" style={{ aspectRatio: `${A4.w} / ${A4.h}` }} aria-label={`A4 ${p + 1}장`}>
              {cards.map((f, i) => {
                const { left, top } = slot(i)
                return (
                  <div
                    key={f.id}
                    className="absolute"
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
