import { Bell } from "lucide-react"

import { Section } from "@/components/home/home-page"
import { PAGE_GRID } from "@/lib/layout"
import { useNotifications } from "@/lib/notifications"
import { timeAgo } from "@/lib/requests"
import { openRequest } from "@/lib/router"

export function NotificationsPage() {
  const { items } = useNotifications()

  return (
    <div className={PAGE_GRID}>
      <Section title="알림" className="col-span-12 lg:col-span-8 xl:col-span-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
            <Bell className="size-5" aria-hidden />
            받은 알림이 없습니다.
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 disabled:cursor-default"
                  disabled={!n.requestId}
                  onClick={() => n.requestId && openRequest(n.requestId)}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-destructive"}`}
                    aria-label={n.read ? undefined : "새 알림"}
                  />
                  <span className="min-w-0 flex-1">{n.message}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(new Date(n.createdAt))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
