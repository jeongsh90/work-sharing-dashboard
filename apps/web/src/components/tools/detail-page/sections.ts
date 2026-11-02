import detailCss from "./assets/detail.css?raw"
import detailJs from "./assets/detail.js?raw"
import logoUrl from "./assets/logo.svg"
import patternUrl from "./assets/point-pattern.png"
import bubbleUrl from "./assets/qa-bubble.svg"
import z8Block from "./assets/z8_block.html?raw"
import commonAlts from "./common-alts.json"

// 상세페이지 만들기의 섹션 모델과 HTML 만들기.
// 디자인은 상세페이지 스킬(detail-page-renewal)의 detail.css·섹션 템플릿을 그대로 쓴다(숫자를 바꾸지 않는다).
// 같은 HTML 을 왼쪽 미리보기(iframe)와 서버 렌더(Edge, render.ps1 과 같은 방식)에 쓴다.

// 첨부한 그림: url 은 미리보기용(blob:), 렌더할 때는 860 폭 JPG data: 로 바꿔 보낸다
export type Picture = { url: string; name: string; width: number; height: number; file: File }

export type QaItem = { id: number; q: string; lead: string; a: string }
export type ShipProduct = { id: number; image: Picture | null; cap: string }

type Base = { id: number; layer: string; alt: string } // layer·alt 가 비면 자동
export type Section = Base &
  (
    | { kind: "hero"; image: Picture | null; sub: string; name: string; desc: string; grad: boolean; tag: string }
    | { kind: "point"; title1: string; title2: string; body: string; kick: boolean }
    | { kind: "photo"; image: Picture | null; tag: string; desc: string }
    | { kind: "gif"; image: Picture | null; desc: string }
    | { kind: "qa"; header: string; items: QaItem[] }
    | { kind: "recipe"; no: string; title: string; body: string }
    | { kind: "ship"; products: ShipProduct[]; productNote: string; ice: ShipProduct[]; iceNote: string }
    | { kind: "notice"; image: Picture | null }
    | { kind: "common"; which: CommonKey; url: string }
  )
export type Kind = Section["kind"]

// 공통 이미지(서버에 이미 있음 — 만들지 않고 주소만 넣는다)
export type CommonKey = "b" | "series" | "url"
const COMMON_BASE = "https://yorihaeyou.cafe24.com/detail_page/common/"
export const COMMON: Record<Exclude<CommonKey, "url">, { label: string; url: string; alt: string }> = {
  b: { label: "공식 판매처 안내 (b.jpg)", url: `${COMMON_BASE}b.jpg`, alt: commonAlts.b },
  series: { label: "맵짤이 7종 소개", url: `${COMMON_BASE}26_mapzzaly_series.jpg`, alt: commonAlts["26_mapzzaly_series"] },
}
// 맨 아래 공통(미리보기에 보이지 않고, 완성 HTML 끝에 늘 붙는다)
const TAIL = [
  { url: `${COMMON_BASE}about8.jpg`, alt: commonAlts.about8 },
  { url: `${COMMON_BASE}award8.jpg`, alt: commonAlts.award8 },
]

