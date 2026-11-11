import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Download, FileUp, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { apiFetch, ApiError } from "@/lib/api"
import { FONT, loadFonts } from "@/lib/canvas-text"
import { useZoom, ZoomControl } from "@/components/tools/zoom-control"
import patternUrl from "@/assets/tools/purchase-cert/point-pattern.png"
import noroBgUrl from "@/assets/tools/noro-cert/noro-bg.jpg"
import noroOverlayUrl from "@/assets/tools/noro-cert/noro-overlay.webp"

// 디자인 툴 > 수매확인서: PDF(수산물 수매확인서)를 올리면 상세페이지용 이미지(860×1429 JPG)를 만든다.
// 사양: docs/tools/수매확인서_툴_사양.md (Figma 셰프애찬 461:212). 고칠 수 있는 건 생산일자뿐이다.
// 디자인 툴 > 노로 비검출해역 확인서는 바다 배경 틀(Figma 744:17397, 860×1400, 파란 강조)이다(CERTS.noro, 사양 docs/tools/노로비검출_툴_사양.md).
// 노로는 말풍선 둘('생식용 굴' · '노로 비검출해역', 75 높이)이고 날짜 말풍선이 없다. 맨 위에 덮개(종이 오른쪽 위 흰 그라데이션 · 모래 · 굴 · 풀)를 얹는다.
// 말풍선은 '생산일자' + PDF 표 첫 칸(생산일자)에 적힌 값 그대로(예 10.22). 서버가 OCR 로 읽어 채운다.
// 왼쪽 미리보기 캔버스가 그대로 내려받는 이미지다. PDF 분석(이미지·OCR·위치)은 서버가 한다(apps/api/src/purchase-cert.ts).

type Box = { l: number; t: number; r: number; b: number }
type Layout = {
  pageImage: string
  pageCount: number
  issued: string | null
  produced: string | null
  highlight: Box | null
  tag: { left: number; top: number } | null
  highlight2: Box | null // 노로만: 본문 '생식용 굴'
  tag2: { left: number; top: number } | null
  dateBox: { left: number; top: number } | null
  warnings: string[]
}

const W = 860
const SCALE = 1 // 결과 이미지 = Figma 프레임 크기 그대로(가로 860)
const ORANGE = "#ff4d00"
const INK = "#111111"
const SUB = "#555555"
const BLUE = "#1d4ed8" // 노로 강조(형광펜·연결·말풍선 테두리)
const TITLE_BLUE = "#2563eb"
const DESC_BLUE = "#3b82f6"

type Seg = { text: string; weight: 500 | 700 | 900; color: string }

