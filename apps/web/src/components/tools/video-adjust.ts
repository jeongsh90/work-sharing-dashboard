// 동영상 → WebP·GIF 색 보정.
// ① 기본 교정(프리미어 프로 Lumetri 색상 "기본 교정"과 같은 칸)
//    색상: 온도(파랑↔주황) · 색조(초록↔자홍) · 채도(100 = 그대로) / 조명: 노출(EV) · 대비 · 밝은 영역 · 어두운 영역 · 흰색 · 검정
//    흰색 균형·노출은 빛 세기(선형)에서, 톤은 보이는 밝기(sRGB)에서 표로 만들어 장면마다 적용한다.
// ② 포토샵 Camera Raw 와 같은 칸
//    곡선(파라메트릭: 밝은 영역·밝음·어두움·어두운 영역 + 나눔점 3개 / 포인트: RGB·빨강·초록·파랑)
//    효과(텍스처·명료도·디헤이즈) — 주변 화소를 보는 보정이라 장면마다 흐림 상자로 계산
//    색상 혼합(8가지 색 계열의 색조·채도·광도 + 스포이트로 고른 포인트 색상)
//    색 보정(어두운·중간·밝은 영역·전역 색 바퀴 + 광도, 혼합·균형)
//    곡선·색상 혼합·색 보정은 색만 바꾸는 보정이라 33×33×33 색 표(3D LUT)로 한 번 만들어 화소마다 찾아 쓴다.

export type Pt = [number, number] // 곡선 점(입력, 출력) 0~255
export type Wheel = { hue: number; sat: number; lum: number } // 색조 0~360 · 채도 0~100 · 광도 -100~+100
export type PointColor = { h: number; s: number; l: number; hue: number; sat: number; lum: number; range: number } // 고른 색(HSL 0~360·0~1·0~1) + 이동값(-100~+100) + 범위(0~100)
export type Grade = { shadows: Wheel; midtones: Wheel; highlights: Wheel; global: Wheel; blending: number; balance: number }
// 칸 보이기 끄기(눈 아이콘): 꺼진 칸은 계산하지 않는다
export type AdjustSection = "basic" | "curve" | "effects" | "mixer" | "grading"

export type Adjust = {
  temperature: number // -100 ~ +100 (- 차갑게 / + 따뜻하게)
  tint: number // -100 ~ +100 (- 초록 / + 자홍)
  saturation: number // 0 ~ 200 (100 = 그대로, 0 = 흑백)
  exposure: number // -4 ~ +4 (EV, 1 = 두 배 밝게)
  contrast: number // -100 ~ +100
  highlights: number // -100 ~ +100
  shadows: number // -100 ~ +100
  whites: number // -100 ~ +100
  blacks: number // -100 ~ +100
  // 곡선 — 파라메트릭(-100 ~ +100)과 나눔점(0~100, 어두운 영역|어두움|밝음|밝은 영역 경계)
  cHighlights: number
  cLights: number
  cDarks: number
  cShadows: number
  cSplits: [number, number, number]
  // 곡선 — 포인트(채널마다 점 목록)
  curves: { rgb: Pt[]; r: Pt[]; g: Pt[]; b: Pt[] }
  // 효과 -100 ~ +100
  texture: number
  clarity: number
  dehaze: number
  // 색상 혼합: 빨강·주황·노랑·녹색·아쿠아·파랑·자주·마젠타 계열 순서로 8칸
  mixHue: number[]
  mixSat: number[]
  mixLum: number[]
  points: PointColor[]
  // 색 보정
  grade: Grade
  hidden: AdjustSection[]
}

export const MIX_COLORS = [
  { key: "red", label: "빨강 계열", hue: 0 },
  { key: "orange", label: "주황 계열", hue: 30 },
  { key: "yellow", label: "노랑 계열", hue: 60 },
  { key: "green", label: "녹색 계열", hue: 120 },
  { key: "aqua", label: "아쿠아 계열", hue: 180 },
  { key: "blue", label: "파랑 계열", hue: 240 },
  { key: "purple", label: "자주 계열", hue: 270 },
  { key: "magenta", label: "마젠타 계열", hue: 300 },
] as const

