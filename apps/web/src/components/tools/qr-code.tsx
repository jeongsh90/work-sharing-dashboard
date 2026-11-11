import { useEffect, useMemo, useState } from "react"
import { CircleAlert, Download, Link2 } from "lucide-react"
import qrcode from "qrcode-generator"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ColorSwatchPicker } from "@/components/tools/color-palette"

// 디자인 툴 > QR코드: URL 을 넣으면 QR 코드를 그리고 PNG(크기 선택) 또는 SVG(벡터)로 내려받는다.
// 한글 주소도 읽히게 UTF-8 바이트로 넣는다(라이브러리 기본은 글자마다 1바이트라 한글이 깨진다).
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s))

type Level = "L" | "M" | "Q" | "H"
const LEVELS: { id: Level; label: string }[] = [
  { id: "L", label: "낮음 (7%)" },
  { id: "M", label: "보통 (15%)" },
  { id: "Q", label: "높음 (25%)" },
  { id: "H", label: "매우 높음 (30%)" },
]
const SIZES = [256, 512, 1024, 2048]
const MARGIN = 4 // 바깥 여백(칸 수). QR 규격 권장 4칸

const HEX = /^#?([0-9a-f]{6})$/i
const hexOf = (v: string, fallback: string) => {
  const m = HEX.exec(v.trim())
  return m ? `#${m[1].toLowerCase()}` : fallback
}

// 주소 앞에 http(s):// 가 없고 도메인처럼 보이면 https:// 를 붙인다
function normalize(raw: string) {
  const s = raw.trim()
  if (!s) return ""
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
  if (/^[^\s/]+\.[^\s/]+/.test(s)) return `https://${s}`
  return s
}
const looksLikeUrl = (s: string) => {
  try {
    const u = new URL(s)
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")
  } catch {
    return false
  }
}

// 모듈(검은 칸) 표: 너무 길면 null
function makeMatrix(text: string, level: Level) {
  if (!text) return null
  try {
    const q = qrcode(0, level)
    q.addData(text, "Byte")
    q.make()
    const n = q.getModuleCount()
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)))
  } catch {
    return null
  }
}

