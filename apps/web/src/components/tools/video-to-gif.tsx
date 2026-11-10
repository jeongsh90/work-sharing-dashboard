import { useEffect, useRef, useState } from "react"
import { CopyPlus, FileInput, History, Redo2, Undo2, LayoutGrid, List, ListVideo, LoaderCircle, Move, Pause, Play, Plus, RotateCcw, Scissors, SlidersHorizontal, Trash2, Repeat, Save, SkipBack, SkipForward, StepBack, StepForward, Upload, Wand2, X, ZoomIn, ZoomOut } from "lucide-react"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ToolHeaderActions, useToolDirty } from "@/components/tools/tool-chrome"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, fetchFileBlob, formatBytes, uploadFileWithProgress } from "@/lib/api"
import { invalidate } from "@/lib/store"
import { ToolHistory, type HistoryItem } from "@/components/tools/tool-history"
import type { GifWorkerIn, GifWorkerOut } from "@/components/tools/gif-worker"
import type { WebpWorkerIn, WebpWorkerOut } from "@/components/tools/webp-worker"
import { applyAdjust, isNoAdjust, NO_ADJUST, type Adjust } from "@/components/tools/video-adjust"
import { isNoMotion, NO_MOTION, type Motion } from "@/components/tools/video-motion"
import { Tip } from "@/components/tip"

// 동영상 → GIF · 동영상 → WebP: 동영상 파일(MP4·MOV·WebM)을 골라 구간·크기·초당 장수를 정하고 GIF(또는 움직이는 WebP)로 바꾼다.
// 서버에 올리지 않고 이 브라우저 안에서 바꾼다. 장면을 한 장씩 뽑아(canvas) Web Worker 가 GIF·WebP 로 묶는다.
// 두 도구는 화면이 같고 만드는 형식(FORMATS)만 다르다.

const FPS = ["10", "12", "15", "20", "24", "25", "30"]
const COLORS = [
  { value: "256", label: "고화질 (256색)" },
  { value: "128", label: "보통 (128색)" },
  { value: "64", label: "작은 용량 (64색)" },
]
// WebP 화질(압축 품질 0~1). GIF 와 달리 색 수 제한이 없어 같은 화질이면 훨씬 가볍다.
const QUALITIES = [
  { value: "0.9", label: "고화질" },
  { value: "0.8", label: "보통" },
  { value: "0.65", label: "작은 용량" },
]
const SPEEDS = ["0.5", "1", "1.5", "2"]

type Format = "gif" | "webp"
type EncoderOut = GifWorkerOut | WebpWorkerOut

// 형식마다: 이름 · 화질 고르기 · 만드는 Worker · 시작 말 · 한 장 시간(ms)
const FORMATS: Record<
  Format,
  {
    label: string
    mime: string
    options: { value: string; label: string }[]
    defaultOption: string
    worker: () => Worker
    start: (w: number, h: number, repeat: number, option: string, delay: number) => GifWorkerIn | WebpWorkerIn
    delay: (fps: number, speed: number) => number
  }
> = {
  gif: {
    label: "GIF",
    mime: "image/gif",
    options: COLORS,
    defaultOption: "256",
    worker: () => new Worker(new URL("./gif-worker.ts", import.meta.url), { type: "module" }),
    start: (width, height, repeat, option, delay) => ({ type: "start", width, height, repeat, colors: Number(option), delay }),
    // GIF 한 장 시간은 10ms 단위. 20ms 보다 짧으면 브라우저가 느리게 틀어서 20ms 로 맞춘다.
    delay: (fps, speed) => Math.max(20, Math.round(1000 / fps / speed / 10) * 10),
  },
  webp: {
    label: "WebP",
    mime: "image/webp",
    options: QUALITIES,
    defaultOption: "0.9",
    worker: () => new Worker(new URL("./webp-worker.ts", import.meta.url), { type: "module" }),
    start: (width, height, repeat, option, delay) => ({ type: "start", width, height, repeat, quality: Number(option), delay }),
    // WebP 는 1ms 단위
    delay: (fps, speed) => Math.max(20, Math.round(1000 / fps / speed)),
  },
}
// 너무 길면 브라우저 메모리가 모자라고 GIF 도 수십 MB 가 된다
const MAX_FRAMES = 900

type Source = { file: File; url: string; duration: number; width: number; height: number }
type Result = { url: string; size: number; width: number; height: number; frames: number; name: string }
// 타임라인 클립(프리미어 시퀀스처럼): 동영상 하나의 한 구간. 클립을 순서대로 이어 붙여 한 움짤로 만든다.
// 같은 동영상을 자르기·복제하면 Source 를 함께 쓴다.
type Clip = { id: number; source: Source; start: number; end: number }
let clipSeq = 1
const newClip = (source: Source, start: number, end: number): Clip => ({ id: clipSeq++, source, start, end })
const clipLen = (c: Clip) => Math.max(0, c.end - c.start)
// 화면 비율(출력 틀). 가로는 860 기준
const RATIOS = [
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "16:10", label: "16:10", w: 16, h: 10 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
]
const OUT_W = 860
const ratioOf = (v: string) => RATIOS.find((r) => r.value === v) ?? RATIOS[0]
// 장면 하나를 틀(outW×outH)에 그린다: 원본 비율 그대로 틀 안에 맞춰 가운데(남는 곳 검정, 프리미어 시퀀스와 같다).
// 모션(위치·비율·회전·기준점·자르기·불투명도)은 원본 픽셀 기준이고 틀 밖으로 잘리지 않아, 비율을 키우면 틀을 채운다
function drawFramed(ctx: CanvasRenderingContext2D, video: CanvasImageSource, srcW: number, srcH: number, outW: number, outH: number, m: Motion) {
  const k = Math.min(outW / srcW, outH / srcH)
  const ox = (outW - srcW * k) / 2
  const oy = (outH - srcH * k) / 2
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = "none"
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, outW, outH)
  if (isNoMotion(m, srcW, srcH)) {
    ctx.drawImage(video, ox, oy, srcW * k, srcH * k)
    return
  }
  const l = (srcW * m.cropL) / 100
  const t = (srcH * m.cropT) / 100
  const r = srcW * (1 - m.cropR / 100)
  const b = srcH * (1 - m.cropB / 100)
  if (r - l < 0.5 || b - t < 0.5 || m.opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, m.opacity / 100)
  if (m.flicker > 0) ctx.filter = `blur(${(m.flicker * k).toFixed(2)}px)`
  ctx.setTransform(k, 0, 0, k, ox, oy)
  ctx.translate(m.x ?? srcW / 2, m.y ?? srcH / 2)
  ctx.rotate((m.rotation * Math.PI) / 180)
  ctx.scale((m.uniform ? m.scale : m.scaleW) / 100, m.scale / 100)
  ctx.translate(-(m.ax ?? srcW / 2), -(m.ay ?? srcH / 2))
  ctx.drawImage(video, l, t, r - l, b - t, l, t, r - l, b - t)
  ctx.restore()
}

// 히스토리에 남기는 설정(원본 동영상은 남기지 않는다. 불러오면 형식·크기·화질·속도·반복·색 보정을 채운다)
type VideoForm = {
  format: Format
  width: string
  ratio?: string // 화면 비율(16:9 · 16:10 · 1:1), 가로 860
  fps: string
  colors: string
  speed: string
  repeat: string
  adjust: Adjust
  motion?: Motion // 모션·불투명도(프리미어 효과 컨트롤과 같은 칸)
  source: string // 원본 파일 이름
  sourceFileId?: string // 원본 동영상(히스토리에 함께 남긴 파일). 불러오면 이 동영상을 다시 연다
  start: number // 구간(초)
  end: number
  // 여러 클립을 이어 붙였을 때 타임라인(순서대로). 첫 클립 = source·start·end
  clips?: { source: string; sourceFileId?: string; start: number; end: number }[]
  outW: number
  outH: number
  frames: number
  size: number // 만든 파일 크기(byte)
}
const HISTORY_MAX = 20 * 1024 * 1024 // 서버가 받는 크기. 더 크면 히스토리에 남기지 않는다
const SOURCE_MAX = 1024 * 1024 * 1024 // 원본 동영상은 1GB 까지 함께 남긴다(더 크면 설정·움짤만)
const blobToDataUrl = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as string)
    r.onerror = () => fail(r.error)
    r.readAsDataURL(b)
  })

const fmt = (s: number) => `${s.toFixed(1)}초`

// 동영상을 그 시간으로 옮기고 그 장면이 준비될 때까지 기다린다
function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done)
      video.removeEventListener("error", fail)
      resolve()
    }
    const fail = () => {
      video.removeEventListener("seeked", done)
      reject(new Error("seek"))
    }
    video.addEventListener("seeked", done)
    video.addEventListener("error", fail)
    video.currentTime = t
  })
}

// 예상 용량: 고른 구간에서 고르게 몇 장만 뽑아 지금 설정으로 GIF·WebP 를 만들어 보고, 한 장 평균 크기를 잰다.
// 장마다 따로 압축되므로(앞 장과 차이만 남기지 않는다) 평균 × 전체 장수가 실제와 거의 같다.
const SAMPLES = 6

async function measurePerFrame(
  format: Format,
  url: string,
  times: number[],
  w: number,
  h: number,
  option: string,
  adjust: Adjust,
  motion: Motion,
  alive: () => boolean,
): Promise<number | null> {
  const video = document.createElement("video")
  video.muted = true
  video.preload = "auto"
  video.src = url
  const worker = FORMATS[format].worker()
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error("load"))
    })
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    ctx.imageSmoothingQuality = "high"
    const done = new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<EncoderOut>) => {
        if (e.data.type === "done") resolve(e.data.bytes)
        if (e.data.type === "error") reject(new Error(e.data.message))
      }
    })
    worker.postMessage(FORMATS[format].start(w, h, 0, option, 70))
    for (const t of times) {
      if (!alive()) return null
      await seek(video, t)
      drawFramed(ctx, video, video.videoWidth, video.videoHeight, w, h, motion)
      const img = ctx.getImageData(0, 0, w, h)
      applyAdjust(img.data, adjust)
      const data = img.data.buffer
      worker.postMessage({ type: "frame", data } satisfies GifWorkerIn, [data])
    }
    worker.postMessage({ type: "finish" } satisfies GifWorkerIn)
    const bytes = await done
    return alive() ? bytes.byteLength / times.length : null
  } finally {
    worker.terminate()
    video.removeAttribute("src")
    video.load()
  }
}

