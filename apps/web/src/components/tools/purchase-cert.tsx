import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Download, FileUp, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { DateRangePicker } from "@/components/date-range-picker"
import { apiFetch, ApiError } from "@/lib/api"
import patternUrl from "@/assets/tools/purchase-cert/point-pattern.png"

// 디자인 툴 > 수매확인서: PDF(수산물 수매확인서)를 올리면 상세페이지용 이미지(860×1429 JPG)를 만든다.
// 사양: docs/tools/수매확인서_툴_사양.md (Figma 셰프애찬 461:212). 고칠 수 있는 건 수매일자뿐이다.
// 왼쪽 미리보기 캔버스가 그대로 내려받는 이미지다. PDF 분석(이미지·OCR·위치)은 서버가 한다(apps/api/src/purchase-cert.ts).

type Box = { l: number; t: number; r: number; b: number }
type Layout = {
  pageImage: string
  pageCount: number
  issued: string | null
  highlight: Box | null
  tag: { left: number; top: number } | null
  dateBox: { left: number; top: number } | null
  warnings: string[]
}

const W = 860
const H = 1429
const SCALE = 1 // 결과 이미지 = Figma 프레임 크기 그대로(가로 860)
const ORANGE = "#ff4d00"
const INK = "#111111"
const SUB = "#555555"
const PAPER = { x: 120, y: 392 + 80, w: 620, h: 877 } // 이미지 영역(392부터 1037) 가운데, 위아래 80
const FONT = '"Noto Sans KR"'

// 표를 못 찾았을 때 수매일자 말풍선 기본 위치(사양 7-6 기준값)
const DEFAULT_LAYOUT: Pick<Layout, "highlight" | "tag" | "dateBox"> = {
  highlight: { l: 79, t: 422, r: 146, b: 441 },
  tag: { left: 31, top: 455 },
  dateBox: { left: 11, top: 527 },
}

// PDF 를 올리기 전에는 강조(형광펜·말풍선)를 그리지 않는다
const NO_MARKS: Pick<Layout, "highlight" | "tag" | "dateBox"> = { highlight: null, tag: null, dateBox: null }

// 글꼴(Noto Sans KR 500·700)을 한 번만 불러온다
let fontsReady: Promise<void> | null = null
function loadFonts() {
  if (!fontsReady) {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700&display=block"
    document.head.appendChild(link)
    fontsReady = new Promise<void>((resolve) => {
      link.onload = () =>
        Promise.all([document.fonts.load(`700 72px ${FONT}`, "안심"), document.fonts.load(`500 30px ${FONT}`, "유통")]).then(
          () => resolve(),
          () => resolve(),
        )
      link.onerror = () => resolve()
    })
  }
  return fontsReady
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

type Seg = { text: string; weight: 500 | 700; color: string }

// 여러 글꼴·색이 섞인 한 줄을 가운데 맞춰 그린다(자간은 글자 크기 대비 %)
function drawLine(ctx: CanvasRenderingContext2D, segs: Seg[], size: number, spacing: number, centerY: number) {
  ctx.letterSpacing = `${size * spacing}px`
  ctx.textBaseline = "middle"
  const widths = segs.map((s) => {
    ctx.font = `${s.weight} ${size}px ${FONT}`
    return ctx.measureText(s.text).width
  })
  let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2
  segs.forEach((s, i) => {
    ctx.font = `${s.weight} ${size}px ${FONT}`
    ctx.fillStyle = s.color
    ctx.fillText(s.text, x, centerY)
    x += widths[i]
  })
}

function centerText(ctx: CanvasRenderingContext2D, text: string, size: number, spacing: number, cx: number, cy: number) {
  ctx.font = `700 ${size}px ${FONT}`
  ctx.letterSpacing = `${size * spacing}px`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = INK
  ctx.fillText(text, cx, cy)
  ctx.textAlign = "start"
}

// 말풍선 바탕: 흰 바탕 · 그림자 y4 blur12 12% · 모서리 8
function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.12)"
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 4
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 8)
  ctx.fill()
  ctx.restore()
}

// 테두리 2px 안쪽
function bubbleBorder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 7)
  ctx.stroke()
  ctx.restore()
}

