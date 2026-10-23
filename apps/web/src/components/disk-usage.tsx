import { HardDrive } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/api"
import { useApi } from "@/lib/store"

type Disk = { drive: string; total: number; free: number } | null

// 사이드메뉴 지원 아래: 서버 드라이브(D:) 전체 용량·남은 용량.
// 서버가 정상훈·슈퍼관리자에게만 값을 주고, 다른 계정에는 null 이라 보이지 않는다.
export function DiskUsage() {
  const { data } = useApi<Disk>("/disk", 300_000)
  if (!data) return null

  const used = data.total - data.free
  const percent = data.total > 0 ? Math.round((used / data.total) * 100) : 0
  const low = data.free / data.total < 0.1 // 남은 용량 10% 미만이면 빨갛게

  return (
    <div className="mt-3 flex flex-col gap-1.5 px-2 pb-1 text-xs group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-1.5 text-sidebar-foreground/70">
        <HardDrive className="size-3.5" aria-hidden />
        <span>{data.drive} 드라이브</span>
        <span className="ml-auto tabular-nums">{percent}% 사용</span>
      </div>
      <Progress
        value={percent}
        aria-label={`${data.drive} 드라이브 사용량 ${percent}%`}
        className={low ? "h-1.5 [&>*]:bg-destructive" : "h-1.5"}
      />
      <div className="flex justify-between tabular-nums">
        <span className={low ? "font-medium text-destructive" : "text-sidebar-foreground"}>남은 용량 {formatBytes(data.free)}</span>
        <span className="text-sidebar-foreground/70">전체 {formatBytes(data.total)}</span>
      </div>
    </div>
  )
}
