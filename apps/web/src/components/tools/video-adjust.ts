// 동영상 → WebP·GIF 색 보정: 포토샵 "노출"(노출·오프셋·감마 교정)과 "색조/채도"(색조·채도·명도)를 장면마다 그대로 적용한다.
// 노출·오프셋·감마는 빛 세기(선형) 기준으로 계산해 256칸 표로 만들어 두고, 색조·채도·명도는 HSL 로 바꿔 고친다.

export type Adjust = {
  exposure: number // -5 ~ +5 (EV, 1 = 두 배 밝게)
  offset: number // -0.5 ~ +0.5 (어두운 부분을 올리거나 내림)
  gamma: number // 0.1 ~ 9.99 (1 = 그대로, 클수록 중간톤이 밝아짐)
  hue: number // -180 ~ +180 (도)
  saturation: number // -100 ~ +100
  lightness: number // -100 ~ +100
}

export const NO_ADJUST: Adjust = { exposure: 0, offset: 0, gamma: 1, hue: 0, saturation: 0, lightness: 0 }

export const isNoAdjust = (a: Adjust) =>
  a.exposure === 0 && a.offset === 0 && a.gamma === 1 && a.hue === 0 && a.saturation === 0 && a.lightness === 0

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

// 노출·오프셋·감마 표(입력 0~255 → 출력 0~255)
function toneTable(a: Adjust) {
  const lut = new Uint8ClampedArray(256)
  const gain = 2 ** a.exposure
  const inv = 1 / Math.max(0.01, a.gamma)
  for (let i = 0; i < 256; i++) {
    let v = toLinear(i / 255) * gain + a.offset
    v = Math.min(1, Math.max(0, v)) ** inv
    lut[i] = Math.round(toSrgb(v) * 255)
  }
  return lut
}

// 장면 하나(RGBA)를 그 자리에서 고친다
export function applyAdjust(data: Uint8ClampedArray, a: Adjust) {
  if (isNoAdjust(a)) return
  const tone = a.exposure !== 0 || a.offset !== 0 || a.gamma !== 1 ? toneTable(a) : null
  const hsl = a.hue !== 0 || a.saturation !== 0 || a.lightness !== 0
  const hueShift = a.hue / 360
  const sat = a.saturation / 100
  const light = a.lightness / 100
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    if (tone) {
      r = tone[r]
      g = tone[g]
      b = tone[b]
    }
    if (hsl) {
      // RGB → HSL
      const R = r / 255
      const G = g / 255
      const B = b / 255
      const max = Math.max(R, G, B)
      const min = Math.min(R, G, B)
      let h = 0
      let s = 0
      const l = (max + min) / 2
      const d = max - min
      if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        if (max === R) h = (G - B) / d + (G < B ? 6 : 0)
        else if (max === G) h = (B - R) / d + 2
        else h = (R - G) / d + 4
        h /= 6
      }
      // 색조는 돌리고, 채도는 늘리거나 줄인다(+100 이면 거의 최대, -100 이면 흑백)
      h = (h + hueShift + 1) % 1
      s = sat >= 0 ? s + (1 - s) * sat * s : s * (1 + sat)
      // HSL → RGB
      let nr = l
      let ng = l
      let nb = l
      if (s > 0) {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        const ch = (t: number) => {
          if (t < 0) t += 1
          if (t > 1) t -= 1
          if (t < 1 / 6) return p + (q - p) * 6 * t
          if (t < 1 / 2) return q
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
          return p
        }
        nr = ch(h + 1 / 3)
        ng = ch(h)
        nb = ch(h - 1 / 3)
      }
      // 명도: + 는 흰색 쪽으로, - 는 검은색 쪽으로 섞는다(포토샵 색조/채도의 명도와 같은 방식)
      if (light > 0) {
        nr += (1 - nr) * light
        ng += (1 - ng) * light
        nb += (1 - nb) * light
      } else if (light < 0) {
        nr *= 1 + light
        ng *= 1 + light
        nb *= 1 + light
      }
      r = nr * 255
      g = ng * 255
      b = nb * 255
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}