async function draw(canvas: HTMLCanvasElement, page: HTMLImageElement | null, layout: Pick<Layout, "highlight" | "tag" | "dateBox">, mmdd: string) {
  await loadFonts()
  const pattern = await loadImage(patternUrl)
  const ctx = canvas.getContext("2d")!
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.imageSmoothingQuality = "high" // PDF(2480px)를 종이(620)에 줄여 넣을 때 글자가 뭉개지지 않게

  // 바탕
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, W, H)

  // 제목(72 Bold, '안심' 주황) · 설명(30 Medium, 강조 Bold 주황) — 제목 줄 y120~206, 설명 y234 부터 줄높이 49
  drawLine(ctx, [{ text: "안심", weight: 700, color: ORANGE }, { text: "하고 드세요!", weight: 700, color: INK }], 72, -0.02, 120 + 43)
  drawLine(
    ctx,
    [
      { text: "유통과정 없이 통영 산지직송", weight: 700, color: ORANGE },
      { text: "으로", weight: 500, color: SUB },
    ],
    30,
    -0.02,
    234 + 24.5,
  )
  drawLine(
    ctx,
    [
      { text: "생식용 굴", weight: 700, color: ORANGE },
      { text: "을 수매하였다는 사실을 확인 받았습니다.", weight: 500, color: SUB },
    ],
    30,
    -0.02,
    234 + 49 + 24.5,
  )

  // 이미지 영역: 패턴(248 원본을 124 로 반복)
  const tile = document.createElement("canvas")
  tile.width = 124 * SCALE
  tile.height = 124 * SCALE
  tile.getContext("2d")!.drawImage(pattern, 0, 0, tile.width, tile.height)
  const pat = ctx.createPattern(tile, "repeat")!
  pat.setTransform(new DOMMatrix([1 / SCALE, 0, 0, 1 / SCALE, 0, 392]))
  ctx.fillStyle = pat
  ctx.fillRect(0, 392, W, 1037)

  // 종이(그림자 y8 blur24 10%) + PDF 첫 장
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.10)"
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h)
  ctx.restore()
  if (page) {
    ctx.drawImage(page, PAPER.x, PAPER.y, PAPER.w, PAPER.h)
  } else {
    ctx.font = `500 22px ${FONT}`
    ctx.letterSpacing = "0px"
    ctx.textAlign = "center"
    ctx.fillStyle = "#9ca3af"
    ctx.fillText("PDF 를 첨부하면 이곳에 들어갑니다", PAPER.x + PAPER.w / 2, PAPER.y + PAPER.h / 2)
    ctx.textAlign = "start"
  }

  // 아래부터 종이 기준 좌표
  ctx.save()
  ctx.translate(PAPER.x, PAPER.y)
  const { highlight: hl, tag, dateBox } = layout

  // 형광펜 + 연결(주황 30% · 곱하기)
  if (hl) {
    ctx.save()
    ctx.globalCompositeOperation = "multiply"
    ctx.fillStyle = "rgba(255,77,0,0.30)"
    ctx.fillRect(hl.l, hl.t, hl.r - hl.l, hl.b - hl.t)
    if (tag) {
      ctx.beginPath()
      ctx.moveTo(hl.l, hl.b)
      ctx.lineTo(hl.r, hl.b)
      ctx.lineTo(tag.left + 157, tag.top)
      ctx.lineTo(tag.left + 7, tag.top)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  // '생식용 굴' 말풍선 164×50
  if (tag) {
    bubble(ctx, tag.left, tag.top, 164, 50)
    bubbleBorder(ctx, tag.left, tag.top, 164, 50)
    centerText(ctx, "생식용 굴", 24, -0.02, tag.left + 82, tag.top + 2 + 23)
  }

  // '수매일자' 말풍선 164×112: 머리 칸 160×50(#f5f5f5, 아래 선 2px 주황) + 날짜 칸 160×58
  if (dateBox) {
    const { left: x, top: y } = dateBox
    bubble(ctx, x, y, 164, 112)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x + 2, y + 2, 160, 108, 6)
    ctx.clip()
    ctx.fillStyle = "#f5f5f5"
    ctx.fillRect(x + 2, y + 2, 160, 50)
    ctx.fillStyle = ORANGE
    ctx.fillRect(x + 2, y + 2 + 48, 160, 2)
    ctx.restore()
    bubbleBorder(ctx, x, y, 164, 112)
    centerText(ctx, "수매일자", 24, -0.013, x + 82, y + 2 + 24)
    centerText(ctx, mmdd, 31, -0.01, x + 82, y + 52 + 29)
  }
  ctx.restore()
}