export const PHOTO_TAGS = ["연출 이미지", "이해를 돕기 위한 이미지"]
// 사진을 아직 넣지 않은 칸(미리보기)에 보이는 사진 아이콘(lucide image)
const PHOTO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`
// 이렇게 보내드려요 칸(내용량·아이스박스 포장)마다 사진 최대 수(4장이면 한 줄에 들어가게 줄인다)
export const SHIP_MAX = 4
export const CATEGORIES = [
  { value: "KI", label: "KI 김치" },
  { value: "CR", label: "CR 게장" },
  { value: "CO", label: "CO 요리" },
  { value: "SO", label: "SO 국물" },
  { value: "SI", label: "SI 반찬" },
  { value: "IT", label: "IT 단품·원물·청·소스" },
]

export const KIND_LABEL: Record<Kind, string> = {
  hero: "썸네일",
  point: "타이틀",
  photo: "이미지",
  gif: "움짤",
  qa: "Q&A",
  recipe: "레시피",
  ship: "이렇게 보내드려요",
  notice: "상품정보고시",
  common: "공통 이미지",
}

let seq = 1
export const nextId = () => seq++

export function newSection(kind: Kind): Section {
  const base = { id: nextId(), layer: "", alt: "" }
  switch (kind) {
    case "hero":
      return { ...base, kind, image: null, sub: "셰프의 반찬, 셰프애찬", name: "", desc: "", grad: true, tag: "" }
    case "point":
      return { ...base, kind, title1: "", title2: "", body: "", kick: false }
    case "photo":
      return { ...base, kind, image: null, tag: "연출 이미지", desc: "" }
    case "gif":
      return { ...base, kind, image: null, desc: "" }
    case "qa":
      return { ...base, kind, header: "가장 궁금했던 질문들만 모아", items: [{ id: nextId(), q: "", lead: "", a: "" }] }
    case "recipe":
      return { ...base, kind, no: "", title: "", body: "" }
    case "ship":
      return { ...base, kind, products: [{ id: nextId(), image: null, cap: "" }], productNote: "", ice: [{ id: nextId(), image: null, cap: "" }], iceNote: "아이스박스에 아이스팩을 넣어 신선하게 배송해 드립니다." }
    case "notice":
      return { ...base, kind, image: null }
    case "common":
      return { ...base, kind, which: "b", url: "" }
  }
}

// ── 파일 이름(레이어명) · 번호 ─────────────────────────────────────────
// 원본 상세 이미지 이름 관례: 메인 d, POINT g·h·i…, POINT 뒤 사진 g2-1…, 움짤 g0·g1…, Q&A o, 배송 p, 고시 r·r2…, 레시피 recipe01…
// NN = 상세 안 순서(01부터). 공통 이미지는 번호를 쓰지 않는다(ftp-upload.md).
export type Planned = { section: Section; file: string | null; layer: string; ext: "jpg" | "gif" | null }

export function plan(sections: Section[]): Planned[] {
  const out: Planned[] = []
  let n = 0
  let point = -1
  let photos = 0
  let gifs = 0
  let top = 0
  let recipes = 0
  let notices = 0
  for (const s of sections) {
    let auto = ""
    if (s.kind === "point") {
      point++
      photos = 0
      gifs = 0
    }
    const letter = String.fromCharCode("g".charCodeAt(0) + Math.max(point, 0))
    switch (s.kind) {
      case "hero":
        auto = "d"
        break
      case "point":
        auto = letter
        break
      case "photo":
        auto = point < 0 ? `top-${++top}` : `${letter}2-${++photos}`
        break
      case "gif":
        auto = point < 0 ? `top${gifs++}` : `${letter}${gifs++}`
        break
      case "qa":
        auto = "o"
        break
      case "recipe":
        auto = `recipe${String(++recipes).padStart(2, "0")}`
        break
      case "ship":
        auto = "p"
        break
      case "notice":
        auto = ++notices === 1 ? "r" : `r${notices}`
        break
    }
    if (s.kind === "common") {
      out.push({ section: s, file: null, layer: "", ext: null })
      continue
    }
    const layer = s.layer.trim() || auto
    const ext = s.kind === "gif" ? "gif" : "jpg"
    out.push({ section: s, file: `${String(++n).padStart(2, "0")}_${layer}.${ext}`, layer, ext })
  }
  return out
}

// ── 글자 → HTML ─────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// **강조** → 지정한 class 의 span. 줄바꿈은 .pre 가 그대로 살린다
const rich = (s: string, cls: string) => esc(s.trim()).replace(/\*\*(.+?)\*\*/gs, `<span class="${cls}">$1</span>`)
const plain = (s: string) => s.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim()

function pictureUrl(p: Picture | null, urls: Map<Picture, string> | null) {
  if (!p) return ""
  return urls?.get(p) ?? p.url
}

// 섹션 하나의 HTML. urls 는 렌더할 때 그림을 data: 로 바꾼 것(없으면 미리보기 blob:)
function sectionHtml(p: Planned, urls: Map<Picture, string> | null, asset: (u: string) => string, index: number) {
  const s = p.section
  const out = p.file ? ` data-out="${p.file}"` : ""
  const idx = ` data-idx="${index}"`
  switch (s.kind) {
    case "hero": {
      const img = pictureUrl(s.image, urls)
      const h = s.image ? Math.round((s.image.height * 860) / s.image.width) : 1000
      return `<section${out}${idx} class="hero${s.grad ? " grad" : ""}" style="background-image:url('${img}'); height:${h}px;${img ? "" : " background-color:#c9c9cf;"}">
  <div class="text">
    <div class="head">
      <img class="logo" src="${asset(logoUrl)}" alt="">
      <div>
        <div class="hero-sub">${esc(s.sub)}</div>
        <div class="hero-name">${esc(s.name) || "상품명"}</div>
      </div>
    </div>
    <div class="hero-desc pre">${rich(s.desc, "b")}</div>
  </div>${s.tag ? `\n  <div class="tag">${esc(s.tag)}</div>` : ""}
</section>`
    }
    case "point": {
      const no = String(pointNo(p)).padStart(2, "0")
      const title = `<div class="t-point pre">${esc(s.title1.trim())}${s.title2.trim() ? `\n<span class="em">${esc(s.title2.trim())}</span>` : ""}</div>`
      if (s.kick) return `<section${out}${idx} class="point kick">\n  ${title}\n</section>`
      return `<section${out}${idx} class="point">
  <div class="badge"><div class="word">POINT</div><div class="num">${no}</div></div>
  ${title}${s.body.trim() ? `\n  <div class="t-body1 pre">${rich(s.body, "ink")}</div>` : ""}
