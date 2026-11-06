import { useEffect, useRef, useState } from "react"
import { Download, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { EmphasisTextarea } from "@/components/tools/emphasis-textarea"
import { ToolHistory } from "@/components/tools/tool-history"
import { GradStopField, PicturePicker, TextColorField } from "@/components/tools/detail-page/detail-page-tool"
import { gradRgba, parseHex, type GradStop, type Picture } from "@/components/tools/detail-page/sections"
import { api, apiFetch, ApiError, uploadFile } from "@/lib/api"
import { invalidate } from "@/lib/store"

// 디자인 툴 > 톡메세지: 카카오톡 메시지용 800×800 이미지. 모양은 Figma(셰프애찬 680-373) 그대로 캔버스에 그린다.
//   - 위: 타이틀 2줄(Gmarket Sans TTF Bold 50px · 90px, 자간 -10%, 가운데, 위 여백 40, 줄 사이 10). 줄은 바뀌지 않고, 넘치면 글자를 줄인다
//   - 사진: 위 800×715 칸을 꽉 채운다(가운데 기준). 위에서 아래로 그라데이션(색·불투명도·세로 크기)
//   - 사진 오른쪽 아래 작은 글(18px, 오른쪽·아래 30 띄움): 색·불투명도(기본 50%)
//   - 아래 띠(높이 85): 배경색 · 글자색 · 강조(골라서 강조하면 굵게 + 강조색), 42px 자간 -10% 가운데
// 내려받으면 히스토리에 남는다(사진 포함 입력). 히스토리에서 불러오면 사진까지 다시 채운다.

const W = 800
const H = 800
const BAR = 85
const AREA = H - BAR // 사진 칸 높이(715)
const PAD = 40
const TITLE_FONT = "GmarketSans"
const BODY_FONT = '"Pretendard Variable", Pretendard'
// 아래 띠 자간: Figma 는 -10%(Inter·대체 글꼴). Pretendard 로 같은 폭이 나오게 -5%
const BAR_SPACING = -0.055

type Form = {
  title: string // 히스토리 이름(이미지에는 안 들어감)
  line1: string
  line1Color: string | undefined
  line2: string
  line2Color: string | undefined
  gradOn: boolean
  gradFrom: GradStop // 위(시작) 색·불투명도
  gradTo: GradStop // 아래(끝) 색·불투명도
  gradHeight: number // px(위에서부터)
  note: string
  noteColor: string | undefined
  noteOpacity: number // 0~100
  bar: string // **강조**
  barBg: string | undefined
  barColor: string | undefined
  barEm: string | undefined
}

// 히스토리에 남기는 입력: 사진은 올린 파일 id
type PicRef = { fileId: string; name: string; width: number; height: number }
type Saved = Form & { image: PicRef | null }

const DEFAULTS: Form = {
  title: "",
  line1: "산뜻한 달래와 쫄깃한 꼬막",
  line1Color: "#ffe400",
  line2: "오픈특가 + 무료배송",
  line2Color: "#ffffff",
  gradOn: true,
  gradFrom: { color: "#000000", opacity: 85 },
  gradTo: { color: "#000000", opacity: 0 },
  gradHeight: 330,
  note: "3캔 주문시 무료배송",
  noteColor: "#ffffff",
  noteOpacity: 50,
  bar: "**[한정수량]**  재고 소진시 종료",
  barBg: "#000000",
  barColor: "#ffffff",
  barEm: "#ffa800",
}

const hex = (v: string | undefined, fallback: string) => {
  const rgb = parseHex(v ?? "")
  return rgb ? `rgb(${rgb.join(",")})` : fallback
}

// **…** 를 나눈다(강조 여부)
function segments(text: string) {
  return text
    .replace(/\n+/g, " ")
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((t) => (t.startsWith("**") && t.endsWith("**") ? { text: t.slice(2, -2), em: true } : { text: t.replace(/\*\*/g, ""), em: false }))
}

// 글자 폭(자간 포함, 마지막 글자 뒤 자간은 뺀다)
function textWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  ctx.letterSpacing = `${spacing}px`
  return ctx.measureText(text).width - (text ? spacing : 0)
}

