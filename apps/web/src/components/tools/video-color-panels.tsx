// 동영상 변환기 > 색 보정 칸 아래: 포토샵 Camera Raw 와 같은 칸 — 곡선 · 효과 · 색상 혼합 · 색 보정(컬러 휠)
// 칸마다 머리 줄(접기 · 눈 아이콘 = 이 칸 효과 끄고 보기 · 기본값)이 있고, 막대는 두 번 누르면 기본값, 숫자는 끌거나 눌러서 입력한다.
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Eye, EyeOff, Pipette, RotateCcw, Spline, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tip } from "@/components/tip"
import {
  hslToRgb,
  MIX_COLORS,
  NO_ADJUST,
  NO_CURVES,
  NO_GRADE,
  NO_SPLITS,
  parametricTable,
  pointTable,
  sectionChanged,
  type Adjust,
  type AdjustSection,
  type Histogram,
  type Pt,
  type Wheel,
} from "@/components/tools/video-adjust"

// 파란 숫자: 좌우로 끌면 바뀌고(Shift = 10배), 누르면 직접 입력
export function Scrub({
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

const SLIDER_CLS =
  "flex-1 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-neutral-300 [&_[data-slot=slider-thumb]]:bg-neutral-900 [&_[data-slot=slider-track]]:bg-transparent"
const GRAY_TRACK = "linear-gradient(90deg,#3a3a3a,#d4d4d4)"

// 이름 + 값 한 줄, 아래 막대(포토샵처럼). 막대를 두 번 누르면 기본값
export function AdjSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  digits = 0,
  def = 0,
  track = GRAY_TRACK,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  digits?: number
  def?: number
  track?: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{label}</span>
        <Scrub value={value} onChange={onChange} step={step} digits={digits} min={min} max={max} label={label} disabled={disabled} />
      </div>
      <div className="relative flex items-center" onDoubleClick={() => !disabled && onChange(def)}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: track }} />
        <Slider min={min} max={max} step={step} value={[value]} disabled={disabled} onValueChange={([x]) => onChange(Number(x.toFixed(digits)))} aria-label={label} className={SLIDER_CLS} />
      </div>
    </div>
  )
}

