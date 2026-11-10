import { useEffect, useRef, useState } from "react"
import { CopyPlus, Download, FileInput, LayoutGrid, List, ListVideo, LoaderCircle, Move, Pause, Play, Plus, RotateCcw, Scissors, SlidersHorizontal, Trash2, Upload, Wand2, X } from "lucide-react"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

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
import { drawWithMotion, isNoMotion, NO_MOTION, type Motion } from "@/components/tools/video-motion"
import { Tip } from "@/components/tip"

// 동영상 → GIF · 동영상 → WebP: 동영상 파일(MP4·MOV·WebM)을 골라 구간·크기·초당 장수를 정하고 GIF(또는 움직이는 WebP)로 바꾼다.
// 서버에 올리지 않고 이 브라우저 안에서 바꾼다. 장면을 한 장씩 뽑아(canvas) Web Worker 가 GIF·WebP 로 묶는다.
// 두 도구는 화면이 같고 만드는 형식(FORMATS)만 다르다.

const WIDTHS = [
  { value: "860", label: "860px (상세페이지)" },
  { value: "640", label: "640px" },
  { value: "480", label: "480px" },
  { value: "320", label: "320px" },
  { value: "0", label: "원본 크기" },
]
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
// 클립 한 장면을 출력 캔버스에 그린다. 첫 클립과 화면 비율이 다르면 비율을 지켜 가운데에 맞추고 남는 곳은 검정(프리미어 시퀀스와 같다)
function drawClipFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  src: Source,
  outW: number,
  outH: number,
  motion: Motion,
  tmp: { canvas?: HTMLCanvasElement },
) {
  const same = Math.abs(src.width / src.height - outW / outH) < 0.01
  if (same) {
    drawWithMotion(ctx, video, src.width, src.height, outW, outH, motion)
    return
  }
  const k = Math.min(outW / src.width, outH / src.height)
  const fw = Math.max(1, Math.round(src.width * k))
  const fh = Math.max(1, Math.round(src.height * k))
  const c = (tmp.canvas ??= document.createElement("canvas"))
  if (c.width !== fw || c.height !== fh) {
    c.width = fw
    c.height = fh
  }
  const tctx = c.getContext("2d")!
  tctx.imageSmoothingQuality = "high"
  drawWithMotion(tctx, video, src.width, src.height, fw, fh, motion)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(c, Math.round((outW - fw) / 2), Math.round((outH - fh) / 2))
}

// 히스토리에 남기는 설정(원본 동영상은 남기지 않는다. 불러오면 형식·크기·화질·속도·반복·색 보정을 채운다)
type VideoForm = {
  format: Format
  width: string
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
      drawWithMotion(ctx, video, video.videoWidth, video.videoHeight, w, h, motion)
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

// 프레임 띠 칸 수
const STRIP = 12

// 미리보기 아래 프레임 띠: 고른 구간 밖은 어둡게, 구간은 테두리, 재생 위치는 세로선. 누르거나 끌면 그 장면으로 옮긴다.
function FrameStrip({
  thumbs,
  duration,
  range,
  time,
  disabled,
  onRange,
  onSeek,
}: {
  thumbs: (string | null)[]
  duration: number
  range: [number, number]
  time: number
  disabled?: boolean
  onRange: (range: [number, number], commit: boolean) => void
  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = (t: number) => `${(Math.min(Math.max(t / duration, 0), 1) * 100).toFixed(3)}%`
  const timeAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.round(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * duration * 10) / 10
  }
  const at = (e: React.PointerEvent) => onSeek(timeAt(e))
  // 구간 테두리 왼쪽·오른쪽 손잡이를 끌어 구간을 바꾼다(최소 0.1초)
  const edge = (side: 0 | 1) => {
    const next = (e: React.PointerEvent): [number, number] => {
      const t = timeAt(e)
      return side === 0 ? [Math.min(t, range[1] - 0.1), range[1]] : [range[0], Math.max(t, range[0] + 0.1)]
    }
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.stopPropagation()
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove: (e: React.PointerEvent) => {
        e.stopPropagation()
        if (!disabled && e.buttons === 1) onRange(next(e), false)
      },
      onPointerUp: (e: React.PointerEvent) => {
        e.stopPropagation()
        if (!disabled) onRange(next(e), true)
      },
    }
  }
  return (
    <div
      ref={ref}
      className="relative h-16 cursor-pointer touch-none overflow-hidden rounded-lg border bg-muted select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        at(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && at(e)}
      role="slider"
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(time * 10) / 10}
      aria-valuetext={fmt(time)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 0.1))
        if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 0.1))
      }}
    >
      <div className="flex h-full">
        {thumbs.map((url, i) =>
          url ? (
            <img key={i} src={url} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
          ) : (
            <div key={i} className="h-full min-w-0 flex-1 animate-pulse border-r border-background/40 bg-muted-foreground/15 motion-reduce:animate-none" />
          ),
        )}
      </div>
      {/* 구간 밖은 어둡게 */}
      <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(range[0]) }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(range[1]) }} />
      <div
        className="pointer-events-none absolute inset-y-0 rounded-sm border-y-2 border-primary"
        style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }}
      />
      {([0, 1] as const).map((side) => (
        <div
          key={side}
          {...edge(side)}
          role="slider"
          aria-label={side === 0 ? "구간 시작" : "구간 끝"}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={range[side]}
          className={`absolute inset-y-0 z-10 flex w-3 cursor-ew-resize items-center justify-center bg-primary ${side === 0 ? "rounded-l-md" : "-translate-x-full rounded-r-md"}`}
          style={{ left: pct(range[side]) }}
        >
          <span className="h-5 w-0.5 rounded-full bg-primary-foreground/70" />
        </div>
      ))}
      {/* 재생 위치 */}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: pct(time) }} />
    </div>
  )
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

