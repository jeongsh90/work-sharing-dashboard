import { useEffect, useRef, useState } from "react"
import { Download, Film, LoaderCircle, Pause, Play, RotateCcw, Scissors, Upload, Wand2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { formatBytes } from "@/lib/api"
import type { GifWorkerIn, GifWorkerOut } from "@/components/tools/gif-worker"

// 동영상 → GIF: 동영상 파일(MP4·MOV·WebM)을 골라 구간·크기·초당 장수를 정하고 GIF 로 바꾼다.
// 서버에 올리지 않고 이 브라우저 안에서 바꾼다. 장면을 한 장씩 뽑아(canvas) Web Worker 가 GIF 로 묶는다.

const WIDTHS = [
  { value: "860", label: "860px (상세페이지)" },
  { value: "640", label: "640px" },
  { value: "480", label: "480px" },
  { value: "320", label: "320px" },
  { value: "0", label: "원본 크기" },
]
const FPS = ["10", "12", "15", "20", "24"]
const COLORS = [
  { value: "256", label: "고화질 (256색)" },
  { value: "128", label: "보통 (128색)" },
  { value: "64", label: "작은 용량 (64색)" },
]
const SPEEDS = ["0.5", "1", "1.5", "2"]
// 너무 길면 브라우저 메모리가 모자라고 GIF 도 수십 MB 가 된다
const MAX_FRAMES = 900

type Source = { file: File; url: string; duration: number; width: number; height: number }
type Result = { url: string; size: number; width: number; height: number; frames: number; name: string }

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

// 예상 용량: 고른 구간에서 고르게 몇 장만 뽑아 지금 설정으로 GIF 를 만들어 보고, 한 장 평균 크기를 잰다.
// 장마다 따로 압축되므로(앞 장과 차이만 남기지 않는다) 평균 × 전체 장수가 실제와 거의 같다.
const SAMPLES = 6

async function measurePerFrame(
  url: string,
  times: number[],
  w: number,
  h: number,
  colors: number,
  alive: () => boolean,
): Promise<number | null> {
  const video = document.createElement("video")
  video.muted = true
  video.preload = "auto"
  video.src = url
  const worker = new Worker(new URL("./gif-worker.ts", import.meta.url), { type: "module" })
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
    const done = new Promise<ArrayBuffer>((resolve) => {
      worker.onmessage = (e: MessageEvent<GifWorkerOut>) => e.data.type === "done" && resolve(e.data.bytes)
    })
    worker.postMessage({ type: "start", width: w, height: h, repeat: 0, colors, delay: 70 } satisfies GifWorkerIn)
    for (const t of times) {
      if (!alive()) return null
      await seek(video, t)
      ctx.drawImage(video, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data.buffer
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
  onSeek,
}: {
  thumbs: (string | null)[]
  duration: number
  range: [number, number]
  time: number
  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = (t: number) => `${(Math.min(Math.max(t / duration, 0), 1) * 100).toFixed(3)}%`
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    onSeek(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * duration)
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
        className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-primary"
        style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }}
      />
      {/* 재생 위치 */}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: pct(time) }} />
    </div>
  )
}