const LINE: Pt[] = [
  [0, 0],
  [255, 255],
]
const ZERO8 = [0, 0, 0, 0, 0, 0, 0, 0]
const NO_WHEEL: Wheel = { hue: 0, sat: 0, lum: 0 }
export const NO_GRADE: Grade = { shadows: NO_WHEEL, midtones: NO_WHEEL, highlights: NO_WHEEL, global: NO_WHEEL, blending: 50, balance: 0 }
export const NO_CURVES = { rgb: LINE, r: LINE, g: LINE, b: LINE }
export const NO_SPLITS: [number, number, number] = [25, 50, 75]

export const NO_ADJUST: Adjust = {
  temperature: 0,
  tint: 0,
  saturation: 100,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  cHighlights: 0,
  cLights: 0,
  cDarks: 0,
  cShadows: 0,
  cSplits: NO_SPLITS,
  curves: NO_CURVES,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  mixHue: ZERO8,
  mixSat: ZERO8,
  mixLum: ZERO8,
  points: [],
  grade: NO_GRADE,
  hidden: [],
}

const BASIC_KEYS = ["temperature", "tint", "saturation", "exposure", "contrast", "highlights", "shadows", "whites", "blacks"] as const

// 칸마다 바꾼 것이 있는지(보이기를 끈 칸은 없는 것으로)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const sectionChanged = {
  basic: (a: Adjust) => BASIC_KEYS.some((k) => a[k] !== NO_ADJUST[k]),
  curve: (a: Adjust) => a.cHighlights !== 0 || a.cLights !== 0 || a.cDarks !== 0 || a.cShadows !== 0 || !same(a.curves, NO_CURVES),
  effects: (a: Adjust) => a.texture !== 0 || a.clarity !== 0 || a.dehaze !== 0,
  mixer: (a: Adjust) => a.mixHue.some(Boolean) || a.mixSat.some(Boolean) || a.mixLum.some(Boolean) || a.points.some((p) => p.hue || p.sat || p.lum),
  grading: (a: Adjust) => [a.grade.shadows, a.grade.midtones, a.grade.highlights, a.grade.global].some((w) => w.sat > 0 || w.lum !== 0),
}
const active = (a: Adjust, s: AdjustSection) => !a.hidden.includes(s) && sectionChanged[s](a)

// 바꾼 것이 하나도 없으면(또는 바꾼 칸을 모두 끄면) 장면을 건드리지 않는다
export const isNoAdjust = (a: Adjust) => {
  const f = fill(a)
  return !(Object.keys(sectionChanged) as AdjustSection[]).some((s) => active(f, s))
}
// 기본값 버튼용: 값 자체가 기본값과 같은지
export const isDefaultAdjust = (a: Adjust) => {
  const f = fill(a)
  return !(Object.keys(sectionChanged) as AdjustSection[]).some((s) => sectionChanged[s](f)) && f.hidden.length === 0
}

// 예전 기록(필드가 없던 때)도 받는다: 빠진 칸은 기본값
function fill(a: Adjust): Adjust {
  if (a && a.grade && a.curves && a.mixHue && a.points && a.hidden && a.cSplits) return a
  return normalizeAdjust(a)
}