// 타임라인: 클립을 길이 비율대로 옆으로 늘어놓는다. 누르면 그 클립을 고르고(구간·프레임 띠가 그 클립으로 바뀐다), 끌어서 순서를 바꾼다.
function Timeline({
  clips,
  activeId,
  disabled,
  onSelect,
  onReorder,
}: {
  clips: Clip[]
  activeId: number | null
  disabled?: boolean
  onSelect: (id: number) => void
  onReorder: (next: Clip[]) => void
}) {
  const thumbOf = useClipThumbs(clips)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const total = clips.reduce((s, c) => s + clipLen(c), 0) || 1
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (disabled || !over || active.id === over.id) return
    const from = clips.findIndex((c) => c.id === active.id)
    const to = clips.findIndex((c) => c.id === over.id)
    if (from >= 0 && to >= 0) onReorder(arrayMove(clips, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={clips.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1" role="listbox" aria-label="타임라인 클립">
          {clips.map((c, i) => (
            <TimelineClip
              key={c.id}
              clip={c}
              index={i}
              thumb={thumbOf(c)}
              grow={clipLen(c) / total}
              active={c.id === activeId}
              disabled={disabled}
              onSelect={() => onSelect(c.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function TimelineClip({
  clip,
  index,
  thumb,
  grow,
  active,
  disabled,
  onSelect,
}: {
  clip: Clip
  index: number
  thumb: string | null
  grow: number
  active: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id, disabled })
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={active}
      aria-label={`${index + 1}번 클립 ${clip.source.file.name} ${fmt(clip.start)}–${fmt(clip.end)}`}
      onClick={onSelect}
      style={{ transform: CSS.Translate.toString(transform), transition, flexGrow: grow, flexBasis: 0 }}
      className={`relative h-16 min-w-20 cursor-grab touch-none overflow-hidden rounded-md border-2 bg-black text-left active:cursor-grabbing ${
        active ? "border-primary" : "border-transparent hover:border-primary/40"
      } ${isDragging ? "z-10 opacity-80 shadow-lg" : ""}`}
    >
      {thumb ? (
        <img src={thumb} alt="" draggable={false} className="absolute inset-0 size-full object-cover opacity-80" />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-muted-foreground/20 motion-reduce:animate-none" />
      )}
      <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white tabular-nums">{index + 1}</span>
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-0.5 text-[11px] text-white tabular-nums">
        {fmt(clipLen(clip))} · {clip.source.file.name}
      </span>
    </button>
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
  const [mediaTab, setMediaTab] = useState<"media" | "history">("media")
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
  const [width, setWidth] = useState("860")
  const [fps, setFps] = useState("25")
  // 화질: GIF 는 색 수, WebP 는 압축 품질
  const [colors, setColors] = useState(F.defaultOption)
  const [speed, setSpeed] = useState("1")
  const [repeat, setRepeat] = useState("0")
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST) // 색 보정(노출·오프셋·감마·색조·채도·명도)
  const adjusted = !isNoAdjust(adjust)
  const [motion, setMotion] = useState<Motion>(NO_MOTION) // 모션·불투명도(위치·비율·회전·기준점·깜박임 제거·자르기)
  const moved = source ? !isNoMotion(motion, source.width, source.height) : false
  const adjustCanvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ step: string; ratio: number; done: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLVideoElement>(null)
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
  const urlsRef = useRef(new Set<string>())
  useEffect(() => {
    const used = new Set([...clips.map((c) => c.source.url), ...media.map((s) => s.url)])
    for (const u of urlsRef.current) if (!used.has(u)) URL.revokeObjectURL(u)
    urlsRef.current = used
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
  // 처음 한 개는 앞 5초(짧으면 전체), 뒤에 붙이는 영상은 전체 길이. 불러온 설정과 같은 동영상이면 그때 구간
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
        return same ? newClip(s, Math.min(want.form.start, s.duration), Math.min(want.form.end, s.duration)) : newClip(s, 0, Math.min(s.duration, 5))
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
      nextClip()
      return
    }
    if (v.currentTime >= range[1] || v.currentTime < range[0] - 0.05) v.currentTime = range[0]
  }
  // 전체 재생: 다음 클립(마지막이면 처음)으로 넘어가 그 클립 시작부터 이어서 재생한다
  const nextClip = () => {
    const v = preview.current
    if (!v || !activeClip) return
    const i = clips.findIndex((c) => c.id === activeClip.id)
    const next = clips[(i + 1) % clips.length]
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
    if (isNoAdjust(adjustRef.current) && isNoMotion(motionRef.current, v.videoWidth, v.videoHeight)) return
    const w = Math.min(860, v.videoWidth)
    const h = Math.max(1, Math.round((v.videoHeight * w) / v.videoWidth))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext("2d", { willReadFrequently: true })!
    drawWithMotion(ctx, v, v.videoWidth, v.videoHeight, w, h, motionRef.current)
    if (isNoAdjust(adjustRef.current)) return
    const img = ctx.getImageData(0, 0, w, h)
    applyAdjust(img.data, adjustRef.current)
    ctx.putImageData(img, 0, 0)
  }
  useEffect(() => {
    drawAdjusted()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust, motion, result])

  // 재생 위치(프레임 띠의 세로선). 재생 중에는 화면 그릴 때마다 따라간다
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (preview.current) setTime(preview.current.currentTime)
      drawAdjusted()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // 프레임 띠: 영상 전체에서 고르게 장면을 뽑아 작은 그림으로 늘어놓는다(하나씩 채워진다)
  const [thumbs, setThumbs] = useState<(string | null)[]>([])
  // 클립을 오가도 같은 동영상 띠는 다시 뽑지 않는다
  const thumbCache = useRef(new Map<string, (string | null)[]>())
  useEffect(() => {
    if (!source) return
    const cached = thumbCache.current.get(source.url)
    if (cached && cached.every(Boolean)) {
      setThumbs(cached)
      return
    }
    let alive = true
    const video = document.createElement("video")
    video.muted = true
    video.preload = "auto"
    video.src = source.url
    const h = 72
    const w = Math.round((source.width * h) / source.height)
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!
    setThumbs(Array(STRIP).fill(null))
    video.onloadeddata = async () => {
      for (let i = 0; i < STRIP && alive; i++) {
        try {
          await seek(video, Math.min(((i + 0.5) * source.duration) / STRIP, source.duration - 0.001))
        } catch {
          return
        }
        if (!alive) return
        ctx.drawImage(video, 0, 0, w, h)
        const url = canvas.toDataURL("image/jpeg", 0.7)
        setThumbs((list) => {
          const next = list.map((v, j) => (j === i ? url : v))
          thumbCache.current.set(source.url, next)
          return next
        })
      }
      video.removeAttribute("src")
      video.load()
    }
    return () => {
      alive = false
      video.removeAttribute("src")
      video.load()
    }
  }, [source])
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
  // 손을 떼면 고른 구간을 처음부터 바로 재생한다
  const playRange = (start: number) => {
    const v = preview.current
    if (!v) return
    pendingSeek.current = null
    v.currentTime = start
    void v.play().catch(() => {})
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
  const outW = first ? Math.min(Number(width) || first.width, first.width) : 0
  const outH = first ? Math.max(1, Math.round((first.height * outW) / first.width)) : 0
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
      const tmp: { canvas?: HTMLCanvasElement } = {}
      // 클립을 순서대로 이어 붙인다(클립마다 시작부터 초당 장수만큼)
      for (const c of seqClips) {
        if (cancelled) return
        await load(c.source.url)
        const n = clipFrames(c)
        for (let i = 0; i < n; i++) {
          if (cancelled) return
          await seek(video, Math.min(c.start + i / Number(fps), c.end - 0.001, c.source.duration - 0.001))
          drawClipFrame(ctx, video, c.source, outW, outH, motion, tmp)
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
      // 만든 움짤과 설정을 히스토리에 남긴다(제목 = 만든 파일 이름. 같은 동영상도 WebP·GIF 는 따로 보인다)
      if (blob.size <= HISTORY_MAX) {
        const head = seqClips[0]
        const form: VideoForm = { format, width, fps, colors, speed, repeat, adjust, motion, source: head.source.file.name, start: head.start, end: head.end, outW, outH, frames, size: blob.size }
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

  const download = () => {
    if (!result) return
    const a = document.createElement("a")
    a.href = result.url
    a.download = result.name
    a.click()
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
  const pickMore = () => {
    appendPick.current = true
    picker.current?.click()
  }
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

      {/* 내보내기 막대: 형식 · 크기 · 장수 · 화질 · 속도 · 반복 · 예상 용량 · 변환 */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex flex-col gap-1">
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
            <TabsList>
              <TabsTrigger value="webp" disabled={busy}>
                WebP
              </TabsTrigger>
              <TabsTrigger value="gif" disabled={busy}>
                GIF
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <BarSelect id="gif-width" label="가로 크기" value={width} onChange={setWidth} disabled={busy} options={WIDTHS} className="w-40" />
        <BarSelect id="gif-fps" label="초당 장수" value={fps} onChange={setFps} disabled={busy} options={FPS.map((f) => ({ value: f, label: `${f}장` }))} className="w-24" />
        <BarSelect id="gif-colors" label="화질" value={colors} onChange={setColors} disabled={busy} options={F.options} className="w-36" />
        <BarSelect
          id="gif-speed"
          label="재생 속도"
          value={speed}
          onChange={setSpeed}
          disabled={busy}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}배${s === "1" ? " (그대로)" : ""}` }))}
          className="w-32"
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
          className="w-32"
        />
        {/* 예상 용량: 설정을 바꿀 때마다 다시 잰다 */}
        {source && (
          <div
            className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
              estimate !== null && estimate > 10 * 1024 * 1024 ? "border-amber-500/50 bg-amber-500/8" : "bg-muted/40"
            }`}
            aria-live="polite"
          >
            <span className="text-xs text-muted-foreground">예상 {F.label}</span>
            <span className="font-semibold tabular-nums">{estimate === null ? "재는 중…" : `약 ${formatBytes(estimate)}`}</span>
            {estimating && estimate !== null && (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="다시 재는 중" />
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {outW}×{outH} · {frames}장 · {fmt(totalLength / Number(speed))}
              {multi ? ` · ${clips.length}컷` : ""}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {busy ? (
            <div className="flex h-9 min-w-64 items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 text-sm" aria-live="polite">
              <span className="font-medium">{progress.step}…</span>
              <span className="font-semibold tabular-nums">{Math.round(progress.ratio * 100)}%</span>
              <Progress value={progress.ratio * 100} className="h-1.5 w-24" />
              <Button variant="ghost" size="xs" onClick={() => cancelRef.current?.()}>
                취소
              </Button>
            </div>
          ) : (
            <Button disabled={!source || tooMany || totalLength <= 0} onClick={() => void convert()}>
              <Wand2 data-icon="inline-start" />
              {F.label} 로 변환 후 내려받기
            </Button>
          )}
        </div>
        {(error || tooMany || (estimate !== null && estimate > 10 * 1024 * 1024) || (first && outW < (Number(width) || 0))) && (
          <div className="flex w-full flex-col gap-0.5 text-xs" aria-live="polite">
            {error && <span className="text-destructive">{error}</span>}
            {tooMany && (
              <span className="text-destructive">
                장수가 너무 많습니다({frames}장, 최대 {MAX_FRAMES}장). 구간을 줄이거나 초당 장수를 낮춰 주세요.
              </span>
            )}
            {!tooMany && estimate !== null && estimate > 10 * 1024 * 1024 && (
              <span className="text-amber-700 dark:text-amber-300">10MB 가 넘습니다. 가로 크기·초당 장수·화질을 낮추거나 구간을 줄이면 가벼워집니다.</span>
            )}
            {first && outW < (Number(width) || 0) && <span className="text-muted-foreground">원본보다 크게는 만들지 않습니다.</span>}
          </div>
        )}
        {fetching && (
          <div className="flex w-full items-center gap-2 text-xs" aria-live="polite">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            원본 동영상 불러오는 중… <span className="tabular-nums">{Math.round(fetching.ratio * 100)}%</span>
            <Progress value={fetching.ratio * 100} className="h-1.5 w-40" />
            <span className="truncate text-muted-foreground">{fetching.name}</span>
          </div>
        )}
        {loaded && (
          <div className="flex w-full items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs" aria-live="polite">
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

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,24vw,420px)]">
        <div className="grid min-h-0 gap-2 lg:grid-rows-[minmax(0,62fr)_minmax(0,38fr)]">
          <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_clamp(300px,22vw,400px)]">
            {/* ① 미리보기(결과가 있으면 결과) */}
            <Panel
              title={result ? `결과 ${F.label}` : "미리보기"}
              actions={
                result ? (
                  <>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {result.width}×{result.height} · {result.frames}장 · {formatBytes(result.size)}
                    </span>
                    <Button variant="outline" size="xs" onClick={() => setResult(null)}>
                      <RotateCcw data-icon="inline-start" />
                      다시 설정
                    </Button>
                    <Button size="xs" onClick={download}>
                      <Download data-icon="inline-start" />
                      내려받기
                    </Button>
                  </>
                ) : source ? (
                  <span className="text-xs text-muted-foreground">
                    {seqPlay ? "클립을 순서대로 이어서 보여 줍니다" : multi ? "고른 클립 구간만 반복합니다 · 전체 재생은 이어서" : "고른 구간만 반복해서 보여 줍니다"}
                  </span>
                ) : null
              }
            >
              {result ? (
                <div className="flex min-h-64 flex-1 flex-col gap-2 p-2">
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
                    <img src={result.url} alt={`${result.name} 미리보기`} className="max-h-full max-w-full object-contain" />
                  </div>
                  {saving && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                      원본 동영상을 히스토리에 저장하는 중… <span className="tabular-nums">{Math.round(saving.ratio * 100)}%</span>
                    </p>
                  )}
                  {result.size > 10 * 1024 * 1024 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">10MB 가 넘습니다. 쇼핑몰에 올리기 무거우면 가로 크기·초당 장수·화질을 낮추거나 구간을 줄여 보세요.</p>
                  )}
                </div>
              ) : source ? (
                <div className="flex min-h-64 flex-1 flex-col gap-2 p-2">
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-black">
                    {progress && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 text-white backdrop-blur-[2px]">
                        <span className="text-3xl font-bold tabular-nums">{Math.round(progress.ratio * 100)}%</span>
                        <span className="text-sm text-white/80">
                          {progress.step}… {progress.done} / {frames}장
                        </span>
                        <Progress value={progress.ratio * 100} className="h-2 w-2/3 bg-white/20" />
                      </div>
                    )}
                    <video
                      ref={preview}
                      src={source.url}
                      preload="auto"
                      muted
                      playsInline
                      onTimeUpdate={onTime}
                      onSeeked={onSeeked}
                      onLoadedMetadata={(e) => (e.currentTarget.defaultPlaybackRate = e.currentTarget.playbackRate = Number(speed))}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onClick={togglePlay}
                      onLoadedData={onPreviewReady}
                      onEnded={onEnded}
                      className="absolute inset-0 size-full cursor-pointer object-contain"
                    />
                    {/* 모션·색 보정 미리보기(바꾼 것이 있을 때만). 누르면 아래 동영상이 받는다 */}
                    <canvas
                      ref={adjustCanvas}
                      aria-hidden
                      className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${adjusted || moved ? "" : "hidden"}`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={togglePlay} disabled={busy}>
                      {playing && !seqPlay ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                      {playing && !seqPlay ? "멈춤" : multi ? "클립 재생" : "구간 재생"}
                    </Button>
                    {multi && (
                      <Button variant={seqPlay ? "default" : "outline"} size="sm" onClick={playSequence} disabled={busy}>
                        {seqPlay && playing ? <Pause data-icon="inline-start" /> : <ListVideo data-icon="inline-start" />}
                        {seqPlay && playing ? "멈춤" : "전체 재생"}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {multi ? `${clipNo}번 클립 · ` : ""}
                      {fmt(time)} / {fmt(source.duration)}
                    </span>
                    <span className="ml-auto truncate text-xs text-muted-foreground tabular-nums">
                      {source.file.name} · {source.width}×{source.height}
                    </span>
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
            {/* ④ 미디어(가져온 동영상) · 히스토리 */}
            <Panel
              title={
                <Tabs value={mediaTab} onValueChange={(v) => setMediaTab(v as "media" | "history")}>
                  <TabsList className="h-7">
                    <TabsTrigger value="media" className="text-xs">
                      미디어 {media.length > 0 && <span className="tabular-nums">{media.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="text-xs">
                      히스토리
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              }
              actions={
                mediaTab === "media" ? (
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
                ) : null
              }
              scroll
            >
              {mediaTab === "history" ? (
                <div className="p-2">
                  <ToolHistory<VideoForm>
                    tool="video"
                    onLoad={(f, h) => {
                      setMediaTab("media")
                      return loadForm(f, h)
                    }}
                    contain
                    fileName={(t, h) => (t.endsWith(`.${h.form.format}`) ? t : `${t}.${h.form.format ?? "webp"}`)}
                  />
                </div>
              ) : media.length === 0 ? (
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
                    <Tip content="다른 동영상을 가져와 뒤에 이어 붙입니다">
                      <Button variant="outline" size="xs" disabled={busy} onClick={pickMore}>
                        <Plus data-icon="inline-start" />
                        영상 추가
                      </Button>
                    </Tip>
                    <Tip content="고른 클립을 타임라인에서 뺍니다">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <Scissors className="size-3.5" />
                        {multi ? `${clipNo}번 클립 구간` : "구간"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmt(range[0])} – {fmt(range[1])} ({fmt(length)})
                      </span>
                      <div className="ml-auto flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => {
                            const t = preview.current?.currentTime ?? 0
                            setRange([Math.min(t, range[1] - 0.1), range[1]])
                          }}
                        >
                          지금 위치를 시작으로
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => {
                            const t = preview.current?.currentTime ?? source.duration
                            setRange([range[0], Math.max(t, range[0] + 0.1)])
                          }}
                        >
                          지금 위치를 끝으로
                        </Button>
                        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setRange([0, source.duration])}>
                          전체
                        </Button>
                      </div>
                    </div>
                    <Slider
                      min={0}
                      max={source.duration}
                      step={0.1}
                      minStepsBetweenThumbs={1}
                      value={range}
                      disabled={busy}
                      onValueChange={(v) => {
                        const next: [number, number] = [v[0], v[1]]
                        setSliding(true)
                        // 움직인 손잡이 위치를 미리보기로 보여 준다
                        seekPreview(next[0] !== range[0] ? next[0] : next[1])
                        setRange(next)
                      }}
                      onValueCommit={(v) => {
                        setSliding(false)
                        playRange(v[0])
                      }}
                      aria-label={`${F.label} 로 만들 구간`}
                      className="py-1"
                    />
                    <FrameStrip
                      thumbs={thumbs}
                      duration={source.duration}
                      range={range}
                      time={time}
                      disabled={busy}
                      onRange={(next, commit) => {
                        setSliding(!commit)
                        setRange(next)
                        if (commit) playRange(next[0])
                        else seekPreview(next[0] !== range[0] ? next[0] : next[1])
                      }}
                      onSeek={(t) => {
                        setTime(t)
                        seekPreview(t)
                      }}
                    />
                    <Timeline
                      clips={clips}
                      activeId={activeClip?.id ?? null}
                      disabled={busy}
                      onSelect={selectClip}
                      onReorder={(next) => {
                        setClips(next)
                        setResult(null)
                      }}
                    />
                    <p className="text-xs break-keep text-muted-foreground">
                      클립을 누르면 그 클립 구간을 다듬고, 끌어서 순서를 바꿉니다. 미디어의 동영상을 여기로 끌어 놓으면 뒤에 붙습니다. 크기는 1번 클립 기준이고, 화면 비율이 다른 클립은 검은 여백을 두고 맞춥니다.
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