// 클립 첫 장면 작은 그림(타임라인 칸). 클립 시작 위치가 바뀌면 다시 뽑는다
function useClipThumbs(clips: Clip[]) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const key = (c: Clip) => `${c.source.url}|${c.start.toFixed(1)}`
  const want = [...new Set(clips.map(key))].filter((k) => !thumbs[k])
  const wantKey = want.join(",")
  useEffect(() => {
    if (want.length === 0) return
    let alive = true
    void (async () => {
      for (const k of want) {
        const c = clips.find((x) => key(x) === k)
        if (!c || !alive) continue
        const video = document.createElement("video")
        video.muted = true
        video.preload = "auto"
        video.src = c.source.url
        try {
          await new Promise<void>((ok, fail) => {
            video.onloadeddata = () => ok()
            video.onerror = () => fail(new Error("load"))
          })
          await seek(video, Math.min(c.start + 0.05, c.source.duration - 0.001))
          const h = 64
          const w = Math.round((c.source.width * h) / c.source.height)
          const canvas = document.createElement("canvas")
          canvas.width = w
          canvas.height = h
          canvas.getContext("2d")!.drawImage(video, 0, 0, w, h)
          const url = canvas.toDataURL("image/jpeg", 0.7)
          if (alive) setThumbs((t) => ({ ...t, [k]: url }))
        } catch {
          // 그림을 못 뽑아도 칸은 보인다
        } finally {
          video.removeAttribute("src")
          video.load()
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey])
  return (c: Clip) => thumbs[key(c)] ?? null
}

// 시퀀스 타임라인(프리미어처럼): 위 시간 눈금 + 비디오 트랙 하나. 클립은 앞 클립 끝에 바로 이어 붙고(빈틈 없음),
// 클립 양 끝을 끌어 길이를 바꾸면 뒤 클립이 알아서 당겨지거나 밀린다. 재생 헤드(파란 머리·세로선)를 끌거나 눈금·트랙을 누르면
// 그 시점 장면이 미리보기에 나온다. 클립 몸통을 끌면 순서가 바뀐다.
const timecode = (t: number, fps: number) => {
  const f = Math.max(1, Math.round(fps))
  const total = Math.max(0, Math.round(t * f))
  const ff = total % f
  const s = Math.floor(total / f)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`
}
const RULER_STEPS = [0.2, 0.5, 1, 2, 4, 5, 10, 15, 30, 60, 120, 300]
// 포인터 잡기(끄는 동안 칸 밖으로 나가도 이어서 받는다). 못 잡아도 끌기는 그대로 한다
const capture = (e: React.PointerEvent) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // 잡을 수 없는 포인터(합성 이벤트 등)
  }
}
// 시간 눈금(그 칸 너비에 시퀀스 전체가 맞게): 미리보기 아래 막대에서 쓴다
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const PREVIEW_ZOOMS = [
  { value: "fit", label: "맞추기" },
  { value: "0.25", label: "25%" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
]

// 가로 스크롤 막대: 손잡이 길이 = 보이는 비율. 손잡이를 끌거나 빈 곳을 누르면 그쪽으로 옮긴다
function ScrollBar({ viewW, contentW, scrollX, onScroll }: { viewW: number; contentW: number; scrollX: number; onScroll: (x: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const grab = useRef<{ x: number; start: number } | null>(null)
  const max = Math.max(0, contentW - viewW)
  const thumbPct = Math.min(100, (viewW / contentW) * 100)
  const leftPct = max > 0 ? (scrollX / max) * (100 - thumbPct) : 0
  const trackW = () => ref.current?.clientWidth ?? 1
  return (
    <div
      ref={ref}
      className="relative h-3 cursor-pointer touch-none rounded-full bg-muted select-none"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-controls="timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(scrollX)}
      aria-label="타임라인 가로 스크롤"
      onPointerDown={(e) => {
        // 빈 곳을 누르면 그 자리가 손잡이 가운데가 되게
        const r = ref.current!.getBoundingClientRect()
        const ratio = (e.clientX - r.left) / r.width
        onScroll(Math.min(max, Math.max(0, (ratio - thumbPct / 200) / (1 - thumbPct / 100)) * max))
      }}
    >
      <div
        className="absolute inset-y-0 rounded-full bg-muted-foreground/50 hover:bg-muted-foreground/70 active:bg-sky-500/70"
        style={{ left: `${leftPct}%`, width: `${thumbPct}%` }}
        onPointerDown={(e) => {
          e.stopPropagation()
          capture(e)
          grab.current = { x: e.clientX, start: scrollX }
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (!g || e.buttons !== 1) return
          const free = trackW() * (1 - thumbPct / 100)
          onScroll(Math.min(max, Math.max(0, g.start + ((e.clientX - g.x) / Math.max(1, free)) * max)))
        }}
        onPointerUp={() => (grab.current = null)}
      />
    </div>
  )
}

// 미리보기 아래 막대(프리미어 프로그램 모니터처럼): 지금 시간 · 보기 배율 · 시간 눈금과 재생 헤드 · 전체 길이 · 재생 버튼
function MonitorBar({
  now,
  total,
  fps,
  playing,
  disabled,
  zoom,
  onZoom,
  onSeek,
  onPlay,
  onStep,
  onHome,
  onEnd,
  onMarkIn,
  onMarkOut,
  onSplit,
  loop,
  onLoop,
}: {
  now: number
  total: number
  fps: number
  playing: boolean
  disabled?: boolean
  zoom: string
  onZoom: (z: string) => void
  onSeek: (t: number) => void
  onPlay: () => void
  onStep: (dir: -1 | 1) => void
  onHome: () => void
  onEnd: () => void
  onMarkIn: () => void
  onMarkOut: () => void
  onSplit: () => void
  loop: boolean
  onLoop: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const pps = w / Math.max(total, 0.1)
  const step = RULER_STEPS.find((s) => s * pps >= 90) ?? 600
  const minor = step / 5
  const ticks: number[] = []
  for (let t = 0; t <= total + 0.001; t += minor) ticks.push(Math.round(t * 1000) / 1000)
  const timeAt = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(Math.max(((x - r.left) / r.width) * total, 0), total)
  }
  const pct = total > 0 ? Math.min(now / total, 1) * 100 : 0
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, key?: string) => (
    <Tip content={key ? `${label} (${key})` : label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
        {icon}
      </Button>
    </Tip>
  )
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs tabular-nums">
        <span className="min-w-24 font-semibold text-sky-500">{timecode(now, fps)}</span>
        <Select value={zoom} onValueChange={onZoom}>
          <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="미리보기 배율">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PREVIEW_ZOOMS.map((z) => (
              <SelectItem key={z.value} value={z.value}>
                {z.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-muted-foreground">{timecode(total, fps)}</span>
      </div>
      {/* 시간 눈금 + 재생 헤드: 누르거나 끌면 그 장면으로 */}
      <div
        ref={ref}
        className="relative h-7 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          if (disabled || total <= 0) return
          capture(e)
          onSeek(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (!disabled && e.buttons === 1) onSeek(timeAt(e.clientX))
        }}
        role="slider"
        aria-label="미리보기 재생 헤드"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 100) / 100}
        aria-valuenow={Math.round(now * 100) / 100}
        aria-valuetext={timecode(now, fps)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault()
            onStep(-1)
          }
          if (e.key === "ArrowRight") {
            e.preventDefault()
            onStep(1)
          }
        }}
      >
        {ticks.map((t) => {
          const major = Math.abs(t / step - Math.round(t / step)) < 1e-6
          return <div key={t} className={`pointer-events-none absolute top-1 w-px bg-muted-foreground/50 ${major ? "h-3" : "h-1.5"}`} style={{ left: `${(t / Math.max(total, 0.1)) * 100}%` }} />
        })}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 h-1.5 rounded-full bg-muted" />
        <div className="pointer-events-none absolute bottom-1 left-0 h-1.5 rounded-full bg-sky-500/40" style={{ width: `${pct}%` }} />
        <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: `${pct}%` }}>
          <div className="absolute top-0 -left-[5px] h-2.5 w-[11px] rounded-b-sm bg-sky-500" />
          <div className="absolute top-0 bottom-0 -left-px w-0.5 bg-sky-500" />
        </div>
      </div>
      {/* 재생 버튼(프리미어 순서) */}
      <div className="flex flex-wrap items-center justify-center gap-0.5">
        {btn("시작 표시 — 고른 클립 구간 시작을 여기로", <BracketsLeft />, onMarkIn, "I")}
        {btn("끝 표시 — 고른 클립 구간 끝을 여기로", <BracketsRight />, onMarkOut, "O")}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn("처음으로", <SkipBack />, onHome, "Home")}
        {btn("1프레임 뒤로", <StepBack />, () => onStep(-1), "←")}
        <Tip content="재생/멈춤 (스페이스)">
          <Button variant="secondary" size="icon-sm" aria-label={playing ? "멈춤" : "재생"} disabled={disabled} onClick={onPlay}>
            {playing ? <Pause /> : <Play />}
          </Button>
        </Tip>
        {btn("1프레임 앞으로", <StepForward />, () => onStep(1), "→")}
        {btn("끝으로", <SkipForward />, onEnd, "End")}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn("재생 헤드에서 자르기", <Scissors />, onSplit, "C")}
        <Tip content="고른 클립만 반복 재생">
          <Button variant={loop ? "secondary" : "ghost"} size="icon-sm" aria-label="고른 클립 반복" aria-pressed={loop} disabled={disabled} onClick={onLoop}>
            <Repeat />
          </Button>
        </Tip>
      </div>
    </div>
  )
}
const BracketsLeft = () => <span className="text-base leading-none font-semibold">{"{"}</span>
const BracketsRight = () => <span className="text-base leading-none font-semibold">{"}"}</span>

function SequenceTimeline({
  clips,
  activeId,
  now,
  fps,
  disabled,
  onSelect,
  onSeek,
  onTrim,
  onReorder,
}: {
  clips: Clip[]
  activeId: number | null
  now: number // 재생 헤드(시퀀스 시간, 초)
  fps: number
  disabled?: boolean
  onSelect: (id: number) => void
  onSeek: (t: number, commit: boolean) => void
  onTrim: (id: number, start: number, end: number, edge: "start" | "end", commit: boolean) => void
  onReorder: (next: Clip[]) => void
}) {
  const thumbOf = useClipThumbs(clips)
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(800)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el)
    measured.current = true
    setBoxW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // 가로 스크롤 위치(확대해서 칸을 넘으면 아래 스크롤 막대로 옮긴다)
  const [scrollX, setScrollX] = useState(0)
  const total = clips.reduce((s, c) => s + clipLen(c), 0)
  // 확대: 1 = 전체가 칸 너비에 맞게(오른쪽에 조금 여유)
  // 끄는 동안에는 배율을 고정한다(길이가 바뀌어 맞추기 배율이 변하면 손잡이가 마우스를 못 따라온다)
  const [frozenPps, setFrozenPps] = useState<number | null>(null)
  // 1초당 픽셀: 처음 클립이 올라오면 칸에 맞추고(맞추기), 그다음은 사람이 −/＋/맞추기 를 눌렀을 때만 바뀐다
  const fit = boxW / Math.max(total * 1.08, 4)
  const [scale, setScale] = useState<number | null>(null)
  const measured = useRef(false)
  useEffect(() => {
    if (total <= 0) setScale(null)
    else if (scale === null && measured.current) setScale((boxRef.current?.clientWidth || boxW) / Math.max(total * 1.08, 4))
  }, [total > 0, boxW])
  const pps = frozenPps ?? scale ?? fit
  const MIN_PPS = 2
  const MAX_PPS = 2000
  const width = Math.max(boxW, total * pps + 40)
  const starts = clips.reduce<number[]>((a, _c, i) => [...a, i === 0 ? 0 : a[i - 1] + clipLen(clips[i - 1])], [])
  const step = RULER_STEPS.find((s) => s * pps >= 80) ?? 600
  const minor = step / 5
  const ticks: number[] = []
  for (let t = 0; t <= width / pps + 0.001; t += minor) ticks.push(Math.round(t * 1000) / 1000)

  // 눈금·트랙 빈 곳: 누르거나 끌면 재생 헤드가 그 시점으로
  const timeAt = (clientX: number) => {
    const r = boxRef.current!.getBoundingClientRect()
    return Math.min(Math.max((clientX - r.left + boxRef.current!.scrollLeft) / pps, 0), total)
  }
  const scrub = {
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || total <= 0) return
      capture(e)
      onSeek(timeAt(e.clientX), false)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!disabled && e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX), false)
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX), true)
    },
  }

  // 클립 끌기: 몸통 = 순서 바꾸기(5px 넘게 움직였을 때), 그냥 누르면 고르고 그 시점으로 재생 헤드 이동 / 양 끝 = 길이 다듬기
  const drag = useRef<{ id: number; x: number; mode: "move" | "start" | "end"; start: number; end: number; moved: boolean; last?: [number, number] } | null>(null)
  const [moving, setMoving] = useState<{ id: number; dx: number } | null>(null)
  const targetIndex = (id: number, dx: number) => {
    const i = clips.findIndex((c) => c.id === id)
    const center = (starts[i] + clipLen(clips[i]) / 2) * pps + dx
    return clips.filter((c, j) => j !== i && (starts[j] + clipLen(c) / 2) * pps < center).length
  }
  const clipHandlers = (c: Clip, mode: "move" | "start" | "end") => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) return
      e.stopPropagation()
      capture(e)
      drag.current = { id: c.id, x: e.clientX, mode, start: c.start, end: c.end, moved: false }
      if (mode !== "move") setFrozenPps(pps)
      if (mode !== "move") onSelect(c.id)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== c.id || e.buttons !== 1) return
      e.stopPropagation()
      const dx = e.clientX - d.x
      if (!d.moved && Math.abs(dx) < 5) return
      d.moved = true
      if (d.mode === "move") setMoving({ id: c.id, dx })
      else {
        const dt = dx / pps
        const r2 = (v: number) => Math.round(v * 100) / 100
        // 끄는 동안 마지막 값을 기억해 두고 놓을 때 그 값으로 확정한다(놓는 순간 화면이 아직 안 바뀌었어도)
        d.last = d.mode === "start" ? [r2(Math.min(Math.max(d.start + dt, 0), d.end - 0.1)), d.end] : [d.start, r2(Math.max(Math.min(d.end + dt, c.source.duration), d.start + 0.1))]
        onTrim(c.id, d.last[0], d.last[1], d.mode, false)
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = drag.current
      drag.current = null
      setFrozenPps(null)
      if (!d || d.id !== c.id) return
      e.stopPropagation()
      if (d.mode === "move") {
        setMoving(null)
        if (d.moved) {
          const to = targetIndex(c.id, e.clientX - d.x)
          const from = clips.findIndex((x) => x.id === c.id)
          if (to !== from) {
            const next = [...clips]
            const [m] = next.splice(from, 1)
            next.splice(to, 0, m)
            onReorder(next)
          }
        } else {
          onSelect(c.id)
          onSeek(timeAt(e.clientX), true)
        }
      } else if (d.last) onTrim(c.id, d.last[0], d.last[1], d.mode, true)
    },
  })
  const dropAt = moving ? targetIndex(moving.id, moving.dx) : -1
  useEffect(() => {
    const el = boxRef.current
    if (!el || drag.current) return
    const x = now * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 16) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
  }, [now, pps])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs tabular-nums">
        <span className="font-semibold text-primary">{timecode(now, fps)}</span>
        <span className="text-muted-foreground">/ {timecode(total, fps)}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="타임라인 축소" disabled={pps <= MIN_PPS} onClick={() => setScale(Math.max(MIN_PPS, pps / 1.5))}>
            <ZoomOut />
          </Button>
          <Button variant="ghost" size="xs" disabled={Math.abs(pps - fit) < 0.5} onClick={() => setScale(fit)}>
            맞추기
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="타임라인 확대" disabled={pps >= MAX_PPS} onClick={() => setScale(Math.min(MAX_PPS, pps * 1.5))}>
            <ZoomIn />
          </Button>
        </div>
      </div>
      <div
        ref={boxRef}
        id="timeline"
        onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
        className="relative overflow-x-auto overflow-y-hidden rounded-md border bg-muted/30 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-lenis-prevent
      >
        <div className="relative" style={{ width }}>
          {/* 시간 눈금 */}
          <div
            {...scrub}
            className="relative h-7 cursor-pointer touch-none border-b bg-background/60"
            role="slider"
            aria-label="재생 헤드"
            aria-valuemin={0}
            aria-valuemax={Math.round(total * 100) / 100}
            aria-valuenow={Math.round(now * 100) / 100}
            aria-valuetext={timecode(now, fps)}
            tabIndex={0}
            onKeyDown={(e) => {
              const d = e.shiftKey ? 1 : 1 / Math.max(1, fps)
              if (e.key === "ArrowLeft") onSeek(Math.max(0, now - d), true)
              if (e.key === "ArrowRight") onSeek(Math.min(total, now + d), true)
            }}
          >
            {ticks.map((t) => {
              const major = Math.abs(t / step - Math.round(t / step)) < 1e-6
              return (
                <div key={t} className="pointer-events-none absolute bottom-0" style={{ left: t * pps }}>
                  <div className={`w-px bg-muted-foreground/60 ${major ? "h-3" : "h-1.5"}`} />
                  {major && <span className="absolute bottom-3 left-1 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">{timecode(t, fps)}</span>}
                </div>
              )
            })}
            {/* 시퀀스 끝 */}
            <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-amber-400/70" style={{ left: total * pps }} />
          </div>
          {/* 비디오 트랙 V1 */}
          <div {...scrub} className="relative h-16 cursor-pointer touch-none">
            {clips.map((c, i) => {
              const active = c.id === activeId
              const thumb = thumbOf(c)
              const isMoving = moving?.id === c.id
              return (
                <div
                  key={c.id}
                  {...clipHandlers(c, "move")}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={`${i + 1}번 클립 ${c.source.file.name} ${fmt(c.start)}–${fmt(c.end)}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(c.id)
                    // Alt + ← → 로 순서 바꾸기
                    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                      const to = i + (e.key === "ArrowLeft" ? -1 : 1)
                      if (to < 0 || to >= clips.length) return
                      const next = [...clips]
                      ;[next[i], next[to]] = [next[to], next[i]]
                      onReorder(next)
                    }
                  }}
                  className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-[3px] border-2 bg-sky-900 active:cursor-grabbing ${
                    active ? "border-white" : "border-sky-700/80 hover:border-sky-300"
                  } ${isMoving ? "z-20 opacity-80 shadow-lg" : ""}`}
                  style={{ left: starts[i] * pps, width: Math.max(4, clipLen(c) * pps), transform: isMoving ? `translateX(${moving.dx}px)` : undefined }}
                >
                  {thumb && (
                    <span aria-hidden className="absolute inset-0 bg-repeat-x opacity-70" style={{ backgroundImage: `url(${thumb})`, backgroundSize: "auto 100%" }} />
                  )}
                  <span className="pointer-events-none absolute inset-x-0 top-0 truncate bg-sky-950/80 px-1.5 text-[11px] leading-4 text-white">
                    {i + 1} · {c.source.file.name}
                  </span>
                  <span className="pointer-events-none absolute right-1 bottom-0.5 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">{fmt(clipLen(c))}</span>
                  {/* 양 끝 손잡이: 끌어서 클립 길이 다듬기(뒤 클립은 알아서 따라간다) */}
                  {(["start", "end"] as const).map((edge) => (
                    <span
                      key={edge}
                      {...clipHandlers(c, edge)}
                      aria-hidden
                      className={`absolute inset-y-0 z-10 w-2 cursor-ew-resize bg-white/0 hover:bg-white/50 ${edge === "start" ? "left-0" : "right-0"} ${active ? "bg-white/30" : ""}`}
                    />
                  ))}
                </div>
              )
            })}
            {/* 순서 바꾸기: 놓일 자리 */}
            {moving && dropAt >= 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-amber-400"
                style={{
                  left: (() => {
                    const others = clips.filter((c) => c.id !== moving.id)
                    return others.slice(0, dropAt).reduce((s, c) => s + clipLen(c), 0) * pps
                  })(),
                }}
              />
            )}
          </div>
          {/* 재생 헤드 */}
          <div className="pointer-events-none absolute inset-y-0 z-30" style={{ left: now * pps }}>
            <div className="absolute top-0 -left-[5px] h-3 w-[11px] rounded-b-sm bg-sky-500" />
            <div className="absolute top-0 bottom-0 -left-px w-0.5 bg-sky-500" />
          </div>
        </div>
      </div>
      {/* 넘치는 부분 스크롤 막대(프리미어 타임라인 아래 막대처럼): 손잡이 = 지금 보이는 범위. 끌거나 막대를 눌러 옮긴다 */}
      {width > boxW + 1 && (
        <ScrollBar
          viewW={boxW}
          contentW={width}
          scrollX={scrollX}
          onScroll={(x) => {
            if (boxRef.current) boxRef.current.scrollLeft = x
          }}
        />
      )}
    </div>
  )
}

// 한 화면에서 위 토글로 GIF·WebP 를 고른다(고른 동영상·구간·크기는 그대로 둔다)
export function VideoConvertTool() {
  const [format, setFormat] = useState<Format>("webp") // 기본은 WebP(같은 화질에 더 가벼움)
  const F = FORMATS[format]
  // 타임라인: 클립을 순서대로 이어 붙인다. 고른 클립(activeId)의 동영상·구간이 미리보기·구간 칸·프레임 띠에 보인다
  const [clips, setClips] = useState<Clip[]>([])
  // 미디어 칸(프리미어 프로젝트 패널): 가져온 동영상. 끌어 놓거나 ＋ 로 타임라인에 클립을 붙인다
  const [media, setMedia] = useState<Source[]>([])
  const [mediaView, setMediaView] = useState<"list" | "grid">("grid")
  const [historyOpen, setHistoryOpen] = useState(false) // 히스토리 칸(창 머리 버튼 → 오른쪽에서)
  const [activeId, setActiveId] = useState<number | null>(null)
  const activeClip = clips.find((c) => c.id === activeId) ?? clips[0] ?? null
  const source = activeClip?.source ?? null
  const range: [number, number] = activeClip ? [activeClip.start, activeClip.end] : [0, 0]
  const activeRef = useRef<number | null>(null)
  activeRef.current = activeClip?.id ?? null
  const setRange = (r: [number, number]) => {
    const id = activeRef.current
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, start: r[0], end: r[1] } : c)))
  }
  const first = clips[0]?.source ?? null // 출력 크기 기준(시퀀스 설정 = 첫 클립)
  const multi = clips.length > 1
  // 전체 재생(클립을 이어서): 지금 클립 끝에 닿으면 다음 클립으로 넘어간다
  const [seqPlay, setSeqPlay] = useState(false)
  const seqRef = useRef(false)
  seqRef.current = seqPlay
  const autoPlay = useRef(false) // 다음 클립으로 넘어간 뒤 동영상이 준비되면 그 클립 시작부터 재생
  const [width, setWidth] = useState("860") // 예전 기록 호환(지금은 늘 860)
  const [ratio, setRatio] = useState("16:9") // 화면 비율(기본 16:9)
  const [fps, setFps] = useState("25")
  // 화질: GIF 는 색 수, WebP 는 압축 품질
  const [colors, setColors] = useState(F.defaultOption)
  const [speed, setSpeed] = useState("1")
  const [repeat, setRepeat] = useState("0")
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST) // 색 보정(노출·오프셋·감마·색조·채도·명도)
  const [motion, setMotion] = useState<Motion>(NO_MOTION) // 모션·불투명도(위치·비율·회전·기준점·깜박임 제거·자르기)
  const adjustCanvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ step: string; ratio: number; done: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  // 미리보기 동영상은 두 개를 번갈아 쓴다(앞 = 보이는 것). 전체 재생 중에는 뒤에 다음 클립을 미리 열어 두었다가 경계에서 바꿔 끼운다
  const preview = useRef<HTMLVideoElement | null>(null)
  const vidA = useRef<HTMLVideoElement | null>(null)
  const vidB = useRef<HTMLVideoElement | null>(null)
  const vids = [vidA, vidB]
  const [front, setFront] = useState<0 | 1>(0)
  const frontRef = useRef<0 | 1>(0)
  const prepared = useRef<{ id: number } | null>(null)
  const lastSwitch = useRef(0)
  const cancelRef = useRef<(() => void) | null>(null)
  // 히스토리에서 불러온 설정: 원본 동영상은 남기지 않아서, 만든 움짤과 원본 이름을 보여 주고 같은 동영상을 고르면 구간까지 채운다
  const [loaded, setLoaded] = useState<{ title: string; fileId: string; form: VideoForm } | null>(null)
  // 원본 동영상을 히스토리에 올리는 중(진행률). 같은 동영상은 한 번만 올린다(파일 → 올린 id)
  const [saving, setSaving] = useState<{ ratio: number } | null>(null)
  const sourceIds = useRef(new WeakMap<File, Promise<string>>())
  const uploadSource = (file: File) => {
    let p = sourceIds.current.get(file)
    if (!p) {
      setSaving({ ratio: 0 })
      p = uploadFileWithProgress(file, (ratio) => setSaving({ ratio })).then((f) => f.id)
      p.then(
        () => setSaving(null),
        () => {
          setSaving(null)
          sourceIds.current.delete(file)
        },
      )
      sourceIds.current.set(file, p)
    }
    return p
  }
  const topRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef<{ title: string; fileId: string; form: VideoForm } | null>(null)

  // 화면을 닫으면 만든 주소·작업을 정리한다(동영상 주소는 어느 클립도 쓰지 않게 되면 푼다)
  // (뺀 동영상도 되돌리기로 다시 쓸 수 있어 주소는 창을 닫을 때 한꺼번에 푼다)
  const urlsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const u of [...clips.map((c) => c.source.url), ...media.map((s) => s.url)]) urlsRef.current.add(u)
  }, [clips, media])
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), [])
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result])
  useEffect(() => () => cancelRef.current?.(), [])

  const OPEN_FAIL = "이 동영상은 브라우저에서 열 수 없습니다. MP4(H.264)나 WebM 으로 저장해 다시 골라 주세요."
  const isVideo = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)
  // 동영상 파일을 열어 크기·길이를 읽는다(못 열면 null)
  const readSource = (file: File) =>
    new Promise<Source | null>((resolve) => {
      const url = URL.createObjectURL(file)
      const v = document.createElement("video")
      v.preload = "metadata"
      v.muted = true
      v.src = url
      v.onloadedmetadata = () => {
        if (!v.videoWidth || !Number.isFinite(v.duration)) {
          URL.revokeObjectURL(url)
          resolve(null)
          return
        }
        resolve({ file, url, duration: v.duration, width: v.videoWidth, height: v.videoHeight })
      }
      v.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
    })

  // 동영상 고르기: 처음이면 타임라인을 새로 만들고, 이미 있으면(영상 추가) 뒤에 클립으로 붙인다.
  // 클립은 원본 전체 길이로 올린다. 불러온 설정과 같은 동영상이면 그때 구간
  // binOnly: 미디어 칸에만 가져온다(타임라인이 비어 있으면 타임라인에도 올린다 — 처음 가져온 영상은 바로 편집)
  const open = async (input: File | File[] | undefined, opts?: { savedId?: string; append?: boolean; binOnly?: boolean; ranges?: [number, number][] }) => {
    const files = (Array.isArray(input) ? input : input ? [input] : []).filter(Boolean)
    if (files.length === 0) return
    if (files.some((f) => !isVideo(f))) {
      setError("동영상 파일(MP4·MOV·WebM)을 골라 주세요.")
      return
    }
    if (opts?.savedId && files.length === 1) sourceIds.current.set(files[0], Promise.resolve(opts.savedId))
    setError(null)
    setResult(null)
    // 같은 파일이 여러 클립에 쓰이면(불러온 타임라인) 한 번만 연다
    const uniq = [...new Set(files)]
    const opened = await Promise.all(uniq.map(readSource))
    if (opened.some((s) => !s)) {
      opened.forEach((s) => s && URL.revokeObjectURL(s.url))
      setError(OPEN_FAIL)
      return
    }
    const byFile = new Map(uniq.map((f, i) => [f, opened[i] as Source]))
    const sources = files.map((f) => byFile.get(f)!)
    const replace = !opts?.append && !opts?.binOnly // 새로 시작(히스토리 불러오기 등): 미디어 칸도 새로
    setMedia((m) => (replace ? [...byFile.values()] : [...m, ...byFile.values()]))
    if (opts?.binOnly && clips.length > 0) {
      setLoaded(null)
      return
    }
    const append = (opts?.append || opts?.binOnly) && clips.length > 0
    const want = loadedRef.current ?? loaded
    loadedRef.current = null
    const made = sources.map((s, i) => {
      const r = opts?.ranges?.[i]
      if (r) return newClip(s, Math.min(r[0], s.duration), Math.min(r[1], s.duration))
      if (!append && i === 0) {
        const same = want && want.form.source === s.file.name
        return same ? newClip(s, Math.min(want.form.start, s.duration), Math.min(want.form.end, s.duration)) : newClip(s, 0, s.duration)
      }
      return newClip(s, 0, s.duration)
    })
    setClips((cs) => (append ? [...cs, ...made] : made))
    setActiveId(made[0].id)
    setLoaded(null)
    setPlaying(false)
    setSeqPlay(false)
  }

  // ── 타임라인 편집(프리미어처럼): 자르기(면도칼) · 복제 · 삭제 · 순서 바꾸기 ──
  const splitAtPlayhead = () => {
    if (!activeClip) return
    const t = preview.current?.currentTime ?? time
    if (t <= activeClip.start + 0.1 || t >= activeClip.end - 0.1) {
      setError("자를 위치를 고른 클립 구간 안(시작·끝에서 0.1초 이상 떨어진 곳)으로 옮겨 주세요.")
      return
    }
    setError(null)
    const cut = Math.round(t * 10) / 10
    const a = { ...activeClip, end: cut }
    const b = newClip(activeClip.source, cut, activeClip.end)
    setClips((cs) => cs.flatMap((c) => (c.id === activeClip.id ? [a, b] : [c])))
    setActiveId(b.id)
    setResult(null)
  }
  const duplicateClip = () => {
    if (!activeClip) return
    const copy = newClip(activeClip.source, activeClip.start, activeClip.end)
    setClips((cs) => cs.flatMap((c) => (c.id === activeClip.id ? [c, copy] : [c])))
    setActiveId(copy.id)
    setResult(null)
  }
  const removeClip = () => {
    if (!activeClip) return
    const i = clips.findIndex((c) => c.id === activeClip.id)
    const next = clips.filter((c) => c.id !== activeClip.id)
    setClips(next)
    setActiveId(next[Math.min(i, next.length - 1)]?.id ?? null)
    setResult(null)
    setSeqPlay(false)
  }
  // 미디어 칸 → 타임라인: 그 동영상 전체를 클립으로 뒤에 붙인다
  const addToTimeline = (s: Source) => {
    const c = newClip(s, 0, s.duration)
    setClips((cs) => [...cs, c])
    setActiveId(c.id)
    setResult(null)
    setSeqPlay(false)
  }
  // 미디어 칸에서 빼면 그 동영상으로 만든 클립도 타임라인에서 빠진다
  const removeMedia = (s: Source) => {
    setMedia((m) => m.filter((x) => x !== s))
    const next = clips.filter((c) => c.source !== s)
    setClips(next)
    if (!next.some((c) => c.id === activeClip?.id)) setActiveId(next[0]?.id ?? null)
    setResult(null)
    setSeqPlay(false)
  }
  const selectClip = (id: number) => {
    if (id === activeClip?.id) return
    preview.current?.pause()
    setSeqPlay(false)
    setActiveId(id)
  }

  // 미리보기는 고른 구간만 되풀이한다
  const onTime = () => {
    const v = preview.current
    if (!v) return
    setTime(v.currentTime)
    if (v.paused) return // 멈춰 있을 때는 프레임 띠에서 구간 밖을 눌러 봐도 그 자리에 둔다
    if (seqRef.current && v.currentTime >= range[1] - 0.04) {
      if (performance.now() - lastSwitch.current > 200) nextClip()
      return
    }
    if (v.currentTime >= range[1] || v.currentTime < range[0] - 0.05) v.currentTime = range[0]
  }
  // 전체 재생: 다음 클립(마지막이면 처음)으로 넘어가 그 클립 시작부터 이어서 재생한다
  const nextOf = (c: Clip) => clips[(clips.findIndex((x) => x.id === c.id) + 1) % clips.length]
  // 다음 클립을 뒤 영상에 미리 열고 시작 위치로 옮겨 둔다(지금 클립 끝 1.2초 전부터)
  const prepareNext = () => {
    const v = preview.current
    if (!seqRef.current || !v || !activeClip || v.paused) return
    if (range[1] - v.currentTime > 1.2) return
    const next = nextOf(activeClip)
    if (prepared.current?.id === next.id) return
    const back = vids[1 - frontRef.current].current
    if (!back) return
    prepared.current = { id: next.id }
    back.defaultPlaybackRate = back.playbackRate = Number(speed)
    const go = () => {
      back.currentTime = next.start
    }
    if (back.src !== next.source.url) {
      back.addEventListener("loadeddata", go, { once: true })
      back.src = next.source.url
    } else go()
  }
  const nextClip = () => {
    const v = preview.current
    if (!v || !activeClip) return
    lastSwitch.current = performance.now()
    const next = nextOf(activeClip)
    const back = vids[1 - frontRef.current].current
    // 뒤 영상이 다음 클립 시작에 준비돼 있으면 바꿔 끼우고 바로 이어 재생(끊김 없음)
    if (back && prepared.current?.id === next.id && back.readyState >= 2 && !back.seeking && Math.abs(back.currentTime - next.start) < 0.08) {
      prepared.current = null
      const f = (1 - frontRef.current) as 0 | 1
      frontRef.current = f
      preview.current = back
      void back.play().catch(() => {})
      v.pause()
      setFront(f)
      setTime(next.start)
      setActiveId(next.id)
      return
    }
    prepared.current = null
    if (next.source.url === activeClip.source.url) {
      // 같은 동영상이면 위치만 옮긴다
      v.currentTime = next.start
      setActiveId(next.id)
      return
    }
    v.pause()
    autoPlay.current = true
    setActiveId(next.id)
  }
  // 구간 끝이 동영상 끝이면 위 검사 전에 재생이 멈춘다: 전체 재생이면 다음 클립, 아니면 구간 처음부터 다시
  const onEnded = () => {
    const v = preview.current
    if (!v) return
    if (seqRef.current) nextClip()
    else {
      v.currentTime = range[0]
      void v.play().catch(() => {})
    }
  }
  // 새 클립 동영상이 준비되면(전체 재생 중) 그 클립 시작부터 재생
  const onPreviewReady = () => {
    drawAdjusted()
    if (pendingLocal.current !== null && preview.current) {
      preview.current.currentTime = pendingLocal.current
      pendingLocal.current = null
    }
    if (!autoPlay.current) return
    autoPlay.current = false
    const v = preview.current
    if (!v) return
    v.currentTime = range[0]
    void v.play().catch(() => {})
  }
  const playSequence = () => {
    const v = preview.current
    if (!v || clips.length === 0) return
    if (seqPlay && !v.paused) {
      v.pause()
      setSeqPlay(false)
      return
    }
    setSeqPlay(true)
    const firstClip = clips[0]
    if (activeClip?.id === firstClip.id) {
      v.currentTime = firstClip.start
      void v.play().catch(() => {})
    } else if (firstClip.source.url === activeClip?.source.url) {
      setActiveId(firstClip.id)
      v.currentTime = firstClip.start
      void v.play().catch(() => {})
    } else {
      v.pause()
      autoPlay.current = true
      setActiveId(firstClip.id)
    }
  }

  useEffect(() => {
    const v = preview.current
    if (v && source && v.src !== source.url) {
      prepared.current = null
      v.src = source.url
    }
    // 결과를 보다 돌아오면 영상 칸이 새로 생겨 다시 넣는다(result)
  }, [source, front, result])
  // 재생 속도를 미리보기에도 반영한다(결과를 보다 돌아오면 영상이 새로 붙어 다시 맞춘다)
  useEffect(() => {
    const v = preview.current
    if (v) v.defaultPlaybackRate = v.playbackRate = Number(speed)
  }, [speed, source, result])

  // 색 보정 미리보기: 보정이 있으면 동영상 위 캔버스에 지금 장면을 보정해 그린다(가로 최대 860 으로 줄여서)
  const adjustRef = useRef(adjust)
  adjustRef.current = adjust
  const motionRef = useRef(motion)
  motionRef.current = motion
  const drawAdjusted = () => {
    const v = preview.current
    const c = adjustCanvas.current
    if (!v || !c || !v.videoWidth) return
    const [w, h] = outSizeRef.current
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext("2d", { willReadFrequently: true })!
    drawFramed(ctx, v, v.videoWidth, v.videoHeight, w, h, motionRef.current)
    if (isNoAdjust(adjustRef.current)) return
    const img = ctx.getImageData(0, 0, w, h)
    applyAdjust(img.data, adjustRef.current)
    ctx.putImageData(img, 0, 0)
  }
  useEffect(() => {
    drawAdjusted()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust, motion, result])

  // 재생 위치(재생 헤드). 재생 중에는 화면 그릴 때마다 따라가고, 전체 재생이면 다음 클립을 준비하고 경계에서 바로 넘긴다
  const [time, setTime] = useState(0)
  const tickRef = useRef<() => void>(() => {})
  tickRef.current = () => {
    const v = preview.current
    if (!v) return
    setTime(v.currentTime)
    drawAdjusted()
    prepareNext()
    if (seqRef.current && !v.paused && v.currentTime >= range[1] - 0.03 && performance.now() - lastSwitch.current > 200) nextClip()
  }
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      tickRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // 손잡이를 끄는 동안: 4K 처럼 큰 영상은 한 번 옮기는 데 오래 걸려, 옮기는 중이면 마지막 위치만 기억했다가 끝나면 옮긴다
  const pendingSeek = useRef<number | null>(null)
  const [sliding, setSliding] = useState(false)
  const seekPreview = (t: number) => {
    const v = preview.current
    if (!v) return
    if (!v.paused) v.pause()
    if (v.seeking) pendingSeek.current = t
    else v.currentTime = t
  }
  const onSeeked = () => {
    drawAdjusted()
    const t = pendingSeek.current
    if (t === null || !preview.current) return
    pendingSeek.current = null
    preview.current.currentTime = t
  }
  const togglePlay = () => {
    const v = preview.current
    if (!v) return
    setSeqPlay(false)
    if (v.paused) {
      if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0]
      void v.play()
    } else v.pause()
  }

  // 출력 크기는 첫 클립 기준(프리미어 시퀀스 설정처럼). 장수·길이는 모든 클립을 더한다
  const outW = OUT_W
  const outH = Math.round((OUT_W * ratioOf(ratio).h) / ratioOf(ratio).w)
  const outSizeRef = useRef<[number, number]>([outW, outH])
  outSizeRef.current = [outW, outH]
  useEffect(() => {
    drawAdjusted()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio])
  const length = Math.max(0, range[1] - range[0]) // 고른 클립 구간
  const clipFrames = (c: Clip) => Math.max(1, Math.round(clipLen(c) * Number(fps)))
  const totalLength = clips.reduce((s, c) => s + clipLen(c), 0)
  const frames = clips.length ? clips.reduce((s, c) => s + clipFrames(c), 0) : 1
  const tooMany = frames > MAX_FRAMES
  const busy = progress !== null

  // 설정을 바꾸면 잠깐 뒤(손을 멈춘 뒤) 한 장 평균 크기를 다시 잰다. 초당 장수·속도·반복은 장수만 바뀌어 다시 재지 않는다.
  const [perFrame, setPerFrame] = useState<{ key: string; bytes: number } | null>(null)
  const sampleKey = source ? `${source.url}|${range[0].toFixed(1)}|${range[1].toFixed(1)}|${outW}|${format}|${colors}|${JSON.stringify(adjust)}|${JSON.stringify(motion)}` : ""
  useEffect(() => {
    // 손잡이를 끄는 동안에는 재지 않는다(미리보기와 영상 읽기를 다투지 않게)
    if (!source || busy || sliding || length <= 0) return
    let alive = true
    const timer = setTimeout(() => {
      const times = Array.from({ length: SAMPLES }, (_, i) => Math.min(range[0] + ((i + 0.5) * length) / SAMPLES, source.duration - 0.001))
      measurePerFrame(format, source.url, times, outW, outH, colors, adjust, motion, () => alive).then(
        (bytes) => alive && bytes !== null && setPerFrame({ key: sampleKey, bytes }),
        () => {},
      )
    }, 600)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // sampleKey 에 구간·크기·화질이 모두 들어 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleKey, busy, sliding])
  const estimating = !perFrame || perFrame.key !== sampleKey
  // 머리말·색표 몫(약 1KB)을 더한다
  const estimate = perFrame ? Math.round(perFrame.bytes * frames + 1024) : null

  const convert = async () => {
    if (!first || tooMany || totalLength <= 0 || clips.some((c) => clipLen(c) <= 0)) return
    setError(null)
    setResult(null)
    preview.current?.pause()
    setSeqPlay(false)
    let cancelled = false
    const worker = F.worker()
    const video = document.createElement("video")
    video.muted = true
    video.preload = "auto"
    let loadedUrl = ""
    // 클립마다 그 동영상을 연다(같은 동영상이면 다시 열지 않는다)
    const load = (url: string) => {
      if (url === loadedUrl) return Promise.resolve()
      loadedUrl = url
      return new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error("load"))
        video.src = url
      })
    }
    const seqClips = clips
    const startKey = workKeyRef.current
    cancelRef.current = () => {
      cancelled = true
      worker.terminate()
      setProgress(null)
    }
    try {
      const canvas = document.createElement("canvas")
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!
      ctx.imageSmoothingQuality = "high"
      const delay = F.delay(Number(fps), Number(speed))
      const finished = new Promise<ArrayBuffer>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<EncoderOut>) => {
          if (e.data.type === "frame-done") {
            const done = e.data.index
            setProgress({ step: done >= frames ? "마무리하는 중" : "변환하는 중", ratio: Math.min(done / frames, 0.99), done })
          } else if (e.data.type === "error") reject(new Error(e.data.message))
          else resolve(e.data.bytes)
        }
      })
      worker.postMessage(F.start(outW, outH, Number(repeat), colors, delay))
      setProgress({ step: "변환하는 중", ratio: 0, done: 0 })
      // 클립을 순서대로 이어 붙인다(클립마다 시작부터 초당 장수만큼)
      for (const c of seqClips) {
        if (cancelled) return
        await load(c.source.url)
        const n = clipFrames(c)
        for (let i = 0; i < n; i++) {
          if (cancelled) return
          await seek(video, Math.min(c.start + i / Number(fps), c.end - 0.001, c.source.duration - 0.001))
          drawFramed(ctx, video, c.source.width, c.source.height, outW, outH, motion)
          const img = ctx.getImageData(0, 0, outW, outH)
          applyAdjust(img.data, adjust)
          const data = img.data.buffer
          worker.postMessage({ type: "frame", data } satisfies GifWorkerIn, [data])
        }
      }
      worker.postMessage({ type: "finish" } satisfies GifWorkerIn)
      const bytes = await finished
      if (cancelled) return
      const blob = new Blob([bytes], { type: F.mime })
      const base = first.file.name.replace(/\.[^.]+$/, "") + (seqClips.length > 1 ? `_편집${seqClips.length}컷` : "")
      const made = { url: URL.createObjectURL(blob), size: blob.size, width: outW, height: outH, frames, name: `${base}.${format}` }
      setResult(made)
      setSavedKey(startKey)
      setSaveOpen(false)
      // 만든 움짤과 설정을 히스토리에 남긴다(제목 = 만든 파일 이름. 같은 동영상도 WebP·GIF 는 따로 보인다)
      if (blob.size <= HISTORY_MAX) {
        const head = seqClips[0]
        const form: VideoForm = { format, width, ratio, fps, colors, speed, repeat, adjust, motion, source: head.source.file.name, start: head.start, end: head.end, outW, outH, frames, size: blob.size }
        const safe = base.replace(/[^\w.\-가-힣 ]/g, "_").slice(0, 50) || "video"
        // 원본 동영상도 함께 남긴다(불러오면 그 동영상들이 다시 열린다). 못 올리면 설정·움짤만 남긴다
        const files = [...new Set(seqClips.map((c) => c.source.file))]
        const ids = Promise.all(files.map((f) => (f.size <= SOURCE_MAX ? uploadSource(f).catch(() => null) : Promise.resolve(null))))
        Promise.all([blobToDataUrl(blob), ids])
          .then(([image, idList]) => {
            const idOf = new Map(files.map((f, i) => [f, idList[i]]))
            const headId = idOf.get(head.source.file) ?? null
            const full: VideoForm = {
              ...form,
              ...(headId ? { sourceFileId: headId } : {}),
              ...(seqClips.length > 1
                ? { clips: seqClips.map((c) => ({ source: c.source.file.name, sourceFileId: idOf.get(c.source.file) ?? undefined, start: c.start, end: c.end })) }
                : {}),
            }
            const fileIds = [...new Set(idList.filter((x): x is string => !!x))]
            return api("/tools/video/history", { body: { title: made.name, fileName: `${safe}.${format}`, form: full, fileIds, image } })
          })
          .then(() => invalidate(), () => {})
      }
      // 변환이 끝나면 바로 내려받는다(결과 화면에서 다시 받을 수도 있다)
      const a = document.createElement("a")
      a.href = made.url
      a.download = made.name
      a.click()
    } catch {
      if (!cancelled) setError("변환하지 못했습니다. 다른 동영상 형식(MP4·WebM)으로 다시 시도해 주세요.")
    } finally {
      worker.terminate()
      video.removeAttribute("src")
      video.load()
      cancelRef.current = null
      if (!cancelled) setProgress(null)
    }
  }


  // 히스토리에서 불러오기: 그때 설정(형식·크기·화질·속도·반복·색 보정)을 채운다. 동영상은 다시 골라야 한다
  const [fetching, setFetching] = useState<{ name: string; ratio: number } | null>(null)
  const loadForm = async (f: VideoForm, h: HistoryItem<VideoForm>) => {
    if (busy) return
    // 여러 클립을 이어 붙인 기록: 원본 동영상들을 받아 타임라인(순서·구간)을 그대로 다시 만든다
    if (f.clips && f.clips.length > 1 && f.clips.every((c) => c.sourceFileId)) {
      requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
      try {
        const ids = [...new Set(f.clips.map((c) => c.sourceFileId!))]
        const files = new Map<string, File>()
        for (const [n, fid] of ids.entries()) {
          const name = f.clips.find((c) => c.sourceFileId === fid)!.source
          setFetching({ name: `${name} (${n + 1}/${ids.length})`, ratio: 0 })
          const blob = await fetchFileBlob(fid, (ratio) => setFetching({ name: `${name} (${n + 1}/${ids.length})`, ratio }))
          const file = new File([blob], name, { type: blob.type || "video/mp4" })
          sourceIds.current.set(file, Promise.resolve(fid))
          files.set(fid, file)
        }
        applyForm(f)
        await open(
          f.clips.map((c) => files.get(c.sourceFileId!)!),
          { ranges: f.clips.map((c) => [c.start, c.end] as [number, number]) },
        )
        return
      } catch {
        // 못 받으면 아래처럼 첫 클립 설정만 채운다
      } finally {
        setFetching(null)
      }
    }
    // 원본 동영상을 함께 남긴 기록: 받아서 그대로 연다(구간까지)
    if (f.sourceFileId && !(source && source.file.name === f.source)) {
      setFetching({ name: f.source, ratio: 0 })
      requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
      try {
        const blob = await fetchFileBlob(f.sourceFileId, (ratio) => setFetching({ name: f.source, ratio }))
        const file = new File([blob], f.source, { type: blob.type || "video/mp4" })
        loadedRef.current = { title: h.title, fileId: h.fileId, form: f }
        applyForm(f)
        await open(file, { savedId: f.sourceFileId })
        return
      } catch {
        // 원본을 못 받으면(지워졌거나 연결 끊김) 설정만 채우고 다시 고르게 한다
      } finally {
        setFetching(null)
      }
    }
    applyForm(f)
    // 지금 열린 동영상이 그때 원본과 같으면 구간도 채우고, 아니면 원본을 다시 고르라고 보여 준다
    if (source && source.file.name === f.source) {
      setRange([Math.min(f.start, source.duration), Math.min(f.end, source.duration)])
      setLoaded(null)
    } else setLoaded({ title: h.title, fileId: h.fileId, form: f })
    // 도구 창 안에서 스크롤하므로 창의 맨 위 칸으로 옮긴다
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const applyForm = (f: VideoForm) => {
    setFormat(f.format)
    setWidth(f.width)
    setRatio(f.ratio ?? "16:9")
    setFps(f.fps)
    setColors(f.colors)
    setSpeed(f.speed)
    setRepeat(f.repeat)
    setAdjust(f.adjust ?? NO_ADJUST)
    setMotion(f.motion ?? NO_MOTION)
    setResult(null)
  }

  const reset = () => {
    cancelRef.current?.()
    setClips([])
    setMedia([])
    setActiveId(null)
    setSeqPlay(false)
    setResult(null)
    setError(null)
  }

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files")
  // 파일 고르기 창: 가져오기(미디어 칸. 타임라인이 비어 있으면 타임라인에도) / 영상 추가(타임라인 뒤에 붙이기)
  const appendPick = useRef(false)
  const pickImport = () => {
    appendPick.current = false
    picker.current?.click()
  }
  const MEDIA_TYPE = "application/x-wsd-media" // 미디어 칸 → 타임라인 끌어 놓기
  const onTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const idx = e.dataTransfer.getData(MEDIA_TYPE)
    if (idx !== "") {
      const s = media[Number(idx)]
      if (s) addToTimeline(s)
      return
    }
    if (e.dataTransfer.files.length) void open([...e.dataTransfer.files], { append: true })
  }
  // 시퀀스 시간(재생 헤드): 고른 클립의 시퀀스 시작 + 그 클립 안 위치
  const seqStart = (id: number | undefined) => {
    let t = 0
    for (const c of clips) {
      if (c.id === id) return t
      t += clipLen(c)
    }
    return 0
  }
  const now = activeClip ? seqStart(activeClip.id) + Math.min(Math.max(time - activeClip.start, 0), clipLen(activeClip)) : 0
  // 재생 헤드를 옮기면 그 시점 클립을 고르고 그 장면을 미리보기에 띄운다(다른 동영상이면 열린 뒤에 옮긴다)
  const pendingLocal = useRef<number | null>(null)
  const seekSequence = (t: number) => {
    if (clips.length === 0) return
    let acc = 0
    let target = clips[clips.length - 1]
    for (const c of clips) {
      if (t < acc + clipLen(c)) {
        target = c
        break
      }
      acc += clipLen(c)
    }
    if (target === clips[clips.length - 1] && t >= acc + clipLen(target)) acc = seqStart(target.id)
    const local = Math.min(Math.max(target.start + (t - acc), target.start), target.end - 0.001)
    setSeqPlay(false)
    setTime(local)
    if (target.id === activeClip?.id || target.source.url === activeClip?.source.url) {
      if (target.id !== activeClip?.id) setActiveId(target.id)
      seekPreview(local)
    } else {
      preview.current?.pause()
      pendingLocal.current = local
      setActiveId(target.id)
    }
  }
  // 클립 끝 다듬기: 시작·끝만 바꾸면 뒤 클립은 시퀀스에서 알아서 당겨지거나 밀린다
  const trimClip = (id: number, start: number, end: number, edge: "start" | "end", commit: boolean) => {
    setSliding(!commit)
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, start, end } : c)))
    setResult(null)
    if (id === activeClip?.id) seekPreview(edge === "start" ? start : Math.max(start, end - 0.001))
  }
  // 프로그램 모니터 막대: 재생 헤드부터 이어서 재생(끝이면 처음부터) · 1프레임 이동 · 처음/끝 · 시작/끝 표시 · 클립 반복
  const [previewZoom, setPreviewZoom] = useState("fit")
  const [saveOpen, setSaveOpen] = useState(false)
  // 저장 안 한 작업: 마지막으로 저장(변환)한 뒤 클립·설정이 바뀌었으면 닫을 때 묻는다
  const workKey = JSON.stringify([clips.map((c) => [c.source.url, c.start, c.end]), format, ratio, fps, colors, speed, repeat, adjust, motion])
  const [savedKey, setSavedKey] = useState("")
  const workKeyRef = useRef(workKey)
  workKeyRef.current = workKey
  useToolDirty(clips.length > 0 && workKey !== savedKey)
  const playFromHead = () => {
    const v = preview.current
    if (!v || !activeClip) return
    if (!v.paused) {
      v.pause()
      setSeqPlay(false)
      return
    }
    if (now >= totalLength - 0.05) {
      playSequence()
      return
    }
    setSeqPlay(true)
    if (v.currentTime < range[0] || v.currentTime >= range[1] - 0.04) v.currentTime = range[0]
    void v.play().catch(() => {})
  }
  const stepFrame = (dir: -1 | 1) => {
    preview.current?.pause()
    seekSequence(Math.min(Math.max(now + dir / Math.max(1, Number(fps)), 0), Math.max(0, totalLength - 0.001)))
  }
  const markIn = () => {
    if (!activeClip) return
    const t = preview.current?.currentTime ?? time
    setRange([Math.min(Math.max(t, 0), range[1] - 0.1), range[1]])
    setResult(null)
  }
  const markOut = () => {
    if (!activeClip || !source) return
    const t = preview.current?.currentTime ?? time
    setRange([range[0], Math.min(Math.max(t, range[0] + 0.1), source.duration)])
    setResult(null)
  }
  const loopClip = () => {
    const v = preview.current
    if (!v) return
    if (!v.paused && !seqPlay) {
      v.pause()
      return
    }
    togglePlay()
  }
  // 단축키(프리미어와 같게): 스페이스 재생 · ←→ 1프레임(Shift = 1초) · Home/End · I/O 시작·끝 표시 · C 자르기 · Delete 고른 클립 삭제
  // ── 되돌리기 기록: 바뀐 뒤 0.35초 손을 멈추면 한 단계로 남긴다(슬라이더·손잡이 끌기는 끌기 한 번 = 한 단계) ──
  type Snap = { clips: Clip[]; media: Source[]; adjust: Adjust; motion: Motion; activeId: number | null }
  const hist = useRef<{ past: Snap[]; present: Snap | null; future: Snap[] }>({ past: [], present: null, future: [] })
  const [histVer, setHistVer] = useState(0) // 버튼 켜기·끄기만 다시 그리게
  const snapNow = useRef<Snap>({ clips, media, adjust, motion, activeId })
  snapNow.current = { clips, media, adjust, motion, activeId: activeClip?.id ?? null }
  const sameSnap = (a: Snap, b: Snap) => a.clips === b.clips && a.media === b.media && a.adjust === b.adjust && a.motion === b.motion
  const record = () => {
    const h = hist.current
    const now = snapNow.current
    if (h.present && sameSnap(h.present, now)) {
      h.present = now // 고른 클립만 바뀐 것은 단계로 남기지 않는다
      return
    }
    if (h.present) h.past.push(h.present)
    if (h.past.length > 100) h.past.shift()
    h.present = now
    h.future = []
    setHistVer((v) => v + 1)
  }
  useEffect(() => {
    const t = setTimeout(record, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, media, adjust, motion])
  const applySnap = (p: Snap) => {
    preview.current?.pause()
    setSeqPlay(false)
    setClips(p.clips)
    setMedia(p.media)
    setAdjust(p.adjust)
    setMotion(p.motion)
    setActiveId(p.clips.some((c) => c.id === p.activeId) ? p.activeId : (p.clips[0]?.id ?? null))
    setResult(null)
    setError(null)
    setHistVer((v) => v + 1)
  }
  const undo = () => {
    record() // 아직 남기지 않은 마지막 변경부터
    const h = hist.current
    const prev = h.past.pop()
    if (!prev || !h.present) return
    h.future.push(h.present)
    h.present = prev
    applySnap(prev)
  }
  const redo = () => {
    record()
    const h = hist.current
    const next = h.future.pop()
    if (!next || !h.present) return
    h.past.push(h.present)
    h.present = next
    applySnap(next)
  }
  void histVer
  const canUndo = hist.current.past.length > 0 || (hist.current.present !== null && !sameSnap(hist.current.present, snapNow.current))
  const canRedo = hist.current.future.length > 0
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keysRef.current = (e: KeyboardEvent) => {
    if (!source || busy || saveOpen) return
    // 확인 창·고르기 목록이 열려 있으면 그쪽이 먼저
    if (document.querySelector('[role=alertdialog], [role=listbox], [role=menu]')) return
    // 글자를 치는 칸에서만 단축키를 쉰다(눈금·버튼·슬라이더에 포커스가 있어도 편집 단축키가 먼저)
    const el = e.target instanceof HTMLElement ? e.target : null
    if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !/^(checkbox|radio|range|button|submit|reset|file|color)$/i.test((el as HTMLInputElement).type)))) return
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
      if (e.code === "KeyY" || e.shiftKey) redo()
      else undo()
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    // 한글 입력 상태에서도 되게 글자(e.key) 대신 키 위치(e.code)로 본다(C = ㅊ, I = ㅑ, O = ㅐ)
    const c = e.code
    if (c === "Space") playFromHead()
    else if (c === "ArrowLeft" || c === "ArrowRight") {
      const d = (c === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / Math.max(1, Number(fps)))
      preview.current?.pause()
      seekSequence(Math.min(Math.max(now + d, 0), Math.max(0, totalLength - 0.001)))
    } else if (c === "Home") seekSequence(0)
    else if (c === "End") seekSequence(Math.max(0, totalLength - 0.001))
    else if (c === "KeyI") markIn()
    else if (c === "KeyO") markOut()
    else if (c === "KeyC") splitAtPlayhead()
    else if (c === "Delete" || c === "Backspace") removeClip() // 고른 클립 삭제
    else return
    // 처리한 키는 포커스된 칸(눈금·버튼 등)으로 넘기지 않는다(두 번 움직이거나 버튼이 눌리지 않게)
    e.preventDefault()
    e.stopPropagation()
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e)
    window.addEventListener("keydown", on, true)
    return () => window.removeEventListener("keydown", on, true)
  }, [])
  const mediaThumb = useClipThumbs(media.map((s) => ({ id: -1, source: s, start: 0, end: s.duration })))
  const clipNo = clips.findIndex((c) => c.id === activeClip?.id) + 1

  return (
    // 프리미어 편집 화면처럼 창 전체를 쓴다: 위 내보내기 막대 · ① 미리보기 · ② 모션 · ③ 색 보정 · ④ 미디어 · ⑤ 타임라인
    <div ref={topRef} className="flex scroll-mt-4 flex-col gap-2 p-2 lg:h-full lg:min-h-0">
      <input
        ref={picker}
        type="file"
        accept="video/*,.mov,.mkv"
        multiple
        hidden
        onChange={(e) => {
          void open([...(e.target.files ?? [])], appendPick.current ? { append: true } : { binOnly: true })
          appendPick.current = false
          e.target.value = ""
        }}
      />

      {/* 창 머리 X 왼쪽: 저장하기(누르면 오른쪽에서 저장 칸이 나온다). 변환 중이면 진행률도 */}
      <ToolHeaderActions>
        {busy && (
          <span className="hidden items-center gap-2 text-xs tabular-nums sm:flex" aria-live="polite">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            {progress.step}… {Math.round(progress.ratio * 100)}%
          </span>
        )}
        {/* 지금 설정으로 만들 때의 예상 용량(설정·클립을 바꾸면 다시 잰다) */}
        {source && !busy && (
          <Tip content={`${F.label} · ${outW}×${outH}px · ${frames}장 · ${fmt(totalLength / Number(speed))}${estimate !== null && estimate > 10 * 1024 * 1024 ? " — 10MB 가 넘습니다" : ""}`}>
            <span
              className={`hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs tabular-nums sm:flex ${
                estimate !== null && estimate > 10 * 1024 * 1024 ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-muted-foreground"
              }`}
              aria-live="polite"
            >
              예상 {F.label}
              <span className="font-semibold text-foreground">{estimate === null ? "재는 중…" : `약 ${formatBytes(estimate)}`}</span>
              {estimating && estimate !== null && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-label="다시 재는 중" />}
              <span className="hidden md:inline">
                · {outW}×{outH} · {frames}장 · {fmt(totalLength / Number(speed))}
              </span>
            </span>
          </Tip>
        )}
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          <History data-icon="inline-start" />
          히스토리
        </Button>
        <Button size="sm" disabled={!source} onClick={() => setSaveOpen(true)}>
          <Save data-icon="inline-start" />
          저장하기
        </Button>
      </ToolHeaderActions>

      {/* 히스토리 칸: 만든 움짤(다시 내려받기 · 불러오기). 불러오면 닫는다 */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>히스토리</SheetTitle>
            <SheetDescription className="break-keep">만든 움짤을 다시 내려받거나, 그때 타임라인·설정을 불러옵니다.</SheetDescription>
          </SheetHeader>
          <SmoothScrollArea className="min-h-0 flex-1 overflow-auto" contentClassName="p-3">
            <ToolHistory<VideoForm>
              tool="video"
              onLoad={(f, h) => {
                setHistoryOpen(false)
                return loadForm(f, h)
              }}
              contain
              fileName={(t, h) => (t.endsWith(`.${h.form.format}`) ? t : `${t}.${h.form.format ?? "webp"}`)}
            />
          </SmoothScrollArea>
        </SheetContent>
      </Sheet>

      {/* 저장 칸: 형식 · 크기 · 장수 · 화질 · 속도 · 반복 · 예상 용량 · 변환 */}
      <Sheet open={saveOpen} onOpenChange={setSaveOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>저장하기</SheetTitle>
            <SheetDescription className="break-keep">형식·크기·화질을 고르고 변환하면 바로 내려받아지고 히스토리에 남습니다.</SheetDescription>
          </SheetHeader>
          <SmoothScrollArea className="min-h-0 flex-1 overflow-auto" contentClassName="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">만들 형식</span>
              <Tabs
                value={format}
                onValueChange={(v) => {
                  const next = v as Format
                  if (next === format || busy) return
                  setFormat(next)
                  // 화질 고르기는 형식마다 다르다(GIF 색 수 / WebP 압축 품질)
                  setColors(FORMATS[next].defaultOption)
                  setResult(null)
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="webp" disabled={busy}>
                    WebP
                  </TabsTrigger>
                  <TabsTrigger value="gif" disabled={busy}>
                    GIF
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="text-xs break-keep text-muted-foreground">
                {format === "gif" ? "어디서나 열리는 움짤. 256색이라 용량이 큽니다." : "같은 화질에 GIF 의 절반 이하 용량. 상세페이지에는 .webp 그대로 올립니다."}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">화면 비율 (가로 860)</span>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="화면 비율">
                  {RATIOS.map((r) => (
                    <Button
                      key={r.value}
                      type="button"
                      variant={ratio === r.value ? "default" : "outline"}
                      size="sm"
                      role="radio"
                      aria-checked={ratio === r.value}
                      disabled={busy}
                      onClick={() => setRatio(r.value)}
                      className="flex h-auto flex-col gap-0 py-1.5"
                    >
                      <span className="font-semibold">{r.label}</span>
                      <span className="text-[11px] opacity-80 tabular-nums">
                        {OUT_W}×{Math.round((OUT_W * r.h) / r.w)}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
              <BarSelect id="gif-fps" label="초당 장수" value={fps} onChange={setFps} disabled={busy} options={FPS.map((f) => ({ value: f, label: `${f}장` }))} />
              <BarSelect id="gif-colors" label="화질" value={colors} onChange={setColors} disabled={busy} options={F.options} />
              <BarSelect
                id="gif-speed"
                label="재생 속도"
                value={speed}
                onChange={setSpeed}
                disabled={busy}
                options={SPEEDS.map((s) => ({ value: s, label: `${s}배${s === "1" ? " (그대로)" : ""}` }))}
              />
              <BarSelect
                id="gif-repeat"
                label="반복"
                value={repeat}
                onChange={setRepeat}
                disabled={busy}
                options={[
                  { value: "0", label: "계속 반복" },
                  { value: "-1", label: "한 번만 재생" },
                ]}
                className="col-span-2"
              />
            </div>
            {/* 예상 용량: 설정을 바꿀 때마다 다시 잰다 */}
            {source && (
              <div
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  estimate !== null && estimate > 10 * 1024 * 1024 ? "border-amber-500/50 bg-amber-500/8" : "bg-muted/40"
                }`}
                aria-live="polite"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs text-muted-foreground">예상 {F.label} 용량</span>
                  <span className="flex items-center gap-2 text-lg font-semibold tabular-nums">
                    {estimate === null ? "재는 중…" : `약 ${formatBytes(estimate)}`}
                    {estimating && estimate !== null && (
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="다시 재는 중" />
                    )}
                  </span>
                </div>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {outW}×{outH}px
                  <br />
                  {frames}장 · {fmt(totalLength / Number(speed))}
                  {multi ? ` · ${clips.length}컷` : ""}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1 text-xs" aria-live="polite">
              {error && <span className="text-destructive">{error}</span>}
              {tooMany && (
                <span className="text-destructive">
                  장수가 너무 많습니다({frames}장, 최대 {MAX_FRAMES}장). 구간을 줄이거나 초당 장수를 낮춰 주세요.
                </span>
              )}
              {!tooMany && estimate !== null && estimate > 10 * 1024 * 1024 && (
                <span className="break-keep text-amber-700 dark:text-amber-300">10MB 가 넘습니다. 가로 크기·초당 장수·화질을 낮추거나 구간을 줄이면 가벼워집니다.</span>
              )}
            </div>
          </SmoothScrollArea>
          <SheetFooter className="border-t">
            {busy ? (
              <div className="flex flex-col gap-2" aria-live="polite">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{progress.step}…</span>
                  <span className="text-lg font-semibold tabular-nums">{Math.round(progress.ratio * 100)}%</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {progress.done} / {frames}장
                  </span>
                  <Button variant="ghost" size="xs" className="ml-auto" onClick={() => cancelRef.current?.()}>
                    취소
                  </Button>
                </div>
                <Progress value={progress.ratio * 100} className="h-2" />
              </div>
            ) : (
              <Button size="lg" className="w-full" disabled={!source || tooMany || totalLength <= 0} onClick={() => void convert()}>
                <Wand2 data-icon="inline-start" />
                {F.label} 로 저장(변환 후 내려받기)
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 히스토리 불러오는 중 · 불러온 설정 안내 */}
      {(fetching || loaded || (error && !saveOpen)) && (
        <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-xs" aria-live="polite">
          {error && !saveOpen && <span className="text-destructive">{error}</span>}
          {fetching && (
            <div className="flex items-center gap-2">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              원본 동영상 불러오는 중… <span className="tabular-nums">{Math.round(fetching.ratio * 100)}%</span>
              <Progress value={fetching.ratio * 100} className="h-1.5 w-40" />
              <span className="truncate text-muted-foreground">{fetching.name}</span>
            </div>
          )}
          {loaded && (
            <div className="flex items-center gap-2">
              <FileInput className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-keep">
                "{loaded.title}" 설정을 불러왔습니다. 이 기록에는 원본 동영상이 없어서 다시 골라야 합니다
                {loaded.form.source ? ` — 원본: ${loaded.form.source} (같은 파일을 고르면 구간 ${fmt(loaded.form.start)}–${fmt(loaded.form.end)}도 채웁니다)` : ""}
              </span>
              <Button variant="ghost" size="icon-xs" aria-label="불러온 설정 안내 닫기" onClick={() => setLoaded(null)}>
                <X />
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,420px)]">
        <div className="grid min-h-0 gap-2 lg:grid-rows-[minmax(0,62fr)_minmax(0,38fr)]">
          <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,22vw,400px)]">
            {/* ① 미리보기(저장할 틀 모양 그대로) */}
            <Panel
              title="미리보기"
              actions={
                source ? (
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {multi ? `${clipNo}번 클립 · ` : ""}
                    {saving ? `원본 히스토리 저장 중 ${Math.round(saving.ratio * 100)}% · ` : ""}
                    {source.file.name} · {source.width}×{source.height} → {outW}×{outH} ({ratio}) · 스페이스 재생 · ←→ 1프레임 · I/O 시작·끝 · C 자르기 · Delete 삭제 · Ctrl+Z 되돌리기
                  </span>
                ) : null
              }
            >
              {source ? (
                <div className="flex min-h-64 flex-1 flex-col gap-2 p-2">
                  <div className="relative flex min-h-0 flex-1 overflow-auto rounded-md bg-neutral-700/60" data-lenis-prevent>
                    {progress && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 text-white backdrop-blur-[2px]">
                        <span className="text-3xl font-bold tabular-nums">{Math.round(progress.ratio * 100)}%</span>
                        <span className="text-sm text-white/80">
                          {progress.step}… {progress.done} / {frames}장
                        </span>
                        <Progress value={progress.ratio * 100} className="h-2 w-2/3 bg-white/20" />
                      </div>
                    )}
                    <div
                      className={previewZoom === "fit" ? "absolute inset-0" : "relative m-auto shrink-0"}
                      style={previewZoom === "fit" ? undefined : { width: source.width * Number(previewZoom), height: source.height * Number(previewZoom) }}
                    >
                    {([0, 1] as const).map((i) => {
                      // 보이는 영상(앞)의 일만 받는다. 뒤 영상은 다음 클립을 미리 여는 데만 쓴다
                      const onFront = (fn: () => void) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
                        if (e.currentTarget === preview.current) fn()
                      }
                      return (
                        <video
                          key={i}
                          ref={(el) => {
                            vids[i].current = el
                            if (frontRef.current === i) preview.current = el
                          }}
                          preload="auto"
                          muted
                          playsInline
                          onTimeUpdate={onFront(onTime)}
                          onSeeked={onFront(onSeeked)}
                          onLoadedMetadata={(e) => (e.currentTarget.defaultPlaybackRate = e.currentTarget.playbackRate = Number(speed))}
                          onPlay={onFront(() => setPlaying(true))}
                          onPause={onFront(() => setPlaying(false))}
                          onClick={onFront(togglePlay)}
                          onLoadedData={onFront(onPreviewReady)}
                          onEnded={onFront(onEnded)}
                          aria-hidden={front !== i}
                          className={`absolute inset-0 size-full object-contain opacity-0 ${front === i ? "cursor-pointer" : "pointer-events-none"}`}
                        />
                      )
                    })}
                    {/* 모션·색 보정 미리보기(바꾼 것이 있을 때만). 누르면 아래 동영상이 받는다 */}
                    <canvas
                      ref={adjustCanvas}
                      aria-hidden
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    />
                    </div>
                  </div>
                  <div data-monitor>
                    <MonitorBar
                      now={now}
                      total={totalLength}
                      fps={Number(fps)}
                      playing={playing && seqPlay}
                      disabled={busy}
                      zoom={previewZoom}
                      onZoom={setPreviewZoom}
                      onSeek={(t) => seekSequence(t)}
                      onPlay={playFromHead}
                      onStep={stepFrame}
                      onHome={() => seekSequence(0)}
                      onEnd={() => seekSequence(Math.max(0, totalLength - 0.001))}
                      onMarkIn={markIn}
                      onMarkOut={markOut}
                      onSplit={splitAtPlayhead}
                      loop={playing && !seqPlay}
                      onLoop={loopClip}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-64 flex-1 p-2">
                  <DropZone dragging={dragging} setDragging={setDragging} onPick={pickImport} onFiles={(f) => void open(f, { binOnly: true })} hasFiles={hasFiles} />
                </div>
              )}
            </Panel>

            {/* ② 모션 */}
            <Panel title="모션" bare scroll>
              {source ? (
                <div className="p-3">
                  <MotionPanel value={motion} onChange={setMotion} srcW={source.width} srcH={source.height} disabled={busy} />
                </div>
              ) : (
                <EmptyNote>동영상을 가져오면 위치·비율·회전·자르기·불투명도를 조절합니다.</EmptyNote>
              )}
            </Panel>
          </div>

          <div className="grid min-h-0 gap-2 lg:grid-cols-[clamp(260px,20vw,360px)_minmax(0,1fr)]">
            {/* ④ 미디어(가져온 동영상) */}
            <Panel
              title={
                <span>
                  미디어 {media.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{media.length}</span>}
                </span>
              }
              actions={
                  <>
                    <Tip content="목록형">
                      <Button variant={mediaView === "list" ? "secondary" : "ghost"} size="icon-xs" aria-label="목록형으로 보기" aria-pressed={mediaView === "list"} onClick={() => setMediaView("list")}>
                        <List />
                      </Button>
                    </Tip>
                    <Tip content="썸네일형">
                      <Button variant={mediaView === "grid" ? "secondary" : "ghost"} size="icon-xs" aria-label="썸네일형으로 보기" aria-pressed={mediaView === "grid"} onClick={() => setMediaView("grid")}>
                        <LayoutGrid />
                      </Button>
                    </Tip>
                    <Tip content="동영상 가져오기">
                      <Button variant="outline" size="icon-xs" aria-label="동영상 가져오기" disabled={busy} onClick={pickImport}>
                        <Upload />
                      </Button>
                    </Tip>
                    {media.length > 0 && (
                      <Tip content="모두 빼기(미디어·타임라인)">
                        <Button variant="ghost" size="icon-xs" aria-label="동영상 모두 빼기" disabled={busy} onClick={reset}>
                          <X />
                        </Button>
                      </Tip>
                    )}
                  </>
              }
              scroll
            >
              {media.length === 0 ? (
                <div
                  className="flex h-full min-h-40 p-2"
                  onDragOver={(e) => {
                    if (!hasFiles(e)) return
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    void open([...e.dataTransfer.files], { binOnly: true })
                  }}
                >
                  <button
                    type="button"
                    onClick={pickImport}
                    className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors ${
                      dragging ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Upload className="size-5" />
                    <span className="font-medium text-foreground">동영상 가져오기</span>
                    <span className="break-keep">고르거나 여기에 끌어 놓으세요(여러 개 가능)</span>
                  </button>
                </div>
              ) : (
                <div
                  className={`p-2 ${dragging ? "bg-primary/5" : ""}`}
                  onDragOver={(e) => {
                    if (!hasFiles(e) || busy) return
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    if (!busy) void open([...e.dataTransfer.files], { binOnly: true })
                  }}
                >
                  <ul className={mediaView === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2" : "flex flex-col gap-1"}>
                    {media.map((s, i) => {
                      const uses = clips.filter((c) => c.source === s).length
                      const thumb = mediaThumb({ id: -1, source: s, start: 0, end: s.duration })
                      return (
                        <li
                          key={s.url}
                          draggable={!busy}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(MEDIA_TYPE, String(i))
                            e.dataTransfer.effectAllowed = "copy"
                          }}
                          onDoubleClick={() => !busy && addToTimeline(s)}
                          className={`group relative cursor-grab rounded-md border bg-background active:cursor-grabbing ${
                            source === s ? "border-primary" : "hover:border-primary/40"
                          } ${mediaView === "grid" ? "flex flex-col overflow-hidden" : "flex items-center gap-2 p-1.5"}`}
                        >
                          <div className={mediaView === "grid" ? "relative aspect-video bg-black" : "relative h-9 w-16 shrink-0 overflow-hidden rounded bg-black"}>
                            {thumb ? (
                              <img src={thumb} alt="" draggable={false} className="size-full object-cover" />
                            ) : (
                              <span className="absolute inset-0 animate-pulse bg-muted-foreground/20 motion-reduce:animate-none" />
                            )}
                            {mediaView === "grid" && (
                              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">{fmt(s.duration)}</span>
                            )}
                          </div>
                          <div className={`flex min-w-0 flex-1 flex-col ${mediaView === "grid" ? "px-1.5 py-1" : ""}`}>
                            <Tip content={s.file.name}>
                              <span className="truncate text-xs font-medium">{s.file.name}</span>
                            </Tip>
                            <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                              {s.width}×{s.height}
                              {mediaView === "list" ? ` · ${fmt(s.duration)}` : ""} · {formatBytes(s.file.size)}
                              {uses > 0 ? ` · 클립 ${uses}` : ""}
                            </span>
                          </div>
                          <div className={`flex gap-0.5 ${mediaView === "grid" ? "absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100" : ""}`}>
                            <Tip content="타임라인 뒤에 붙이기(더블클릭·끌어 놓기도 됨)">
                              <Button variant="secondary" size="icon-xs" aria-label={`${s.file.name} 타임라인에 붙이기`} disabled={busy} onClick={() => addToTimeline(s)}>
                                <Plus />
                              </Button>
                            </Tip>
                            <Tip content="미디어에서 빼기(이 동영상 클립도 빠짐)">
                              <Button variant="secondary" size="icon-xs" aria-label={`${s.file.name} 빼기`} disabled={busy} onClick={() => removeMedia(s)}>
                                <Trash2 />
                              </Button>
                            </Tip>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </Panel>

            {/* ⑤ 타임라인: 고른 클립 구간 다듬기(프레임 띠) + 클립 줄(끌어 놓아 붙이기) */}
            <Panel
              title={
                <span className="flex items-center gap-1.5">
                  <ListVideo className="size-4" />
                  타임라인
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    클립 {clips.length}개 · {fmt(totalLength)}
                  </span>
                </span>
              }
              actions={
                source ? (
                  <>
                    <Tip content="되돌리기 (Ctrl+Z)">
                      <Button variant="ghost" size="icon-xs" aria-label="되돌리기" disabled={busy || !canUndo} onClick={undo}>
                        <Undo2 />
                      </Button>
                    </Tip>
                    <Tip content="다시 실행 (Ctrl+Shift+Z)">
                      <Button variant="ghost" size="icon-xs" aria-label="다시 실행" disabled={busy || !canRedo} onClick={redo}>
                        <Redo2 />
                      </Button>
                    </Tip>
                    <Tip content="재생 위치에서 고른 클립을 둘로 자릅니다(면도칼)">
                      <Button variant="outline" size="xs" disabled={busy} onClick={splitAtPlayhead}>
                        <Scissors data-icon="inline-start" />
                        자르기
                      </Button>
                    </Tip>
                    <Tip content="고른 클립을 바로 뒤에 하나 더 붙입니다">
                      <Button variant="outline" size="xs" disabled={busy} onClick={duplicateClip}>
                        <CopyPlus data-icon="inline-start" />
                        복제
                      </Button>
                    </Tip>
                    <Tip content="고른 클립을 타임라인에서 뺍니다 (Delete)">
                      <Button variant="ghost" size="xs" disabled={busy} onClick={removeClip} aria-label="고른 클립 삭제">
                        <Trash2 data-icon="inline-start" />
                        삭제
                      </Button>
                    </Tip>
                  </>
                ) : null
              }
              scroll
            >
              <div
                className={`flex min-h-full flex-col gap-2 p-2 ${dragging ? "bg-primary/5" : ""}`}
                onDragOver={(e) => {
                  if (busy || (!hasFiles(e) && !e.dataTransfer.types.includes(MEDIA_TYPE))) return
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onTimelineDrop}
              >
                {source ? (
                  <>
                    <SequenceTimeline
                      clips={clips}
                      activeId={activeClip?.id ?? null}
                      now={now}
                      fps={Number(fps)}
                      disabled={busy}
                      onSelect={selectClip}
                      onSeek={(t) => seekSequence(t)}
                      onTrim={trimClip}
                      onReorder={(next) => {
                        setClips(next)
                        setResult(null)
                      }}
                    />
                    <p className="text-xs break-keep text-muted-foreground">
                      눈금·트랙을 누르거나 파란 재생 헤드를 끌면 그 장면이 미리보기에 나오고, 클립 양 끝을 끌면(또는 미리보기 아래 {"{ }"} 버튼·I/O 키) 길이가 바뀌며 뒤 클립이 따라 붙습니다. 클립 몸통을 끌면 순서가 바뀌고(Alt+←→ 도 됨), 미디어의 동영상을 끌어 놓으면 뒤에 붙습니다. 크기는 1번 클립 기준이고, 화면 비율이 다른 클립은 검은 여백을 두고 맞춥니다.
                    </p>
                  </>
                ) : (
                  <EmptyNote>미디어의 동영상을 여기로 끌어 놓거나 ＋ 를 누르면 타임라인을 만듭니다.</EmptyNote>
                )}
              </div>
            </Panel>
          </div>
        </div>

        {/* ③ 색 보정 */}
        <Panel title="색 보정" bare scroll>
          {source ? (
            <div className="p-3">
              <AdjustPanel value={adjust} onChange={setAdjust} disabled={busy} />
            </div>
          ) : (
            <EmptyNote>동영상을 가져오면 노출·감마·색조·채도·명도를 보정합니다.</EmptyNote>
          )}
        </Panel>
      </div>
    </div>
  )
}

// 편집 화면 칸(프리미어 패널처럼): 위 제목 줄 + 내용. scroll 이면 내용만 따로 스크롤(부드럽게)
// bare: 안쪽 칸(모션·색 보정)이 제목·기본값 버튼을 가지고 있어 머리 줄을 그리지 않는다(제목은 화면 읽기용으로만)
function Panel({ title, actions, scroll, bare, children }: { title: React.ReactNode; actions?: React.ReactNode; scroll?: boolean; bare?: boolean; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card" aria-label={typeof title === "string" ? title : undefined}>
      {!bare && (
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 border-b px-2 py-1">
          <h3 className="mr-auto text-sm font-semibold">{title}</h3>
          {actions}
        </div>
      )}
      {scroll ? (
        <SmoothScrollArea className="min-h-0 flex-1 overflow-auto" contentClassName="h-full">
          {children}
        </SmoothScrollArea>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      )}
    </section>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full min-h-24 items-center justify-center p-4 text-center text-xs break-keep text-muted-foreground">{children}</p>
}

// 내보내기 막대의 작은 고르기 칸(이름 위 · 칸 아래)
function BarSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// 처음 화면(① 미리보기 자리): 동영상 가져오기
function DropZone({
  dragging,
  setDragging,
  onPick,
  onFiles,
  hasFiles,
}: {
  dragging: boolean
  setDragging: (v: boolean) => void
  onPick: () => void
  onFiles: (files: File[]) => void
  hasFiles: (e: React.DragEvent) => boolean
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onFiles([...e.dataTransfer.files])
      }}
      className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center text-sm transition-colors ${
        dragging ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground hover:bg-muted/40"
      }`}
    >
      <Upload className="size-7" />
      <span className="font-medium text-foreground">동영상 가져오기</span>
      <span className="break-keep">
        MP4·MOV·WebM 을 고르거나 여기에 끌어 놓으세요.
        <br />
        여러 개를 고르면 미디어에 들어가고, 처음 고른 영상들은 타임라인에 순서대로 올라갑니다.
      </span>
    </button>
  )
}

// ── 색 보정 칸: 포토샵 노출 창(노출·오프셋·감마 교정) + 색조/채도(색조·채도·명도) ──
type AdjustKey = keyof Adjust
type AdjustRow = { key: AdjustKey; label: string; min: number; max: number; step: number; digits: number; group: string }
const ADJUST_ROWS: AdjustRow[] = [
  { key: "exposure", label: "노출", min: -5, max: 5, step: 0.01, digits: 2, group: "노출" },
  { key: "offset", label: "오프셋", min: -0.5, max: 0.5, step: 0.001, digits: 3, group: "노출" },
  { key: "gamma", label: "감마 교정", min: 0.1, max: 9.99, step: 0.01, digits: 2, group: "노출" },
  { key: "hue", label: "색조", min: -180, max: 180, step: 1, digits: 0, group: "색조/채도" },
  { key: "saturation", label: "채도", min: -100, max: 100, step: 1, digits: 0, group: "색조/채도" },
  { key: "lightness", label: "명도", min: -100, max: 100, step: 1, digits: 0, group: "색조/채도" },
]
// 감마 슬라이더는 가운데가 1 이 되게 로그 눈금(0.1 ~ 1 ~ 9.99)
const gammaToPos = (g: number) => Math.log10(g)
const posToGamma = (p: number) => Math.round(10 ** p * 100) / 100
const showNum = (row: AdjustRow, v: number) => (row.key === "gamma" ? v.toFixed(2) : (v > 0 ? "+" : "") + v.toFixed(row.digits))

function AdjustPanel({ value, onChange, disabled }: { value: Adjust; onChange: (a: Adjust) => void; disabled?: boolean }) {
  // 입력 칸에 치는 중인 글자(다 치기 전 "-" "0." 같은 것도 그대로 보이게)
  const [drafts, setDrafts] = useState<Partial<Record<AdjustKey, string>>>({})
  const set = (key: AdjustKey, v: number) => onChange({ ...value, [key]: v })
  const clearDraft = (key: AdjustKey) =>
    setDrafts((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  return (
    <Field>
      <FieldLabel>
        <SlidersHorizontal className="size-4" />
        색 보정
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={disabled || isNoAdjust(value)}
          onClick={() => {
            setDrafts({})
            onChange(NO_ADJUST)
          }}
        >
          <RotateCcw data-icon="inline-start" />
          기본값
        </Button>
      </FieldLabel>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        {ADJUST_ROWS.map((row, i) => {
          const v = value[row.key]
          const gamma = row.key === "gamma"
          return (
            <div key={row.key} className="flex flex-col gap-1.5">
              {(i === 0 || ADJUST_ROWS[i - 1].group !== row.group) && (
                <span className={`text-xs font-medium text-muted-foreground ${i > 0 ? "mt-1 border-t pt-3" : ""}`}>{row.group}</span>
              )}
              <div className="flex items-center gap-3">
                <label htmlFor={`adj-${row.key}`} className="w-16 shrink-0 text-sm">
                  {row.label}
                </label>
                <Slider
                  min={gamma ? gammaToPos(row.min) : row.min}
                  max={gamma ? gammaToPos(row.max) : row.max}
                  step={gamma ? 0.001 : row.step}
                  value={[gamma ? gammaToPos(v) : v]}
                  disabled={disabled}
                  onValueChange={([x]) => {
                    clearDraft(row.key)
                    set(row.key, gamma ? posToGamma(x) : Number(x.toFixed(row.digits)))
                  }}
                  aria-label={row.label}
                  className="flex-1"
                />
                <Tip content={"두 번 누르면 기본값"} wrap><Input
                  id={`adj-${row.key}`}
                  value={drafts[row.key] ?? showNum(row, v)}
                  disabled={disabled}
                  inputMode="decimal"
                  className="h-8 w-20 text-right tabular-nums"
                  onChange={(e) => {
                    const text = e.target.value
                    setDrafts((d) => ({ ...d, [row.key]: text }))
                    const n = Number(text)
                    if (text.trim() !== "" && Number.isFinite(n)) set(row.key, Math.min(row.max, Math.max(row.min, n)))
                  }}
                  onBlur={() => clearDraft(row.key)}
                  onDoubleClick={() => {
                    clearDraft(row.key)
                    set(row.key, NO_ADJUST[row.key])
                  }}
                /></Tip>
              </div>
            </div>
          )
        })}
      </div>
      <FieldDescription className="break-keep">포토샵 노출·색조/채도와 같은 방식입니다. 미리보기와 만드는 파일에 그대로 들어갑니다.</FieldDescription>
    </Field>
  )
}

// ── 모션 칸: 프리미어 프로 효과 컨트롤의 "모션"·"불투명도"와 같은 칸. 파란 숫자를 좌우로 끌면 바뀌고(Shift = 10배), 누르면 직접 입력 ──
function Scrub({
  value,
  onChange,
  step,
  digits,
  min = -Infinity,
  max = Infinity,
  suffix = "",
  label,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  digits: number
  min?: number
  max?: number
  suffix?: string
  label: string
  disabled?: boolean
}) {
  const [edit, setEdit] = useState<string | null>(null)
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(digits))))
  const commit = () => {
    const n = Number(edit)
    if (edit !== null && edit.trim() !== "" && Number.isFinite(n)) onChange(clamp(n))
    setEdit(null)
  }
  if (edit !== null)
    return (
      <Input
        autoFocus
        aria-label={label}
        value={edit}
        inputMode="decimal"
        className="h-7 w-20 px-1.5 text-right text-sm tabular-nums"
        onChange={(e) => setEdit(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEdit(null)
        }}
      />
    )
  return (
    <button
      type="button"
      aria-label={`${label} ${value.toFixed(digits)}${suffix}`}
      disabled={disabled}
      className="cursor-ew-resize rounded px-1 text-sm text-sky-600 tabular-nums select-none hover:underline disabled:cursor-default disabled:opacity-50 dark:text-sky-400"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, v: value, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (Math.abs(dx) > 2) d.moved = true
        if (d.moved) onChange(clamp(d.v + dx * step * (e.shiftKey ? 10 : 1)))
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) setEdit(value.toFixed(digits))
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clamp(value + step * (e.shiftKey ? 10 : 1)))
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clamp(value - step * (e.shiftKey ? 10 : 1)))
        else return
        e.preventDefault()
      }}
    >
      {value.toFixed(digits)}
      {suffix}
    </button>
  )
}

function MotionPanel({
  value,
  onChange,
  srcW,
  srcH,
  disabled,
}: {
  value: Motion
  onChange: (m: Motion) => void
  srcW: number
  srcH: number
  disabled?: boolean
}) {
  const set = (patch: Partial<Motion>) => onChange({ ...value, ...patch })
  const x = value.x ?? srcW / 2
  const y = value.y ?? srcH / 2
  const ax = value.ax ?? srcW / 2
  const ay = value.ay ?? srcH / 2
  type Row = { label: string; changed: boolean; reset: Partial<Motion>; body: React.ReactNode; dim?: boolean }
  const crop = (key: "cropL" | "cropT" | "cropR" | "cropB", label: string): Row => ({
    label,
    changed: value[key] !== 0,
    reset: { [key]: 0 },
    body: <Scrub label={label} value={value[key]} step={0.1} digits={1} min={0} max={100} suffix=" %" disabled={disabled} onChange={(v) => set({ [key]: v })} />,
  })
  const rows: Row[] = [
    {
      label: "위치",
      changed: x !== srcW / 2 || y !== srcH / 2,
      reset: { x: null, y: null },
      body: (
        <>
          <Scrub label="위치 가로" value={x} step={1} digits={1} disabled={disabled} onChange={(v) => set({ x: v })} />
          <Scrub label="위치 세로" value={y} step={1} digits={1} disabled={disabled} onChange={(v) => set({ y: v })} />
        </>
      ),
    },
    {
      label: "비율 조정",
      changed: value.scale !== 100,
      reset: { scale: 100 },
      body: <Scrub label="비율 조정" value={value.scale} step={0.5} digits={1} min={0} max={10000} disabled={disabled} onChange={(v) => set({ scale: v })} />,
    },
    {
      label: "폭 비율 조정",
      changed: !value.uniform && value.scaleW !== 100,
      reset: { scaleW: 100 },
      dim: value.uniform,
      body: (
        <Scrub
          label="폭 비율 조정"
          value={value.uniform ? value.scale : value.scaleW}
          step={0.5}
          digits={1}
          min={0}
          max={10000}
          disabled={disabled || value.uniform}
          onChange={(v) => set({ scaleW: v })}
        />
      ),
    },
    {
      label: "",
      changed: false,
      reset: {},
      body: (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.uniform}
            disabled={disabled}
            onCheckedChange={(on) => set(on === true ? { uniform: true } : { uniform: false, scaleW: value.scale })}
          />
          균일 비율
        </label>
      ),
    },
    {
      label: "회전",
      changed: value.rotation !== 0,
      reset: { rotation: 0 },
      body: <Scrub label="회전" value={value.rotation} step={0.5} digits={1} suffix="°" disabled={disabled} onChange={(v) => set({ rotation: v })} />,
    },
    {
      label: "기준점",
      changed: ax !== srcW / 2 || ay !== srcH / 2,
      reset: { ax: null, ay: null },
      body: (
        <>
          <Scrub label="기준점 가로" value={ax} step={1} digits={1} disabled={disabled} onChange={(v) => set({ ax: v })} />
          <Scrub label="기준점 세로" value={ay} step={1} digits={1} disabled={disabled} onChange={(v) => set({ ay: v })} />
        </>
      ),
    },
    {
      label: "깜박임 제거 필터",
      changed: value.flicker !== 0,
      reset: { flicker: 0 },
      body: <Scrub label="깜박임 제거 필터" value={value.flicker} step={0.01} digits={2} min={0} max={1} disabled={disabled} onChange={(v) => set({ flicker: v })} />,
    },
    crop("cropL", "왼쪽 자르기"),
    crop("cropT", "위쪽 자르기"),
    crop("cropR", "오른쪽 자르기"),
    crop("cropB", "아래쪽 자르기"),
  ]
  const opacityRow: Row = {
    label: "불투명도",
    changed: value.opacity !== 100,
    reset: { opacity: 100 },
    body: <Scrub label="불투명도" value={value.opacity} step={0.5} digits={1} min={0} max={100} suffix=" %" disabled={disabled} onChange={(v) => set({ opacity: v })} />,
  }
  const line = (r: Row, i: number) => (
    <div key={r.label || `row-${i}`} className="flex min-h-8 items-center gap-2">
      <span className={`w-28 shrink-0 text-sm ${r.dim ? "text-muted-foreground/60" : ""}`}>{r.label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{r.body}</div>
      {r.label && (
        <Tip content={`${r.label} 기본값`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`${r.label} 기본값`}
            disabled={disabled || !r.changed}
            onClick={() => set(r.reset)}
          >
            <RotateCcw />
          </Button>
        </Tip>
      )}
    </div>
  )
  return (
    <Field>
      <FieldLabel>
        <Move className="size-4" />
        모션
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={disabled || isNoMotion(value, srcW, srcH)}
          onClick={() => onChange(NO_MOTION)}
        >
          <RotateCcw data-icon="inline-start" />
          기본값
        </Button>
      </FieldLabel>
      <div className="flex flex-col gap-0.5 rounded-lg border p-3">
        {rows.map(line)}
        <span className="mt-2 border-t pt-3 text-xs font-medium text-muted-foreground">불투명도</span>
        {line(opacityRow, rows.length)}
      </div>
      <FieldDescription className="break-keep">
        프리미어 프로 효과 컨트롤과 같은 방식입니다. 파란 숫자를 좌우로 끌면 바뀌고(Shift 를 누르면 10배), 누르면 직접 입력합니다. 위치·기준점은 원본({srcW}×{srcH}) 픽셀 기준이고, 비는 곳은 검정으로 채웁니다.
      </FieldDescription>
    </Field>
  )
}
