import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Download, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FieldError, FieldGroup } from "@/components/ui/field"
import { api, ApiError } from "@/lib/api"
import { assetDataUrls, b64ToBytes, Preview, ShipGroup, toDataUrl } from "./detail-page-tool"
import { autoAlt, buildDocument, newSection, plan, type Picture, type Section } from "./sections"

// 디자인 툴 > 이렇게 보내드려요: 상세페이지 도구의 "이렇게 보내드려요" 섹션만 따로 만든다(같은 입력·같은 디자인).
// 내용량·아이스박스 포장(정사각형 사진 최대 4개 + 사진 아래 글 + ※ 안내) → 서버가 Edge 로 찍은 860 폭 JPG(p.jpg) 내려받기 + alt 복사.

type Ship = Extract<Section, { kind: "ship" }>

export function ShipTool() {
  const [ship, setShip] = useState<Ship>(() => newSection("ship") as Ship)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const planned = useMemo(() => plan([{ ...ship, layer: "p" }]), [ship])
  const [doc, setDoc] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDoc(buildDocument(planned, { preview: true })), 250)
    return () => clearTimeout(t)
  }, [planned])

  const update = (patch: Partial<Ship>) => setShip((s) => ({ ...s, ...patch }))
  const items = [...ship.products, ...ship.ice]
  const missing = items.some((pr) => !pr.image)
  const alt = autoAlt(planned[0], "")

  const download = async () => {
    if (missing) return setError("빈 사진 칸에 사진을 넣거나 칸을 빼 주세요.")
    setError(null)
    setBusy(true)
    try {
      const urls = new Map<Picture, string>()
      for (const pr of items) if (pr.image && !urls.has(pr.image)) urls.set(pr.image, await toDataUrl(pr.image))
      const assets = await assetDataUrls()
      const html = buildDocument(planned, { urls, assetUrl: (u) => assets.get(u) ?? u })
      const [shot] = await api<{ file: string; data: string }[]>("/tools/detail-render", { body: { html } })
      const url = URL.createObjectURL(new Blob([b64ToBytes(shot.data)], { type: "image/jpeg" }))
      const a = document.createElement("a")
      a.href = url
      a.download = "p.jpg"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "만들지 못했습니다.")
    } finally {
      setBusy(false)
    }
  }

  const copyAlt = async () => {
    await navigator.clipboard.writeText(alt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="flex w-full flex-col gap-6 p-4 md:p-6 lg:flex-row lg:items-start">
      {/* 왼쪽: 미리보기(내려받는 이미지 그대로) */}
      <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:flex-[7]">
        <h3 className="font-semibold">미리보기</h3>
        <Preview doc={doc} empty={false} />
      </div>

      {/* 오른쪽: 입력 */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-[5]">
        <FieldGroup>
          <ShipGroup
            id="ship-p"
            label="내용량"
            items={ship.products}
            note={ship.productNote}
            capHint="예: 225g"
            onItems={(products) => update({ products })}
            onNote={(productNote) => update({ productNote })}
          />
          <ShipGroup
            id="ship-i"
            label="아이스박스 포장"
            items={ship.ice}
            note={ship.iceNote}
            capHint="없으면 비움"
            onItems={(ice) => update({ ice })}
            onNote={(iceNote) => update({ iceNote })}
            preset
          />
        </FieldGroup>
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <span className="text-xs font-medium">alt</span>
          <p className="text-xs break-keep text-muted-foreground">{alt}</p>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => void download()}>
              {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Download data-icon="inline-start" />}
              {busy ? "만드는 중…" : "JPG 내려받기 (p.jpg)"}
            </Button>
            <Button variant="outline" onClick={() => void copyAlt()}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "복사됨" : "alt 복사"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
