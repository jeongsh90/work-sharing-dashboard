import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { BUSY_LABEL, busyLevel, initials, isActive, type BusyLevel, type DesignRequest, type Designer } from "@/lib/requests"

const BUSY_DOT: Record<BusyLevel, string> = {
  free: "bg-emerald-500",
  normal: "bg-amber-400",
  busy: "bg-red-500",
}

export function DesignerCards({ designers, requests }: { designers: Designer[]; requests: DesignRequest[] }) {
  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex w-max gap-4 pb-3">
        {designers.map((d) => {
          const mine = requests.filter((r) => isActive(r) && r.designers.includes(d.id))
          const working = mine.filter((r) => r.status === "in-progress" || r.status === "revising").length
          const level = busyLevel(mine.length)
          return (
            <div
              key={d.id}
              className="flex w-44 shrink-0 flex-col items-center gap-3 rounded-xl border bg-card px-4 py-5 text-card-foreground"
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
                <p className="text-xs text-muted-foreground">{d.title}</p>
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
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
