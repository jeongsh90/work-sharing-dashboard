import { Badge } from "@/components/ui/badge"
import { statusText, URGENCY_LABEL, type DesignRequest, type RequestStatus, type Urgency } from "@/lib/requests"

// 상태별 색. 글자와 함께 보여 색만으로 구분하지 않는다.
const STATUS_CLASS: Record<RequestStatus, string> = {
  requested: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  "needs-info": "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  waiting: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "in-progress": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  review: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  revising: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  canceled: "bg-muted text-muted-foreground",
}

export function StatusBadge({ request }: { request: DesignRequest }) {
  return (
    <Badge variant="secondary" className={STATUS_CLASS[request.status]}>
      {statusText(request)}
    </Badge>
  )
}

const URGENCY_CLASS: Record<Urgency, string> = {
  normal: "",
  urgent: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  critical: "border-destructive/40 text-destructive",
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  if (urgency === "normal") return <span className="text-muted-foreground">{URGENCY_LABEL.normal}</span>
  return (
    <Badge variant="outline" className={URGENCY_CLASS[urgency]}>
      {URGENCY_LABEL[urgency]}
    </Badge>
  )
}