// 칸 머리 줄: 접기 · 제목 · 기본값 · 눈(이 칸 효과 끄고 보기)
function SectionBox({
  id,
  title,
  value,
  onChange,
  reset,
  disabled,
  children,
}: {
  id: AdjustSection
  title: string
  value: Adjust
  onChange: (a: Adjust) => void
  reset: Partial<Adjust>
  disabled?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const hidden = value.hidden.includes(id)
  const changed = sectionChanged[id](value)
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label={title}>
      <div className="flex items-center gap-1">
        <button type="button" className="flex items-center gap-1.5 text-sm font-medium" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
          {changed && <span className="size-1.5 rounded-full bg-sky-500" aria-label="바꾼 값 있음" />}
        </button>
        <Tip content="이 칸 기본값">
          <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label={`${title} 기본값`} disabled={disabled || !changed} onClick={() => onChange({ ...value, ...reset })}>
            <RotateCcw />
          </Button>
        </Tip>
        <Tip content={hidden ? "이 칸 효과 켜기" : "이 칸 효과 끄고 보기"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={hidden ? `${title} 켜기` : `${title} 끄기`}
            aria-pressed={hidden}
            disabled={disabled}
            onClick={() => onChange({ ...value, hidden: hidden ? value.hidden.filter((h) => h !== id) : [...value.hidden, id] })}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </Button>
        </Tip>
      </div>
      {open && <div className={`flex flex-col gap-3 ${hidden ? "opacity-50" : ""}`}>{children}</div>}
    </section>
  )
}

// ── 곡선 ──
type CurveMode = "param" | "rgb" | "r" | "g" | "b"
const CH_COLOR: Record<Exclude<CurveMode, "param">, string> = { rgb: "#e5e5e5", r: "#ef4444", g: "#22c55e", b: "#3b82f6" }

function CurveSection({ value, onChange, hist, disabled }: { value: Adjust; onChange: (a: Adjust) => void; hist: Histogram | null; disabled?: boolean }) {
  const [mode, setMode] = useState<CurveMode>("param")
  const set = (patch: Partial<Adjust>) => onChange({ ...value, ...patch })
  const svg = useRef<SVGSVGElement>(null)
  // 끄는 동안의 점 목록은 여기서 이어 간다(다시 그리기 전에 다음 움직임이 와도 맞게)
  const drag = useRef<{ idx: number; ch: Exclude<CurveMode, "param">; list: Pt[] } | null>(null)
  const pts: Pt[] = mode === "param" ? [] : value.curves[mode]
  const table = useMemo(() => (mode === "param" ? parametricTable(value) : pointTable(pts)), [mode, value, pts])

  // 히스토그램(바탕): 곡선 모드에 맞는 채널
  const histPath = useMemo(() => {
    if (!hist) return ""
    const arr = mode === "r" ? hist.r : mode === "g" ? hist.g : mode === "b" ? hist.b : hist.l
    let max = 1
    for (let i = 2; i < 254; i++) max = Math.max(max, arr[i])
    let d = "M0 256"
    for (let i = 0; i < 256; i++) d += ` L${i} ${256 - Math.min(1, Math.sqrt(arr[i] / max)) * 240}`
    return d + " L255 256 Z"
  }, [hist, mode])
  const curvePath = useMemo(() => {
    let d = ""
    for (let i = 0; i < 256; i++) d += `${i ? "L" : "M"}${i} ${256 - table[i] * 256}`
    return d
  }, [table])

  const toPt = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 256, 256 - ((e.clientY - r.top) / r.height) * 256]
  }
  const setPts = (next: Pt[]) => mode !== "param" && set({ curves: { ...value.curves, [mode]: next } })
  const near = (x: number, y: number) => pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10)
  // 곡선을 누르면 핀(점)을 놓는다: 그 자리 곡선 높이에(곡선에서 멀리 누르면 누른 높이에). 파라메트릭 화면에서 누르면 포인트 곡선(RGB)으로 넘어가며 놓는다
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return
    const ch = mode === "param" ? "rgb" : mode
    let list = value.curves[ch]
    const [x, y] = toPt(e)
    let idx = mode === "param" ? -1 : near(x, y)
    if (idx < 0) {
      const nx = Math.round(Math.min(255, Math.max(0, x)))
      idx = list.findIndex((p) => p[0] === nx)
      if (idx < 0) {
        const cy = pointTable(list)[nx] * 255
        const ny = Math.round(Math.min(255, Math.max(0, mode === "param" || Math.abs(cy - y) < 24 ? cy : y)))
        const next = [...list, [nx, ny] as Pt].sort((p, q) => p[0] - q[0])
        idx = next.findIndex((p) => p[0] === nx)
        list = next
        set({ curves: { ...value.curves, [ch]: next } })
      }
    }
    if (mode === "param") setMode("rgb")
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { idx, ch, list }
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const [x, y] = toPt(e)
    const cur = d.list
    const i = d.idx
    if (i < 0 || i >= cur.length) return
    const put = (next: Pt[]) => {
      d.list = next
      set({ curves: { ...value.curves, [d.ch]: next } })
    }
    // 양 끝이 아닌 점은 칸 밖으로 멀리 끌면 지운다
    const out = x < -24 || x > 280 || y < -24 || y > 280
    if (out && i > 0 && i < cur.length - 1) {
      drag.current = null
      put(cur.filter((_, k) => k !== i))
      return
    }
    const lo = i > 0 ? cur[i - 1][0] + 1 : 0
    const hi = i < cur.length - 1 ? cur[i + 1][0] - 1 : 255
    put(cur.map((p, k) => (k === i ? ([Math.round(Math.min(hi, Math.max(lo, x))), Math.round(Math.min(255, Math.max(0, y)))] as Pt) : p)))
  }
  const onDbl = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled || mode === "param") return
    const [x, y] = toPt(e)
    const i = near(x, y)
    if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, k) => k !== i))
  }

  const modes: { id: CurveMode; label: string }[] = [
    { id: "param", label: "파라메트릭 곡선" },
    { id: "rgb", label: "포인트 곡선(RGB)" },
    { id: "r", label: "빨강 채널" },
    { id: "g", label: "초록 채널" },
    { id: "b", label: "파랑 채널" },
  ]
  const color = mode === "param" ? "#d4d4d4" : CH_COLOR[mode]
  return (
    <SectionBox id="curve" title="곡선" value={value} onChange={onChange} reset={{ cHighlights: 0, cLights: 0, cDarks: 0, cShadows: 0, cSplits: NO_SPLITS, curves: NO_CURVES }} disabled={disabled}>
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-sm text-muted-foreground">조정</span>
        {modes.map((m) => (
          <Tip key={m.id} content={m.label}>
            <button
              type="button"
              aria-label={m.label}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${mode === m.id ? "ring-2 ring-sky-500" : ""}`}
            >
              {m.id === "param" ? <Spline className="size-4" /> : <span className="size-4 rounded-full border-2" style={{ borderColor: CH_COLOR[m.id] }} />}
            </button>
          </Tip>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox="0 0 256 256"
        className="aspect-square w-full cursor-crosshair touch-none rounded border bg-neutral-900"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={onDbl}
        role="img"
        aria-label="곡선"
      >
        {histPath && <path d={histPath} fill={mode === "param" || mode === "rgb" ? "#525252" : color} opacity={mode === "param" || mode === "rgb" ? 0.9 : 0.35} />}
        {[64, 128, 192].map((v) => (
          <g key={v} stroke="#404040" strokeWidth={1}>
            <line x1={v} y1={0} x2={v} y2={256} />
            <line x1={0} y1={v} x2={256} y2={v} />
          </g>
        ))}
        {mode === "param" &&
          value.cSplits.map((s) => <line key={s} x1={(s / 100) * 256} y1={0} x2={(s / 100) * 256} y2={256} stroke="#737373" strokeDasharray="3 3" />)}
        <line x1={0} y1={256} x2={256} y2={0} stroke="#525252" strokeWidth={1} />
        <path d={curvePath} fill="none" stroke={color} strokeWidth={2} />
        {mode !== "param" && pts.map(([x, y], i) => <rect key={i} x={x - 4} y={256 - y - 4} width={8} height={8} fill="#171717" stroke={color} strokeWidth={1.5} />)}
      </svg>
      {mode === "param" ? (
        <>
          <p className="text-xs break-keep text-muted-foreground">곡선을 누르면 핀(점)이 생기고 포인트 곡선으로 바뀝니다. 아래 막대로는 구간별로 올리고 내립니다.</p>
          {/* 나눔점: 어두운 영역 | 어두움 | 밝음 | 밝은 영역 */}
          <div className="flex flex-col gap-1">
            <div className="h-2 rounded-sm" style={{ background: "linear-gradient(90deg,#000,#fff)" }} aria-hidden />
            <Slider
              min={5}
              max={95}
              step={1}
              minStepsBetweenThumbs={5}
              value={value.cSplits}
              disabled={disabled}
              onValueChange={(v) => set({ cSplits: [v[0], v[1], v[2]] })}
              aria-label="곡선 영역 나눔점"
              className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-neutral-400 [&_[data-slot=slider-thumb]]:bg-neutral-800 [&_[data-slot=slider-track]]:bg-transparent"
            />
          </div>
          <AdjSlider label="밝은 영역" value={value.cHighlights} onChange={(v) => set({ cHighlights: v })} min={-100} max={100} disabled={disabled} />
          <AdjSlider label="밝음" value={value.cLights} onChange={(v) => set({ cLights: v })} min={-100} max={100} disabled={disabled} />
          <AdjSlider label="어두움" value={value.cDarks} onChange={(v) => set({ cDarks: v })} min={-100} max={100} disabled={disabled} />
          <AdjSlider label="어두운 영역" value={value.cShadows} onChange={(v) => set({ cShadows: v })} min={-100} max={100} disabled={disabled} />
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs break-keep text-muted-foreground">
          <span className="min-w-0 flex-1">곡선을 누르면 핀(점)이 생기고 끌어서 옮깁니다. 핀을 두 번 누르거나 칸 밖으로 끌면 지웁니다.</span>
          <Button type="button" variant="ghost" size="xs" disabled={disabled || pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255} onClick={() => setPts(NO_CURVES.rgb)}>
            <RotateCcw data-icon="inline-start" />
            이 채널
          </Button>
        </div>
      )}
    </SectionBox>
  )
}

// ── 효과 ──
function EffectsSection({ value, onChange, disabled }: { value: Adjust; onChange: (a: Adjust) => void; disabled?: boolean }) {
  const set = (patch: Partial<Adjust>) => onChange({ ...value, ...patch })
  return (
    <SectionBox id="effects" title="효과" value={value} onChange={onChange} reset={{ texture: 0, clarity: 0, dehaze: 0 }} disabled={disabled}>
      <AdjSlider label="텍스처" value={value.texture} onChange={(v) => set({ texture: v })} min={-100} max={100} disabled={disabled} />
      <AdjSlider label="명료도" value={value.clarity} onChange={(v) => set({ clarity: v })} min={-100} max={100} disabled={disabled} />
      <AdjSlider label="디헤이즈" value={value.dehaze} onChange={(v) => set({ dehaze: v })} min={-100} max={100} disabled={disabled} />
    </SectionBox>
  )
}

// ── 색상 혼합 ──
type MixKind = "hue" | "sat" | "lum"
const MIX_KEY: Record<MixKind, "mixHue" | "mixSat" | "mixLum"> = { hue: "mixHue", sat: "mixSat", lum: "mixLum" }
const MIX_NAME: Record<MixKind, string> = { hue: "색조", sat: "채도", lum: "광도" }
const hsl = (h: number, s = 100, l = 50) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`
const mixTrack = (kind: MixKind, h: number) =>
  kind === "hue" ? `linear-gradient(90deg,${hsl(h - 30)},${hsl(h)},${hsl(h + 30)})` : kind === "sat" ? `linear-gradient(90deg,${hsl(h, 0)},${hsl(h)})` : `linear-gradient(90deg,${hsl(h, 100, 12)},${hsl(h)},${hsl(h, 100, 88)})`
const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`

function MixerSection({
  value,
  onChange,
  disabled,
  pickingPoint,
  onPickPoint,
}: {
  value: Adjust
  onChange: (a: Adjust) => void
  disabled?: boolean
  pickingPoint?: boolean
  onPickPoint?: () => void
}) {
  const [tab, setTab] = useState<"mix" | "point">("mix")
  const [how, setHow] = useState<"hsl" | "color">("hsl")
  const [kind, setKind] = useState<MixKind | "all">("hue")
  const [color, setColor] = useState(0)
  const [sel, setSel] = useState(0)
  const set = (patch: Partial<Adjust>) => onChange({ ...value, ...patch })
  const setMix = (k: MixKind, i: number, v: number) => set({ [MIX_KEY[k]]: value[MIX_KEY[k]].map((x, j) => (j === i ? v : x)) } as Partial<Adjust>)
  // 스포이트로 새 포인트를 고르면 그 포인트를 보인다
  const count = value.points.length
  const prev = useRef(count)
  useEffect(() => {
    if (count > prev.current) {
      setSel(count - 1)
      setTab("point")
    }
    prev.current = count
  }, [count])

  const group = (k: MixKind) => (
    <div className="flex flex-col gap-2.5">
      {MIX_COLORS.map((c, i) => (
        <AdjSlider key={c.key} label={c.label} value={value[MIX_KEY[k]][i]} onChange={(v) => setMix(k, i, v)} min={-100} max={100} track={mixTrack(k, c.hue)} disabled={disabled} />
      ))}
    </div>
  )
  const p = value.points[Math.min(sel, count - 1)]
  const setPoint = (patch: Partial<typeof p>) => set({ points: value.points.map((q, j) => (j === sel ? { ...q, ...patch } : q)) })
  return (
    <SectionBox id="mixer" title="색상 혼합" value={value} onChange={onChange} reset={{ mixHue: NO_ADJUST.mixHue, mixSat: NO_ADJUST.mixSat, mixLum: NO_ADJUST.mixLum, points: [] }} disabled={disabled}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "mix" | "point")}>
        <TabsList variant="line">
          <TabsTrigger value="mix">혼합</TabsTrigger>
          <TabsTrigger value="point">포인트 색상</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "mix" ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">조정</span>
            <Select value={how} onValueChange={(v) => setHow(v as "hsl" | "color")}>
              <SelectTrigger size="sm" className="flex-1" aria-label="혼합 조정 방식">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hsl">HSL</SelectItem>
                <SelectItem value="color">색상</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {how === "hsl" ? (
            <>
              <Tabs value={kind} onValueChange={(v) => setKind(v as MixKind | "all")}>
                <TabsList variant="line">
                  <TabsTrigger value="hue">색조</TabsTrigger>
                  <TabsTrigger value="sat">채도</TabsTrigger>
                  <TabsTrigger value="lum">광도</TabsTrigger>
                  <TabsTrigger value="all">모두</TabsTrigger>
                </TabsList>
              </Tabs>
              {kind === "all" ? (
                (["hue", "sat", "lum"] as MixKind[]).map((k) => (
                  <div key={k} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{MIX_NAME[k]}</p>
                    {group(k)}
                  </div>
                ))
              ) : (
                group(kind)
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="색 계열">
                {MIX_COLORS.map((c, i) => (
                  <Tip key={c.key} content={c.label}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={color === i}
                      aria-label={c.label}
                      onClick={() => setColor(i)}
                      className={`size-6 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${color === i ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-card" : ""}`}
                      style={{ background: hsl(c.hue) }}
                    />
                  </Tip>
                ))}
              </div>
              {(["hue", "sat", "lum"] as MixKind[]).map((k) => (
                <AdjSlider key={k} label={MIX_NAME[k]} value={value[MIX_KEY[k]][color]} onChange={(v) => setMix(k, color, v)} min={-100} max={100} track={mixTrack(k, MIX_COLORS[color].hue)} disabled={disabled} />
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Tip content="스포이트: 미리보기에서 바꿀 색을 누르세요(최대 8개)">
              <Button variant={pickingPoint ? "default" : "outline"} size="icon-sm" aria-label="포인트 색상 스포이트" aria-pressed={pickingPoint} disabled={disabled || count >= 8} onClick={onPickPoint}>
                <Pipette />
              </Button>
            </Tip>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="radiogroup" aria-label="고른 색">
              {value.points.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={sel === i}
                  aria-label={`포인트 색상 ${i + 1}`}
                  onClick={() => setSel(i)}
                  className={`size-6 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${sel === i ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-card" : "ring-1 ring-border"}`}
                  style={{ background: css(hslToRgb(q.h, q.s, q.l)) }}
                />
              ))}
            </div>
          </div>
          {pickingPoint && <p className="text-xs text-sky-500">미리보기에서 바꿀 색을 누르세요</p>}
          {p ? (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-4 flex-1 rounded-sm" style={{ background: css(hslToRgb(p.h, p.s, p.l)) }} aria-label="고른 색" />
                <span aria-hidden>→</span>
                <span
                  className="h-4 flex-1 rounded-sm"
                  aria-label="바뀐 색"
                  style={{ background: css(hslToRgb(p.h + (p.hue / 100) * 30, Math.min(1, Math.max(0, p.s * (1 + p.sat / 100))), Math.min(1, Math.max(0, p.l + (p.lum / 100) * (p.lum > 0 ? 1 - p.l : p.l) * 0.8 * Math.min(1, p.s * 1.5))))) }}
                />
                <Tip content="이 포인트 지우기">
                  <Button variant="ghost" size="icon-xs" aria-label="포인트 색상 지우기" disabled={disabled} onClick={() => { set({ points: value.points.filter((_, j) => j !== sel) }); setSel((s) => Math.max(0, s - 1)) }}>
                    <Trash2 />
                  </Button>
                </Tip>
              </div>
              <AdjSlider label="색조 이동" value={p.hue} onChange={(v) => setPoint({ hue: v })} min={-100} max={100} track={`linear-gradient(90deg,${hsl(p.h - 30)},${hsl(p.h)},${hsl(p.h + 30)})`} disabled={disabled} />
              <AdjSlider label="채도 이동" value={p.sat} onChange={(v) => setPoint({ sat: v })} min={-100} max={100} track={`linear-gradient(90deg,${hsl(p.h, 0)},${hsl(p.h)})`} disabled={disabled} />
              <AdjSlider label="광도 이동" value={p.lum} onChange={(v) => setPoint({ lum: v })} min={-100} max={100} track={`linear-gradient(90deg,${hsl(p.h, 100, 12)},${hsl(p.h)},${hsl(p.h, 100, 88)})`} disabled={disabled} />
              <AdjSlider label="범위" value={p.range} onChange={(v) => setPoint({ range: v })} min={0} max={100} def={50} disabled={disabled} />
            </>
          ) : (
            <p className="text-xs break-keep text-muted-foreground">스포이트를 누르고 미리보기에서 바꿀 색을 고르면, 그 색과 비슷한 부분만 색조·채도·광도를 옮깁니다.</p>
          )}
        </>
      )}
    </SectionBox>
  )
}

