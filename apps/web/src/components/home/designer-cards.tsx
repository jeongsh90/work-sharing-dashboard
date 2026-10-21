import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { BUSY_LABEL, busyLevel, designerTitle, initials, isActive, type BusyLevel, type DesignRequest, type Designer } from "@/lib/requests"

// 카드 폭 = 본문 12칸 그리드의 칸 수(넓은 화면 2칸). 간격은 INNER_GRID(gap-4, md:gap-6)와 같다.
// 카드 비율은 포커 카드(63.5 × 88.9mm, 5:7).
// (100% - 간격 × (한 화면 장수 - 1)) / 한 화면 장수
const CARD_WIDTH =
  "basis-[calc((100%-1rem)/2)] md:basis-[calc((100%-3rem)/3)] lg:basis-[calc((100%-4.5rem)/4)] xl:basis-[calc((100%-7.5rem)/6)]"

const BUSY_DOT: Record<BusyLevel, string> = {
  free: "bg-emerald-500",
  normal: "bg-amber-400",
  busy: "bg-red-500",
}

export function DesignerCards({ designers, requests }: { designers: Designer[]; requests: DesignRequest[] }) {
  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin] md:gap-6">
      {designers.map((d) => {
        const mine = requests.filter((r) => isActive(r) && r.designers.includes(d.id))
        const working = mine.filter((r) => r.status === "in-progress" || r.status === "revising").length
        const level = busyLevel(mine.length)
        return (
          <div
            key={d.id}
            className={`flex aspect-[5/7] shrink-0 snap-start flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-5 text-card-foreground ${CARD_WIDTH}`}
          >
            <div className="relative">
              <Avatar className="size-14">
                <AvatarFallback className="text-base font-semibold">{initials(d.name)}</AvatarFallback>
              </Avatar>
              <span
                className={`absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-card ${BUSY_DOT[level]}`}
                aria-hidden
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold">{d.name}</p>
              <p className="text-xs text-muted-foreground">{designerTitle(d)}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                진행 <b className="text-foreground tabular-nums">{mine.length}</b> · 작업 중{" "}
                <b className="text-foreground tabular-nums">{working}</b>
              </span>
            </div>
            <Badge variant="outline">{BUSY_LABEL[level]}</Badge>
          </div>
        )
      })}
    </div>
  )
}
