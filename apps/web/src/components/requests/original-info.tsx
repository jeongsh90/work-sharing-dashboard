import { ExternalLink, LayoutGrid, Link2, PenTool, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ORIGINAL_LABEL, type OriginalKind } from "@/lib/requests"

// 작업 원본 형태 표시: "Figma 로 작업"·"디자인 툴로 제작 · 수매확인서" 등과 링크 열기 버튼.
// 파일만 올린 요청(예전 요청 포함)은 아무것도 보이지 않는다.
const ICON = { file: Upload, figma: PenTool, tool: LayoutGrid, link: Link2 }

export function OriginalInfo({
  kind,
  link,
  tool,
  compact = false,
}: {
  kind: OriginalKind | ""
  link: string
  tool: string
  compact?: boolean
}) {
  if (!kind || (kind === "file" && !link)) return null
  const Icon = ICON[kind]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
        <Icon className="size-3.5" />
        {ORIGINAL_LABEL[kind]}
        {kind === "tool" && tool && ` · ${tool}`}
      </span>
      {link && (
        <Button asChild variant="outline" size={compact ? "xs" : "sm"} onClick={(e) => e.stopPropagation()}>
          <a href={link} target="_blank" rel="noopener noreferrer" title={link}>
            <ExternalLink data-icon="inline-start" />
            {kind === "figma" ? "Figma 열기" : "링크 열기"}
          </a>
        </Button>
      )}
    </div>
  )
}