// 예전 기록(포토샵 노출·색조/채도: exposure·offset·gamma·hue·saturation·lightness)도 받는다: 노출·채도만 옮긴다
export function normalizeAdjust(a: unknown): Adjust {
  if (!a || typeof a !== "object") return NO_ADJUST
  const o = a as Record<string, unknown>
  const num = (k: string, d: number, min = -Infinity, max = Infinity) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? Math.min(max, Math.max(min, o[k] as number)) : d)
  if ("gamma" in o || "lightness" in o || "hue" in o) {
    return { ...NO_ADJUST, exposure: Math.max(-4, Math.min(4, num("exposure", 0))), saturation: Math.max(0, Math.min(200, 100 + num("saturation", 0))) }
  }
  const arr8 = (v: unknown) => (Array.isArray(v) && v.length === 8 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]).map((x) => Math.max(-100, Math.min(100, x))) : ZERO8)
  const pts = (v: unknown): Pt[] => {
    if (!Array.isArray(v)) return LINE
    const p = v.filter((x): x is Pt => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number" && Number.isFinite(n))).map(([x, y]) => [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))] as Pt)
    return p.length >= 2 ? p.sort((m, n) => m[0] - n[0]) : LINE
  }
  const c = (o.curves && typeof o.curves === "object" ? o.curves : {}) as Record<string, unknown>
  const wheel = (v: unknown): Wheel => {
    const w = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
    const n = (k: string, d: number, min: number, max: number) => (typeof w[k] === "number" && Number.isFinite(w[k]) ? Math.min(max, Math.max(min, w[k] as number)) : d)
    return { hue: n("hue", 0, 0, 360), sat: n("sat", 0, 0, 100), lum: n("lum", 0, -100, 100) }
  }
  const g = (o.grade && typeof o.grade === "object" ? o.grade : {}) as Record<string, unknown>
  const gn = (k: string, d: number, min: number, max: number) => (typeof g[k] === "number" && Number.isFinite(g[k]) ? Math.min(max, Math.max(min, g[k] as number)) : d)
  const splits = Array.isArray(o.cSplits) && o.cSplits.length === 3 && o.cSplits.every((x) => typeof x === "number") ? ([...(o.cSplits as number[])].sort((x, y) => x - y) as [number, number, number]) : NO_SPLITS
  const points = Array.isArray(o.points)
    ? (o.points as Record<string, unknown>[])
        .filter((p) => p && typeof p === "object")
        .slice(0, 8)
        .map((p) => {
          const n = (k: string, d: number, min: number, max: number) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? Math.min(max, Math.max(min, p[k] as number)) : d)
          return { h: n("h", 0, 0, 360), s: n("s", 0, 0, 1), l: n("l", 0.5, 0, 1), hue: n("hue", 0, -100, 100), sat: n("sat", 0, -100, 100), lum: n("lum", 0, -100, 100), range: n("range", 50, 0, 100) }
        })
    : []
  const SECTIONS: AdjustSection[] = ["basic", "curve", "effects", "mixer", "grading"]
  return {
    temperature: num("temperature", 0),
    tint: num("tint", 0),
    saturation: num("saturation", 100),
    exposure: num("exposure", 0),
    contrast: num("contrast", 0),
    highlights: num("highlights", 0),
    shadows: num("shadows", 0),
    whites: num("whites", 0),
    blacks: num("blacks", 0),
    cHighlights: num("cHighlights", 0, -100, 100),
    cLights: num("cLights", 0, -100, 100),
    cDarks: num("cDarks", 0, -100, 100),
    cShadows: num("cShadows", 0, -100, 100),
    cSplits: splits,
    curves: { rgb: pts(c.rgb), r: pts(c.r), g: pts(c.g), b: pts(c.b) },
    texture: num("texture", 0, -100, 100),
    clarity: num("clarity", 0, -100, 100),
    dehaze: num("dehaze", 0, -100, 100),
    mixHue: arr8(o.mixHue),
    mixSat: arr8(o.mixSat),
    mixLum: arr8(o.mixLum),
    points,
    grade: { shadows: wheel(g.shadows), midtones: wheel(g.midtones), highlights: wheel(g.highlights), global: wheel(g.global), blending: gn("blending", 50, 0, 100), balance: gn("balance", 0, -100, 100) },
    hidden: Array.isArray(o.hidden) ? (o.hidden as unknown[]).filter((x): x is AdjustSection => SECTIONS.includes(x as AdjustSection)) : [],
  }
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const LIN = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255))
const STEPS = 4096 // 선형 값 → 보이는 밝기 + 톤 표 칸 수
// 온도·색조 ±100 일 때 배율 폭(빨강↔파랑 / 초록↔자홍)
const KT = 0.6
const KG = 0.35
const KM = 0.15

// 흰색 균형 배율(선형 R·G·B): 온도는 빨강↔파랑, 색조는 초록↔(빨강·파랑)
export function wbGains(temperature: number, tint: number): [number, number, number] {
  const t = temperature / 100
  const m = tint / 100
  return [(1 + KT * t) * (1 + KM * m), 1 - KG * m, (1 - KT * t) * (1 + KM * m)]
}

