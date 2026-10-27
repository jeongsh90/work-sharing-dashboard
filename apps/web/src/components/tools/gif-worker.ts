import { applyPalette, GIFEncoder, quantize } from "gifenc"

// 동영상 → GIF 변환의 GIF 만들기(색 줄이기·압축)를 화면과 따로(Web Worker) 돌린다. 화면이 멈추지 않게.
// 받는 말: start(크기·반복·색 수·한 장 시간) → frame(RGBA, 여러 번) → finish
// 보내는 말: frame-done(몇 장째) → done(GIF 바이트)

export type GifWorkerIn =
  | { type: "start"; width: number; height: number; repeat: number; colors: number; delay: number }
  | { type: "frame"; data: ArrayBuffer }
  | { type: "finish" }

export type GifWorkerOut = { type: "frame-done"; index: number } | { type: "done"; bytes: ArrayBuffer }

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
    const index = applyPalette(rgba, palette)
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