export function VideoToGifTool() {
  const [source, setSource] = useState<Source | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [width, setWidth] = useState("860")
  const [fps, setFps] = useState("15")
  const [colors, setColors] = useState("256")
  const [speed, setSpeed] = useState("1")
  const [repeat, setRepeat] = useState("0")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ step: string; ratio: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  // 화면을 닫으면 만든 주소·작업을 정리한다
  useEffect(() => () => void (source && URL.revokeObjectURL(source.url)), [source])
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result])
  useEffect(() => () => cancelRef.current?.(), [])

  const open = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
      setError("동영상 파일(MP4·MOV·WebM)을 골라 주세요.")
      return
    }
    setError(null)
    setResult(null)
    const url = URL.createObjectURL(file)
    const v = document.createElement("video")
    v.preload = "metadata"
    v.muted = true
    v.src = url
    v.onloadedmetadata = () => {
      if (!v.videoWidth || !Number.isFinite(v.duration)) {
        URL.revokeObjectURL(url)
        setError("이 동영상은 브라우저에서 열 수 없습니다. MP4(H.264)나 WebM 으로 저장해 다시 골라 주세요.")
        return
      }
      setSource({ file, url, duration: v.duration, width: v.videoWidth, height: v.videoHeight })
      // 처음에는 앞 5초(짧으면 전체)
      setRange([0, Math.min(v.duration, 5)])
      setPlaying(false)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      setError("이 동영상은 브라우저에서 열 수 없습니다. MP4(H.264)나 WebM 으로 저장해 다시 골라 주세요.")
    }
  }

  // 미리보기는 고른 구간만 되풀이한다
  const onTime = () => {
    const v = preview.current
    if (!v) return
    setTime(v.currentTime)
    // 멈춰 있을 때는 프레임 띠에서 구간 밖을 눌러 봐도 그 자리에 둔다
    if (!v.paused && (v.currentTime >= range[1] || v.currentTime < range[0] - 0.05)) v.currentTime = range[0]
  }

  // 재생 위치(프레임 띠의 세로선). 재생 중에는 화면 그릴 때마다 따라간다
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (preview.current) setTime(preview.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // 프레임 띠: 영상 전체에서 고르게 장면을 뽑아 작은 그림으로 늘어놓는다(하나씩 채워진다)
  const [thumbs, setThumbs] = useState<(string | null)[]>([])
  useEffect(() => {
    if (!source) return
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
        setThumbs((list) => list.map((v, j) => (j === i ? url : v)))
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
    if (v.paused) {
      if (v.currentTime < range[0] || v.currentTime >= range[1]) v.currentTime = range[0]
      void v.play()
    } else v.pause()
  }

  const outW = source ? Math.min(Number(width) || source.width, source.width) : 0
  const outH = source ? Math.max(1, Math.round((source.height * outW) / source.width)) : 0
  const length = Math.max(0, range[1] - range[0])
  const frames = Math.max(1, Math.round(length * Number(fps)))
  const tooMany = frames > MAX_FRAMES
  const busy = progress !== null

  // 설정을 바꾸면 잠깐 뒤(손을 멈춘 뒤) 한 장 평균 크기를 다시 잰다. 초당 장수·속도·반복은 장수만 바뀌어 다시 재지 않는다.
  const [perFrame, setPerFrame] = useState<{ key: string; bytes: number } | null>(null)
  const sampleKey = source ? `${source.url}|${range[0].toFixed(1)}|${range[1].toFixed(1)}|${outW}|${colors}` : ""
  useEffect(() => {
    // 손잡이를 끄는 동안에는 재지 않는다(미리보기와 영상 읽기를 다투지 않게)
    if (!source || busy || sliding || length <= 0) return
    let alive = true
    const timer = setTimeout(() => {
      const times = Array.from({ length: SAMPLES }, (_, i) => Math.min(range[0] + ((i + 0.5) * length) / SAMPLES, source.duration - 0.001))
      measurePerFrame(source.url, times, outW, outH, Number(colors), () => alive).then(
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
    if (!source || tooMany || length <= 0) return
    setError(null)
    setResult(null)
    preview.current?.pause()
    let cancelled = false
    const worker = new Worker(new URL("./gif-worker.ts", import.meta.url), { type: "module" })
    const video = document.createElement("video")
    video.muted = true
    video.preload = "auto"
    video.src = source.url
    cancelRef.current = () => {
      cancelled = true
      worker.terminate()
      setProgress(null)
    }
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error("load"))
      })
      const canvas = document.createElement("canvas")
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!
      ctx.imageSmoothingQuality = "high"
      // GIF 한 장 시간은 10ms 단위. 20ms 보다 짧으면 브라우저가 느리게 틀어서 20ms 로 맞춘다.
      const delay = Math.max(20, Math.round(1000 / Number(fps) / Number(speed) / 10) * 10)
      const finished = new Promise<ArrayBuffer>((resolve) => {
        worker.onmessage = (e: MessageEvent<GifWorkerOut>) => {
          if (e.data.type === "frame-done") setProgress({ step: "GIF 만드는 중", ratio: e.data.index / frames })
          else resolve(e.data.bytes)
        }
      })
      worker.postMessage({ type: "start", width: outW, height: outH, repeat: Number(repeat), colors: Number(colors), delay } satisfies GifWorkerIn)
      setProgress({ step: "장면 뽑는 중", ratio: 0 })
      for (let i = 0; i < frames; i++) {
        if (cancelled) return
        await seek(video, Math.min(range[0] + i / Number(fps), source.duration - 0.001))
        ctx.drawImage(video, 0, 0, outW, outH)
        const data = ctx.getImageData(0, 0, outW, outH).data.buffer
        worker.postMessage({ type: "frame", data } satisfies GifWorkerIn, [data])
      }
      worker.postMessage({ type: "finish" } satisfies GifWorkerIn)
      const bytes = await finished
      if (cancelled) return
      const blob = new Blob([bytes], { type: "image/gif" })
      const base = source.file.name.replace(/\.[^.]+$/, "")
      setResult({ url: URL.createObjectURL(blob), size: blob.size, width: outW, height: outH, frames, name: `${base}.gif` })
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

  const reset = () => {
    cancelRef.current?.()
    setSource(null)
    setResult(null)
    setError(null)
  }

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files")

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-12 gap-6 p-4 md:p-6">
      <input
        ref={picker}
        type="file"
        accept="video/*,.mov,.mkv"
        hidden
        onChange={(e) => {
          open(e.target.files?.[0])
          e.target.value = ""
        }}
      />

      {/* 오른쪽: 설정(넓은 화면에서는 미리보기 오른쪽) */}
      <div className="col-span-12 lg:order-2 lg:col-span-5">
        <FieldGroup>
          <Field>
            <FieldLabel>동영상</FieldLabel>
            {source ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Film className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium" title={source.file.name}>
                    {source.file.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {source.width}×{source.height} · {fmt(source.duration)} · {formatBytes(source.file.size)}
                  </span>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="다른 동영상 고르기" disabled={busy} onClick={reset}>
                  <X />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => picker.current?.click()}
                onDragOver={(e) => {
                  if (!hasFiles(e)) return
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  open(e.dataTransfer.files[0])
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center text-sm transition-colors ${
                  dragging ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <Upload className="size-7" />
                <span className="font-medium text-foreground">동영상 파일 고르기</span>
                <span>MP4·MOV·WebM 을 고르거나 여기에 끌어 놓으세요. 파일은 서버에 올라가지 않습니다.</span>
              </button>
            )}
            {error && <FieldError>{error}</FieldError>}
          </Field>

          {source && (
            <>
              <Field>
                <FieldLabel>
                  <Scissors className="size-4" />
                  구간
                  <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                    {fmt(range[0])} – {fmt(range[1])} ({fmt(length)})
                  </span>
                </FieldLabel>
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
                  aria-label="GIF 로 만들 구간"
                  className="py-2"
                />
                <div className="flex flex-wrap gap-2">
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
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="gif-width">가로 크기</FieldLabel>
                  <Select value={width} onValueChange={setWidth} disabled={busy}>
                    <SelectTrigger id="gif-width" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WIDTHS.map((w) => (
                        <SelectItem key={w.value} value={w.value}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="gif-fps">초당 장수</FieldLabel>
                  <Select value={fps} onValueChange={setFps} disabled={busy}>
                    <SelectTrigger id="gif-fps" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FPS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}장{f === "15" ? " (기본)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="gif-colors">화질</FieldLabel>
                  <Select value={colors} onValueChange={setColors} disabled={busy}>
                    <SelectTrigger id="gif-colors" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLORS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="gif-speed">재생 속도</FieldLabel>
                  <Select value={speed} onValueChange={setSpeed} disabled={busy}>
                    <SelectTrigger id="gif-speed" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SPEEDS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}배{s === "1" ? " (그대로)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="col-span-2">
                  <FieldLabel htmlFor="gif-repeat">반복</FieldLabel>
                  <Select value={repeat} onValueChange={setRepeat} disabled={busy}>
                    <SelectTrigger id="gif-repeat" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">계속 반복</SelectItem>
                      <SelectItem value="-1">한 번만 재생</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field data-invalid={tooMany}>
                {/* 예상 용량: 설정을 바꿀 때마다 다시 잰다 */}
                <div
                  className={`flex items-center gap-3 rounded-lg border p-3 ${
                    estimate !== null && estimate > 10 * 1024 * 1024 ? "border-amber-500/50 bg-amber-500/8" : "bg-muted/40"
                  }`}
                  aria-live="polite"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs text-muted-foreground">예상 GIF 용량</span>
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
                    {frames}장 · {fmt(length / Number(speed))}
                  </span>
                </div>
                {estimate !== null && estimate > 10 * 1024 * 1024 && (
                  <FieldDescription className="text-amber-700 dark:text-amber-300">
                    10MB 가 넘습니다. 가로 크기·초당 장수·화질을 낮추거나 구간을 줄이면 가벼워집니다.
                  </FieldDescription>
                )}
                {outW < (Number(width) || 0) && <FieldDescription>원본보다 크게는 만들지 않습니다.</FieldDescription>}
                {tooMany && (
                  <FieldError>
                    장수가 너무 많습니다({frames}장, 최대 {MAX_FRAMES}장). 구간을 줄이거나 초당 장수를 낮춰 주세요.
                  </FieldError>
                )}
              </Field>

              {busy ? (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{progress.step}…</span>
                    <span className="text-muted-foreground tabular-nums">{Math.round(progress.ratio * 100)}%</span>
                    <Button variant="ghost" size="xs" className="ml-auto" onClick={() => cancelRef.current?.()}>
                      취소
                    </Button>
                  </div>
                  <Progress value={progress.ratio * 100} />
                </div>
              ) : (
                <Button size="lg" className="w-full" disabled={tooMany || length <= 0} onClick={() => void convert()}>
                  <Wand2 data-icon="inline-start" />
                  GIF 로 변환
                </Button>
              )}
            </>
          )}
        </FieldGroup>
      </div>

      {/* 왼쪽: 미리보기(동영상) → 결과(GIF) */}
      <div className="col-span-12 flex min-w-0 flex-col gap-4 lg:order-1 lg:col-span-7">
        {result ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto font-semibold">
                결과 GIF
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {result.width}×{result.height} · {result.frames}장 · {formatBytes(result.size)}
                </span>
              </h3>
              <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                <RotateCcw data-icon="inline-start" />
                다시 설정
              </Button>
              <Button size="sm" onClick={download}>
                <Download data-icon="inline-start" />
                GIF 내려받기
              </Button>
            </div>
            <div className="flex justify-center overflow-hidden rounded-xl border bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
              <img src={result.url} alt={`${result.name} 미리보기`} className="max-h-[70vh] max-w-full object-contain" />
            </div>
            {result.size > 10 * 1024 * 1024 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                10MB 가 넘습니다. 쇼핑몰에 올리기 무거우면 가로 크기·초당 장수·화질을 낮추거나 구간을 줄여 보세요.
              </p>
            )}
          </>
        ) : source ? (
          <>
            <div className="flex items-center gap-2">
              <h3 className="mr-auto font-semibold">미리보기</h3>
              <span className="text-xs text-muted-foreground">고른 구간만 반복해서 보여 줍니다</span>
            </div>
            <div className="relative overflow-hidden rounded-xl border bg-black">
              <video
                ref={preview}
                src={source.url}
                preload="auto"
                muted
                playsInline
                onTimeUpdate={onTime}
                onSeeked={onSeeked}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={togglePlay}
                className="max-h-[60vh] w-full cursor-pointer object-contain"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={togglePlay} disabled={busy}>
                {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {playing ? "멈춤" : "구간 재생"}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {fmt(time)} / {fmt(source.duration)}
              </span>
            </div>
            <FrameStrip
              thumbs={thumbs}
              duration={source.duration}
              range={range}
              time={time}
              onSeek={(t) => {
                setTime(t)
                seekPreview(t)
              }}
            />
          </>
        ) : (
          <div className="flex min-h-80 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            <Film className="size-8" />
            동영상을 고르면 여기에 미리보기가 나옵니다.
          </div>
        )}
      </div>
    </div>
  )
}