</section>`
    }
    case "photo":
    case "gif": {
      const img = pictureUrl(s.image, urls)
      if (!img) return `<section${out}${idx} class="photo"><div class="empty">${s.kind === "gif" ? "움짤" : "이미지"}을 넣어 주세요</div></section>`
      const tag = s.kind === "photo" && s.tag ? `<div class="tag">${esc(s.tag)}</div>` : ""
      return `<section${out}${idx} class="photo"><img src="${img}" alt="">${tag}</section>`
    }
    case "qa":
      return `<section${out}${idx} class="qa">
  <div class="header"><div class="bubble"><img src="${asset(bubbleUrl)}" alt=""></div><div class="t-section">${esc(s.header)}</div></div>
${s.items
  .map(
    (it) => `  <div class="item">
    <div class="q"><div class="badge-q">Q</div><div class="t-h3">${esc(it.q.trim())}</div></div>
    <div class="answers"><div class="a"><div class="slot${it.lead.trim() ? " l30" : ""}"><div class="badge-a">A</div></div><div class="txt pre">${it.lead.trim() ? `<span class="lead">${esc(it.lead.trim())}</span>` : ""}${rich(it.a, "em28")}</div></div></div>
  </div>`,
  )
  .join("\n")}
</section>`
    case "recipe":
      return `<section${out}${idx} class="recipe">
  <div class="eyebrow">Recipe ${esc(s.no.trim() || String(recipeNo(p)).padStart(2, "0"))}</div>
  <div class="t-h3">${esc(s.title.trim())}</div>
  <div class="t-body2 body">${rich(s.body, "ink")}</div>
</section>`
    case "ship": {
      // 내용량·아이스박스 포장은 같은 모양: 정사각형 사진(최대 4장) + 사진 아래 글 + ※ 안내.
      // 3장까지는 템플릿 크기(210), 4장이면 한 줄(720 칸)에 들어가게 152 로 줄인다. 아래 글이 없으면 사진만(박스 위아래 여백이 같아 세로 가운데).
      const group = (label: string, items: ShipProduct[], note: string) => {
        const size = items.length >= 4 ? 152 : 210
        const sq = `width:${size}px;height:${size}px;`
        const item = (pr: ShipProduct) => {
          const src = pictureUrl(pr.image, urls)
          const img = src ? `<img src="${src}" alt="" style="${sq}">` : `<div class="ph-empty" style="${sq}">${PHOTO_ICON}</div>`
          return `      <div class="product">${img}${pr.cap.trim() ? `<div class="cap">${esc(pr.cap.trim())}</div>` : ""}</div>`
        }
        return `  <div class="group">
    <div class="label t-label">${label}</div>
    <div class="box"><div class="products">
${items.map(item).join("\n")}
    </div></div>${note.trim() ? `\n    <div class="notes"><div class="note t-body3"><span class="mark">※</span><span class="pre">${esc(note.trim())}</span></div></div>` : ""}
  </div>`
      }
      return `<section${out}${idx} class="ship">
  <div class="t-section">이렇게 보내드려요</div>
${group("내용량", s.products, s.productNote)}
${group("아이스박스 포장", s.ice, s.iceNote)}
</section>`
    }
    case "notice": {
      const img = pictureUrl(s.image, urls)
      if (!img) return `<section${out}${idx} class="photo"><div class="empty">상품정보고시 이미지를 넣어 주세요</div></section>`
      return `<section${out}${idx} class="photo"><img src="${img}" alt=""></section>`
    }
    case "common": {
      const url = s.which === "url" ? s.url.trim() : COMMON[s.which].url
      return `<div class="common"${idx}>${url ? `<img src="${esc(url)}" alt="">` : `<div class="empty">공통 이미지 주소를 넣어 주세요</div>`}<div class="common-badge">공통 · 주소만 넣음</div></div>`
    }
  }
}

// POINT 번호: 제목만 있는 강조 띠(kick)는 세지 않는다
let pointCounter = new Map<Planned, number>()
let recipeCounter = new Map<Planned, number>()
const pointNo = (p: Planned) => pointCounter.get(p) ?? 1
const recipeNo = (p: Planned) => recipeCounter.get(p) ?? 1

// 미리보기·렌더용 문서 전체. 미리보기는 섹션을 누르면 오른쪽 입력으로 옮겨 가게 부모 창에 알린다.
export function buildDocument(
  planned: Planned[],
  opts: { urls?: Map<Picture, string>; assetUrl?: (u: string) => string; preview?: boolean; selected?: number | null } = {},
) {
  pointCounter = new Map()
  recipeCounter = new Map()
  let pn = 0
  let rn = 0
  for (const p of planned) {
    if (p.section.kind === "point" && !p.section.kick) pointCounter.set(p, ++pn)
    if (p.section.kind === "recipe") recipeCounter.set(p, ++rn)
  }
  const asset = opts.assetUrl ?? ((u: string) => new URL(u, location.href).href)
  // detail.css 의 패턴 그림 주소를 실제 주소로
  const css = detailCss.replace("url('point-pattern.png')", `url('${asset(patternUrl)}')`)
  const body = planned.map((p, i) => sectionHtml(p, opts.urls ?? null, asset, i)).join("\n")
  const extra = `
