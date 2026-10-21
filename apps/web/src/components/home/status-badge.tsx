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
