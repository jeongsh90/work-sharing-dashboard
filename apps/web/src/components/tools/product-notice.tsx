import { useEffect, useRef, useState } from "react"
import { Check, Copy, Download, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToolHistory } from "@/components/tools/tool-history"
import { SortableList } from "@/components/sortable-list"
import { api } from "@/lib/api"
import { applyFont, loadFonts, wrapText, type TextStyle } from "@/lib/canvas-text"
import { invalidate } from "@/lib/store"

// 디자인 툴 > 상품정보고시: 고시 항목·주의사항·영양정보를 입력하면 상세페이지용 이미지(가로 860)를 만든다.
// 사양: docs/tools/상품정보고시_툴_사양.md (Figma 셰프애찬 235:291). 글은 입력한 그대로 쓴다(법적 표기).
// 왼쪽 미리보기 캔버스가 그대로 내려받는 이미지다.

type Row = { id: number; label: string; value: string }
type NutriRow = { id: number; name: string; amount: string; ratio: string }

const W = 860
const PAD = { top: 120, side: 70, bottom: 120 }
const GAP = 48 // 섹션 간격
const CONTENT_W = W - PAD.side * 2 // 720
const MAIN = "#111111"
const SUB = "#555555"
const LINE = "#e5e5ec"
const ORANGE = "#f97316"

// 글자 스타일(사양 5장)
const S = {
  title: { weight: 700, size: 52, spacing: -0.03 } as TextStyle, // 줄높이 68
  label: { weight: 700, size: 28, spacing: -0.02 } as TextStyle, // 39
  value: { weight: 500, size: 26, spacing: -0.015 } as TextStyle, // 43
  note: { weight: 500, size: 24, spacing: -0.015 } as TextStyle, // 41
  nutriHead: { weight: 700, size: 28, spacing: -0.02 } as TextStyle,
  nutriCell: { weight: 500, size: 26, spacing: -0.015 } as TextStyle,
  nutriRatio: { weight: 700, size: 26, spacing: -0.015 } as TextStyle,
}
const LH = { title: 68, label: 39, value: 43, note: 41 }

const NOTICE_LABELS = ["제품명", "원료명", "내용량", "식품유형", "보관방법", "소비기한", "품목번호", "제조원"]
const NUTRI_NAMES = ["열량", "나트륨", "탄수화물", "당류", "지방", "트랜스지방", "포화지방", "콜레스테롤", "단백질"]
const DEFAULT_NUTRI_NOTE = "1일 영양성분 기준치에 대한 비율(%)은 2,000kcal 기준이므로 개인의 필요 열량에 따라 다를 수 있습니다."

let nextId = 1
const id = () => nextId++

type Form = {
  rows: Row[]
  notes: string // 주의사항: 1줄 = 1항목(앞에 ※)
  nutriTitle: string
  nutri: NutriRow[]
  nutriNote: string
}

const initialForm = (): Form => ({
  rows: NOTICE_LABELS.map((label) => ({ id: id(), label, value: "" })),
  notes: "",
  nutriTitle: "영양정보 (100g당)",
  nutri: NUTRI_NAMES.map((name) => ({ id: id(), name, amount: "", ratio: "" })),
  nutriNote: DEFAULT_NUTRI_NOTE,
})

// 입력 정리(사양 8장): 온도 °C → ℃, 주의 문구 앞 ※ 는 빼고 툴이 붙인다
const tidy = (v: string) => v.replace(/°\s*C/g, "℃").trim()
const noteLines = (notes: string) =>
  notes
    .split("\n")
    .map((l) => tidy(l.replace(/^\s*※\s*/, "")))
    .filter(Boolean)

// 그릴 내용만 추린다(빈 행·빈 묶음은 빼고)
function contentOf(f: Form) {
  const rows = f.rows.map((r) => ({ label: tidy(r.label), value: tidy(r.value) })).filter((r) => r.label || r.value)
  const notes = noteLines(f.notes)
  const nutri = f.nutri
    .map((n) => ({ name: tidy(n.name), amount: tidy(n.amount), ratio: tidy(n.ratio) }))
    .filter((n) => n.amount || n.ratio)
  const nutriNote = noteLines(f.nutriNote)
  return { rows, notes, nutri, nutriNote, nutriTitle: tidy(f.nutriTitle) }
}