// 한 줄(가운데): 칸 너비를 넘으면 글자 크기를 줄인다. top = Figma 글 상자 위(자동 줄 높이 = 글꼴 위·아래 높이)
function centerLine(ctx: CanvasRenderingContext2D, text: string, size: number, color: string, top: number) {
  let s = size
  ctx.font = `700 ${s}px ${TITLE_FONT}`
  let w = textWidth(ctx, text, -0.1 * s)
  if (w > W - PAD * 2) {
    s = (s * (W - PAD * 2)) / w
    ctx.font = `700 ${s}px ${TITLE_FONT}`
    w = textWidth(ctx, text, -0.1 * s)
  }
  const m = ctx.measureText(text)
  ctx.fillStyle = color
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  // Figma 자동 줄 높이(Gmarket Sans: 약 1.16em)에서 글자가 놓이는 자리에 맞춰 기준선을 내린다(피그마 화면과 겹쳐 잰 값: 50px → 5, 90px → 6)
  if (text) ctx.fillText(text, (W - w) / 2, top + m.fontBoundingBoxAscent + 3.75 + 0.025 * s)
  // 이 줄 상자 높이(다음 줄 위치)
  return 1.16 * s
}

function draw(ctx: CanvasRenderingContext2D, f: Form, img: HTMLImageElement | null) {
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  // 사진 칸(사진이 없으면 Figma 바탕 회색)
  ctx.fillStyle = "#dddddd"
  ctx.fillRect(0, 0, W, AREA)
  if (img) {
    const scale = Math.max(W / img.naturalWidth, AREA / img.naturalHeight)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, AREA)
    ctx.clip()
    ctx.drawImage(img, (W - dw) / 2, (AREA - dh) / 2, dw, dh)
    ctx.restore()
  }
  // 그라데이션: 맨 위(시작 색) → 세로 크기 끝(끝 색)
  if (f.gradOn && f.gradHeight > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, f.gradHeight)
    g.addColorStop(0, gradRgba(f.gradFrom, DEFAULTS.gradFrom))
    g.addColorStop(1, gradRgba(f.gradTo, DEFAULTS.gradTo))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, Math.min(AREA, f.gradHeight))
  }
  // 타이틀 2줄
  const h1 = centerLine(ctx, f.line1, 50, hex(f.line1Color, "#ffffff"), PAD)
  centerLine(ctx, f.line2, 90, hex(f.line2Color, "#ffffff"), PAD + h1 + 10)
  // 사진 오른쪽 아래 작은 글(오른쪽·아래 30 띄움)
  if (f.note.trim()) {
    ctx.save()
    ctx.globalAlpha = Math.min(100, Math.max(0, f.noteOpacity)) / 100
    ctx.font = `500 18px ${BODY_FONT}`
    // Figma 는 이 글을 Inter(한글은 대체 글꼴)로 써서 Pretendard 보다 조금 넓다. 자간 0.05em 으로 폭을 맞춘다
    const w = textWidth(ctx, f.note, 0.9)
    const m = ctx.measureText(f.note)
    ctx.fillStyle = hex(f.noteColor, "#ffffff")
    ctx.fillText(f.note, W - 30 - w, AREA - 30 - m.fontBoundingBoxDescent)
    ctx.restore()
  }
  // 아래 띠
  ctx.fillStyle = hex(f.barBg, "#000000")
  ctx.fillRect(0, AREA, W, BAR)
  const segs = segments(f.bar)
  if (segs.length) {
    let size = 42
    const measure = () =>
      segs.map((s) => {
        ctx.font = `${s.em ? 700 : 500} ${size}px ${BODY_FONT}`
        ctx.letterSpacing = `${BAR_SPACING * size}px`
        const m = ctx.measureText(s.text)
        return { ...s, w: m.width, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent }
      })
    let parts = measure()
    let total = parts.reduce((t, p) => t + p.w, 0) - BAR_SPACING * size // 마지막 글자 뒤 자간(음수)은 뺀다
    if (total > W - 20) {
      size = (size * (W - 20)) / total
      parts = measure()
      total = parts.reduce((t, p) => t + p.w, 0) - BAR_SPACING * size
    }
    const asc = Math.max(...parts.map((p) => p.asc))
    const desc = Math.max(...parts.map((p) => p.desc))
    const baseline = AREA + (BAR - (asc + desc)) / 2 + asc
    let x = (W - total) / 2
    for (const p of parts) {
      ctx.font = `${p.em ? 700 : 500} ${size}px ${BODY_FONT}`
      ctx.letterSpacing = `${BAR_SPACING * size}px`
      ctx.fillStyle = p.em ? hex(f.barEm, "#ffa800") : hex(f.barColor, "#ffffff")
      ctx.fillText(p.text, x, baseline)
      x += p.w
    }
  }
  ctx.restore()
}

// 쓰는 글꼴을 미리 받는다(받기 전에 그리면 다른 글꼴로 그려진다)
async function loadFonts(f: Form) {
  const titles = f.line1 + f.line2
  const body = f.note + f.bar
  await Promise.all([
    document.fonts.load(`700 50px ${TITLE_FONT}`, titles || "가"),
    document.fonts.load(`500 18px ${BODY_FONT}`, body || "가"),
    document.fonts.load(`700 42px ${BODY_FONT}`, body || "가"),
  ]).catch(() => {})
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("사진을 열지 못했습니다."))
    img.src = url
  })
}

