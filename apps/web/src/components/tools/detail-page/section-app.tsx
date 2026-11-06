import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Download, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToolHistory } from "@/components/tools/tool-history"
import { api, ApiError } from "@/lib/api"
import { invalidate } from "@/lib/store"
import { deserializeSections, serializeSections } from "./drafts"
import { assetDataUrls, b64ToBytes, bytesToB64, Preview, SectionEditor, squareJpg, THUMB_SIZE, toDataUrl } from "./detail-page-tool"
import { autoAlt, buildDocument, KIND_LABEL, newSection, plan, type Kind, type Picture, type Section } from "./sections"

// 디자인 툴 > 상세페이지 섹션 앱: 상세페이지 도구의 섹션 하나(썸네일·인트로·타이틀·Q&A·레시피·WHY)만 따로 만든다(같은 입력·같은 디자인).
// 썸네일은 사진을 1200×1200 정사각 JPG 로, 나머지는 서버가 Edge 로 찍은 860 폭 JPG 로 내려받는다 + alt 복사.
// 내려받으면 히스토리(도구 id: dp-{섹션})에 남고, 불러오면 사진까지 그대로 다시 채운다.

export type SectionAppKind = Extract<Kind, "thumb" | "hero" | "point" | "qa" | "recipe" | "why">

type SavedForm = { title: string; section: Section }

// 섹션 안 사진들(내려받기 전에 data URL 로 바꿔 서버에 보낸다)
function picturesOf(s: Section): Picture[] {
  const list: (Picture | null | undefined)[] =
    s.kind === "thumb" || s.kind === "hero" || s.kind === "photo" || s.kind === "gif" || s.kind === "notice"
      ? [s.image]
      : s.kind === "why"
        ? s.items.map((it) => it.image)
        : s.kind === "qa"
          ? s.items.map((it) => it.image)
          : s.kind === "ship"
            ? [...s.products, ...s.ice].map((pr) => pr.image)
            : []
  return list.filter((p): p is Picture => !!p)
}

// 내려받기 전 빠진 것
function problemOf(s: Section): string | null {
  if ((s.kind === "thumb" || s.kind === "hero") && !s.image) return "사진을 넣어 주세요."
  if (s.kind === "why" && s.items.some((it) => !it.image)) return "카드마다 사진을 넣어 주세요."
  if (s.kind === "why" && s.items.some((it) => !it.title.trim())) return "카드마다 제목을 넣어 주세요."
  if (s.kind === "point" && !s.title1.trim() && !s.title2.trim()) return "제목을 넣어 주세요."
  if (s.kind === "recipe" && !s.title.trim()) return "레시피 이름을 넣어 주세요."
  if (s.kind === "qa" && s.items.some((it) => !it.q.trim())) return "질문을 넣어 주세요."
  return null
}