// 그리기: 먼저 높이를 재고(measure=true) 그다음 실제로 그린다
function render(ctx: CanvasRenderingContext2D, f: Form, measure: boolean) {
  const c = contentOf(f)
  let y = PAD.top
  const text = (s: TextStyle, color: string, str: string, x: number, lineY: number, lh: number, align: CanvasTextAlign = "left") => {
    if (measure) return
    applyFont(ctx, s)
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = "middle"
    ctx.fillText(str, x, lineY + lh / 2)
  }
  const rule = (yy: number, h: number, color: string) => {
    if (measure) return
    ctx.fillStyle = color
    ctx.fillRect(PAD.side, yy, CONTENT_W, h)
  }

  // 5-0 제목
  text(S.title, MAIN, "상품정보고시", W / 2, y, LH.title, "center")
  y += LH.title

  // 5-1 고시 표: 위 2px 검정 선, 행마다 여백 16 · 항목명 110 · 간격 24 · 아래 1px 회색 선
  if (c.rows.length > 0) {
    y += GAP
    rule(y, 2, MAIN)
    y += 2
    const valueW = CONTENT_W - 16 * 2 - 110 - 24
    for (const r of c.rows) {
      applyFont(ctx, S.label)
      const labelLines = wrapText(ctx, r.label, 110)
      applyFont(ctx, S.value)
      const valueLines = r.value ? wrapText(ctx, r.value, valueW) : [""]
      const h = Math.max(labelLines.length * LH.label, valueLines.length * LH.value)
      labelLines.forEach((l, i) => text(S.label, MAIN, l, PAD.side + 16, y + 16 + i * LH.label, LH.label))
      valueLines.forEach((l, i) => text(S.value, SUB, l, PAD.side + 16 + 110 + 24, y + 16 + i * LH.value, LH.value))
      y += 16 + h + 16
      rule(y, 1, LINE)
      y += 1
    }
  }

  // 5-2 주의사항(없으면 뺀다): ※ 칸 24 + 간격 7 + 글, 항목 간격 10
  if (c.notes.length > 0) {
    y += GAP
    applyFont(ctx, S.note)
    c.notes.forEach((n, i) => {
      if (i > 0) y += 10
      const lines = wrapText(ctx, n, CONTENT_W - 24 - 7)
      text(S.note, SUB, "※", PAD.side, y, LH.note)
      lines.forEach((l, li) => text(S.note, SUB, l, PAD.side + 24 + 7, y + li * LH.note, LH.note))
      applyFont(ctx, S.note)
      y += lines.length * LH.note
    })
  }

  // 5-3 영양정보(성분 행이 없으면 뺀다)
  if (c.nutri.length > 0) {
    y += GAP
    if (c.nutriTitle) {
      text(S.label, MAIN, c.nutriTitle, PAD.side, y, LH.label)
      y += LH.label + 12
    }
    rule(y, 2, MAIN)
    y += 2
    const colW = (CONTENT_W - 48) / 3
    const x1 = PAD.side + 24
    const right2 = x1 + colW * 2
    const right3 = x1 + colW * 3
    // 머리 행(72)
    text(S.nutriHead, MAIN, "영양성분", x1, y + 16, 40)
    text(S.nutriHead, MAIN, "함량", right2, y + 16, 40, "right")
    text(S.nutriHead, MAIN, "1일 기준치 비율", right3, y + 16, 40, "right")
    y += 72
    rule(y - 1, 1, LINE)
    // 성분 행(76): 비율이 있으면 주황 Bold, 없으면 회색 -
    for (const n of c.nutri) {
      text(S.nutriCell, MAIN, n.name, x1, y + 16, LH.value)
      text(S.nutriCell, MAIN, n.amount, right2, y + 16, LH.value, "right")
      if (n.ratio && n.ratio !== "-") text(S.nutriRatio, ORANGE, n.ratio, right3, y + 16, LH.value, "right")
      else text(S.nutriCell, SUB, "-", right3, y + 16, LH.value, "right")
      y += 76
      rule(y - 1, 1, LINE)
    }
    // 안내(없으면 뺀다): ※ 칸 20 + 간격 10
    if (c.nutriNote.length > 0) {
      y += 12
      applyFont(ctx, S.value)
      c.nutriNote.forEach((n, i) => {
        if (i > 0) y += 10
        const lines = wrapText(ctx, n, CONTENT_W - 20 - 10)
        text(S.value, SUB, "※", PAD.side, y, LH.value)
        lines.forEach((l, li) => text(S.value, SUB, l, PAD.side + 30, y + li * LH.value, LH.value))
        applyFont(ctx, S.value)
        y += lines.length * LH.value
      })
    }
  }

  return y + PAD.bottom
}

