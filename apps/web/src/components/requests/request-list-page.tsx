import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Section } from "@/components/home/home-page"
import { RequestTable } from "@/components/home/request-table"
import { PageState } from "@/components/page-state"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { isActive, isUnassigned, type DesignRequest } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { useRequests } from "@/lib/store"

type Scope = { id: string; label: string; match: (r: DesignRequest) => boolean; empty: string }

// 받은 요청함(작업자·관리자): 내 담당 / 미배정 / 전체
// 내 요청(모두): 내가 요청한 건
export function RequestListPage({ session, mode }: { session: Session; mode: "inbox" | "mine" }) {
  const { requests, error } = useRequests()
  const scopes: Scope[] =
    mode === "inbox"
      ? [
          { id: "assigned", label: "내 담당", match: (r) => r.designers.includes(session.id), empty: "맡은 요청이 없습니다." },
          {
            id: "unassigned",
            label: "미배정",
            match: (r) => isUnassigned(r) && isActive(r),
            empty: "담당이 정해지지 않은 요청이 없습니다.",
          },
          { id: "all", label: "전체", match: () => true, empty: "아직 들어온 요청이 없습니다." },
        ]
      : [{ id: "mine", label: "내 요청", match: (r) => r.requesterId === session.id, empty: "보낸 요청이 없습니다." }]
  const [scope, setScope] = useState(mode === "inbox" && isManager(session) ? "unassigned" : scopes[0].id)

  if (!requests) return <PageState error={error} />

  const current = scopes.find((s) => s.id === scope) ?? scopes[0]
  const rows = requests.filter(current.match)

  return (
    <div className={PAGE_GRID}>
      <Section
        title={mode === "inbox" ? "받은 요청" : "내가 보낸 요청"}
        aside={
          scopes.length > 1 && (
            <Tabs value={scope} onValueChange={setScope} className="ml-2">
              <TabsList>
                {scopes.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>
                    {s.label}
                    <span className="text-xs text-muted-foreground tabular-nums">{requests.filter(s.match).length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )
        }
        action={
          mode === "mine" && (
            <Button size="sm" onClick={() => navigate("request")}>
              <Plus data-icon="inline-start" />새 요청
            </Button>
          )
        }
      >
        <RequestTable key={scope} requests={rows} emptyMessage={current.empty} />
      </Section>
    </div>
  )
}