// 톤 곡선(보이는 밝기 0~1 → 0~1): 검정·흰색은 끝 쪽, 어두운/밝은 영역은 그 사이 구간, 대비는 가운데를 기준으로 펼친다
function tone(v: number, a: Adjust) {
  const sh = a.shadows / 100
  const hi = a.highlights / 100
  const wh = a.whites / 100
  const bl = a.blacks / 100
  const ct = a.contrast / 100
  v += bl * 0.25 * (1 - v) ** 4
  v += wh * 0.25 * v ** 4
  v += sh * 0.35 * v * (1 - v) ** 2 * 2.25
  v += hi * 0.35 * v ** 2 * (1 - v) * 2.25
  v = Math.min(1, Math.max(0, v))
  // 대비: + 는 부드러운 S 곡선 쪽으로(어두운 곳은 더 어둡게·밝은 곳은 더 밝게), - 는 가운데로 모은다
  if (ct > 0) {
    const s = v * v * (3 - 2 * v)
    v += (s - v) * ct * 1.5
  } else if (ct < 0) v = 0.5 + (v - 0.5) * (1 + ct * 0.6)
  return Math.min(1, Math.max(0, v))
}

function toneTable(a: Adjust) {
  const out = new Uint8ClampedArray(STEPS)
  for (let i = 0; i < STEPS; i++) out[i] = Math.round(tone(toSrgb(i / (STEPS - 1)), a) * 255)
  return out
}

// 채널마다 입력 0~255 → 출력 0~255 표(흰색 균형·노출·톤을 한 번에). 같은 보정값이면 다시 만들지 않는다(미리보기는 장면마다 부른다)
type Luts = { r: Uint8Array; g: Uint8Array; b: Uint8Array }
const lutCache = new Map<string, Luts>()
function channelLuts(a: Adjust): Luts {
  const key = `${a.temperature}|${a.tint}|${a.exposure}|${a.contrast}|${a.highlights}|${a.shadows}|${a.whites}|${a.blacks}`
  const hit = lutCache.get(key)
  if (hit) return hit
  const [gr, gg, gb] = wbGains(a.temperature, a.tint)
  const ev = 2 ** a.exposure
  const T = toneTable(a)
  const top = STEPS - 1
  const make = (k: number) => Uint8Array.from({ length: 256 }, (_, i) => T[Math.min(top, Math.round(LIN[i] * k * ev * top))])
  const luts = { r: make(gr), g: make(gg), b: make(gb) }
  if (lutCache.size > 32) lutCache.clear()
  lutCache.set(key, luts)
  return luts
}

function applyBasic(data: Uint8ClampedArray, a: Adjust) {
  const { r: LR, g: LG, b: LB } = channelLuts(a)
  const sat = a.saturation / 100
  const n = data.length
  if (sat === 1) {
    for (let i = 0; i < n; i += 4) {
      data[i] = LR[data[i]]
      data[i + 1] = LG[data[i + 1]]
      data[i + 2] = LB[data[i + 2]]
    }
    return
  }
  for (let i = 0; i < n; i += 4) {
    const r = LR[data[i]]
    const g = LG[data[i + 1]]
    const b = LB[data[i + 2]]
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    data[i] = y + (r - y) * sat
    data[i + 1] = y + (g - y) * sat
    data[i + 2] = y + (b - y) * sat
  }
}

// ── 곡선 ──
// 파라메트릭 곡선(0~1 → 0~1, 256칸): 나눔점으로 나눈 네 구간(어두운 영역·어두움·밝음·밝은 영역)을 각각 올리고 내린다
export function parametricTable(a: Pick<Adjust, "cHighlights" | "cLights" | "cDarks" | "cShadows" | "cSplits">): Float32Array {
  const [s1, s2, s3] = a.cSplits.map((v) => v / 100)
  const regions: [number, number, number][] = [
    [0, s1, a.cShadows],
    [s1, s2, a.cDarks],
    [s2, s3, a.cLights],
    [s3, 1, a.cHighlights],
  ]
  const out = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let y = x
    for (const [lo, hi, amt] of regions) {
      if (!amt) continue
      const c = (lo + hi) / 2
      const half = Math.max(0.06, (hi - lo) / 2) + 0.12
      const d = (x - c) / half
      if (Math.abs(d) >= 1) continue
      const ends = Math.min(1, x * 6, (1 - x) * 6) // 0·255 는 그대로
      y += (amt / 100) * 0.25 * ((Math.cos(Math.PI * d) + 1) / 2) * ends
    }
    out[i] = Math.min(1, Math.max(0, i ? Math.max(y, out[i - 1]) : y))
  }
  return out
}