// SVG: 한 줄씩 이어진 검은 칸을 가로 막대로 묶어 path 하나로(칸 사이 틈 없음)
function toSvg(m: boolean[][], fg: string, bg: string) {
  const n = m.length
  const total = n + MARGIN * 2
  let d = ""
  m.forEach((row, r) => {
    let c = 0
    while (c < n) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < n && row[c]) c++
      d += `M${start + MARGIN} ${r + MARGIN}h${c - start}v1h-${c - start}z`
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 10}" height="${total * 10}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`
}

// PNG: size×size 캔버스. 칸 경계를 정수 픽셀로 반올림해 흐릿한 선이 없게
function toPngBlob(m: boolean[][], size: number, fg: string, bg: string) {
  const n = m.length
  const total = n + MARGIN * 2
  const c = document.createElement("canvas")
  c.width = size
  c.height = size
  const x = c.getContext("2d")!
  x.fillStyle = bg
  x.fillRect(0, 0, size, size)
  x.fillStyle = fg
  const at = (i: number) => Math.round(((i + MARGIN) * size) / total)
  m.forEach((row, r) =>
    row.forEach((dark, col) => {
      if (dark) x.fillRect(at(col), at(r), at(col + 1) - at(col), at(r + 1) - at(r))
    }),
  )
  return new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"))
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 파일 이름: 주소의 도메인(없으면 qrcode)
function fileBase(text: string) {
  try {
    return `qr_${new URL(text).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "_")}`
  } catch {
    return "qrcode"
  }
}

function ColorField({ label, value, onChange, fallback }: { label: string; value: string; onChange: (v: string) => void; fallback: string }) {
  const ok = HEX.test(value.trim())
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <ColorSwatchPicker value={hexOf(value, fallback)} label={label} swatch={{ background: hexOf(value, fallback) }} onPick={onChange} className="size-8" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={fallback} aria-label={`${label} 색상값`} aria-invalid={!ok} className="font-mono" />
      </div>
    </Field>
  )
}

export function QrCodeTool() {
  const [raw, setRaw] = useState("")
  const [level, setLevel] = useState<Level>("M")
  const [size, setSize] = useState(1024)
  const [fg, setFg] = useState("#000000")
  const [bg, setBg] = useState("#ffffff")
  const [busy, setBusy] = useState(false)

  const text = normalize(raw)
  const fgHex = hexOf(fg, "#000000")
  const bgHex = hexOf(bg, "#ffffff")
  const matrix = useMemo(() => makeMatrix(text, level), [text, level])
  const svg = useMemo(() => (matrix ? toSvg(matrix, fgHex, bgHex) : ""), [matrix, fgHex, bgHex])
  const [preview, setPreview] = useState("")
  useEffect(() => {
    if (!svg) return setPreview("")
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [svg])

  const tooLong = !!text && !matrix
  const notUrl = !!text && !!matrix && !looksLikeUrl(text)
  const base = fileBase(text)

  const downloadPng = async () => {
    if (!matrix) return
    setBusy(true)
    try {
      const blob = await toPngBlob(matrix, size, fgHex, bgHex)
      if (blob) save(blob, `${base}_${size}.png`)
    } finally {
      setBusy(false)
    }
  }
  const downloadSvg = () => {
    if (svg) save(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`)
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:p-6">
      {/* 입력 */}
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="qr-url">URL</FieldLabel>
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="qr-url" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="https://www.chefechan.com" className="pl-8" autoFocus autoComplete="off" spellCheck={false} />
          </div>
          <FieldDescription className="break-keep">
            {text && text !== raw.trim() ? (
              <>
                <span className="font-mono break-all">{text}</span> 로 만듭니다.
              </>
            ) : (
              "주소를 넣으면 바로 QR 코드가 만들어집니다. https:// 를 빼고 넣어도 됩니다."
            )}
          </FieldDescription>
        </Field>

        {tooLong && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription className="break-keep">주소가 너무 길어 QR 코드에 담을 수 없습니다. 오류 복원 수준을 낮추거나 주소를 줄여 주세요.</AlertDescription>
          </Alert>
        )}
        {notUrl && (
          <Alert>
            <CircleAlert />
            <AlertDescription className="break-keep">웹 주소 형식이 아닙니다. 휴대폰으로 찍으면 글자로만 보일 수 있습니다.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>오류 복원 수준</FieldLabel>
            <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription className="break-keep">높을수록 일부가 가려져도 읽히지만 칸이 촘촘해집니다.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>PNG 크기</FieldLabel>
            <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} × {s} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription className="break-keep">SVG 는 크기와 상관없이 늘려도 선명합니다.</FieldDescription>
          </Field>
          <ColorField label="QR 색" value={fg} onChange={setFg} fallback="#000000" />
          <ColorField label="배경색" value={bg} onChange={setBg} fallback="#ffffff" />
        </div>
      </div>

      {/* 미리보기 + 다운로드 */}
      <div className="flex flex-col gap-3">
        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
          {preview ? (
            <img src={preview} alt={`${text} QR 코드`} className="size-full object-contain" />
          ) : (
            <p className="px-6 text-center text-sm break-keep text-muted-foreground">URL 을 넣으면 여기에 QR 코드가 보입니다.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={downloadPng} disabled={!matrix || busy}>
            <Download />
            PNG
          </Button>
          <Button variant="outline" onClick={downloadSvg} disabled={!matrix}>
            <Download />
            SVG
          </Button>
        </div>
        {matrix && (
          <p className="text-center text-xs text-muted-foreground tabular-nums">
            {matrix.length} × {matrix.length} 칸 · 여백 {MARGIN}칸
          </p>
        )}
      </div>
    </div>
  )
}