// 확인서 종류마다 다른 것: 서버 주소 · 제목·설명 글 · 강조 말풍선 글과 폭 · 날짜 말풍선 머리 · 받는 파일 · 내려받는 이름
type CertConfig = {
  endpoint: string
  name: string // 화면에 쓰는 이름(수매확인서)
  title: Seg[]
  desc: [Seg[], Seg[]]
  tagLabel: string
  tagWidth: number
  dateLabel: string | null // 날짜 말풍선 머리(노로는 없음)
  acceptImage: boolean // 스캔 이미지(JPG·PNG)도 받는다
  fileName: string
  defaultDateBox: { left: number; top: number } // 표를 못 찾았을 때 날짜 말풍선 기본 위치
  findText: string // 첨부 칸 안내: 무엇을 찾는지
  height: number // 결과 이미지 높이(가로는 860)
  paper: { x: number; y: number; w: number; h: number } // 종이 자리
  docTop: number // 종이 안에서 확인서 첫 장이 놓이는 높이(강조 좌표도 이만큼 내려간다)
  accent: string // 형광펜·연결·말풍선 테두리 색
  theme: "pattern" | "sea" // 바탕: 주황 패턴(수매확인서) / 바다 사진 + 아래 모래(노로)
}
const CERTS: Record<"purchase" | "noro", CertConfig> = {
  purchase: {
    endpoint: "/tools/purchase-cert",
    name: "수매확인서",
    title: [
      { text: "안심", weight: 700, color: ORANGE },
      { text: "하고 드세요!", weight: 700, color: INK },
    ],
    desc: [
      [
        { text: "유통과정 없이 통영 산지직송", weight: 700, color: ORANGE },
        { text: "으로", weight: 500, color: SUB },
      ],
      [
        { text: "생식용 굴", weight: 700, color: ORANGE },
        { text: "을 수매하였다는 사실을 확인 받았습니다.", weight: 500, color: SUB },
      ],
    ],
    tagLabel: "생식용 굴",
    tagWidth: 164,
    dateLabel: "생산일자",
    acceptImage: false,
    fileName: "2026.jpg", // 다운로드 파일 이름은 늘 2026.jpg
    defaultDateBox: { left: 11, top: 527 }, // 사양 7-6 기준값
    findText: "'생식용 굴'·생산일자",
    height: 1429,
    paper: { x: 120, y: 392 + 80, w: 620, h: 877 }, // 이미지 영역(392부터 1037) 가운데, 위아래 80
    docTop: 0,
    accent: ORANGE,
    theme: "pattern",
  },
  // 노로 비검출해역 확인서(Figma 744:17397): 본문 '생식용 굴' + 표 채취해역 칸의 '노로 비검출해역'
  noro: {
    endpoint: "/tools/noro-cert",
    name: "노로 비검출해역 확인서",
    title: [
      { text: "노로 비검출", weight: 900, color: TITLE_BLUE },
      { text: " 해역 굴", weight: 700, color: INK },
    ],
    desc: [
      [
        { text: "노로바이러스 비검출 해역", weight: 900, color: DESC_BLUE },
        { text: "에서 채취한", weight: 500, color: SUB },
      ],
      [
        { text: "생식용 굴", weight: 900, color: DESC_BLUE },
        { text: "만 수매하였음을 확인 받았습니다.", weight: 500, color: SUB },
      ],
    ],
    tagLabel: "노로 비검출해역",
    tagWidth: 330,
    dateLabel: null,
    acceptImage: true,
    fileName: "noro.jpg",
    defaultDateBox: { left: 58, top: 385 },
    findText: "'생식용 굴'·'노로 비검출해역'",
    height: 1400,
    paper: { x: 120, y: 1400 - 120 - 877, w: 620, h: 877 }, // 아래 여백 120, 종이 아래쪽은 모래에 묻힌다
    docTop: 10,
    accent: BLUE,
    theme: "sea",
  },
}

// PDF 를 올리기 전에는 강조(형광펜·말풍선)를 그리지 않는다
type Marks = Pick<Layout, "highlight" | "tag" | "highlight2" | "tag2" | "dateBox">
const NO_MARKS: Marks = { highlight: null, tag: null, highlight2: null, tag2: null, dateBox: null }

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

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
function bubbleBorder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 7)
  ctx.stroke()
  ctx.restore()
}