// 포인트 곡선(0~255 점 → 0~1, 256칸): 단조 3차 보간(점 사이에서 넘치지 않게)
export function pointTable(pts: Pt[]): Float32Array {
  const p = [...pts].sort((a, b) => a[0] - b[0]).filter((q, i, arr) => i === 0 || q[0] !== arr[i - 1][0])
  const out = new Float32Array(256)
  if (p.length < 2) {
    for (let i = 0; i < 256; i++) out[i] = i / 255
    return out
  }
  const n = p.length
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  const d = Array.from({ length: n - 1 }, (_, k) => (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]))
  const m = Array.from({ length: n }, (_, k) => (k === 0 ? d[0] : k === n - 1 ? d[n - 2] : d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2))
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = m[k + 1] = 0
      continue
    }
    const al = m[k] / d[k]
    const be = m[k + 1] / d[k]
    const s = al * al + be * be
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[k] = t * al * d[k]
      m[k + 1] = t * be * d[k]
    }
  }
  let k = 0
  for (let x = 0; x < 256; x++) {
    let y: number
    if (x <= xs[0]) y = ys[0]
    else if (x >= xs[n - 1]) y = ys[n - 1]
    else {
      while (x > xs[k + 1]) k++
      const h = xs[k + 1] - xs[k]
      const t = (x - xs[k]) / h
      const t2 = t * t
      const t3 = t2 * t
      y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
    }
    out[x] = Math.min(1, Math.max(0, y / 255))
  }
  return out
}