const toMMDD = (iso: string) => (iso ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : "MM.DD")

export function PurchaseCertTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [page, setPage] = useState<HTMLImageElement | null>(null)
  const [date, setDate] = useState("") // 수매일자 yyyy-MM-dd(이것만 고칠 수 있다)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 입력이 바뀔 때마다 다시 그린다
  useEffect(() => {
    if (canvasRef.current) void draw(canvasRef.current, page, layout ?? NO_MARKS, toMMDD(date))
  }, [page, layout, date])

  const attach = async (file: File | undefined) => {
    if (!file) return
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF 파일만 올릴 수 있습니다.")
      return
    }
    setBusy(true)
    setError(null)
    setPdfName(file.name)
    try {
      const res = await apiFetch("/tools/purchase-cert", { method: "POST", body: file, headers: { "Content-Type": "application/pdf" } })
      const body = await res.json()
      if (!res.ok) throw new ApiError(res.status, body.error ?? "PDF 를 읽지 못했습니다.")
      const next = body as Layout
      setPage(await loadImage(next.pageImage))
      setLayout({ ...next, dateBox: next.dateBox ?? DEFAULT_LAYOUT.dateBox })
      if (next.issued) setDate(next.issued)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "PDF 를 읽지 못했습니다.")
      setPdfName(null)
    } finally {
      setBusy(false)
    }
  }

  const ready = !!page && !!date
  const fileName = "2026.jpg" // 다운로드 파일 이름은 늘 2026.jpg

  const download = () => {
    canvasRef.current?.toBlob(
      (blob) => {
        if (!blob) return
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = fileName
        a.click()
        URL.revokeObjectURL(a.href)
      },
      "image/jpeg",
      0.92,
    )
  }

  return (
    <div className="grid w-full grid-cols-12 gap-6 p-4 md:p-6">
      {/* 왼쪽: 수매확인서(내려받는 이미지 그대로) */}
      <div className="col-span-12 flex justify-center lg:col-span-8">
        <canvas
          ref={canvasRef}
          className="h-auto w-full max-w-[860px] rounded-lg border bg-white shadow-sm"
          aria-label="수매확인서 미리보기"
        />
      </div>

      {/* 오른쪽: 파일 첨부 · 수매일자 · 다운로드(넓은 화면에서는 스크롤해도 따라온다) */}
      <div className="col-span-12 flex flex-col gap-5 lg:sticky lg:top-6 lg:col-span-4 lg:self-start">
        <Field>
          <FieldLabel>수매확인서 PDF</FieldLabel>
          <button
            type="button"
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-accent/40"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void attach(e.dataTransfer.files[0])
            }}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="size-6 animate-spin" aria-hidden /> : <FileUp className="size-6" aria-hidden />}
            <span className="font-medium text-foreground">{busy ? "PDF 를 읽는 중… (20~30초)" : pdfName ?? "PDF 를 끌어 놓거나 눌러서 고르세요"}</span>
            <span className="text-xs">첫 장을 이미지로 바꿔 왼쪽 종이에 넣고, '생식용 굴'·수매일자 위치를 찾습니다.</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files?.[0])
              e.target.value = ""
            }}
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {layout?.warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {w}
          </p>
        ))}

        <Field>
          <FieldLabel htmlFor="cert-date">수매일자</FieldLabel>
          {/* shadcn 달력(한 날짜) */}
          <DateRangePicker
            id="cert-date"
            single
            value={date ? { from: new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))), to: undefined } : undefined}
            onChange={(r) => {
              const d = r?.from
              if (d) setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
            }}
            placeholder="PDF 를 올리면 발행일로 채워집니다"
          />
          <FieldDescription>PDF 의 발행일로 채워집니다. 문서에서 고칠 수 있는 곳은 수매일자뿐입니다.</FieldDescription>
        </Field>

        <Button size="lg" disabled={!ready || busy} onClick={download}>
          <Download data-icon="inline-start" />
          {ready ? `${fileName} 다운로드` : "PDF 를 올리면 다운로드할 수 있습니다"}
        </Button>
        <p className="text-xs text-muted-foreground">이미지 860×1429 JPG(Figma 프레임 크기). 상세페이지 업로드는 알드라이브로 직접 합니다.</p>
      </div>
    </div>
  )
}