export function SectionApp({ kind }: { kind: SectionAppKind }) {
  const tool = `dp-${kind}`
  const label = KIND_LABEL[kind]
  const [section, setSection] = useState<Section>(() => newSection(kind))
  const [title, setTitle] = useState("") // 히스토리 제목(제품명)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const planned = useMemo(() => plan([section]), [section])
  const p = planned[0]
  const isThumb = section.kind === "thumb"
  const [doc, setDoc] = useState("")
  useEffect(() => {
    if (isThumb) return
    const t = setTimeout(() => setDoc(buildDocument(planned, { preview: true })), 250)
    return () => clearTimeout(t)
  }, [planned, isThumb])

  const alt = isThumb ? "" : section.alt.trim() || autoAlt(p, title.trim())
  const fileName = isThumb ? `썸네일_${THUMB_SIZE}x${THUMB_SIZE}.jpg` : `${p.layer || kind}.jpg`
  const fallbackTitle = title.trim() || label

  const loadForm = async (f: SavedForm) => {
    setLoading(true)
    setError(null)
    try {
      const [next] = await deserializeSections([f.section])
      if (next?.kind === kind) setSection(next)
      setTitle(f.title ?? "")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    const problem = problemOf(section)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      let b64: string
      if (section.kind === "thumb") {
        b64 = bytesToB64(await squareJpg(section.image!))
      } else {
        const urls = new Map<Picture, string>()
        for (const pic of picturesOf(section)) if (!urls.has(pic)) urls.set(pic, await toDataUrl(pic))
        const assets = await assetDataUrls()
        const html = buildDocument(planned, { urls, assetUrl: (u) => assets.get(u) ?? u })
        const [shot] = await api<{ file: string; data: string }[]>("/tools/detail-render", { body: { html } })
        if (!shot?.data) throw new Error("이미지를 만들지 못했습니다.")
        b64 = shot.data
      }
      const url = URL.createObjectURL(new Blob([b64ToBytes(b64)], { type: "image/jpeg" }))
      const a = document.createElement("a")
      a.href = url
      a.download = title.trim() ? `${title.trim().replace(/[\\/:*?"<>|]/g, "")}_${fileName}` : fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      // 히스토리에 남긴다(사진도 올려 두어 나중에 그대로 불러온다). 실패해도 내려받기는 끝났으니 조용히 넘긴다
      void (async () => {
        const { sections, fileIds } = await serializeSections([section])
        const form: SavedForm = { title: title.trim(), section: sections[0] }
        await api(`/tools/${tool}/history`, {
          body: { title: fallbackTitle, fileName: isThumb ? "thumb.jpg" : `${kind}.jpg`, form, fileIds, image: `data:image/jpeg;base64,${b64}` },
        })
        invalidate()
      })().catch(() => {})
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
    <div className="flex w-full flex-col gap-6 p-4 md:p-6">
      <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start">
        {/* 왼쪽: 미리보기(내려받는 이미지 그대로) */}
        <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:flex-[7]">
          <h3 className="font-semibold">
            미리보기 <span className="text-xs font-normal text-muted-foreground">{isThumb ? `${THUMB_SIZE} × ${THUMB_SIZE}` : "860 폭"}</span>
          </h3>
          {isThumb ? (
            <div className="flex aspect-square w-full max-w-[600px] items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {section.kind === "thumb" && section.image ? (
                <img src={section.image.url} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-sm text-muted-foreground">사진을 넣으면 가운데를 정사각으로 잘라 보여 줍니다</span>
              )}
            </div>
          ) : (
            <Preview doc={doc} empty={false} />
          )}
        </div>

        {/* 오른쪽: 입력(상세페이지 도구의 섹션 입력 그대로) */}
        <div className="flex min-w-0 flex-col gap-4 lg:flex-[5]">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${tool}-title`}>제품명</FieldLabel>
              <Input id={`${tool}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 통영생굴무침" />
              <FieldDescription>히스토리·파일 이름으로 씁니다(이미지에는 들어가지 않음).{isThumb ? "" : " alt 자동 문구에도 들어갑니다."}</FieldDescription>
            </Field>
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                히스토리에서 불러오는 중…
              </p>
            )}
          </FieldGroup>
          <SectionEditor p={p} product={title.trim()} onChange={(patch) => setSection((s) => ({ ...s, ...patch }) as Section)} />
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            {!isThumb && (
              <>
                <span className="text-xs font-medium">alt</span>
                <p className="text-xs break-keep text-muted-foreground">{alt || "입력하면 자동으로 채워집니다"}</p>
              </>
            )}
            {error && <FieldError>{error}</FieldError>}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => void download()}>
                {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Download data-icon="inline-start" />}
                {busy ? "만드는 중…" : `JPG 내려받기 (${fileName})`}
              </Button>
              {!isThumb && (
                <Button variant="outline" disabled={!alt} onClick={() => void copyAlt()}>
                  {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                  {copied ? "복사됨" : "alt 복사"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 아래: 만든 이미지 히스토리(제품명·썸네일·다운로드·검색·불러오기) */}
      <ToolHistory<SavedForm> tool={tool} onLoad={loadForm} fileName={(t) => `${t}_${fileName}`} />
    </div>
  )
}