// ── HSL ──
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}
const hue2 = (p: number, q: number, t: number) => {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) return [l, l, l]
  h = (((h % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2(p, q, h + 1 / 3), hue2(p, q, h), hue2(p, q, h - 1 / 3)]
}
export const rgbToHslPublic = rgbToHsl

// 색조 h 가 8개 계열에 얼마씩 걸리는지(이웃 두 계열 사이를 부드럽게 나눈다, 합 1)
const CENTERS = MIX_COLORS.map((c) => c.hue)
function bandWeights(h: number, out: Float32Array) {
  out.fill(0)
  for (let k = 0; k < 8; k++) {
    const c0 = CENTERS[k]
    const c1 = k === 7 ? 360 : CENTERS[k + 1]
    if (h >= c0 && h < c1) {
      const t = (h - c0) / (c1 - c0)
      const s = (1 - Math.cos(Math.PI * t)) / 2
      out[k] += 1 - s
      out[(k + 1) % 8] += s
      return
    }
  }
}
const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// 색 바퀴 하나가 더하는 색(바퀴 색조 쪽으로, 채도만큼)
function wheelOffset(w: Wheel): [number, number, number] {
  if (w.sat <= 0) return [0, 0, 0]
  const [r, g, b] = hslToRgb(w.hue, 1, 0.5)
  const m = (r + g + b) / 3
  const k = (w.sat / 100) * 0.28
  return [(r - m) * k, (g - m) * k, (b - m) * k]
}

// 색만 바꾸는 보정(곡선 → 색상 혼합 → 포인트 색상 → 색 보정): 0~1 RGB → 0~1 RGB
type ColorPlan = {
  curve: null | { p: Float32Array; rgb: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array }
  mixer: null | { hue: number[]; sat: number[]; lum: number[]; points: PointColor[] }
  grade: null | { s: [number, number, number]; m: [number, number, number]; h: [number, number, number]; g: [number, number, number]; ls: number; lm: number; lh: number; lg: number; gamma: number; bal: number }
}
function colorPlan(a: Adjust): ColorPlan {
  return {
    curve: active(a, "curve") ? { p: parametricTable(a), rgb: pointTable(a.curves.rgb), r: pointTable(a.curves.r), g: pointTable(a.curves.g), b: pointTable(a.curves.b) } : null,
    mixer: active(a, "mixer") ? { hue: a.mixHue, sat: a.mixSat, lum: a.mixLum, points: a.points.filter((p) => p.hue || p.sat || p.lum) } : null,
    grade: active(a, "grading")
      ? {
          s: wheelOffset(a.grade.shadows),
          m: wheelOffset(a.grade.midtones),
          h: wheelOffset(a.grade.highlights),
          g: wheelOffset(a.grade.global),
          ls: (a.grade.shadows.lum / 100) * 0.25,
          lm: (a.grade.midtones.lum / 100) * 0.25,
          lh: (a.grade.highlights.lum / 100) * 0.25,
          lg: (a.grade.global.lum / 100) * 0.25,
          gamma: 1 + ((100 - a.grade.blending) / 100) * 3,
          bal: 2 ** (-a.grade.balance / 100),
        }
      : null,
  }
}

const W8 = new Float32Array(8)
function colorOp(r: number, g: number, b: number, P: ColorPlan): [number, number, number] {
  if (P.curve) {
    const C = P.curve
    const at = (t: Float32Array, v: number) => {
      const x = Math.min(255, Math.max(0, v * 255))
      const i = Math.floor(x)
      const f = x - i
      return i >= 255 ? t[255] : t[i] + (t[i + 1] - t[i]) * f
    }
    r = at(C.r, at(C.rgb, at(C.p, r)))
    g = at(C.g, at(C.rgb, at(C.p, g)))
    b = at(C.b, at(C.rgb, at(C.p, b)))
  }
  if (P.mixer) {
    let [h, s, l] = rgbToHsl(r, g, b)
    if (s > 0.0001) {
      const M = P.mixer
      bandWeights(h, W8)
      let dh = 0
      let ds = 0
      let dl = 0
      for (let k = 0; k < 8; k++) {
        const w = W8[k]
        if (!w) continue
        dh += w * M.hue[k]
        ds += w * M.sat[k]
        dl += w * M.lum[k]
      }
      // 포인트 색상: 고른 색과 가까울수록(색조·채도·광도, 범위만큼) 더 많이
      for (const p of M.points) {
        const rh = 12 + p.range * 0.5
        const rs = 0.12 + p.range * 0.005
        const rl = 0.15 + p.range * 0.006
        const w = Math.exp(-((hueDist(h, p.h) / rh) ** 2) - ((s - p.s) / rs) ** 2 - ((l - p.l) / rl) ** 2)
        if (w < 0.002) continue
        dh += w * p.hue
        ds += w * p.sat
        dl += w * p.lum
      }
      const chroma = Math.min(1, s * 1.5)
      h += (dh / 100) * 30
      s = Math.min(1, Math.max(0, s * (1 + ds / 100)))
      const f = (dl / 100) * chroma
      l = Math.min(1, Math.max(0, l + f * (f > 0 ? 1 - l : l) * 0.8))
      ;[r, g, b] = hslToRgb(h, s, l)
    }
  }
  if (P.grade) {
    const G = P.grade
    const y = Math.min(1, Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b))
    const x = y ** G.bal
    const ws = (1 - x) ** G.gamma
    const wh = x ** G.gamma
    const wm = Math.max(0, 1 - ws - wh)
    const lum = ws * G.ls + wm * G.lm + wh * G.lh + G.lg
    r += ws * G.s[0] + wm * G.m[0] + wh * G.h[0] + G.g[0] + lum
    g += ws * G.s[1] + wm * G.m[1] + wh * G.h[1] + G.g[1] + lum
    b += ws * G.s[2] + wm * G.m[2] + wh * G.h[2] + G.g[2] + lum
  }
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))]
}

