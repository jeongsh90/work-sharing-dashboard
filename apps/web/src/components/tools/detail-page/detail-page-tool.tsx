import { useEffect, useMemo, useRef, useState } from "react"
import { zipSync } from "fflate"
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  ClipboardList,
  Download,
  Film,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  ImagePlus,
  LayoutTemplate,
  LoaderCircle,
  Package,
  Save,
  Square as SquareIcon,
  Plus,
  Trash2,
  Type,
  UtensilsCrossed,
  ListChecks,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { SortableList } from "@/components/sortable-list"
import { EmphasisTextarea } from "@/components/tools/emphasis-textarea"
import { api, ApiError, formatBytes } from "@/lib/api"
import {
  altOf,
  autoAlt,
  buildContentHtml,
  buildDocument,
  CATEGORIES,
  COMMON,
  DEFAULT_GRAD_FROM,
  DEFAULT_GRAD_TO,
  gradRgba,
  parseHex,
  KIND_LABEL,
  newSection,
  nextId,
  PHOTO_TAGS,
  SHIP_MAX,
  plan,
  type GradStop,
  type Kind,
  type Picture,
  type Planned,
  type Section,
  type ShipProduct,
  type WhyItem,
} from "./sections"
import { DraftBar, deserializeSections, serializeSections, type CurrentDraft, type DraftControls, type DraftState, type LoadProgress } from "./drafts"
import { Progress } from "@/components/ui/progress"
import { ToolHistory } from "@/components/tools/tool-history"
import { DEFAULT_ZOOM, ZoomControl } from "@/components/tools/zoom-control"
import { ColorSwatchPicker } from "@/components/tools/color-palette"
import { invalidate } from "@/lib/store"
import iceboxUrl from "./assets/icebox.png"
import logoUrl from "./assets/logo.svg"
import patternUrl from "./assets/point-pattern.png"
import bubbleUrl from "./assets/qa-bubble.svg"
import { Tip } from "@/components/tip"

// 디자인 툴 > 상세페이지: 섹션을 하나씩 더해 상세페이지를 만든다(상세페이지 스킬 디자인 그대로).
// 왼쪽 = 미리보기(860 폭을 줄여 보여 줌, 누르면 그 섹션 입력으로), 오른쪽 = 입력(위 버튼으로 섹션 추가).
// "제작 완료"를 누르면 서버가 Edge 로 섹션마다 860 폭 JPG 를 찍고, 파일(NN_이름) + 관리자용 content.html 을 zip 으로 받는다.
// 공통 이미지는 주소만 넣고, 맨 아래 공통(about8·award8·고객센터 z8)은 미리보기에 보이지 않고 완성 HTML 끝에 늘 붙는다.

const ADD: { kind: Kind; label: string; icon: LucideIcon }[] = [
  { kind: "thumb", label: "썸네일", icon: SquareIcon },
  { kind: "hero", label: "인트로", icon: LayoutTemplate },
  { kind: "point", label: "타이틀", icon: Type },
  { kind: "photo", label: "이미지", icon: ImageIcon },
  { kind: "gif", label: "움짤", icon: Film },
  { kind: "qa", label: "Q&A", icon: HelpCircle },
  { kind: "recipe", label: "레시피", icon: UtensilsCrossed },
  { kind: "why", label: "WHY", icon: ListChecks },
  { kind: "ship", label: "이렇게 보내드려요", icon: Package },
  { kind: "notice", label: "상품정보고시", icon: ClipboardList },
]

// 고른 그림 파일 → 미리보기 주소 + 크기
export function readPicture(file: File): Promise<Picture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ url, name: file.name, width: img.naturalWidth, height: img.naturalHeight, file })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("그림을 열지 못했습니다."))
    }
    img.src = url
  })
}

// 렌더용: 860 폭보다 크면 860 으로 줄인 JPG, 아니면 원본 그대로(data:)
// 썸네일: 가운데를 정사각으로 잘라 1200×1200 JPG
export const THUMB_SIZE = 1200
export async function squareJpg(p: Picture, size = THUMB_SIZE): Promise<Uint8Array> {
  const img = new Image()
  img.src = p.url
  await img.decode()
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("썸네일을 만들지 못했습니다."))), "image/jpeg", 0.92))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function toDataUrl(p: Picture, max = 860): Promise<string> {
  if (p.width <= max) {
    return new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsDataURL(p.file)
    })
  }
  const img = new Image()
  img.src = p.url
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = max
  canvas.height = Math.round((p.height * max) / p.width)
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.95)
}

export async function assetDataUrls() {
  const map = new Map<string, string>()
  for (const u of [iceboxUrl, logoUrl, patternUrl, bubbleUrl]) {
    const blob = await (await fetch(u)).blob()
    map.set(u, await new Promise<string>((r) => {
      const fr = new FileReader()
      fr.onload = () => r(String(fr.result))
      fr.readAsDataURL(blob)
    }))
  }
  return map
}

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
export const bytesToB64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(s)
}

// 제작 전에 빠진 것: 입력 칸 id 또는 섹션 번호(누르면 그리로 이동)
type Problem = { text: string; el?: string; section?: number }

type Result = { files: { file: string; size: number }[]; zipUrl: string; zipName: string; html: string }

