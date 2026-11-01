// 동영상 → WebP 변환의 WebP 만들기를 화면과 따로(Web Worker) 돌린다. 화면이 멈추지 않게.
// 받는 말: start(크기·반복·화질·한 장 시간) → frame(RGBA, 여러 번) → finish
// 보내는 말: frame-done(몇 장째) → done(WebP 바이트)
// 브라우저는 움직이는 WebP 를 바로 만들지 못해, 장마다 정지 WebP 로 압축한 뒤(OffscreenCanvas) 움직이는 WebP 로 묶는다.
// 묶는 형식: RIFF·WEBP 안에 VP8X(움직임 표시) · ANIM(반복) · ANMF(장마다 위치·시간 + 그 장의 압축 데이터)

export type WebpWorkerIn =
  | { type: "start"; width: number; height: number; repeat: number; quality: number; delay: number }
  | { type: "frame"; data: ArrayBuffer }
  | { type: "finish" }

export type WebpWorkerOut =
  | { type: "frame-done"; index: number }
  | { type: "done"; bytes: ArrayBuffer }
  | { type: "error"; message: string }

const ascii = (s: string) => new TextEncoder().encode(s)
const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]

// 이름(4자) + 크기 + 내용(홀수면 0 하나 덧붙임)
function chunk(fourcc: string, payload: Uint8Array) {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1))
  out.set(ascii(fourcc), 0)
  out.set(u32(payload.length), 4)
  out.set(payload, 8)
  return out
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// 정지 WebP 에서 그림 데이터 묶음(ALPH·VP8·VP8L)만 꺼낸다(RIFF 머리·VP8X 는 뺀다)
function imageChunks(webp: Uint8Array) {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength)
  const parts: Uint8Array[] = []
  let alpha = false
  for (let at = 12; at + 8 <= webp.length; ) {
    const fourcc = String.fromCharCode(...webp.subarray(at, at + 4))
    const size = view.getUint32(at + 4, true)
    const end = at + 8 + size + (size & 1)
    if (fourcc === "ALPH" || fourcc === "VP8 " || fourcc === "VP8L") {
      parts.push(webp.subarray(at, Math.min(end, webp.length)))
      if (fourcc !== "VP8 ") alpha = true
    }
    at = end
  }
  return { data: concat(parts), alpha }
}

let opts: Extract<WebpWorkerIn, { type: "start" }> | null = null
let canvas: OffscreenCanvas | null = null
let frames: Uint8Array[] = []
let anyAlpha = false
// 장마다 압축은 비동기라 받은 차례대로 하나씩 처리한다
let queue: Promise<void> = Promise.resolve()

async function encode(data: ArrayBuffer) {
  const o = opts!
  const ctx = canvas!.getContext("2d")!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), o.width, o.height), 0, 0)
  const blob = await canvas!.convertToBlob({ type: "image/webp", quality: o.quality })
  if (blob.type !== "image/webp") throw new Error("이 브라우저는 WebP 로 저장하지 못합니다.")
  const { data: image, alpha } = imageChunks(new Uint8Array(await blob.arrayBuffer()))
  anyAlpha ||= alpha
  // ANMF: X/2 · Y/2 · 너비-1 · 높이-1 · 시간(ms) · 덮어쓰기(앞 장과 섞지 않음)
  const header = new Uint8Array([...u24(0), ...u24(0), ...u24(o.width - 1), ...u24(o.height - 1), ...u24(o.delay), 0b10])
  frames.push(chunk("ANMF", concat([header, image])))
  postMessage({ type: "frame-done", index: frames.length } satisfies WebpWorkerOut)
}

function finish() {
  const o = opts!
  const vp8x = chunk("VP8X", new Uint8Array([0x02 | (anyAlpha ? 0x10 : 0), 0, 0, 0, ...u24(o.width - 1), ...u24(o.height - 1)]))
  // 배경색(흰색) · 반복 횟수(0 = 계속, 1 = 한 번)
  const anim = chunk("ANIM", new Uint8Array([255, 255, 255, 255, ...u32(o.repeat === -1 ? 1 : 0).slice(0, 2)]))
  const body = concat([ascii("WEBP"), vp8x, anim, ...frames])
  const bytes = concat([ascii("RIFF"), new Uint8Array(u32(body.length)), body])
  frames = []
  postMessage({ type: "done", bytes: bytes.buffer } satisfies WebpWorkerOut, { transfer: [bytes.buffer] })
}

self.onmessage = (e: MessageEvent<WebpWorkerIn>) => {
  const msg = e.data
  if (msg.type === "start") {
    opts = msg
    canvas = new OffscreenCanvas(msg.width, msg.height)
    frames = []
    anyAlpha = false
    queue = Promise.resolve()
    return
  }
  if (!opts) return
  queue = queue
    .then(() => (msg.type === "frame" ? encode(msg.data) : finish()))
    .catch((error: unknown) => {
      opts = null
      postMessage({ type: "error", message: error instanceof Error ? error.message : "WebP 로 만들지 못했습니다." } satisfies WebpWorkerOut)
    })
}