async function draw(
  canvas: HTMLCanvasElement,
  cfg: CertConfig,
  page: HTMLImageElement | null,
  layout: Marks,
  value: string,
) {
  await loadFonts()
  const sea = cfg.theme === "sea"
  const [back, cover] = sea ? await Promise.all([loadImage(noroBgUrl), loadImage(noroOverlayUrl)]) : [await loadImage(patternUrl), null]
  const H = cfg.height
  const PAPER = cfg.paper
  const ctx = canvas.getContext("2d")!
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.imageSmoothingQuality = "high" // PDF(2480px)를 종이(620)에 줄여 넣을 때 글자가 뭉개지지 않게

  // 바탕: 흰색(수매확인서) / 바다 사진(노로, 종이 왼쪽 아래 그림자까지 들어 있다)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, W, H)
  if (sea) ctx.drawImage(back, 0, 0, W, H)

  // 제목(72 Bold, '안심' 주황) · 설명(30 Medium, 강조 Bold 주황) — 제목 줄 y120~206, 설명 y234 부터 줄높이 49
  drawLine(ctx, cfg.title, 72, -0.02, 120 + 43)
  drawLine(ctx, cfg.desc[0], 30, -0.02, 234 + 24.5)
  drawLine(ctx, cfg.desc[1], 30, -0.02, 234 + 49 + 24.5)

  // 이미지 영역: 패턴(248 원본을 124 로 반복) — 수매확인서만
  if (!sea) {
    const tile = document.createElement("canvas")
    tile.width = 124 * SCALE
    tile.height = 124 * SCALE
    tile.getContext("2d")!.drawImage(back, 0, 0, tile.width, tile.height)
    const pat = ctx.createPattern(tile, "repeat")!
    pat.setTransform(new DOMMatrix([1 / SCALE, 0, 0, 1 / SCALE, 0, 392]))
    ctx.fillStyle = pat
    ctx.fillRect(0, 392, W, 1037)
  }

  // 종이: 수매확인서는 흰 종이(그림자 y8 blur24 10%) / 노로는 그림자가 바탕에 들어 있고 확인서 첫 장만 종이 위 10 아래에 놓는다
  ctx.save()
  if (!sea) {
    ctx.shadowColor = "rgba(0,0,0,0.10)"
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
  }
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(PAPER.x, PAPER.y + cfg.docTop, PAPER.w, PAPER.h)
  ctx.restore()
  if (page) {
    ctx.drawImage(page, PAPER.x, PAPER.y + cfg.docTop, PAPER.w, PAPER.h)
  } else {
    ctx.font = `500 22px ${FONT}`
    ctx.letterSpacing = "0px"
    ctx.textAlign = "center"
    ctx.fillStyle = "#9ca3af"
    ctx.fillText(cfg.acceptImage ? "확인서를 첨부하면 이곳에 들어갑니다" : "PDF 를 첨부하면 이곳에 들어갑니다", PAPER.x + PAPER.w / 2, PAPER.y + PAPER.h / 2)
    ctx.textAlign = "start"
  }

  // 아래부터 확인서 첫 장 기준 좌표(서버가 준 강조 위치는 첫 장 620×877 기준)
  ctx.save()
  ctx.translate(PAPER.x, PAPER.y + cfg.docTop)
  const { highlight: hl, tag, dateBox } = layout

  if (sea) {
    // 노로(Figma 744:17397): 형광펜 + 연결(파랑 30% · 곱하기, 형광펜 폭 → 말풍선 양쪽 11 안쪽) + 말풍선(75 높이, 테두리 3, 글 36 Black 파랑)
    const marks: [Box | null, { left: number; top: number } | null, string, number][] = [
      [layout.highlight2, layout.tag2, "생식용 굴", 204],
      [hl, tag, cfg.tagLabel, cfg.tagWidth],
    ]
    for (const [h, t, , w] of marks) {
      if (!h) continue
      ctx.save()
      ctx.globalCompositeOperation = "multiply"
      ctx.globalAlpha = 0.3
      ctx.fillStyle = cfg.accent
      ctx.fillRect(h.l, h.t, h.r - h.l, h.b - h.t)
      if (t) {
        ctx.beginPath()
        ctx.moveTo(h.l, h.b)
        ctx.lineTo(h.r, h.b)
        ctx.lineTo(t.left + w - 11, t.top)
        ctx.lineTo(t.left + 11, t.top)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }
    for (const [h, t, label, w] of marks) {
      if (!h || !t) continue
      ctx.save()
      ctx.shadowColor = "rgba(0,0,0,0.12)"
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 6
      ctx.fillStyle = "#ffffff"
      ctx.beginPath()
      ctx.roundRect(t.left, t.top, w, 75, 12)
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.strokeStyle = cfg.accent
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(t.left + 1.5, t.top + 1.5, w - 3, 72, 10.5)
      ctx.stroke()
      ctx.font = `900 36px ${FONT}`
      ctx.letterSpacing = "-0.72px"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = cfg.accent
      ctx.fillText(label, t.left + w / 2, t.top + 3 + 34.5)
      ctx.restore()
    }
  } else {
    // 형광펜 + 연결(주황 30% · 곱하기, 형광펜 폭 → 말풍선 폭 양쪽 7 안쪽)
    if (hl) {
      ctx.save()
      ctx.globalCompositeOperation = "multiply"
      ctx.fillStyle = cfg.accent
      ctx.globalAlpha = 0.3
      ctx.fillRect(hl.l, hl.t, hl.r - hl.l, hl.b - hl.t)
      if (tag) {
        ctx.beginPath()
        ctx.moveTo(hl.l, hl.b)
        ctx.lineTo(hl.r, hl.b)
        ctx.lineTo(tag.left + cfg.tagWidth - 7, tag.top)
        ctx.lineTo(tag.left + 7, tag.top)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }

    // 강조 말풍선('생식용 굴' 164×50)
    if (tag) {
      bubble(ctx, tag.left, tag.top, cfg.tagWidth, 50)
      bubbleBorder(ctx, tag.left, tag.top, cfg.tagWidth, 50, cfg.accent)
      centerText(ctx, cfg.tagLabel, 24, -0.02, tag.left + cfg.tagWidth / 2, tag.top + 2 + 23)
    }
  }

  // '생산일자' 말풍선 164×112: 머리 칸 160×50(#f5f5f5, 아래 선 2px 주황) + 날짜 칸 160×58
  if (dateBox && cfg.dateLabel) {
    const { left: x, top: y } = dateBox
    bubble(ctx, x, y, 164, 112)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x + 2, y + 2, 160, 108, 6)
    ctx.clip()
    ctx.fillStyle = "#f5f5f5"
    ctx.fillRect(x + 2, y + 2, 160, 50)
    ctx.fillStyle = cfg.accent
    ctx.fillRect(x + 2, y + 2 + 48, 160, 2)
    ctx.restore()
    bubbleBorder(ctx, x, y, 164, 112, cfg.accent)
    centerText(ctx, cfg.dateLabel, 24, -0.013, x + 82, y + 2 + 24)
    centerText(ctx, value, 31, -0.01, x + 82, y + 52 + 29)
  }
  ctx.restore()

  // 노로: 맨 위에 덮개(860×1400 — 종이 오른쪽 위 흰 그라데이션, 아래 모래·굴, 오른쪽 풀)
  if (cover) ctx.drawImage(cover, 0, 0, W, H)
}

export function PurchaseCertTool() {
  return <CertTool cfg={CERTS.purchase} />
}

export function NoroCertTool() {
  return <CertTool cfg={CERTS.noro} />
}

function CertTool({ cfg }: { cfg: CertConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [page, setPage] = useState<HTMLImageElement | null>(null)
  const [date, setDate] = useState("") // 생산일자(수매일자): 확인서에 적힌 그대로(이것만 고칠 수 있다)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { boxRef, zoom, setZoom, scale } = useZoom() // 보기 배율(처음 70%)

  // 입력이 바뀔 때마다 다시 그린다
  useEffect(() => {
    if (canvasRef.current) void draw(canvasRef.current, cfg, page, layout ?? NO_MARKS, date.trim() || "MM.DD")
  }, [cfg, page, layout, date])

  const attach = async (file: File | undefined) => {
    if (!file) return
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    const isImage = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
    if (!isPdf && !(cfg.acceptImage && isImage)) {
      setError(cfg.acceptImage ? "PDF 나 이미지(JPG·PNG) 파일만 올릴 수 있습니다." : "PDF 파일만 올릴 수 있습니다.")
      return
    }
    setBusy(true)
    setError(null)
    setPdfName(file.name)
    try {
      const res = await apiFetch(cfg.endpoint, { method: "POST", body: file, headers: { "Content-Type": isPdf ? "application/pdf" : file.type || "image/jpeg" } })
      const body = await res.json()
      if (!res.ok) throw new ApiError(res.status, body.error ?? "파일을 읽지 못했습니다.")
      const next = body as Layout
      setPage(await loadImage(next.pageImage))
      setLayout({ ...next, highlight2: next.highlight2 ?? null, tag2: next.tag2 ?? null, dateBox: cfg.dateLabel ? (next.dateBox ?? cfg.defaultDateBox) : null })
      setDate(next.produced ?? "")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "파일을 읽지 못했습니다.")
      setPdfName(null)
    } finally {
      setBusy(false)
    }
  }

  const ready = !!page && (!cfg.dateLabel || !!date.trim())
  const fileName = cfg.fileName

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
      {/* 보기 배율: 처음 70%, 오른쪽 위 − / + (상세페이지 미리보기와 같음) */}
      <div ref={boxRef} className="relative col-span-12 flex justify-center lg:col-span-8">
        <ZoomControl zoom={zoom} scale={scale} onZoom={setZoom} />
        <canvas
          ref={canvasRef}
          style={{ width: 860 * scale }}
          className="h-auto max-w-full rounded-lg border bg-white shadow-sm"
          aria-label={`${cfg.name} 미리보기`}
        />
      </div>

      {/* 오른쪽: 파일 첨부 · 생산일자 · 다운로드(넓은 화면에서는 스크롤해도 따라온다) */}
      <div className="col-span-12 flex flex-col gap-5 lg:sticky lg:top-6 lg:col-span-4 lg:self-start">
        <Field>
          <FieldLabel>{cfg.acceptImage ? `${cfg.name} (PDF·이미지)` : `${cfg.name} PDF`}</FieldLabel>
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
            <span className="font-medium text-foreground">
              {busy ? "확인서를 읽는 중… (20~30초)" : (pdfName ?? (cfg.acceptImage ? "PDF·JPG 를 끌어 놓거나 눌러서 고르세요" : "PDF 를 끌어 놓거나 눌러서 고르세요"))}
            </span>
            <span className="text-xs break-keep">첫 장을 이미지로 바꿔 왼쪽 종이에 넣고, {cfg.findText}를 찾습니다.</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={cfg.acceptImage ? "application/pdf,.pdf,image/jpeg,image/png,image/webp" : "application/pdf,.pdf"}
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

        {cfg.dateLabel && (
        <Field>
          <FieldLabel htmlFor="cert-date">{cfg.dateLabel}</FieldLabel>
          <Input id="cert-date" value={date} onChange={(e) => setDate(e.target.value)} maxLength={20} placeholder={`확인서를 올리면 표의 ${cfg.dateLabel}로 채워집니다`} className="tabular-nums" />
          <FieldDescription className="break-keep">
            {cfg.acceptImage
              ? `표의 ${cfg.dateLabel} 칸 날짜를 월.일로 넣습니다(예 2026.11.06 → 11.06). 잘못 읽혔을 때만 고쳐 주세요.`
              : `PDF 표의 ${cfg.dateLabel} 칸에 적힌 그대로 들어갑니다(예 10.22). 잘못 읽혔을 때만 고쳐 주세요.`}
          </FieldDescription>
        </Field>
        )}

        <Button size="lg" disabled={!ready || busy} onClick={download}>
          <Download data-icon="inline-start" />
          {ready ? `${fileName} 다운로드` : "확인서를 올리면 다운로드할 수 있습니다"}
        </Button>
        <p className="text-xs text-muted-foreground">이미지 860×{cfg.height} JPG(Figma 프레임 크기). 상세페이지 업로드는 알드라이브로 직접 합니다.</p>
      </div>
    </div>
  )
}