export function DetailPageTool() {
  const [product, setProduct] = useState("")
  const [category, setCategory] = useState("")
  const [number, setNumber] = useState("")
  const [sections, setSections] = useState<Section[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [draft, setDraft] = useState<CurrentDraft | null>(null)
  const cards = useRef(new Map<number, HTMLDivElement>())
  const drafts = useRef<DraftControls>(null)
  // 임시 저장·히스토리를 불러오는 동안 그림 받는 진행률
  const [loading, setLoading] = useState<LoadProgress | null>(null)
  // 접어 둔 섹션(id). 접으면 머리줄만 보이고 입력 칸은 숨긴다
  const [folded, setFolded] = useState<Set<number>>(new Set())
  const allFolded = sections.length > 0 && sections.every((x) => folded.has(x.id))
  const toggleFold = (id: number) =>
    setFolded((f) => {
      const next = new Set(f)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const planned = useMemo(() => plan(sections), [sections])
  const folder = category && number.trim() ? `${category}/${Number(number.trim())}` : ""

  // 미리보기 문서: 입력이 멈춘 뒤(0.25초) 다시 만든다
  const [doc, setDoc] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDoc(buildDocument(planned, { preview: true, selected })), 250)
    return () => clearTimeout(t)
  }, [planned, selected])

  // 미리보기에서 섹션을 누르면 오른쪽 입력으로
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const i = (e.data as { detailPageSelect?: number })?.detailPageSelect
      if (typeof i !== "number") return
      const s = sections[i]
      if (!s) return
      setSelected(i)
      setFolded((f) => (f.has(s.id) ? new Set([...f].filter((x) => x !== s.id)) : f))
      cards.current.get(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    window.addEventListener("message", on)
    return () => window.removeEventListener("message", on)
  }, [sections])

  useEffect(() => () => void (result && URL.revokeObjectURL(result.zipUrl)), [result])

  const add = (kind: Kind) => {
    // 썸네일은 하나만, 늘 맨 위
    if (kind === "thumb") {
      const have = sections.findIndex((x) => x.kind === "thumb")
      if (have >= 0) {
        setSelected(have)
        requestAnimationFrame(() => cards.current.get(sections[have].id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
        return
      }
      const t = newSection("thumb")
      setSections((list) => [t, ...list])
      setSelected(0)
      requestAnimationFrame(() => cards.current.get(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
      return
    }
    const s = newSection(kind)
    // 고른 섹션 바로 뒤에, 없으면 맨 끝에
    const at = selected !== null && selected < sections.length ? selected + 1 : sections.length
    setSections((list) => [...list.slice(0, at), s, ...list.slice(at)])
    setSelected(at)
    requestAnimationFrame(() => cards.current.get(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const update = (id: number, patch: Partial<Section>) =>
    setSections((list) => list.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)))
  const remove = async (s: Section) => {
    if (!(await confirmDialog({ title: `${KIND_LABEL[s.kind]} 섹션을 지울까요?`, confirmText: "삭제", destructive: true }))) return
    setSections((list) => list.filter((x) => x.id !== s.id))
    setSelected(null)
  }
  const move = (i: number, d: -1 | 1) =>
    setSections((list) => {
      const j = i + d
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      setSelected(j)
      return next
    })

  // 빠진 것 확인. 문구를 누르면 그 칸(입력 id) 또는 그 섹션(번호)으로 옮겨 간다
  const problems = useMemo(() => {
    const out: Problem[] = []
    if (!product.trim()) out.push({ text: "상품명을 입력해 주세요.", el: "dp-product" })
    if (!folder) out.push({ text: "업로드 폴더(카테고리·번호)를 정해 주세요.", el: category ? "dp-num" : "dp-cat" })
    if (planned.every((p) => !p.file)) out.push({ text: "섹션을 하나 이상 추가해 주세요." })
    planned.forEach((p, i) => {
      const s = p.section
      const n = `${i + 1}번 ${KIND_LABEL[s.kind]}`
      const at = (text: string) => out.push({ text: `${n}: ${text}`, section: i })
      if ((s.kind === "thumb" || s.kind === "hero" || s.kind === "photo" || s.kind === "gif" || s.kind === "notice") && !s.image) at("그림을 넣어 주세요.")
      if (s.kind === "why" && s.items.some((it) => !it.image)) at("카드마다 사진을 넣어 주세요.")
      if (s.kind === "why" && s.items.some((it) => !it.title.trim())) at("카드마다 제목을 넣어 주세요.")
      if (s.kind === "ship" && [...s.products, ...s.ice].some((pr) => !pr.image)) at("내용량·아이스박스 포장의 빈 사진 칸에 사진을 넣거나 칸을 빼 주세요.")
      if (s.kind === "common" && s.which === "url" && !/^https?:\/\//.test(s.url.trim())) at("공통 이미지 주소를 넣어 주세요.")
      if (s.kind === "common" && s.which === "url" && !s.alt.trim()) at("공통 이미지 alt 를 넣어 주세요.")
      if (p.file && !altOf(p, product).replace(/[-\s]/g, "")) at("alt 가 비었습니다.")
    })
    const names = planned.map((p) => p.file)
    const dup = names.findIndex((f, i) => f && names.indexOf(f) !== i)
    if (dup >= 0) out.push({ text: "파일 이름이 겹칩니다. 섹션의 파일 이름을 바꿔 주세요.", section: dup })
    return out
  }, [planned, product, folder, category])

  // 빠진 칸으로 이동: 섹션이면 펼쳐서 그 카드로, 입력이면 그 칸에 커서
  const [errorAt, setErrorAt] = useState<Problem | null>(null)
  const goTo = (pr: Problem) => {
    if (pr.section !== undefined) {
      const s = sections[pr.section]
      if (!s) return
      setSelected(pr.section)
      setFolded((f) => (f.has(s.id) ? new Set([...f].filter((x) => x !== s.id)) : f))
      requestAnimationFrame(() => cards.current.get(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }))
      return
    }
    const el = pr.el ? document.getElementById(pr.el) : null
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.focus({ preventScroll: true })
  }

  const finish = async () => {
    if (problems.length) {
      setError(problems[0].text)
      setErrorAt(problems[0])
      goTo(problems[0])
      return
    }
    setErrorAt(null)
    setError(null)
    setResult(null)
    try {
      setBusy("그림 준비 중")
      const urls = new Map<Picture, string>()
      for (const p of planned) {
        const s = p.section
        const pics: (Picture | null)[] =
          s.kind === "hero" || s.kind === "photo" || s.kind === "notice" ? [s.image] : s.kind === "ship" ? [...s.products, ...s.ice].map((pr) => pr.image) : s.kind === "why" ? s.items.map((it) => it.image) : s.kind === "qa" ? s.items.map((it) => it.image ?? null) : []
        for (const pic of pics) if (pic && !urls.has(pic)) urls.set(pic, await toDataUrl(pic))
      }
      const assets = await assetDataUrls()
      // 움짤은 찍지 않는다(파일 그대로 올림)
      const rendered = planned.filter((p) => p.file && p.section.kind !== "gif")
      const html = buildDocument(rendered, { urls, assetUrl: (u) => assets.get(u) ?? u })
      setBusy("서버에서 섹션을 이미지로 만드는 중")
      const shots = await api<{ file: string; data: string }[]>("/tools/detail-render", { body: { html } })
      setBusy("zip 만드는 중")
      const files: Record<string, Uint8Array> = {}
      const list: Result["files"] = []
      const shotOf = new Map(shots.map((s) => [s.file, s.data]))
      for (const p of planned) {
        if (!p.file) continue
        const s = p.section
        const bytes = s.kind === "gif" ? new Uint8Array(await s.image!.file.arrayBuffer()) : b64ToBytes(shotOf.get(p.file) ?? "")
        if (!bytes.length) throw new Error(`${p.file} 를 만들지 못했습니다.`)
        files[`${folder}/${p.file}`] = bytes
        list.push({ file: `${folder}/${p.file}`, size: bytes.length })
      }
      // 썸네일(대표 이미지): zip 맨 위에 따로. 상세·content.html 에는 넣지 않는다
      const thumbSec = sections.find((x): x is Extract<Section, { kind: "thumb" }> => x.kind === "thumb")
      let thumbJpg: Uint8Array | null = null
      if (thumbSec?.image) {
        thumbJpg = await squareJpg(thumbSec.image)
        const name = `썸네일_${product.trim()}_${THUMB_SIZE}x${THUMB_SIZE}.jpg`
        files[name] = thumbJpg
        list.unshift({ file: name, size: thumbJpg.length })
      }
      const content = buildContentHtml(planned, product, folder)
      files["content.html"] = new TextEncoder().encode(content)
      const zip = zipSync(files, { level: 0 })
      const zipName = `상세페이지_${product.trim()}_${folder.replace("/", "")}.zip`
      const zipUrl = URL.createObjectURL(new Blob([zip], { type: "application/zip" }))
      setResult({ files: list, zipUrl, zipName, html: content })
      const a = document.createElement("a")
      a.href = zipUrl
      a.download = zipName
      a.click()
      // 히스토리에 남긴다(첫 섹션 이미지를 썸네일로, 입력은 그림까지 올려 두어 나중에 그대로 불러온다). 실패해도 내려받기는 끝났으니 조용히 넘긴다
      const thumb = thumbJpg ? bytesToB64(thumbJpg) : shots.find((x) => x.data)?.data
      if (thumb) {
        void (async () => {
          const { sections: saved, fileIds } = await serializeSections(sections)
          const form: DraftState = { product: product.trim(), category, number, sections: saved }
          await api("/tools/detail-page/history", { body: { title: product.trim(), fileName: "thumb.jpg", form, fileIds, image: `data:image/jpeg;base64,${thumb}` } })
          invalidate()
        })().catch(() => {})
      }
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "만들지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const loadState = (st: DraftState, d: CurrentDraft | null) => {
    setProduct(st.product)
    setCategory(st.category)
    setNumber(st.number)
    setSections(st.sections)
    setSelected(null)
    setResult(null)
    setError(null)
    setDraft(d)
  }

  // 히스토리에서 불러오기: 그때 입력(그림 포함)을 그대로 다시 채운다(임시 저장과는 따로)
  const loadHistory = async (f: DraftState) => {
    if (sections.length > 0 && !(await confirmDialog({ title: "히스토리 내용을 불러올까요?", description: "지금 화면에 만들던 내용은 사라집니다(필요하면 먼저 임시 저장하세요).", confirmText: "불러오기" })))
      return
    setBusy("히스토리 불러오는 중")
    try {
      loadState({ product: f.product ?? "", category: f.category ?? "", number: f.number ?? "", sections: await deserializeSections(f.sections ?? [], setLoading) }, null)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "불러오지 못했습니다.")
    } finally {
      setBusy(null)
      setLoading(null)
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4 md:p-6 lg:pr-28">
      {/* 불러오는 중: 화면 가운데 진행 막대(그림 n / 전체 장, 지금 그림 받은 정도) */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" role="status" aria-live="polite">
          <div className="flex w-80 flex-col gap-3 rounded-xl border bg-card p-5 shadow-xl">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              그림 불러오는 중
              <span className="ml-auto text-muted-foreground tabular-nums">
                {Math.min(loading.done + 1, Math.max(loading.total, 1))} / {Math.max(loading.total, 1)}장
              </span>
            </div>
            <Progress value={loading.total ? ((loading.done + loading.ratio) / loading.total) * 100 : 100} />
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {loading.total ? `${Math.round(((loading.done + loading.ratio) / loading.total) * 100)}%${loading.name ? ` · ${loading.name}` : ""}` : "내용 불러오는 중…"}
            </span>
          </div>
        </div>
      )}
      {/* 맨 위: 임시 저장(본사 자료를 기다리는 동안 만든 내용을 저장해 두고 나중에 이어서) */}
      <div className="rounded-xl border bg-card px-3 py-2">
        <DraftBar controlRef={drafts} onProgress={setLoading} state={{ product, category, number, sections }} current={draft} onSaved={setDraft} onLoad={(st, d) => loadState(st, d)} />
      </div>
    <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
      {/* 왼쪽: 미리보기 */}
      <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:flex-[7]">
        <div className="flex items-center gap-2">
          <h3 className="mr-auto font-semibold">미리보기</h3>
          <span className="text-xs text-muted-foreground">섹션을 누르면 오른쪽 입력으로 갑니다 · 하단 공통 영역은 완성할 때 자동으로 붙습니다</span>
        </div>
        <Preview doc={doc} empty={sections.length === 0} />
      </div>

      {/* 섹션 추가 도구 막대: 넓은 화면은 화면 오른쪽 위(입력 칸 위쪽과 같은 높이)에 세로로 고정, 좁은 화면은 가로로 늘어놓음 */}
      <div className="flex shrink-0 flex-col gap-1 lg:fixed lg:top-[85px] lg:right-4 lg:z-20" role="toolbar" aria-label="섹션 추가">
        <div className="flex flex-wrap gap-1 rounded-xl border bg-card p-1 lg:w-[76px] lg:flex-col">
          {ADD.map((a) => (
            <Tip key={a.kind} content={`${a.label} 추가${selected !== null && sections[selected] ? " (고른 섹션 뒤에)" : ""}`}><Button
              variant="ghost"
              className="h-auto flex-col gap-1 px-1 py-2 text-[11px] leading-tight font-normal break-keep whitespace-normal lg:w-full [@media(max-height:880px)]:gap-0.5 [@media(max-height:880px)]:py-1"
              onClick={() => add(a.kind)}
            >
              <a.icon className="size-5" />
              {a.label}
            </Button></Tip>
          ))}
        </div>
        {/* 임시 저장·불러오기, 섹션 모두 접기·펼치기 */}
        <div className="flex flex-wrap gap-1 rounded-xl border bg-card p-1 lg:w-[76px] lg:flex-col">
          {[
            { label: "임시 저장", icon: Save, onClick: () => drafts.current?.save(), title: draft ? `"${draft.title}" 에 덮어쓰기` : "이름을 정해 임시 저장" },
            { label: "불러오기", icon: FolderOpen, onClick: () => drafts.current?.open(), title: "임시 저장한 것 불러오기" },
            // 접기·펼치기 하나로: 모두 접혀 있으면 펼치기, 아니면 접기
            allFolded
              ? { label: "모두 펼치기", icon: ChevronsUpDown, onClick: () => setFolded(new Set()), title: "섹션 입력을 모두 펼치기", off: sections.length === 0 }
              : { label: "모두 접기", icon: ChevronsDownUp, onClick: () => setFolded(new Set(sections.map((x) => x.id))), title: "섹션 입력을 모두 접기", off: sections.length === 0 },
          ].map((b) => (
            <Tip key={b.label} content={b.title} wrap className="lg:w-full"><Button
              variant="ghost"
              className="h-auto flex-col gap-1 px-1 py-2 text-[11px] leading-tight font-normal break-keep whitespace-normal lg:w-full [@media(max-height:880px)]:gap-0.5 [@media(max-height:880px)]:py-1"
              disabled={b.off}
              onClick={b.onClick}
            >
              <b.icon className="size-5" />
              {b.label}
            </Button></Tip>
          ))}
        </div>
      </div>

      {/* 오른쪽: 입력 */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-[5]">
        <FieldGroup className="rounded-xl border p-4">
          <Field>
            <FieldLabel htmlFor="dp-product">상품명</FieldLabel>
            <Input id="dp-product" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="예: 통영생굴무침" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="dp-cat">카테고리</FieldLabel>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="dp-cat" className="w-full">
                  <SelectValue placeholder="고르기" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="dp-num">번호</FieldLabel>
              <Input id="dp-num" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="예: 88" />
            </Field>
          </div>
          <FieldDescription className="break-all">
            업로드 폴더: {folder ? `https://yorihaeyou.cafe24.com/detail_page/${folder}/` : "카테고리·번호를 정하면 보입니다"} (기존 상세 이미지 폴더 번호를 따릅니다. 예: /co/co_088 → CO 88)
          </FieldDescription>
        </FieldGroup>


        {sections.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm break-keep text-muted-foreground">
            오른쪽 도구 막대의 버튼으로 섹션을 추가해 주세요. 보통 썸네일(대표 이미지, 따로 받음) → 인트로 → 타이틀(POINT) + 이미지·움짤 → Q&A → 이렇게 보내드려요 → 상품정보고시 순서입니다.
          </p>
        ) : (
          <>
          {/* 모두 접기·펼치기 */}
          <div className="-mb-1 flex justify-end gap-1">
            <Button variant="ghost" size="xs" onClick={() => setFolded(new Set(sections.map((s) => s.id)))}>
              <ChevronsDownUp data-icon="inline-start" />
              모두 접기
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setFolded(new Set())}>
              <ChevronsUpDown data-icon="inline-start" />
              모두 펼치기
            </Button>
          </div>
          <SortableList
            items={sections}
            onReorder={(next) => {
              setSections(next)
              setSelected(null)
            }}
            className="flex flex-col gap-3"
            renderItem={(s, handle) => {
              const i = sections.indexOf(s)
              const p = planned[i]
              return (
                <div
                  ref={(el) => void (el ? cards.current.set(s.id, el) : cards.current.delete(s.id))}
                  className={`scroll-mt-4 rounded-xl border bg-card ${selected === i ? "border-primary ring-2 ring-primary/30" : ""}`}
                  onFocusCapture={() => setSelected(i)}
                >
                  <div className={`flex items-center gap-1 px-2 py-1.5 ${folded.has(s.id) ? "" : "border-b"}`}>
                    {handle}
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelected(selected === i ? null : i)}>
                      <span className="shrink-0 text-sm font-medium">
                        {i + 1}. {KIND_LABEL[s.kind]}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.file ?? (s.kind === "thumb" ? "따로 1200×1200 · 상세에 안 들어감" : "공통 · 번호 없음")}</span>
                      {/* 접었을 때는 무엇이 들어 있는지 한 줄로 */}
                      {folded.has(s.id) && <span className="truncate text-xs text-muted-foreground">{altOf(p, product)}</span>}
                    </button>
                    <Button variant="ghost" size="xs" aria-expanded={!folded.has(s.id)} onClick={() => toggleFold(s.id)}>
                      {folded.has(s.id) ? <ChevronsUpDown data-icon="inline-start" /> : <ChevronsDownUp data-icon="inline-start" />}
                      {folded.has(s.id) ? "펼치기" : "접기"}
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="아래로" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="섹션 지우기" onClick={() => void remove(s)}>
                      <Trash2 />
                    </Button>
                  </div>
                  {!folded.has(s.id) && (
                    <div className="p-3">
                      <SectionEditor p={p} product={product} onChange={(patch) => update(s.id, patch)} />
                    </div>
                  )}
                </div>
              )
            }}
          />
          </>
        )}

        <div className="sticky bottom-0 flex flex-col gap-2 rounded-xl border bg-background/95 p-3 backdrop-blur">
          {/* 빠진 것: 누르면 그 칸으로. 이미 고친 것이면 다음 남은 것을 보여 준다 */}
          {error && !errorAt && <FieldError>{error}</FieldError>}
          {problems.length > 0 && (sections.length > 0 || errorAt) && (
            <button
              type="button"
              className={`text-left underline-offset-2 hover:underline ${errorAt ? "text-sm text-destructive" : "text-xs text-muted-foreground"}`}
              onClick={() => goTo(problems[0])}
            >
              {errorAt ? problems[0].text : `남은 것: ${problems[0].text}`} <span className="text-xs opacity-70">(눌러서 이동)</span>
            </button>
          )}
          <Button size="lg" disabled={busy !== null} onClick={() => void finish()}>
            {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Wand2 data-icon="inline-start" />}
            {busy ? `${busy}…` : "제작 완료 (이미지 + HTML 내려받기)"}
          </Button>
          {result && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">완성 · 파일 {result.files.length}개 + content.html</span>
                <Button variant="outline" size="xs" className="ml-auto" asChild>
                  <a href={result.zipUrl} download={result.zipName}>
                    <Download data-icon="inline-start" />
                    다시 받기
                  </a>
                </Button>
              </div>
              <SmoothScrollArea className="max-h-40 overflow-y-auto" contentClassName="flex flex-col gap-0.5 text-xs tabular-nums">
                {result.files.map((f) => (
                  <div key={f.file} className="flex justify-between gap-2">
                    <span>{f.file}</span>
                    <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                  </div>
                ))}
              </SmoothScrollArea>
              <p className="text-xs break-keep text-muted-foreground">
                zip 의 {folder} 폴더를 카페24(yorihaeyou) /detail_page/{category}/ 에 올리고, content.html 을 관리자 상세설명에 넣으면 됩니다(맨 위 이벤트 배너는 관리자에서 그대로 둠).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* 아래: 제작 완료한 상세페이지 히스토리(상품명·첫 섹션 썸네일·검색·불러오기) */}
      <ToolHistory<DraftState>
        tool="detail-page"
        onLoad={loadHistory}
        fileName={(t) => `${t}_썸네일.jpg`}
        // 목록형(썸네일 없이): 카테고리 · 번호 · 섹션 수
        meta={(f) =>
          [
            CATEGORIES.find((c) => c.value === f.category)?.label ?? f.category,
            f.number ? `${f.number}번` : "",
            f.sections?.length ? `섹션 ${f.sections.length}개` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        }
      />
    </div>
  )
}

// 미리보기: 860 폭 문서를 칸 너비에 맞춰 줄여 보여 준다
// 보기 배율: 처음은 70%, 오른쪽 위 − / + 로 40% ~ 100%(zoom-control.tsx)

export function Preview({ doc, empty }: { doc: string; empty: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [fit, setFit] = useState(0.6)
  const [zoom, setZoom] = useState<number | null>(DEFAULT_ZOOM) // null = 칸 너비에 맞춤
  const scale = zoom ?? fit
  const [height, setHeight] = useState(400)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setFit(Math.min(1, el.clientWidth / 860)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 문서 높이를 따라간다(웹폰트·그림이 늦게 들어와도)
  const measure = () => {
    const d = frame.current?.contentDocument
    if (!d?.body) return
    // 미리보기 문서 자체에는 스크롤 막대를 두지 않는다(높이를 문서에 맞추므로 바깥에서 스크롤)
    d.documentElement.style.overflow = "hidden"
    d.body.style.overflow = "hidden"
    setHeight(d.documentElement.scrollHeight)
    const ro = new ResizeObserver(() => setHeight(d.documentElement.scrollHeight))
    ro.observe(d.body)
  }

  return (
    <div className="relative">
      {!empty && <ZoomControl zoom={zoom} scale={scale} onZoom={setZoom} />}
    <SmoothScrollArea
      className="max-h-[calc(100svh-9rem)] overflow-auto rounded-xl border bg-[#444] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      contentClassName="p-0"
    >
      <div ref={box} className="w-full">
        {empty ? (
          <div className="flex h-80 flex-col items-center justify-center gap-2 text-sm text-white/70">
            <ImagePlus className="size-8" />
            오른쪽에서 섹션을 추가하면 여기에 보입니다
          </div>
        ) : (
          // 칸이 860 보다 넓으면 가운데에 둔다
          <div style={{ height: height * scale, width: 860 * scale }} className="mx-auto overflow-hidden">
            <iframe
              ref={frame}
              title="상세페이지 미리보기"
              srcDoc={doc}
              onLoad={measure}
              scrolling="no"
              style={{ width: 860, height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }}
            />
          </div>
        )}
      </div>
    </SmoothScrollArea>
    </div>
  )
}

// 그림 넣기 칸
export function PicturePicker({ value, onChange, accept = "image/*", label = "그림 넣기" }: { value: Picture | null; onChange: (p: Picture | null) => void; accept?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const take = async (file?: File) => {
    if (!file) return
    try {
      onChange(await readPicture(file))
    } catch {
      // 열 수 없는 파일은 무시
    }
  }
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-dashed p-2 ${dragging ? "border-primary bg-primary/5" : ""}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void take(e.dataTransfer.files[0])
      }}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => void take(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      {value ? (
        <>
          <img src={value.url} alt="" className="size-14 shrink-0 rounded object-cover" />
          <div className="flex min-w-0 flex-1 flex-col text-xs">
            <span className="truncate font-medium">{value.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {value.width}×{value.height} · {formatBytes(value.file.size)}
            </span>
          </div>
          <Button variant="ghost" size="xs" onClick={() => input.current?.click()}>
            바꾸기
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="그림 빼기" onClick={() => onChange(null)}>
            <X />
          </Button>
        </>
      ) : (
        <button type="button" className="flex w-full items-center justify-center gap-2 py-3 text-sm text-muted-foreground" onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" />
          {label} (끌어 놓아도 됩니다)
        </button>
      )}
    </div>
  )
}

function SectionEditor({ p, product, onChange }: { p: Planned; product: string; onChange: (patch: Partial<Section>) => void }) {
  const s = p.section
  const id = `dp-${s.id}`
  const common = (
    <>
      {p.file && (
        <Field>
          <FieldLabel htmlFor={`${id}-layer`}>파일 이름</FieldLabel>
          <Input id={`${id}-layer`} value={s.layer} onChange={(e) => onChange({ layer: e.target.value.replace(/[^\w-]/g, "") })} placeholder={`자동: ${p.layer}`} className="tabular-nums" />
          <FieldDescription>비우면 자동({p.file}). 원본 상세 이미지 이름을 따르려면 바꿔 주세요.</FieldDescription>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`${id}-alt`}>alt</FieldLabel>
        <Textarea id={`${id}-alt`} value={s.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder={autoAlt(p, product) || "이미지 내용을 적어 주세요"} className="min-h-16 text-xs break-keep" />
        <FieldDescription>비우면 입력한 글자로 자동(회색 글). 긴 내용도 alt 하나에 넣습니다.</FieldDescription>
      </Field>
    </>
  )

  switch (s.kind) {
    case "thumb":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>썸네일 사진 (정사각형 1200×1200)</FieldLabel>
            <PicturePicker value={s.image} onChange={(image) => onChange({ image })} />
            <FieldDescription>
              상품 대표 이미지로 쓰는 사진입니다. 상세 이미지에는 들어가지 않고 zip 에 1200×1200 JPG 로 따로 들어갑니다. 정사각형이 아니면 가운데를 정사각으로 잘라 만듭니다.
            </FieldDescription>
            {s.image && (s.image.width !== s.image.height || s.image.width < THUMB_SIZE) && (
              <FieldDescription className="text-amber-600 dark:text-amber-400">
                지금 사진 {s.image.width}×{s.image.height}
                {s.image.width !== s.image.height ? " · 정사각형이 아니라 가운데를 잘라 냅니다" : ""}
                {Math.min(s.image.width, s.image.height) < THUMB_SIZE ? " · 1200 보다 작아 늘려서 흐릿할 수 있습니다" : ""}
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>
      )
    case "hero":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>배경 사진 (글자 지운 메인 사진, 860 폭)</FieldLabel>
            <PicturePicker value={s.image} onChange={(image) => onChange({ image })} />
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-sub`}>윗줄</FieldLabel>
              <TextColorField label="윗줄" value={s.subColor} onChange={(subColor) => onChange({ subColor })} />
            </div>
            <Input id={`${id}-sub`} value={s.sub} onChange={(e) => onChange({ sub: e.target.value })} />
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-name`}>상품명</FieldLabel>
              <TextColorField label="상품명" value={s.nameColor} onChange={(nameColor) => onChange({ nameColor })} />
            </div>
            <Input id={`${id}-name`} value={s.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={product || "상품명"} />
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-desc`}>설명</FieldLabel>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <TextColorField label="설명" value={s.descColor} onChange={(descColor) => onChange({ descColor })} />
                <TextColorField label="설명 강조" caption="강조색" fallback="#ff4d00" value={s.emColor} onChange={(emColor) => onChange({ emColor })} />
              </div>
            </div>
            <EmphasisTextarea id={`${id}-desc`} value={s.desc} onValueChange={(desc) => onChange({ desc })} className="min-h-20 break-keep" placeholder="줄을 바꾸면 그대로 줄이 바뀝니다 (골라서 강조하면 강조색 굵게)" />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={s.grad} onCheckedChange={(v) => onChange({ grad: v === true })} />
              글자 뒤 그라데이션
            </Label>
            <TagSelect value={s.tag} onChange={(tag) => onChange({ tag })} />
          </div>
          {s.grad && (
            // 그라데이션 색: 위(시작) → 아래(끝). 색은 #ffffff 처럼, 불투명도는 0~100%
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">그라데이션 색</span>
                {(s.gradFrom || s.gradTo) && (
                  <Button variant="ghost" size="sm" onClick={() => onChange({ gradFrom: undefined, gradTo: undefined })}>
                    기본값(검정 60% → 0%)
                  </Button>
                )}
              </div>
              <GradStopField id={`${id}-gfrom`} label="위(시작)" value={s.gradFrom} fallback={DEFAULT_GRAD_FROM} onChange={(gradFrom) => onChange({ gradFrom, gradTo: s.gradTo ?? DEFAULT_GRAD_TO })} />
              <GradStopField id={`${id}-gto`} label="아래(끝)" value={s.gradTo} fallback={DEFAULT_GRAD_TO} onChange={(gradTo) => onChange({ gradTo, gradFrom: s.gradFrom ?? DEFAULT_GRAD_FROM })} />
              <div
                className="h-6 rounded border"
                style={{ backgroundImage: `linear-gradient(to right, ${gradRgba(s.gradFrom, DEFAULT_GRAD_FROM)}, ${gradRgba(s.gradTo, DEFAULT_GRAD_TO)}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%)`, backgroundSize: "auto, 12px 12px" }}
                aria-hidden
              />
            </div>
          )}
          {common}
        </FieldGroup>
      )
    case "point":
      return (
        <FieldGroup>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={s.kick} onCheckedChange={(v) => onChange({ kick: v === true })} />
            제목만 있는 강조 띠(POINT 번호 없음, 예: 셰프의 킥)
          </Label>
          {/* 제목 줄마다 강조(주황 굵게)를 체크로 고른다. 기본은 제목 2만 */}
          {([
            ["title1", "em1", "제목 1줄", s.em1 ?? false],
            ["title2", "em2", "제목 2줄", s.em2 ?? true],
          ] as const).map(([key, em, label, on]) => (
            <Field key={key}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                <Label className="flex items-center gap-1.5 text-xs font-normal">
                  <Checkbox checked={on} onCheckedChange={(v) => onChange({ [em]: v === true })} />
                  <span className={on ? "font-bold text-[#ff4d00]" : "text-muted-foreground"}>강조 (주황 굵게)</span>
                </Label>
              </div>
              <Input
                id={`${id}-${key}`}
                value={s[key]}
                onChange={(e) => onChange({ [key]: e.target.value })}
                className={on ? "font-bold text-[#ff4d00]" : ""}
              />
            </Field>
          ))}
          {!s.kick && (
            <Field>
              <FieldLabel htmlFor={`${id}-body`}>본문</FieldLabel>
              <EmphasisTextarea id={`${id}-body`} value={s.body} onValueChange={(body) => onChange({ body })} className="min-h-28 break-keep" />
              <FieldDescription>줄을 바꾸면 그대로 줄이 바뀝니다. 글을 골라 강조(Ctrl+B)하면 검정 굵게.</FieldDescription>
            </Field>
          )}
          {common}
        </FieldGroup>
      )
    case "photo":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>사진 (860 폭으로 맞춰짐)</FieldLabel>
            <PicturePicker value={s.image} onChange={(image) => onChange({ image })} />
          </Field>
          <TagSelect value={s.tag} onChange={(tag) => onChange({ tag })} />
          <Field>
            <FieldLabel htmlFor={`${id}-desc`}>장면 설명 (alt)</FieldLabel>
            <Input id={`${id}-desc`} value={s.desc} onChange={(e) => onChange({ desc: e.target.value })} placeholder="예: 흰쌀밥 위에 올린 굴무침" />
          </Field>
          {common}
        </FieldGroup>
      )
    case "gif":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>움짤 파일 (WebP)</FieldLabel>
            <PicturePicker value={s.image} onChange={(image) => onChange({ image })} accept="image/webp,image/gif" label="움짤 넣기" />
            <FieldDescription>
              동영상은 디자인 툴의 "동영상 → WebP·GIF"에서 WebP 로 만든 뒤 넣어 주세요. 이름 바꾸지 않고 .webp 그대로 올라갑니다(예전 GIF 를 넣으면 .gif).
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-desc`}>장면 설명 (alt)</FieldLabel>
            <Input id={`${id}-desc`} value={s.desc} onChange={(e) => onChange({ desc: e.target.value })} placeholder="예: 굴무침을 젓가락으로 집어 올리는" />
          </Field>
          {common}
        </FieldGroup>
      )
    case "qa":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-head`}>머리 문구</FieldLabel>
            <Input id={`${id}-head`} value={s.header} onChange={(e) => onChange({ header: e.target.value })} />
          </Field>
          {s.items.map((it, k) => (
            <div key={it.id} className="flex flex-col gap-2 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">질문 {k + 1}</span>
                <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="질문 빼기" disabled={s.items.length === 1} onClick={() => onChange({ items: s.items.filter((x) => x.id !== it.id) })}>
                  <X />
                </Button>
              </div>
              <Input value={it.q} onChange={(e) => onChange({ items: s.items.map((x) => (x.id === it.id ? { ...x, q: e.target.value } : x)) })} placeholder="Q. 질문" aria-label={`질문 ${k + 1}`} />
              <Input value={it.lead} onChange={(e) => onChange({ items: s.items.map((x) => (x.id === it.id ? { ...x, lead: e.target.value } : x)) })} placeholder="A. 첫 핵심 문장(주황 굵게, 없어도 됨)" aria-label={`답변 ${k + 1} 핵심 문장`} />
              <EmphasisTextarea value={it.a} onValueChange={(a) => onChange({ items: s.items.map((x) => (x.id === it.id ? { ...x, a } : x)) })} className="min-h-20 break-keep" placeholder="답변 본문 (골라서 강조하면 주황 굵게)" aria-label={`답변 ${k + 1}`} />
              <PicturePicker value={it.image ?? null} onChange={(image) => onChange({ items: s.items.map((x) => (x.id === it.id ? { ...x, image } : x)) })} label="답변 아래 사진 (없어도 됨)" />
            </div>
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => onChange({ items: [...s.items, { id: nextId(), q: "", lead: "", a: "" }] })}>
            <Plus data-icon="inline-start" />
            질문 추가
          </Button>
          {common}
        </FieldGroup>
      )
    case "recipe":
      return (
        <FieldGroup>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field>
              <FieldLabel htmlFor={`${id}-no`}>번호</FieldLabel>
              <Input id={`${id}-no`} value={s.no} onChange={(e) => onChange({ no: e.target.value })} placeholder="자동" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-title`}>메뉴 이름</FieldLabel>
              <Input id={`${id}-title`} value={s.title} onChange={(e) => onChange({ title: e.target.value })} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-body`}>설명</FieldLabel>
            <EmphasisTextarea id={`${id}-body`} value={s.body} onValueChange={(body) => onChange({ body })} className="min-h-20 break-keep" />
            <FieldDescription>레시피 사진은 이 섹션 뒤에 "이미지"로 넣어 주세요.</FieldDescription>
          </Field>
          {common}
        </FieldGroup>
      )
    case "why":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-eyebrow`}>윗글 (주황 작은 글)</FieldLabel>
            <Input id={`${id}-eyebrow`} value={s.eyebrow} onChange={(e) => onChange({ eyebrow: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-t1`}>제목 1줄</FieldLabel>
            <Input id={`${id}-t1`} value={s.title1} onChange={(e) => onChange({ title1: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-t2`}>제목 2줄 (주황 굵게)</FieldLabel>
            <Input id={`${id}-t2`} value={s.title2} onChange={(e) => onChange({ title2: e.target.value })} placeholder={`${product || "상품명"}을 찾을까?`} className="font-bold text-[#ff4d00]" />
          </Field>
          {s.items.map((it, k) => {
            const set = (patch: Partial<WhyItem>) => onChange({ items: s.items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) })
            return (
              <div key={it.id} className="flex flex-col gap-2 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">카드 {String(k + 1).padStart(2, "0")}</span>
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="카드 빼기" disabled={s.items.length === 1} onClick={() => onChange({ items: s.items.filter((x) => x.id !== it.id) })}>
                    <X />
                  </Button>
                </div>
                <PicturePicker value={it.image} onChange={(image) => set({ image })} label="사진 (정사각으로 잘림)" />
                <Input value={it.title} onChange={(e) => set({ title: e.target.value })} placeholder="제목 (예: 맛있으니까!)" aria-label={`카드 ${k + 1} 제목`} />
                <EmphasisTextarea value={it.body} onValueChange={(body) => set({ body })} className="min-h-16 break-keep" placeholder="설명 (줄을 바꾸면 그대로 줄이 바뀝니다)" aria-label={`카드 ${k + 1} 설명`} />
              </div>
            )
          })}
          <Button variant="outline" size="sm" className="self-start" onClick={() => onChange({ items: [...s.items, { id: nextId(), image: null, title: "", body: "" }] })}>
            <Plus data-icon="inline-start" />
            카드 추가
          </Button>
          {common}
        </FieldGroup>
      )
    case "ship":
      return (
        <FieldGroup>
          <ShipGroup
            id={`${id}-p`}
            label="내용량"
            items={s.products}
            note={s.productNote}
            capHint="예: 225g"
            onItems={(products) => onChange({ products })}
            onNote={(productNote) => onChange({ productNote })}
          />
          <ShipGroup
            id={`${id}-i`}
            label="아이스박스 포장"
            items={s.ice}
            note={s.iceNote}
            capHint="없으면 비움"
            onItems={(ice) => onChange({ ice })}
            onNote={(iceNote) => onChange({ iceNote })}
            preset
          />
          {common}
        </FieldGroup>
      )
    case "notice":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>상품정보고시 이미지</FieldLabel>
            <PicturePicker value={s.image} onChange={(image) => onChange({ image })} />
            <FieldDescription>디자인 툴 "상품정보고시"로 만든 세로형 이미지(r.jpg)를 넣어 주세요. alt 는 그 도구의 "alt 복사" 내용을 붙여 넣으면 됩니다(고시 탭 자동 입력에 쓰이니 원문 그대로).</FieldDescription>
          </Field>
          {common}
        </FieldGroup>
      )
    case "common":
      return (
        <FieldGroup>
          <Field>
            <FieldLabel>공통 이미지</FieldLabel>
            <Select value={s.which} onValueChange={(v) => onChange({ which: v as typeof s.which })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="b">{COMMON.b.label}</SelectItem>
                <SelectItem value="series">{COMMON.series.label}</SelectItem>
                <SelectItem value="url">직접 주소 넣기 (수매확인서 등)</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>서버에 이미 있는 이미지라 만들지 않고 주소만 넣습니다(번호도 쓰지 않음).</FieldDescription>
          </Field>
          {s.which === "url" && (
            <Field>
              <FieldLabel htmlFor={`${id}-url`}>이미지 주소</FieldLabel>
              <Input id={`${id}-url`} value={s.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://owenfood.speedgabia.com/_dt_test/2026/2026.jpg" />
            </Field>
          )}
          {s.which === "url" ? (
            common
          ) : (
            <p className="text-xs break-keep text-muted-foreground">alt: {COMMON[s.which].alt.slice(0, 80)}…</p>
          )}
        </FieldGroup>
      )
  }
}

// 이렇게 보내드려요의 한 칸(내용량·아이스박스 포장 같은 모양): 정사각형 사진(최대 SHIP_MAX) + 사진 아래 글 + ※ 안내
// preset: 기본 아이스박스 사진을 바로 넣는 버튼
export function ShipGroup({
  id,
  label,
  items,
  note,
  capHint,
  onItems,
  onNote,
  preset = false,
}: {
  id: string
  label: string
  items: ShipProduct[]
  note: string
  capHint: string
  onItems: (items: ShipProduct[]) => void
  onNote: (note: string) => void
  preset?: boolean
}) {
  const set = (pid: number, patch: Partial<ShipProduct>) => onItems(items.map((x) => (x.id === pid ? { ...x, ...patch } : x)))
  const usePreset = async () => {
    const blob = await (await fetch(iceboxUrl)).blob()
    const pic = await readPicture(new File([blob], "icebox.png", { type: blob.type }))
    const empty = items.find((x) => !x.image)
    if (empty) set(empty.id, { image: pic })
    else if (items.length < SHIP_MAX) onItems([...items, { id: nextId(), image: pic, cap: "" }])
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <Field>
        <FieldLabel>
          {label} <span className="font-normal text-muted-foreground">(정사각형 사진 + 사진 아래 글, 최대 {SHIP_MAX}개)</span>
        </FieldLabel>
        {items.map((pr, k) => (
          <div key={pr.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <PicturePicker value={pr.image} onChange={(image) => set(pr.id, { image })} label="사진" />
            </div>
            <Input value={pr.cap} onChange={(e) => set(pr.id, { cap: e.target.value })} placeholder={capHint} className="w-28" aria-label={`${label} 사진 ${k + 1} 아래 글`} />
            <Button variant="ghost" size="icon-xs" aria-label="빼기" disabled={items.length === 1} onClick={() => onItems(items.filter((x) => x.id !== pr.id))}>
              <X />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={items.length >= SHIP_MAX} onClick={() => onItems([...items, { id: nextId(), image: null, cap: "" }])}>
            <Plus data-icon="inline-start" />
            사진 추가 ({items.length}/{SHIP_MAX})
          </Button>
          {preset && (
            <Button variant="ghost" size="sm" disabled={items.every((x) => x.image) && items.length >= SHIP_MAX} onClick={() => void usePreset()}>
              <Package data-icon="inline-start" />
              기본 아이스박스 사진 넣기
            </Button>
          )}
        </div>
        <FieldDescription>사진은 가운데를 기준으로 정사각형으로 잘려 보입니다. 아래 글이 없으면 사진만 박스 가운데에 놓입니다.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-note`}>{label} 안내 (※, 없으면 비움)</FieldLabel>
        <Textarea id={`${id}-note`} value={note} onChange={(e) => onNote(e.target.value)} className="min-h-16 break-keep" />
      </Field>
    </div>
  )
}

// 사진 표기(오른쪽 아래): 없음 / 연출 이미지 / 이해를 돕기 위한 이미지
// 글자색: 색 견본 + #색상값(비우면 흰색)
export function TextColorField({ label, value, onChange, caption = "글자색", fallback = "#ffffff" }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; caption?: string; fallback?: string }) {
  const text = value ?? ""
  const rgb = parseHex(text)
  const bad = text.trim() !== "" && !rgb
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{caption}</span>
      <ColorSwatchPicker value={text || fallback} label={`${label} ${caption}`} swatch={{ background: rgb ? `rgb(${rgb.join(",")})` : fallback }} onPick={onChange} />
      <Input
        value={text}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        placeholder={fallback}
        aria-label={`${label} ${caption}`}
        aria-invalid={bad}
        className="h-7 w-24 font-mono text-xs"
      />
    </div>
  )
}

// 그라데이션 한 끝: 색 견본 + #색상값 + 불투명도 %
export function GradStopField({ id, label, value, fallback, onChange }: { id: string; label: string; value: GradStop | undefined; fallback: GradStop; onChange: (v: GradStop) => void }) {
  const v = value ?? fallback
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="w-16 shrink-0 font-normal text-muted-foreground">{label}</Label>
      <ColorSwatchPicker
        value={v.color}
        label={`${label} 그라데이션`}
        className="size-8"
        swatch={{ backgroundImage: `linear-gradient(${gradRgba(v, fallback)}, ${gradRgba(v, fallback)}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%)`, backgroundSize: "auto, 8px 8px" }}
        onPick={(color) => onChange({ ...v, color })}
      />
      <Input
        id={id}
        value={v.color}
        onChange={(e) => onChange({ ...v, color: e.target.value })}
        placeholder="#000000"
        aria-label={`${label} 색상값`}
        aria-invalid={!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.color.trim())}
        className="w-28 font-mono"
      />
      <div className="relative w-24">
        <Input
          type="number"
          min={0}
          max={100}
          step={5}
          value={v.opacity}
          onChange={(e) => onChange({ ...v, opacity: e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))) })}
          aria-label={`${label} 불투명도(%)`}
          className="pr-7 tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
      </div>
    </div>
  )
}

function TagSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field className="w-auto">
      <FieldLabel>사진 표기</FieldLabel>
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">표기 없음</SelectItem>
          {PHOTO_TAGS.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