// 올린 사진 파일 id(같은 사진은 한 번만 올린다)
const uploaded = new WeakMap<File, string>()

export function TalkMessageTool() {
  const [form, setForm] = useState<Form>(DEFAULTS)
  const [image, setImage] = useState<Picture | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    let alive = true
    if (!image) setImg(null)
    else void loadImage(image.url).then((i) => alive && setImg(i), () => alive && setImg(null))
    return () => {
      alive = false
    }
  }, [image])

  // 바뀔 때마다 다시 그린다(글꼴을 받은 뒤)
  useEffect(() => {
    let alive = true
    void loadFonts(form).then(() => {
      const ctx = canvas.current?.getContext("2d")
      if (alive && ctx) draw(ctx, form, img)
    })
    return () => {
      alive = false
    }
  }, [form, img])

  const fallbackTitle = form.line2.trim() || form.line1.trim() || "톡메세지"

  const download = async () => {
    setError(null)
    setBusy(true)
    try {
      await loadFonts(form)
      const c = document.createElement("canvas")
      c.width = W
      c.height = H
      draw(c.getContext("2d")!, form, img)
      const data = c.toDataURL("image/jpeg", 0.92)
      const a = document.createElement("a")
      a.href = data
      a.download = `${(form.title.trim() || fallbackTitle).replace(/[\\/:*?"<>|]/g, "")}.jpg`
      a.click()
      // 히스토리에 남긴다(사진도 올려 두어 나중에 그대로 불러온다). 실패해도 내려받기는 끝났으니 조용히 넘긴다
      void (async () => {
        let ref: PicRef | null = null
        if (image) {
          let fileId = uploaded.get(image.file)
          if (!fileId) {
            fileId = (await uploadFile(image.file)).id
            uploaded.set(image.file, fileId)
          }
          ref = { fileId, name: image.name, width: image.width, height: image.height }
        }
        const saved: Saved = { ...form, image: ref }
        await api("/tools/talk/history", {
          body: { title: form.title.trim() || fallbackTitle, fileName: "talk.jpg", form: saved, fileIds: ref ? [ref.fileId] : [], image: data },
        })
        invalidate()
      })().catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : "만들지 못했습니다.")
    } finally {
      setBusy(false)
    }
  }

  const loadForm = async (saved: Saved) => {
    setLoading(true)
    setError(null)
    try {
      const { image: ref, ...rest } = saved
      let pic: Picture | null = null
      if (ref) {
        const res = await apiFetch(`/files/${ref.fileId}`)
        if (!res.ok) throw new ApiError(res.status, `사진(${ref.name})을 불러오지 못했습니다.`)
        const blob = await res.blob()
        const file = new File([blob], ref.name, { type: blob.type })
        uploaded.set(file, ref.fileId)
        pic = { url: URL.createObjectURL(file), name: ref.name, width: ref.width, height: ref.height, file }
      }
      const old = rest as Partial<Form> & { gradColor?: string; gradOpacity?: number }
      const gradFrom = old.gradFrom ?? (old.gradColor ? { color: old.gradColor, opacity: old.gradOpacity ?? 85 } : DEFAULTS.gradFrom)
      const gradTo = old.gradTo ?? (old.gradColor ? { color: old.gradColor, opacity: 0 } : DEFAULTS.gradTo)
      setForm({ ...DEFAULTS, ...rest, gradFrom, gradTo })
      setImage(pic)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
        {/* 왼쪽: 미리보기(내려받는 이미지 그대로) */}
        <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:flex-[6]">
          <h3 className="font-semibold">
            미리보기 <span className="text-xs font-normal text-muted-foreground">800 × 800</span>
          </h3>
          <canvas ref={canvas} width={W} height={H} className="aspect-square w-full max-w-[800px] rounded-lg border bg-muted" aria-label="톡메세지 미리보기" />
        </div>

        {/* 오른쪽: 입력 */}
        <div className="flex min-w-0 flex-col gap-4 lg:flex-[5]">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="talk-title">제목</FieldLabel>
              <Input id="talk-title" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={100} placeholder={fallbackTitle} />
              <FieldDescription>히스토리·파일 이름으로 씁니다(이미지에는 들어가지 않음). 비우면 타이틀 둘째 줄.</FieldDescription>
            </Field>
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                히스토리에서 불러오는 중…
              </p>
            )}

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="talk-line1">타이틀 윗줄</FieldLabel>
                <TextColorField label="타이틀 윗줄" value={form.line1Color} fallback="#ffe400" onChange={(line1Color) => set({ line1Color })} />
              </div>
              <Input id="talk-line1" value={form.line1} onChange={(e) => set({ line1: e.target.value })} maxLength={40} />
            </Field>
            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="talk-line2">타이틀 큰 줄</FieldLabel>
                <TextColorField label="타이틀 큰 줄" value={form.line2Color} onChange={(line2Color) => set({ line2Color })} />
              </div>
              <Input id="talk-line2" value={form.line2} onChange={(e) => set({ line2: e.target.value })} maxLength={30} />
              <FieldDescription>Gmarket Sans Bold 50px · 90px, 자간 -10%. 한 줄로만 나오고, 길면 글자가 작아집니다.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>배경 사진 (위 800 × 715 칸을 꽉 채움)</FieldLabel>
              <PicturePicker value={image} onChange={setImage} label="사진 넣기" />
            </Field>
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <Label className="flex items-center gap-2 font-medium">
                <Checkbox checked={form.gradOn} onCheckedChange={(v) => set({ gradOn: v === true })} />
                위 그라데이션
              </Label>
              {form.gradOn && (
                <>
                  {/* 시작·끝을 가로로 나란히(좁으면 아래로 넘어간다) */}
                  <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-2 [&_label]:w-auto">
                    <GradStopField id="talk-gfrom" label="위(시작)" value={form.gradFrom} fallback={DEFAULTS.gradFrom} onChange={(gradFrom) => set({ gradFrom })} />
                    <GradStopField id="talk-gto" label="아래(끝)" value={form.gradTo} fallback={DEFAULTS.gradTo} onChange={(gradTo) => set({ gradTo })} />
                  </div>
                  <div
                    className="h-6 rounded border"
                    style={{ backgroundImage: `linear-gradient(to right, ${gradRgba(form.gradFrom, DEFAULTS.gradFrom)}, ${gradRgba(form.gradTo, DEFAULTS.gradTo)}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%)`, backgroundSize: "auto, 12px 12px" }}
                    aria-hidden
                  />
                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">세로 크기</span>
                    <Slider min={0} max={AREA} step={5} value={[form.gradHeight]} onValueChange={([v]) => set({ gradHeight: v })} aria-label="그라데이션 세로 크기" />
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums">{form.gradHeight}px</span>
                  </div>
                  <FieldDescription>사진 맨 위가 시작 색, 세로 크기만큼 내려간 곳이 끝 색입니다(그 아래는 그라데이션 없음).</FieldDescription>
                </>
              )}
            </div>

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="talk-note">사진 오른쪽 아래 글</FieldLabel>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <TextColorField label="오른쪽 아래 글" value={form.noteColor} onChange={(noteColor) => set({ noteColor })} />
                  <PercentInput label="오른쪽 아래 글 불투명도" value={form.noteOpacity} onChange={(noteOpacity) => set({ noteOpacity })} />
                </div>
              </div>
              <Input id="talk-note" value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={40} placeholder="비우면 넣지 않음" />
            </Field>

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="talk-bar">아래 띠 (높이 85px)</FieldLabel>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <TextColorField label="아래 띠" caption="배경" value={form.barBg} fallback="#000000" onChange={(barBg) => set({ barBg })} />
                  <TextColorField label="아래 띠" value={form.barColor} onChange={(barColor) => set({ barColor })} />
                  <TextColorField label="아래 띠 강조" caption="강조색" value={form.barEm} fallback="#ffa800" onChange={(barEm) => set({ barEm })} />
                </div>
              </div>
              <EmphasisTextarea id="talk-bar" value={form.bar} onValueChange={(bar) => set({ bar: bar.replace(/\n/g, " ") })} className="min-h-14 break-keep" placeholder="한 줄로 나옵니다 (골라서 강조하면 굵게 + 강조색)" />
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-2">
            {error && <FieldError>{error}</FieldError>}
            <Button disabled={busy} onClick={() => void download()}>
              {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Download data-icon="inline-start" />}
              {busy ? "만드는 중…" : "JPG 내려받기 (800 × 800)"}
            </Button>
          </div>
        </div>
      </div>

      {/* 아래: 만든 이미지 히스토리 */}
      <ToolHistory<Saved> tool="talk" onLoad={loadForm} fileName={(t) => `${t}.jpg`} />
    </div>
  )
}

// 불투명도 % 입력
function PercentInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">불투명도</span>
      <div className="relative w-20">
        <Input
          type="number"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))))}
          aria-label={`${label}(%)`}
          className="h-7 pr-6 text-xs tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
    </div>
  )
}