// 33×33×33 색 표. 같은 값이면 다시 만들지 않는다
const N = 33
const cubeCache = new Map<string, Uint8ClampedArray>()
function colorCube(a: Adjust): Uint8ClampedArray {
  const key = JSON.stringify([
    active(a, "curve") && [a.cHighlights, a.cLights, a.cDarks, a.cShadows, a.cSplits, a.curves],
    active(a, "mixer") && [a.mixHue, a.mixSat, a.mixLum, a.points],
    active(a, "grading") && a.grade,
  ])
  const hit = cubeCache.get(key)
  if (hit) return hit
  const P = colorPlan(a)
  const cube = new Uint8ClampedArray(N * N * N * 3)
  let o = 0
  for (let bi = 0; bi < N; bi++)
    for (let gi = 0; gi < N; gi++)
      for (let ri = 0; ri < N; ri++) {
        const [r, g, b] = colorOp(ri / (N - 1), gi / (N - 1), bi / (N - 1), P)
        cube[o++] = Math.round(r * 255)
        cube[o++] = Math.round(g * 255)
        cube[o++] = Math.round(b * 255)
      }
  if (cubeCache.size > 16) cubeCache.clear()
  cubeCache.set(key, cube)
  return cube
}
// 0~255 → 표 칸 번호·사이 비율
const IDX = Uint8Array.from({ length: 256 }, (_, v) => Math.min(N - 2, Math.floor((v * (N - 1)) / 255)))
const FRAC = Float32Array.from({ length: 256 }, (_, v) => (v * (N - 1)) / 255 - IDX[v])

function applyCube(data: Uint8ClampedArray, cube: Uint8ClampedArray) {
  const SG = N * 3
  const SB = N * N * 3
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i]
    const G = data[i + 1]
    const B = data[i + 2]
    const r0 = IDX[R], g0 = IDX[G], b0 = IDX[B]
    const fr = FRAC[R], fg = FRAC[G], fb = FRAC[B]
    const base = b0 * SB + g0 * SG + r0 * 3
    for (let c = 0; c < 3; c++) {
      const p = base + c
      const c00 = cube[p] + (cube[p + 3] - cube[p]) * fr
      const c10 = cube[p + SG] + (cube[p + SG + 3] - cube[p + SG]) * fr
      const c01 = cube[p + SB] + (cube[p + SB + 3] - cube[p + SB]) * fr
      const c11 = cube[p + SB + SG] + (cube[p + SB + SG + 3] - cube[p + SB + SG]) * fr
      const c0 = c00 + (c10 - c00) * fg
      const c1 = c01 + (c11 - c01) * fg
      data[i + c] = c0 + (c1 - c0) * fb
    }
  }
}

// ── 효과(주변 화소를 보는 보정) ──
// 상자 흐림(가로 → 세로, 가장자리는 끝 값 반복). 두 번 돌리면 가우스 흐림에 가깝다
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const d = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / d
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}
const blur2 = (src: Float32Array, w: number, h: number, r: number) => boxBlur(boxBlur(src, w, h, r), w, h, r)

function applyEffects(data: Uint8ClampedArray, w: number, h: number, a: Adjust) {
  const n = w * h
  const unit = Math.max(w, h) / 860 // 반경은 화면 크기에 맞춘다(미리보기·결과가 같게)
  if (a.texture || a.clarity) {
    const Y = new Float32Array(n)
    for (let i = 0, j = 0; i < n; i++, j += 4) Y[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255
    const delta = new Float32Array(n)
    // 텍스처: 잔 무늬(작은 반경)
    if (a.texture) {
      const B = blur2(Y, w, h, Math.max(1, Math.round(2 * unit)))
      const k = (a.texture / 100) * 1.2
      for (let i = 0; i < n; i++) delta[i] += k * (Y[i] - B[i])
    }
    // 명료도: 중간 밝기의 큰 경계 대비(큰 반경)
    if (a.clarity) {
      const B = blur2(Y, w, h, Math.max(2, Math.round(14 * unit)))
      const k = (a.clarity / 100) * 0.9
      for (let i = 0; i < n; i++) {
        const m = 1 - (2 * Y[i] - 1) ** 2
        delta[i] += k * (Y[i] - B[i]) * m
      }
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = delta[i] * 255
      if (!v) continue
      data[j] += v
      data[j + 1] += v
      data[j + 2] += v
    }
  }
  // 디헤이즈: 어두운 채널로 안개 정도를 재고, + 는 걷어 내고 - 는 덧씌운다
  if (a.dehaze) {
    const D = new Float32Array(n)
    for (let i = 0, j = 0; i < n; i++, j += 4) D[i] = Math.min(data[j], data[j + 1], data[j + 2]) / 255
    const Db = boxBlur(D, w, h, Math.max(2, Math.round(12 * unit)))
    // 대기 빛: 안개가 가장 짙은 0.2% 화소의 평균 색
    const sorted = Float32Array.from(Db).sort()
    const th = sorted[Math.floor(sorted.length * 0.998)]
    let ar = 0, ag = 0, ab = 0, cnt = 0
    for (let i = 0, j = 0; i < n; i++, j += 4)
      if (Db[i] >= th) {
        ar += data[j]
        ag += data[j + 1]
        ab += data[j + 2]
        cnt++
      }
    const A = cnt ? [ar / cnt, ag / cnt, ab / cnt] : [255, 255, 255]
    const Am = Math.max(1, (A[0] + A[1] + A[2]) / 3) / 255
    const amt = a.dehaze / 100
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (amt > 0) {
        const t = Math.max(0.25, 1 - 0.9 * amt * Math.min(1, Db[i] / Am))
        for (let c = 0; c < 3; c++) data[j + c] = (data[j + c] - A[c]) / t + A[c]
      } else {
        const k = -amt * 0.6 * (0.4 + 0.6 * (1 - Db[i]))
        for (let c = 0; c < 3; c++) data[j + c] = data[j + c] * (1 - k) + A[c] * k
      }
    }
  }
}

