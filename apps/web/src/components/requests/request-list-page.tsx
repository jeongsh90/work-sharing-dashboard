import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Section } from "@/components/home/home-page"
import { RequestTable } from "@/components/home/request-table"
import { PageState } from "@/components/page-state"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { isActive, isUnassigned, type DesignRequest } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { useRequests } from "@/lib/store"

type Scope = { id: string; label: string; match: (r: DesignRequest) => boolean; empty: string }

// 받은 요청함(작업자·관리자): 내 담당 / 미배정 / 전체를 탭 없이 섹션으로 나눠 위아래로 보여 준다.
// 관리자는 미배정이 맨 위, 작업자는 내 담당이 맨 위.
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
  const ordered = mode === "inbox" && isManager(session) ? [scopes[1], scopes[0], ...scopes.slice(2)] : scopes

  if (!requests) return <PageState error={error} />

  return (
    <div className={PAGE_GRID}>
      {ordered.map((sc, i) => {
        const rows = requests.filter(sc.match)
        return (
          <Section
            key={sc.id}
            title={mode === "inbox" ? (sc.id === "all" ? "전체 요청" : sc.label) : "내가 보낸 요청"}
            aside={<span className="text-sm text-muted-foreground tabular-nums">{rows.length}건</span>}
            action={
              mode === "mine" &&
              i === 0 && (
                <Button size="sm" onClick={() => navigate("request")}>
                  <Plus data-icon="inline-start" />새 요청
                </Button>
              )
            }
          >
            <RequestTable requests={rows} emptyMessage={sc.empty} statusTabs={sc.id !== "unassigned"} />
          </Section>
        )
      })}
    </div>
  )
}