.empty { padding: 120px 70px; text-align: center; color: #888; font-size: 28px; background: repeating-linear-gradient(45deg, #f4f4f6 0 16px, #ececf0 16px 32px); }
.common { position: relative; background: #fff; width: 860px; }
.common img { display: block; width: 860px; height: auto; }
.common-badge { position: absolute; left: 12px; top: 12px; background: rgba(17,17,17,.75); color: #fff; font-size: 18px; line-height: 28px; padding: 2px 10px; }
.hero { background-color: #c9c9cf; }
.ph-empty { display: flex; align-items: center; justify-content: center; background: #f2f2f4; border: 2px dashed #d4d4da; color: #a1a1aa; }
.ph-empty svg { width: 30%; height: 30%; }
${opts.preview ? `section, .common { cursor: pointer; } [data-idx="${opts.selected ?? -1}"] { outline: 6px solid #3b82f6; outline-offset: -6px; }` : ".common { display: none; }"}`
  const script = opts.preview
    ? `<script>document.addEventListener('click', function (e) { var el = e.target.closest('[data-idx]'); if (el) parent.postMessage({ detailPageSelect: Number(el.getAttribute('data-idx')) }, '*'); });</script>`
    : ""
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${css}${extra}</style></head><body>
${body}
<script>${detailJs}</script>${script}
</body></html>`
}

// ── alt (detail-page-alt 규칙: 긴 내용도 alt 하나에) ─────────────────────
export function autoAlt(p: Planned, productName: string): string {
  const s = p.section
  const name = productName.trim()
  switch (s.kind) {
    case "hero":
      return [plain(s.name) || name, plain(s.desc)].filter(Boolean).join(" - ")
    case "point": {
      const title = [plain(s.title1), plain(s.title2)].filter(Boolean).join(" ")
      if (s.kick) return title
      return `POINT ${String(pointNo(p)).padStart(2, "0")} - ${title}${s.body.trim() ? `. ${plain(s.body)}` : ""}`
    }
    case "photo":
      return s.tag ? `${s.tag} - ${plain(s.desc)}` : plain(s.desc)
    case "gif":
      return `${plain(s.desc)} 움짤`.trim()
    case "qa":
      return `${name ? `${name} ` : ""}자주 묻는 질문 - ${s.items
        .filter((it) => it.q.trim())
        .map((it) => `${plain(it.q)} ${[plain(it.lead), plain(it.a)].filter(Boolean).join(" ")}`)
        .join(" / ")}`
    case "recipe":
      return `Recipe ${s.no.trim() || String(recipeNo(p)).padStart(2, "0")} ${plain(s.title)} - ${plain(s.body)}`
    case "ship": {
      const part = (items: ShipProduct[], note: string) => [items.map((pr) => plain(pr.cap)).filter(Boolean).join(", "), plain(note)].filter(Boolean).join(" ")
      return `이렇게 보내드려요 - 내용량: ${part(s.products, s.productNote)} / 아이스박스 포장: ${part(s.ice, s.iceNote)}`
    }
    case "notice":
      return `${name} 상품정보고시`
    case "common":
      return s.which === "url" ? "" : COMMON[s.which].alt
  }
}
export const altOf = (p: Planned, productName: string) => p.section.alt.trim() || autoAlt(p, productName)

// 관리자 상세설명(mg_content)에 넣을 HTML: 상품 이미지 + 공통(about8·award8) + 하단 z8-1~6. 맨 위 이벤트 배너는 관리자에서 그대로 둔다.
export function buildContentHtml(planned: Planned[], productName: string, folder: string) {
  buildDocument(planned) // 번호 세기
  const base = `https://yorihaeyou.cafe24.com/detail_page/${folder}/`
  const lines = planned.map((p) => {
    const url = p.file ? base + p.file : p.section.kind === "common" ? (p.section.which === "url" ? p.section.url.trim() : COMMON[p.section.which].url) : ""
    return `<img src="${esc(url)}" alt="${esc(altOf(p, productName))}">`
  })
  for (const t of TAIL) lines.push(`<img loading="lazy" decoding="async" src="${t.url}" alt="${esc(t.alt)}">`)
  return `<div style="text-align: center;">\n${lines.join("\n")}\n${z8Block.trim()}\n</div>\n`
}
