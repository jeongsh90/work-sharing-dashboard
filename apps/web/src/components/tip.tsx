import * as React from "react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// 브라우저 기본 title 말풍선 대신 쓰는 shadcn 툴팁.
// content 가 비어 있으면 툴팁 없이 children 만 그린다.
// 비활성(disabled) 버튼은 포인터 이벤트를 받지 않으므로 wrap 으로 span 에 한 번 감싼다.
export function Tip({
  content,
  children,
  side,
  wrap,
  className,
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: "top" | "right" | "bottom" | "left"
  wrap?: boolean
  className?: string
}) {
  if (content === null || content === undefined || content === false || content === "") return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {wrap ? (
          <span tabIndex={0} className={cn("inline-flex", className)}>
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent side={side} className="whitespace-pre-line break-keep [overflow-wrap:anywhere]">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
