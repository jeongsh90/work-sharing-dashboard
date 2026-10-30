import { GIFEncoder, quantize } from "gifenc"

// 동영상 → GIF 변환의 GIF 만들기(색 줄이기·압축)를 화면과 따로(Web Worker) 돌린다. 화면이 멈추지 않게.
// 받는 말: start(크기·반복·색 수·한 장 시간) → frame(RGBA, 여러 번) → finish
// 보내는 말: frame-done(몇 장째) → done(GIF 바이트)

export type GifWorkerIn =
  | { type: "start"; width: number; height: number; repeat: number; colors: number; delay: number }
  | { type: "frame"; data: ArrayBuffer }
  | { type: "finish" }

export type GifWorkerOut = { type: "frame-done"; index: number } | { type: "done"; bytes: ArrayBuffer }

// 색 줄이기에 Floyd–Steinberg 디더링: 가장 가까운 색으로 바꾸며 생긴 차이를 옆·아래 점에 나눠 준다.
// 그냥 가까운 색으로만 바꾸면(gifenc applyPalette) 그라데이션·피부색이 계단처럼 뭉개진다.
// 차이를 다 넘기면 자글자글해지고 용량도 커져 조금 덜(STRENGTH) 넘긴다.
const STRENGTH = 0.8
function dither(rgba: Uint8Array, palette: number[][], w: number, h: number) {
  const index = new Uint8Array(w * h)
  // 가까운 색 찾기는 RGB 각 5비트(32768칸)로 묶어 한 번 찾은 값을 다시 쓴다
  const cache = new Int16Array(32768).fill(-1)
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const hit = cache[key]
    if (hit >= 0) return hit
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]
      const dr = r - p[0]
      const dg = g - p[1]
      const db = b - p[2]
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3 // 사람 눈이 초록·파랑 차이에 더 민감하다
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cache[key] = best
    return best
  }
  // 이번 줄·다음 줄에 넘길 차이(R·G·B), 양옆 한 칸씩 여유
  let cur = new Float32Array((w + 2) * 3)
  let next = new Float32Array((w + 2) * 3)
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const e = (x + 1) * 3
      const r = clamp(rgba[p] + cur[e])
      const g = clamp(rgba[p + 1] + cur[e + 1])
      const b = clamp(rgba[p + 2] + cur[e + 2])
      const i = nearest(r | 0, g | 0, b | 0)
      index[y * w + x] = i
      const c = palette[i]
      const er = (r - c[0]) * STRENGTH
      const eg = (g - c[1]) * STRENGTH
      const eb = (b - c[2]) * STRENGTH
      // 오른쪽 7/16 · 왼쪽 아래 3/16 · 아래 5/16 · 오른쪽 아래 1/16
      cur[e + 3] += (er * 7) / 16
      cur[e + 4] += (eg * 7) / 16
      cur[e + 5] += (eb * 7) / 16
      next[e - 3] += (er * 3) / 16
      next[e - 2] += (eg * 3) / 16
      next[e - 1] += (eb * 3) / 16
      next[e] += (er * 5) / 16
      next[e + 1] += (eg * 5) / 16
      next[e + 2] += (eb * 5) / 16
      next[e + 3] += er / 16
      next[e + 4] += eg / 16
      next[e + 5] += eb / 16
    }
    ;[cur, next] = [next, cur]
    next.fill(0)
  }
  return index
}

let encoder: ReturnType<typeof GIFEncoder> | null = null
let opts: Extract<GifWorkerIn, { type: "start" }> | null = null
let count = 0

self.onmessage = (e: MessageEvent<GifWorkerIn>) => {
  const msg = e.data
  if (msg.type === "start") {
    encoder = GIFEncoder()
    opts = msg
    count = 0
    return
  }
  if (!encoder || !opts) return
  if (msg.type === "frame") {
    const rgba = new Uint8Array(msg.data)
    // 장마다 색표를 따로 만들어 장면이 바뀌어도 색이 덜 뭉개지게 한다
    const palette = quantize(rgba, opts.colors)
    const index = dither(rgba, palette, opts.width, opts.height)
    encoder.writeFrame(index, opts.width, opts.height, { palette, delay: opts.delay, repeat: opts.repeat })
    count++
    postMessage({ type: "frame-done", index: count } satisfies GifWorkerOut)
    return
  }
  encoder.finish()
  const bytes = encoder.bytes() as Uint8Array<ArrayBuffer>
  encoder = null
  postMessage({ type: "done", bytes: bytes.buffer } satisfies GifWorkerOut, { transfer: [bytes.buffer] })
}