// ── 색 보정(컬러 휠) ──
type GradeMode = "3way" | "shadows" | "midtones" | "highlights" | "global"
const GRADE_NAME: Record<Exclude<GradeMode, "3way">, string> = { shadows: "어두운 영역", midtones: "중간 영역", highlights: "밝은 영역", global: "전역" }

// 색 바퀴: 각도 = 색조, 가운데에서 멀수록 채도. 두 번 누르면 가운데로
function ColorWheel({ value, onChange, size, label, disabled }: { value: Wheel; onChange: (w: Wheel) => void; size: number; label: string; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const rad = r.width / 2
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
    const sat = Math.min(100, (Math.hypot(dx, dy) / rad) * 100)
    onChange({ ...value, hue: Math.round(hue), sat: Math.round(sat) })
  }
  const rad = size / 2
  const x = rad + Math.cos((value.hue * Math.PI) / 180) * (value.sat / 100) * rad
  const y = rad + Math.sin((value.hue * Math.PI) / 180) * (value.sat / 100) * rad
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${label} 색 바퀴`}
      aria-valuetext={`색조 ${value.hue}, 채도 ${value.sat}`}
      className="relative shrink-0 touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle closest-side,#8a8a8a,rgba(138,138,138,0)), conic-gradient(from 90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        opacity: disabled ? 0.5 : 1,
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = true
        at(e)
      }}
      onPointerMove={(e) => drag.current && at(e)}
      onPointerUp={() => (drag.current = false)}
      onDoubleClick={() => !disabled && onChange({ ...value, hue: 0, sat: 0 })}
      onKeyDown={(e) => {
        const k = e.shiftKey ? 10 : 1
        if (e.key === "ArrowRight") onChange({ ...value, hue: (value.hue + k) % 360 })
        else if (e.key === "ArrowLeft") onChange({ ...value, hue: (value.hue - k + 360) % 360 })
        else if (e.key === "ArrowUp") onChange({ ...value, sat: Math.min(100, value.sat + k) })
        else if (e.key === "ArrowDown") onChange({ ...value, sat: Math.max(0, value.sat - k) })
        else return
        e.preventDefault()
      }}
    >
      <span aria-hidden className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-900/60 shadow" style={{ left: x, top: y }} />
    </div>
  )
}

function WheelBlock({ name, w, onW, size, disabled }: { name: string; w: Wheel; onW: (w: Wheel) => void; size: number; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-sm">{name}</span>
      <ColorWheel value={w} onChange={onW} size={size} label={name} disabled={disabled} />
      <div className="relative flex w-full items-center" style={{ maxWidth: size }} onDoubleClick={() => !disabled && onW({ ...w, lum: 0 })}>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: GRAY_TRACK }} />
        <Slider min={-100} max={100} step={1} value={[w.lum]} disabled={disabled} onValueChange={([v]) => onW({ ...w, lum: v })} aria-label={`${name} 광도`} className={SLIDER_CLS} />
      </div>
    </div>
  )
}

function GradingSection({ value, onChange, disabled }: { value: Adjust; onChange: (a: Adjust) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<GradeMode>("3way")
  const g = value.grade
  const setG = (patch: Partial<typeof g>) => onChange({ ...value, grade: { ...g, ...patch } })
  const wheel = (k: Exclude<GradeMode, "3way">) => (w: Wheel) => setG({ [k]: w } as Partial<typeof g>)
  const modes: { id: GradeMode; label: string; dot: React.ReactNode }[] = [
    {
      id: "3way",
      label: "3방향",
      dot: (
        <span className="relative size-4" aria-hidden>
          <span className="absolute top-0 left-1 size-2 rounded-full bg-neutral-400" />
          <span className="absolute bottom-0 left-0 size-2 rounded-full bg-neutral-700 ring-1 ring-neutral-500" />
          <span className="absolute right-0 bottom-0 size-2 rounded-full bg-neutral-100" />
        </span>
      ),
    },
    { id: "shadows", label: "어두운 영역", dot: <span className="size-4 rounded-full bg-neutral-800 ring-1 ring-neutral-400" aria-hidden /> },
    { id: "midtones", label: "중간 영역", dot: <span className="size-4 rounded-full bg-neutral-500" aria-hidden /> },
    { id: "highlights", label: "밝은 영역", dot: <span className="size-4 rounded-full bg-neutral-100" aria-hidden /> },
    { id: "global", label: "전역", dot: <span className="size-4 rounded-full ring-1 ring-neutral-400" style={{ background: "linear-gradient(90deg,#f5f5f5 50%,#262626 50%)" }} aria-hidden /> },
  ]
  return (
    <SectionBox id="grading" title="색 보정" value={value} onChange={onChange} reset={{ grade: NO_GRADE }} disabled={disabled}>
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-sm text-muted-foreground">조정</span>
        {modes.map((m) => (
          <Tip key={m.id} content={m.label}>
            <button
              type="button"
              aria-label={m.label}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${mode === m.id ? "ring-2 ring-sky-500" : ""}`}
            >
              {m.dot}
            </button>
          </Tip>
        ))}
      </div>
      {mode === "3way" ? (
        <>
          <WheelBlock name="중간 영역" w={g.midtones} onW={wheel("midtones")} size={112} disabled={disabled} />
          <div className="grid grid-cols-2 gap-3">
            <WheelBlock name="어두운 영역" w={g.shadows} onW={wheel("shadows")} size={96} disabled={disabled} />
            <WheelBlock name="밝은 영역" w={g.highlights} onW={wheel("highlights")} size={96} disabled={disabled} />
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-center">
            <ColorWheel value={g[mode]} onChange={wheel(mode)} size={176} label={GRADE_NAME[mode]} disabled={disabled} />
          </div>
          <AdjSlider label="색조" value={g[mode].hue} onChange={(v) => wheel(mode)({ ...g[mode], hue: v })} min={0} max={360} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" disabled={disabled} />
          <AdjSlider label="채도" value={g[mode].sat} onChange={(v) => wheel(mode)({ ...g[mode], sat: v })} min={0} max={100} track={`linear-gradient(90deg,#8a8a8a,${hsl(g[mode].hue)})`} disabled={disabled} />
          <AdjSlider label="광도" value={g[mode].lum} onChange={(v) => wheel(mode)({ ...g[mode], lum: v })} min={-100} max={100} disabled={disabled} />
        </>
      )}
      {mode !== "global" && (
        <>
          <AdjSlider label="혼합" value={g.blending} onChange={(v) => setG({ blending: v })} min={0} max={100} def={50} disabled={disabled} />
          <AdjSlider label="균형" value={g.balance} onChange={(v) => setG({ balance: v })} min={-100} max={100} disabled={disabled} />
        </>
      )}
    </SectionBox>
  )
}

// 색 보정 칸 아래에 차례로 붙는 네 칸
export function CameraRawPanels({
  value,
  onChange,
  hist,
  disabled,
  pickingPoint,
  onPickPoint,
}: {
  value: Adjust
  onChange: (a: Adjust) => void
  hist: Histogram | null
  disabled?: boolean
  pickingPoint?: boolean
  onPickPoint?: () => void
}) {
  return (
    <>
      <CurveSection value={value} onChange={onChange} hist={hist} disabled={disabled} />
      <EffectsSection value={value} onChange={onChange} disabled={disabled} />
      <MixerSection value={value} onChange={onChange} disabled={disabled} pickingPoint={pickingPoint} onPickPoint={onPickPoint} />
      <GradingSection value={value} onChange={onChange} disabled={disabled} />
    </>
  )
}

// 기본 교정 칸 머리(눈 아이콘)도 같은 모양으로 쓴다
export { SectionBox }
