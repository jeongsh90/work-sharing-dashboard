import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Section } from "@/components/home/home-page"
import { RequestTable } from "@/components/home/request-table"
import { PageState } from "@/components/page-state"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { isActive, isRequesterOf, isUnassigned, type DesignRequest } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { useDesigners, useRequests } from "@/lib/store"

type Scope = { id: string; label: string; match: (r: DesignRequest) => boolean; empty: string }

// 받은 요청함(작업자·관리자): 내 담당 / 미배정 / 전체를 탭 없이 섹션으로 나눠 위아래로 보여 준다.
// 관리자는 미배정이 맨 위, 작업자는 내 담당이 맨 위. 관리자는 전체 위에 "작업자별 요청"(작업자를 골라 그 사람 담당 건)이 더 있다.
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
      : [{ id: "mine", label: "내 요청", match: (r) => isRequesterOf(r, session.id), empty: "보낸 요청이 없습니다." }]
  const ordered = mode === "inbox" && isManager(session) ? [scopes[1], scopes[0], ...scopes.slice(2)] : scopes

  if (!requests) return <PageState error={error} />

  return (
    <div className={PAGE_GRID}>
      {ordered.map((sc, i) => {
        const rows = requests.filter(sc.match)
        const byWorker = mode === "inbox" && sc.id === "all" && isManager(session) ? <WorkerSection key="by-worker" requests={requests} /> : null
        return [
          byWorker,
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
          </Section>,
        ]
      })}
    </div>
  )
}

// ── 작업자별 요청(관리자): 작업자를 고르면 그 사람이 맡은 요청(공동 담당 포함). 버튼 숫자는 진행 중인 건수 ──
const WORKER_KEY = "wsd.inbox.worker"
function WorkerSection({ requests }: { requests: DesignRequest[] }) {
  const designers = useDesigners()
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WORKER_KEY)
    } catch {
      return null
    }
  })
  if (!designers || designers.length === 0) return null
  const current = designers.find((d) => d.id === picked) ?? designers[0]
  const pick = (id: string) => {
    setPicked(id)
    try {
      localStorage.setItem(WORKER_KEY, id)
    } catch {
      /* 저장 못 해도 괜찮다 */
    }
  }
  const mine = (id: string) => requests.filter((r) => r.designers.includes(id))
  const rows = mine(current.id)
  return (
    <Section
      title="작업자별 요청"
      aside={<span className="text-sm text-muted-foreground tabular-nums">{rows.length}건</span>}
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="작업자">
        {designers.map((d) => {
          const active = mine(d.id).filter(isActive).length
          const on = d.id === current.id
          return (
            <Button
              key={d.id}
              size="sm"
              variant={on ? "default" : "outline"}
              role="tab"
              aria-selected={on}
              onClick={() => pick(d.id)}
            >
              {d.name}
              <span className={`tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{active}</span>
            </Button>
          )
        })}
      </div>
      <RequestTable key={current.id} requests={rows} asDesigner={current.id} emptyMessage={`${current.name} 님이 맡은 요청이 없습니다.`} />
      <p className="text-xs text-muted-foreground">이름 옆 숫자는 진행 중인 요청 수입니다(완료·취소 제외). 공동 담당도 포함합니다.</p>
    </Section>
  )
}
