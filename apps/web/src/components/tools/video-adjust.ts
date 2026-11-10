// 동영상 → WebP·GIF 색 보정: 프리미어 프로 Lumetri 색상 "기본 교정"과 같은 칸.
// 색상: 온도(파랑↔주황) · 색조(초록↔자홍) · 채도(100 = 그대로)
// 조명: 노출(EV) · 대비 · 밝은 영역 · 어두운 영역 · 흰색 · 검정
// 흰색 균형·노출은 빛 세기(선형)에서, 톤(대비·밝은/어두운 영역·흰색·검정)은 보이는 밝기(sRGB)에서 표로 만들어 장면마다 적용한다.

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
}

export const NO_ADJUST: Adjust = { temperature: 0, tint: 0, saturation: 100, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }

export const isNoAdjust = (a: Adjust) => (Object.keys(NO_ADJUST) as (keyof Adjust)[]).every((k) => a[k] === NO_ADJUST[k])

// 예전 기록(포토샵 노출·색조/채도: exposure·offset·gamma·hue·saturation·lightness)도 받는다: 노출·채도만 옮긴다
export function normalizeAdjust(a: unknown): Adjust {
  if (!a || typeof a !== "object") return NO_ADJUST
  const o = a as Record<string, unknown>
  const num = (k: string, d: number) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : d)
  if ("gamma" in o || "lightness" in o || "hue" in o) {
    return { ...NO_ADJUST, exposure: Math.max(-4, Math.min(4, num("exposure", 0))), saturation: Math.max(0, Math.min(200, 100 + num("saturation", 0))) }
  }
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

// 장면 하나(RGBA)를 그 자리에서 고친다
export function applyAdjust(data: Uint8ClampedArray, a: Adjust) {
  if (isNoAdjust(a)) return
  const [gr, gg, gb] = wbGains(a.temperature, a.tint)
  const ev = 2 ** a.exposure
  const kr = gr * ev
  const kg = gg * ev
  const kb = gb * ev
  const T = toneTable(a)
  const top = STEPS - 1
  const sat = a.saturation / 100
  for (let i = 0; i < data.length; i += 4) {
    let r = T[Math.min(top, Math.round(LIN[data[i]] * kr * top))]
    let g = T[Math.min(top, Math.round(LIN[data[i + 1]] * kg * top))]
    let b = T[Math.min(top, Math.round(LIN[data[i + 2]] * kb * top))]
    if (sat !== 1) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = y + (r - y) * sat
      g = y + (g - y) * sat
      b = y + (b - y) * sat
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
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
