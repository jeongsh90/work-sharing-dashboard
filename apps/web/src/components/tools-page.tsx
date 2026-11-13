import { lazy, Suspense, useCallback, useRef, useState } from "react"
import { ClipboardList, Clapperboard, LoaderCircle, FileCheck2, ShieldCheck, HelpCircle, IdCard, LayoutTemplate, ListChecks, Mail, MessageSquareText, Package, PanelTop, QrCode, Search, Shrink, Square, Type, UtensilsCrossed, X, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { ToolChromeContext } from "@/components/tools/tool-chrome"
import { Input } from "@/components/ui/input"
import { PAGE_GRID } from "@/lib/layout"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { Tip } from "@/components/tip"

// 도구 화면은 열 때 받는다(목록만 볼 때는 아이콘만 — 도구마다 코드가 커서 한꺼번에 받지 않는다)
const DeskNameplateTool = lazy(() => import("@/components/tools/desk-nameplate").then((m) => ({ default: m.DeskNameplateTool })))
const MailSignatureTool = lazy(() => import("@/components/tools/mail-signature").then((m) => ({ default: m.MailSignatureTool })))
const PurchaseCertTool = lazy(() => import("@/components/tools/purchase-cert").then((m) => ({ default: m.PurchaseCertTool })))
const NoroCertTool = lazy(() => import("@/components/tools/purchase-cert").then((m) => ({ default: m.NoroCertTool })))
const ProductNoticeTool = lazy(() => import("@/components/tools/product-notice").then((m) => ({ default: m.ProductNoticeTool })))
const VideoConvertTool = lazy(() => import("@/components/tools/video-to-gif").then((m) => ({ default: m.VideoConvertTool })))
const DetailPageTool = lazy(() => import("@/components/tools/detail-page/detail-page-tool").then((m) => ({ default: m.DetailPageTool })))
const ShipTool = lazy(() => import("@/components/tools/detail-page/ship-tool").then((m) => ({ default: m.ShipTool })))
const TalkMessageTool = lazy(() => import("@/components/tools/talk-message").then((m) => ({ default: m.TalkMessageTool })))
const QrCodeTool = lazy(() => import("@/components/tools/qr-code").then((m) => ({ default: m.QrCodeTool })))
const ImageResizeTool = lazy(() => import("@/components/tools/image-resize").then((m) => ({ default: m.ImageResizeTool })))
const SectionApp = lazy(() => import("@/components/tools/detail-page/section-app").then((m) => ({ default: m.SectionApp })))

// 디자인 툴(메뉴 이름): 디자인팀 작업에 쓰는 도구 모음. 아이폰 홈 화면처럼 앱 아이콘을 늘어놓고,
// 누르면 전체 화면 창이 열린다. 도구를 만들면 TOOLS 에 하나씩 추가하고 body 에 화면을 넣는다.

// 분류(목록에서 이 순서로 묶어 보여 준다)
const CATEGORIES = [
  { id: "cert", name: "인증·고시", description: "확인서·상품정보고시 이미지" },
  { id: "detail", name: "상세페이지", description: "상세페이지 전체와 섹션별 이미지" },
  { id: "marketing", name: "마케팅·영상", description: "메시지 이미지·움짤·리사이즈·QR" },
  { id: "office", name: "사내 업무", description: "메일 서명·명찰" },
] as const
type CategoryId = (typeof CATEGORIES)[number]["id"]

type Tool = {
  id: string
  category: CategoryId
  name: string
  description: string
  icon: LucideIcon
  color: string // 아이콘 바탕(그라데이션)
  body?: React.ReactNode // 도구 화면. 없으면 준비 중
  fill?: boolean // 창 높이를 꽉 채우는 작업 화면(칸마다 따로 스크롤. 넓은 화면에서만)
}

const TOOLS: Tool[] = [
  {
    id: "purchase-confirm",
    category: "cert",
    name: "수매확인서",
    description: "수매확인서 PDF 로 상세페이지 이미지를 만드는 도구",
    icon: FileCheck2,
    color: "from-emerald-400 to-teal-600",
    body: <PurchaseCertTool />,
  },
  {
    id: "noro-cert",
    category: "cert",
    name: "노로 비검출해역 확인서",
    description: "노로바이러스 비검출해역 확인서(PDF·스캔 JPG)로 상세페이지 최상단 강조 이미지를 만드는 도구",
    icon: ShieldCheck,
    color: "from-sky-400 to-blue-600",
    body: <NoroCertTool />,
  },
  {
    id: "product-notice",
    category: "cert",
    name: "상품정보고시",
    description: "고시 항목·주의사항·영양정보로 상세페이지 고시 이미지를 만드는 도구",
    icon: ClipboardList,
    color: "from-amber-400 to-orange-600",
    body: <ProductNoticeTool />,
  },
  {
    id: "detail-page",
    category: "detail",
    name: "상세페이지",
    description: "섹션(썸네일·타이틀·이미지·움짤·Q&A 등)을 더해 상세페이지 이미지와 관리자용 HTML 을 만드는 도구",
    icon: LayoutTemplate,
    color: "from-sky-400 to-indigo-600",
    body: <DetailPageTool />,
  },
  // 상세페이지 섹션 하나만 따로 만드는 앱(상세페이지 도구와 같은 입력·디자인, 각자 히스토리)
  {
    id: "dp-thumb",
    category: "detail",
    name: "썸네일",
    description: "상품 대표 사진을 가운데 기준 정사각 1200×1200 JPG 로 만드는 도구",
    icon: Square,
    color: "from-cyan-400 to-sky-600",
    body: <SectionApp kind="thumb" />,
  },
  {
    id: "dp-hero",
    category: "detail",
    name: "인트로",
    description: "배경 사진 + 윗줄·상품명·설명(강조)·그라데이션으로 상세페이지 인트로(860 폭) 이미지를 만드는 도구",
    icon: PanelTop,
    color: "from-blue-400 to-indigo-600",
    body: <SectionApp kind="hero" />,
  },
  {
    id: "dp-point",
    category: "detail",
    name: "타이틀",
    description: "POINT 번호·제목·설명으로 상세페이지 타이틀(860 폭) 이미지를 만드는 도구",
    icon: Type,
    color: "from-orange-400 to-red-600",
    body: <SectionApp kind="point" />,
  },
  {
    id: "dp-qa",
    category: "detail",
    name: "Q&A",
    description: "질문·답변(강조·사진)으로 상세페이지 Q&A(860 폭) 이미지를 만드는 도구",
    icon: HelpCircle,
    color: "from-teal-400 to-emerald-600",
    body: <SectionApp kind="qa" />,
  },
  {
    id: "dp-recipe",
    category: "detail",
    name: "레시피",
    description: "번호·레시피 이름·설명으로 상세페이지 레시피(860 폭) 이미지를 만드는 도구",
    icon: UtensilsCrossed,
    color: "from-pink-400 to-rose-600",
    body: <SectionApp kind="recipe" />,
  },
  {
    id: "dp-why",
    category: "detail",
    name: "WHY",
    description: "사진 카드(번호·제목·설명)로 상세페이지 WHY(860 폭) 이미지를 만드는 도구",
    icon: ListChecks,
    color: "from-violet-400 to-purple-600",
    body: <SectionApp kind="why" />,
  },
  {
    id: "ship",
    category: "detail",
    name: "이렇게 보내드려요",
    description: "내용량·아이스박스 포장 사진(정사각형 최대 4개)과 글로 상세페이지 \"이렇게 보내드려요\" 이미지를 만드는 도구",
    icon: Package,
    color: "from-lime-400 to-green-600",
    body: <ShipTool />,
  },
  {
    id: "talk",
    category: "marketing",
    name: "톡메세지",
    description: "타이틀·배경 사진·아래 띠 글을 넣어 카카오톡 메시지용 800×800 이미지를 만드는 도구",
    icon: MessageSquareText,
    color: "from-yellow-300 to-amber-500",
    body: <TalkMessageTool />,
  },
  {
    id: "video",
    category: "marketing",
    name: "동영상 → WebP·GIF",
    description: "동영상 파일(MP4·MOV·WebM)을 구간·크기·속도를 정해 움직이는 WebP 또는 GIF 로 바꾸는 도구(위 토글로 형식 선택)",
    icon: Clapperboard,
    color: "from-fuchsia-400 to-purple-600",
    body: <VideoConvertTool />,
    fill: true,
  },
  {
    id: "image-resize",
    category: "marketing",
    name: "이미지 리사이즈",
    description: "큰 사진을 정한 크기(px)로 줄여 내려받는 도구. 여러 장을 넣으면 한 번에 줄여 ZIP 으로 받습니다",
    icon: Shrink,
    color: "from-sky-400 to-blue-600",
    body: <ImageResizeTool />,
  },
  {
    id: "qr-code",
    category: "marketing",
    name: "QR코드",
    description: "URL 을 넣어 QR 코드를 만들고 PNG·SVG 로 내려받는 도구",
    icon: QrCode,
    color: "from-neutral-500 to-neutral-900",
    body: <QrCodeTool />,
  },
  {
    id: "mail-signature",
    category: "office",
    name: "메일 서명",
    description: "회사 메일 서명을 만들고 복사하는 도구",
    icon: Mail,
    color: "from-rose-400 to-red-600",
    body: <MailSignatureTool />,
  },
  {
    id: "desk-nameplate",
    category: "office",
    name: "데스크 명찰",
    description: "팀 이름·직급(직책)·이름을 넣어 8.5cm × 5.5cm 데스크 명찰을 인쇄하는 도구",
    icon: IdCard,
    color: "from-slate-500 to-zinc-800",
    body: <DeskNameplateTool />,
  },
]

function AppIcon({ tool, className = "size-16" }: { tool: Tool; className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-[22%] bg-gradient-to-br text-white shadow-md ${tool.color} ${className}`}
    >
      <tool.icon className="size-1/2" strokeWidth={1.75} aria-hidden />
    </span>
  )
}

// 앱 본문(준비 중이면 안내)
function ToolBody({ tool }: { tool: Tool }) {
  if (tool.body)
    return (
      <Suspense
        fallback={
          <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            도구를 여는 중…
          </p>
        }
      >
        {tool.body}
      </Suspense>
    )
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <AppIcon tool={tool} className="size-20 opacity-60" />
      <p className="font-medium">준비 중인 도구입니다.</p>
      <p className="text-sm text-muted-foreground">곧 이곳에서 {tool.name} 기능을 쓸 수 있습니다.</p>
    </div>
  )
}

export function ToolsPage() {
  const [open, setOpen] = useState<Tool | null>(null)
  return (
    <>
      <ToolsList onOpen={setOpen} />
      <ToolDialog tool={open} onClose={() => setOpen(null)} />
    </>
  )
}

function ToolsList({ onOpen }: { onOpen: (t: Tool) => void }) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const list = TOOLS.filter((t) => !q || `${t.name} ${t.description} ${CATEGORIES.find((c) => c.id === t.category)?.name ?? ""}`.toLowerCase().includes(q))

  return (
    <div className={PAGE_GRID}>
      <section className="col-span-12 flex flex-col gap-6">
        {/* 상단: 제목 + 검색 */}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">디자인 툴</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{TOOLS.length}개</span>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="도구 검색"
              aria-label="도구 검색"
              className="pl-8"
            />
          </div>
        </div>

        {/* 분류별 앱 목록: 아이폰 홈 화면처럼 아이콘 + 이름(검색하면 맞는 도구가 있는 분류만) */}
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            찾는 도구가 없습니다.
          </p>
        ) : (
          CATEGORIES.map((c) => {
            const tools = list.filter((t) => t.category === c.id)
            if (tools.length === 0) return null
            return (
              <div key={c.id} className="flex flex-col gap-3">
                <div className="flex items-baseline gap-2 border-b pb-2">
                  <h3 className="text-sm font-semibold">{c.name}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{tools.length}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.description}</span>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-x-4 gap-y-6">
                  {tools.map((t) => (
                    <li key={t.id}>
                      <Tip content={t.description}><button
                        type="button"
                        className="group flex w-full flex-col items-center gap-2 rounded-xl p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() => onOpen(t)}
                      >
                        <span className="relative transition-transform group-hover:scale-105 group-active:scale-95">
                          <AppIcon tool={t} />
                          {!t.body && (
                            <span className="absolute -top-1.5 -right-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-medium text-white ring-2 ring-background">
                              준비 중
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-center text-sm">{t.name}</span>
                      </button></Tip>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

// 로그인한 화면: 앱은 전체 화면 창으로 연다(오른쪽 위 X 로 닫기).
// 도구는 머리 오른쪽(X 왼쪽)에 버튼을 넣을 수 있고(ToolHeaderActions), 저장하지 않은 작업이 있으면(useToolDirty) 닫기 전에 묻는다
function ToolDialog({ tool: open, onClose }: { tool: Tool | null; onClose: () => void }) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const dirty = useRef(false)
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d
  }, [])
  const [confirm, setConfirm] = useState(false)
  const requestClose = () => {
    if (dirty.current) setConfirm(true)
    else onClose()
  }
  return (
    <ToolChromeContext.Provider value={{ actions, setDirty }}>
      <Dialog open={open !== null} onOpenChange={(o) => !o && requestClose()}>
        <DialogContent
          showCloseButton={false}
          className="flex h-svh max-h-svh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none"
          data-lenis-prevent
        >
          {open && (
            <>
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <AppIcon tool={open} className="size-9" />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate">{open.name}</DialogTitle>
                  <DialogDescription className="truncate text-xs">{open.description}</DialogDescription>
                </div>
                {/* 도구가 넣는 버튼 자리(X 왼쪽) */}
                <div ref={setActions} className="flex items-center gap-2" />
                <Button variant="ghost" size="icon" aria-label="닫기" onClick={requestClose}>
                  <X />
                </Button>
              </div>
              {/* 도구 화면 스크롤도 부드럽게 */}
              <SmoothScrollArea className={`min-h-0 flex-1 overflow-auto ${open.fill ? "lg:overflow-hidden" : ""}`} contentClassName={open.fill ? "lg:h-full" : undefined}>
                <ToolBody tool={open} />
              </SmoothScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>작업 중인 내용이 있습니다</AlertDialogTitle>
            <AlertDialogDescription className="break-keep">저장하지 않고 닫으면 지금 편집한 내용이 사라집니다. 그래도 닫을까요?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 작업</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                dirty.current = false
                setConfirm(false)
                onClose()
              }}
            >
              저장 안 하고 닫기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ToolChromeContext.Provider>
  )
}
