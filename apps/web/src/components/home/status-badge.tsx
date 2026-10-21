import { Badge } from "@/components/ui/badge"
import { statusText, URGENCY_LABEL, type DesignRequest, type Urgency } from "@/lib/requests"
import { STATUS_BG, STATUS_TEXT } from "@/lib/status-colors"

export function StatusBadge({ request }: { request: Pick<DesignRequest, "status" | "revision"> }) {
  return (
    <Badge variant="secondary" className={`${STATUS_BG[request.status]} ${STATUS_TEXT[request.status]}`}>
      {statusText(request)}
    </Badge>
  )
}

// 긴급도는 두 가지만 보인다: 보통이면 비워 두고, 급함(예전의 매우 급함 포함)이면 "긴급요청"
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  if (urgency === "normal") return null
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      {URGENCY_LABEL[urgency]}
    </Badge>
  )
}