async function draw(canvas: HTMLCanvasElement, f: Form) {
  await loadFonts()
  const ctx = canvas.getContext("2d")!
  const height = render(ctx, f, true)
  canvas.width = W
  canvas.height = height
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, W, height)
  render(ctx, f, false)
}

// 이미지 alt(사양 10-1): 긴 내용도 alt 하나에
function altText(f: Form) {
  const c = contentOf(f)
  const name = c.rows.find((r) => r.label === "제품명")?.value ?? ""
  const parts = [
    ...c.rows.map((r) => `${r.label}: ${r.label === "제조원" ? r.value.replace(/\s*\|\s*/g, ", ") : r.value}`),
    ...(c.notes.length ? [c.notes.join(" ")] : []),
    ...(c.nutri.length
      ? [
          `${c.nutriTitle}: ${c.nutri.map((n) => `${n.name} ${n.amount}${n.ratio && n.ratio !== "-" ? ` (${n.ratio})` : ""}`).join(", ")}`,
          ...(c.nutriNote.length ? [c.nutriNote.join(" ")] : []),
        ]
      : []),
  ]
  return `${name ? `${name} ` : ""}상품정보고시${c.nutri.length ? " 및 영양정보" : ""} - ${parts.join(" / ")}`
}

export function ProductNoticeTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [form, setForm] = useState<Form>(initialForm)
  const [copied, setCopied] = useState(false)
  // 내려받을 때마다 이름을 r.jpg → r2.jpg → r3.jpg 처럼 늘린다(한 화면에서 여러 상품을 만들 때)
  const [downloads, setDownloads] = useState(0)
  const fileName = downloads === 0 ? "r.jpg" : `r${downloads + 1}.jpg`

  useEffect(() => {
    if (canvasRef.current) void draw(canvasRef.current, form)
  }, [form])

  const setRow = (rid: number, patch: Partial<Row>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }))
  const setNutri = (nid: number, patch: Partial<NutriRow>) =>
    setForm((f) => ({ ...f, nutri: f.nutri.map((n) => (n.id === nid ? { ...n, ...patch } : n)) }))

  // 다운로드하면 히스토리에 남긴다(제목 = 제품명, 이미지·입력 내용)
  const saveHistory = (name: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const title = contentOf(form).rows.find((r) => r.label === "제품명")?.value || "제목 없음"
    api("/tools/product-notice/history", { body: { title, fileName: name, form, image: canvas.toDataURL("image/jpeg", 0.92) } }).then(
      () => invalidate(),
      () => {},
    )
  }

  // 히스토리에서 불러오기: 입력 칸을 그때 내용으로 채운다
  const loadForm = (f: Form) =>
    setForm({
      ...f,
      rows: f.rows.map((r) => ({ ...r, id: id() })),
      nutri: f.nutri.map((n) => ({ ...n, id: id() })),
    })

  const download = () => {
    saveHistory(fileName)
    canvasRef.current?.toBlob(
      (blob) => {
        if (!blob) return
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = fileName
        a.click()
        URL.revokeObjectURL(a.href)
        setDownloads((n) => n + 1)
      },
      "image/jpeg",
      0.92,
    )
  }

  const copyAlt = async () => {
    await navigator.clipboard.writeText(altText(form))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      {/* 위: 미리보기 + 입력. 오른쪽 입력이 따라다니는 범위를 이 묶음 안으로 한정한다(아래 히스토리를 덮지 않게) */}
      <div className="grid grid-cols-12 gap-6">
      {/* 왼쪽: 미리보기(내려받는 이미지 그대로) */}
      <div className="col-span-12 flex justify-center lg:col-span-7">
        <canvas ref={canvasRef} className="h-auto w-full max-w-[860px] self-start rounded-lg border bg-white shadow-sm" aria-label="상품정보고시 미리보기" />
      </div>

      {/* 오른쪽 입력: 화면보다 길어서 따로 스크롤하지 않고 페이지와 함께 내려간다(위아래가 잘리지 않게) */}
      <div className="col-span-12 flex flex-col gap-6 lg:col-span-5">
        {/* 고시 항목 */}
        <Field>
          <FieldLabel>고시 항목</FieldLabel>
          <div className="flex flex-col gap-2">
            <SortableList
              items={form.rows}
              onReorder={(rows) => setForm((f) => ({ ...f, rows }))}
              className="flex flex-col gap-2"
              renderItem={(r, handle) => (
              <div className="flex items-start gap-2">
                {handle}
                <Input value={r.label} onChange={(e) => setRow(r.id, { label: e.target.value })} placeholder="제목" aria-label="항목 제목" className="w-28 shrink-0" />
                <Textarea
                  value={r.value}
                  onChange={(e) => setRow(r.id, { value: e.target.value })}
                  placeholder="내용"
                  aria-label={`${r.label || "항목"} 내용`}
                  className="min-h-9 py-1.5 break-keep"
                  rows={1}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${r.label || "항목"} 제거`}
                  onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((x) => x.id !== r.id) }))}
                >
                  <Trash2 />
                </Button>
              </div>
              )}
            />
            <Button size="sm" className="self-start" onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { id: id(), label: "", value: "" }] }))}>
              <Plus data-icon="inline-start" />
              항목 추가
            </Button>
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="notice-notes">주의사항</FieldLabel>
          <Textarea
            id="notice-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={"한 줄에 하나씩 적어 주세요. 앞에 ※ 는 자동으로 붙습니다.\n예: 개봉한 제품은 변질될 우려가 있으므로 가급적 빨리 드시기 바랍니다."}
            className="min-h-28 break-keep"
          />
          <FieldDescription>비워 두면 이미지에 나오지 않습니다.</FieldDescription>
        </Field>

        {/* 영양정보 */}
        <Field>
          <FieldLabel htmlFor="nutri-title">영양정보</FieldLabel>
          <Input id="nutri-title" value={form.nutriTitle} onChange={(e) => setForm((f) => ({ ...f, nutriTitle: e.target.value }))} placeholder="예: 영양정보 (100g당)" />
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1.25rem_1fr_1fr_1fr_2.25rem] gap-2 text-xs text-muted-foreground">
              <span />
              <span>성분</span>
              <span>함량</span>
              <span>1일 기준치 비율</span>
            </div>
            <SortableList
              items={form.nutri}
              onReorder={(nutri) => setForm((f) => ({ ...f, nutri }))}
              className="flex flex-col gap-2"
              renderItem={(n, handle) => (
              <div className="grid grid-cols-[1.25rem_1fr_1fr_1fr_2.25rem] items-center gap-2">
                {handle}
                <Input value={n.name} onChange={(e) => setNutri(n.id, { name: e.target.value })} placeholder="성분" aria-label="성분" />
                <Input value={n.amount} onChange={(e) => setNutri(n.id, { amount: e.target.value })} placeholder="예: 160kcal" aria-label={`${n.name || "성분"} 함량`} />
                <Input value={n.ratio} onChange={(e) => setNutri(n.id, { ratio: e.target.value })} placeholder="예: 95% (없으면 비움)" aria-label={`${n.name || "성분"} 비율`} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${n.name || "성분"} 제거`}
                  onClick={() => setForm((f) => ({ ...f, nutri: f.nutri.filter((x) => x.id !== n.id) }))}
                >
                  <Trash2 />
                </Button>
              </div>
              )}
            />
            <Button
              size="sm"
              className="self-start"
              onClick={() => setForm((f) => ({ ...f, nutri: [...f.nutri, { id: id(), name: "", amount: "", ratio: "" }] }))}
            >
              <Plus data-icon="inline-start" />
              성분 추가
            </Button>
          </div>
          <FieldDescription>함량이나 비율을 적은 성분만 나옵니다. 하나도 없으면 영양정보 묶음 전체가 빠집니다.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="nutri-note">영양정보 안내</FieldLabel>
          <Textarea id="nutri-note" value={form.nutriNote} onChange={(e) => setForm((f) => ({ ...f, nutriNote: e.target.value }))} className="min-h-20 break-keep" />
          <FieldDescription>비워 두면 이미지에 나오지 않습니다.</FieldDescription>
        </Field>

        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={download}>
            <Download data-icon="inline-start" />
            {fileName} 다운로드
          </Button>
          <Button variant="outline" onClick={copyAlt}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "복사됨" : "이미지 alt 복사"}
          </Button>
          <p className="text-xs text-muted-foreground">
            이미지 가로 860 JPG. 파일 이름은 내려받을 때마다 r.jpg, r2.jpg, r3.jpg 순서로 붙고, 아래 히스토리에 남습니다.
          </p>
        </div>
      </div>

      </div>

      {/* 아래: 만든 이미지 히스토리(제품명·썸네일·다운로드·검색) */}
      <ToolHistory<Form> tool="product-notice" onLoad={loadForm} />
    </div>
  )
}
