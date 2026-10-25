import { useState } from "react"
import { FileCheck2, LayoutTemplate, Mail, Search, X, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MailSignatureTool } from "@/components/tools/mail-signature"
import { PAGE_GRID } from "@/lib/layout"

// 디자인 툴(메뉴 이름): 디자인팀 작업에 쓰는 도구 모음. 아이폰 홈 화면처럼 앱 아이콘을 늘어놓고,
// 누르면 전체 화면 창이 열린다. 도구를 만들면 TOOLS 에 하나씩 추가하고 body 에 화면을 넣는다.

type Tool = {
  id: string
  name: string
  description: string
  icon: LucideIcon
  color: string // 아이콘 바탕(그라데이션)
  body?: React.ReactNode // 도구 화면. 없으면 준비 중
}

const TOOLS: Tool[] = [
  {
    id: "purchase-confirm",
    name: "수매확인서",
    description: "수매 확인서를 만들고 내려받는 도구",
    icon: FileCheck2,
    color: "from-emerald-400 to-teal-600",
  },
  {
    id: "detail-page",
    name: "상세페이지",
    description: "상품 상세페이지를 만들고 정리하는 도구",
    icon: LayoutTemplate,
    color: "from-sky-400 to-indigo-600",
  },
  {
    id: "mail-signature",
    name: "메일 서명",
    description: "회사 메일 서명을 만들고 복사하는 도구",
    icon: Mail,
    color: "from-rose-400 to-red-600",
    body: <MailSignatureTool />,
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
  return (
    tool.body ?? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <AppIcon tool={tool} className="size-20 opacity-60" />
        <p className="font-medium">준비 중인 도구입니다.</p>
        <p className="text-sm text-muted-foreground">곧 이곳에서 {tool.name} 기능을 쓸 수 있습니다.</p>
      </div>
    )
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
  const list = TOOLS.filter((t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q))

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

        {/* 앱 목록: 아이폰 홈 화면처럼 아이콘 + 이름 */}
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            찾는 도구가 없습니다.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-x-4 gap-y-6">
            {list.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="group flex w-full flex-col items-center gap-2 rounded-xl p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => onOpen(t)}
                  title={t.description}
                >
                  <span className="relative transition-transform group-hover:scale-105 group-active:scale-95">
                    <AppIcon tool={t} />
                    {!t.body && (
                      <span className="absolute -top-1.5 -right-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                        준비 중
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-sm">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// 로그인한 화면: 앱은 전체 화면 창으로 연다(오른쪽 위 X 로 닫기)
function ToolDialog({ tool: open, onClose }: { tool: Tool | null; onClose: () => void }) {
  return (
      <Dialog open={open !== null} onOpenChange={(o) => !o && onClose()}>
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
                <DialogClose asChild>
                  <Button variant="ghost" size="icon" aria-label="닫기">
                    <X />
                  </Button>
                </DialogClose>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <ToolBody tool={open} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
  )
}
