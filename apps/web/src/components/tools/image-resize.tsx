import { useEffect, useRef, useState } from "react"
import { Download, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react"
import { zipSync } from "fflate"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"

// 디자인 툴 > 이미지 리사이즈: 큰 사진을 정한 크기로 줄여 내려받는다. 여러 장이면 ZIP 하나로.
// 서버에 올리지 않고 브라우저 안에서만 처리한다(큰 사진도 업로드 기다림 없음). 원본보다 키우지는 않는다.

type Item = { id: number; file: File; url: string; w: number; h: number; out?: { w: number; h: number; size: number } }
type Basis = "long" | "width" | "height"
type Format = "keep" | "jpeg" | "webp" | "png"

const BASIS: { id: Basis; label: string }[] = [
  { id: "long", label: "긴 변 기준" },
  { id: "width", label: "가로 기준" },
  { id: "height", label: "세로 기준" },
]
const PRESETS = [860, 1200, 1600, 2000, 3000]
const FORMATS: { id: Format; label: string }[] = [
  { id: "keep", label: "원본 형식 유지" },
  { id: "jpeg", label: "JPG" },
  { id: "webp", label: "WebP" },
  { id: "png", label: "PNG" },
]
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" }

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

let seq = 0

// 원본 형식 유지: JPG·PNG·WebP 는 그대로, 그 밖(GIF·BMP 등)은 JPG
const outType = (file: File, format: Format) =>
  format === "keep" ? (EXT[file.type] ? file.type : "image/jpeg") : `image/${format}`

// 줄일 크기: 기준 변이 target 보다 클 때만 비율대로 줄인다
function fit(w: number, h: number, basis: Basis, target: number) {
  const side = basis === "width" ? w : basis === "height" ? h : Math.max(w, h)
  const s = side > target ? target / side : 1
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

async function resize(item: Item, basis: Basis, target: number, format: Format, quality: number) {
  const { w, h } = fit(item.w, item.h, basis, target)
  // 브라우저가 디코딩하면서 바로 줄인다(큰 사진도 메모리를 덜 쓴다). 사진 회전 정보(EXIF)는 반영된다
  const bmp = await createImageBitmap(item.file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high", imageOrientation: "from-image" })
  const type = outType(item.file, format)
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const x = c.getContext("2d")!
  if (type === "image/jpeg") {
    x.fillStyle = "#fff" // 투명한 부분은 흰 바탕(JPG 는 투명이 없다)
    x.fillRect(0, 0, w, h)
  }
  x.drawImage(bmp, 0, 0)
  bmp.close()
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, quality / 100))
  c.width = c.height = 0
  if (!blob) throw new Error(`${item.file.name}: 변환하지 못했습니다.`)
  return { blob, w, h, name: item.file.name.replace(/\.[^.]+$/, "") + "." + EXT[type] }
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ImageResizeTool() {
  const [items, setItems] = useState<Item[]>([])
  const [basis, setBasis] = useState<Basis>("long")
  const [target, setTarget] = useState("1600")
  const [format, setFormat] = useState<Format>("keep")
  const [quality, setQuality] = useState(85)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const px = Math.round(Number(target))
  const pxOk = Number.isFinite(px) && px >= 16 && px <= 20000
  const lossy = items.some((it) => outType(it.file, format) !== "image/png")

  const add = async (files: FileList | File[]) => {
    setError(null)
    const bad: string[] = []
    const next: Item[] = []
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) {
        bad.push(file.name)
        continue
      }
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
        const url = URL.createObjectURL(file)
        urls.current.push(url)
        next.push({ id: ++seq, file, url, w: bmp.width, h: bmp.height })
        bmp.close()
      } catch {
        bad.push(file.name)
      }
    }
    setItems((cur) => [...cur, ...next])
    if (bad.length) setError(`열 수 없는 파일은 뺐습니다: ${bad.join(", ")} (JPG·PNG·WebP·GIF·BMP 를 쓸 수 있습니다. 아이폰 HEIC 는 JPG 로 바꿔 넣어 주세요.)`)
  }

  const remove = (id: number) => setItems((cur) => cur.filter((it) => it.id !== id))

  const run = async () => {
    if (!items.length || !pxOk) return
    setError(null)
    setBusy({ done: 0, total: items.length })
    try {
      const results: { name: string; blob: Blob }[] = []
      const outs = new Map<number, Item["out"]>()
      for (const it of items) {
        const r = await resize(it, basis, px, format, quality)
        results.push({ name: r.name, blob: r.blob })
        outs.set(it.id, { w: r.w, h: r.h, size: r.blob.size })
        setBusy((b) => (b ? { ...b, done: b.done + 1 } : b))
      }
      setItems((cur) => cur.map((it) => (outs.has(it.id) ? { ...it, out: outs.get(it.id) } : it)))
      if (results.length === 1) return save(results[0].blob, results[0].name)
      // 여러 장: 같은 이름은 (2), (3) 을 붙여 ZIP 하나로(사진은 이미 압축돼 있어 ZIP 압축은 하지 않는다)
      const files: Record<string, Uint8Array> = {}
      for (const r of results) {
        let name = r.name
        for (let n = 2; files[name]; n++) name = r.name.replace(/(\.[^.]+)$/, ` (${n})$1`)
        files[name] = new Uint8Array(await r.blob.arrayBuffer())
      }
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
      save(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `리사이즈_${px}px_${results.length}장_${stamp}.zip`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "리사이즈하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const totalIn = items.reduce((s, it) => s + it.file.size, 0)
  const totalOut = items.every((it) => it.out) ? items.reduce((s, it) => s + (it.out?.size ?? 0), 0) : null

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:p-6">
      {/* 사진 */}
      <div className="flex min-w-0 flex-col gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            void add(e.dataTransfer.files)
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-sm text-muted-foreground transition-colors hover:bg-accent/50 ${over ? "border-primary bg-accent/50" : ""}`}
        >
          <ImagePlus className="size-8" />
          <span className="font-medium text-foreground">사진을 끌어 놓거나 눌러서 고르세요</span>
          <span className="break-keep">여러 장을 한 번에 넣을 수 있습니다. 여러 장이면 ZIP 파일 하나로 내려받습니다.</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void add(e.target.files)
            e.target.value = ""
          }}
        />
        {error && <p className="text-sm break-keep text-destructive">{error}</p>}
        {items.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{items.length}장</span>
              <span className="text-muted-foreground tabular-nums">
                {fmtSize(totalIn)}
                {totalOut !== null && ` → ${fmtSize(totalOut)}`}
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" disabled={!!busy} onClick={() => setItems([])}>
                <Trash2 data-icon="inline-start" />
                모두 빼기
              </Button>
            </div>
            <ul className="flex flex-col divide-y rounded-xl border">
              {items.map((it) => {
                const next = fit(it.w, it.h, basis, pxOk ? px : Infinity)
                const same = next.w === it.w && next.h === it.h
                return (
                  <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                    <img src={it.url} alt="" loading="lazy" decoding="async" className="size-12 shrink-0 rounded-md bg-muted object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.file.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {it.w}×{it.h} · {fmtSize(it.file.size)}
                        {" → "}
                        <span className={same ? "" : "text-foreground"}>
                          {next.w}×{next.h}
                          {it.out && it.out.w === next.w && it.out.h === next.h ? ` · ${fmtSize(it.out.size)}` : ""}
                        </span>
                        {same && " (원본보다 크게 하지 않음)"}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`${it.file.name} 빼기`} disabled={!!busy} onClick={() => remove(it.id)}>
                      <X />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {/* 설정 */}
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="rs-px">크기</FieldLabel>
          <div className="flex gap-2">
            <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
              <SelectTrigger className="w-32 shrink-0" aria-label="크기 기준">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASIS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-0 flex-1">
              <Input id="rs-px" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!pxOk} className="pr-8 tabular-nums" />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">px</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button key={p} type="button" size="xs" variant={px === p ? "secondary" : "outline"} onClick={() => setTarget(String(p))}>
                {p}
              </Button>
            ))}
          </div>
          <FieldDescription className="break-keep">
            {pxOk ? "비율은 그대로 두고 줄입니다. 860 = 상세페이지 가로." : "16 ~ 20000 사이 숫자를 넣어 주세요."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="rs-format">저장 형식</FieldLabel>
          <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
            <SelectTrigger id="rs-format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="break-keep">원본 형식 유지: JPG·PNG·WebP 는 그대로, 그 밖의 형식은 JPG 로 저장합니다.</FieldDescription>
        </Field>

        <Field data-disabled={!lossy || undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel>화질</FieldLabel>
            <span className="text-sm text-muted-foreground tabular-nums">{quality}</span>
          </div>
          <Slider value={[quality]} min={50} max={100} step={1} disabled={!lossy} onValueChange={([v]) => setQuality(v)} aria-label="화질" />
          <FieldDescription className="break-keep">JPG·WebP 에만 적용됩니다. 85 정도면 눈으로 차이가 거의 없고 용량이 많이 줄어듭니다.</FieldDescription>
        </Field>

        <Button size="lg" disabled={!items.length || !pxOk || !!busy} onClick={() => void run()}>
          {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
          {busy ? `줄이는 중… ${busy.done}/${busy.total}` : items.length > 1 ? `${items.length}장 리사이즈 · ZIP 내려받기` : "리사이즈 · 내려받기"}
        </Button>
        {busy && <Progress value={(busy.done / busy.total) * 100} />}
      </div>
    </div>
  )
}