// 장면 하나(RGBA)를 그 자리에서 고친다: 기본 교정 → 효과 → 곡선·색상 혼합·색 보정
export function applyAdjust(img: ImageData, adjust: Adjust) {
  const a = fill(adjust)
  if (isNoAdjust(a)) return
  if (active(a, "basic")) applyBasic(img.data, a)
  if (active(a, "effects")) applyEffects(img.data, img.width, img.height, a)
  if (active(a, "curve") || active(a, "mixer") || active(a, "grading")) applyCube(img.data, colorCube(a))
}

// 포인트 색상 스포이트: 고른 곳 색을 HSL 로(포인트 색상 계산과 같은 기준: 색상 혼합 바로 앞 단계의 색)
export function pickPointColor(img: ImageData, x: number, y: number, adjust: Adjust): { h: number; s: number; l: number } | null {
  const a = fill(adjust)
  const stage = { ...a, mixHue: ZERO8, mixSat: ZERO8, mixLum: ZERO8, points: [], grade: NO_GRADE }
  applyAdjust(img, stage)
  const { width: w, height: h, data } = img
  let r = 0, g = 0, b = 0, n = 0
  for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++)
    for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
      const i = (yy * w + xx) * 4
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
  if (!n) return null
  const [hh, ss, ll] = rgbToHsl(r / n / 255, g / n / 255, b / n / 255)
  return { h: hh, s: ss, l: ll }
}

// 흰색 균형 스포이트: 고른 곳(원본 색, 0~255)이 회색이 되게 하는 온도·색조
export function neutralize(r: number, g: number, b: number): { temperature: number; tint: number } {
  const R = Math.max(1e-4, LIN[Math.round(r)])
  const G = Math.max(1e-4, LIN[Math.round(g)])
  const B = Math.max(1e-4, LIN[Math.round(b)])
  // R·(1+KT·t) = B·(1-KT·t)
  const t = Math.max(-1, Math.min(1, (B - R) / (KT * (B + R))))
  const R2 = R * (1 + KT * t)
  const B2 = B * (1 - KT * t)
  const rb = (R2 + B2) / 2
  // G·(1-KG·m) = rb·(1+KM·m)
  const m = Math.max(-1, Math.min(1, (G - rb) / (KG * G + KM * rb)))
  return { temperature: Math.round(t * 1000) / 10, tint: Math.round(m * 1000) / 10 }
}

// 히스토그램(곡선 뒤 배경): 밝기·R·G·B 256칸. 큰 장면은 건너뛰며 센다
export type Histogram = { l: Uint32Array; r: Uint32Array; g: Uint32Array; b: Uint32Array }
export function histogramOf(img: ImageData): Histogram {
  const l = new Uint32Array(256), r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256)
  const d = img.data
  const step = Math.max(1, Math.floor((img.width * img.height) / 120000)) * 4
  for (let i = 0; i < d.length; i += step) {
    r[d[i]]++
    g[d[i + 1]]++
    b[d[i + 2]]++
    l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++
  }
  return { l, r, g, b }
}
