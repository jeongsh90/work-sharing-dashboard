import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DesignerCards } from "@/components/home/designer-cards"
import { RequestTable } from "@/components/home/request-table"
import { StatCards } from "@/components/home/stat-cards"
import { PresenceButton } from "@/components/home/presence-button"
import { PageState } from "@/components/page-state"
import type { Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import type { Presence } from "@/lib/presence"
import { navigate } from "@/lib/router"
import { isDesignWorker, useDesigners, useRequests } from "@/lib/store"

export function Section({
  title,
  aside,
  action,
  children,
  className = "col-span-12",
}: {
  title: string
  aside?: React.ReactNode
  action?: React.ReactNode // 제목 줄 오른쪽 끝
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={label} onClick={onClick}>
      자세히 보기
      <ChevronRight data-icon="inline-end" />
    </Button>
  )
}

// 홈은 관리자·작업자·요청자 모두 같은 화면이다.
export function HomePage({ session, onSessionChange }: { session: Session; onSessionChange: (s: Session) => void }) {
  const { requests, error } = useRequests()
  const designers = useDesigners()

  if (!requests || !designers) return <PageState error={error} />

  const presence = Object.fromEntries(designers.map((d) => [d.id, d.presence])) as Record<string, Presence>

  // 오른쪽 아래 상태 버튼이 표의 마지막 줄을 가리지 않게 아래 여백을 둔다
  const showPresence = isDesignWorker(session)

  return (
    <div className={`${PAGE_GRID} ${showPresence ? "pb-24 md:pb-24" : ""}`}>
      <Section
        title="금주 진행 현황"
        action={<MoreButton label="금주 진행 현황 자세히 보기 (디자인팀 일정)" onClick={() => navigate("schedule")} />}
      >
        <StatCards requests={requests} />
      </Section>
      <Section title="디자인팀" aside={<span className="text-sm text-muted-foreground">{designers.length}명</span>}>
        <DesignerCards designers={designers} requests={requests} presence={presence} />
      </Section>
      <Section title="작업 현황">
        <RequestTable requests={requests} emptyMessage="아직 들어온 요청이 없습니다." />
      </Section>
      {/* 작업자(디자인팀 관리자 포함)만: 오른쪽 아래 내 현재 상태 버튼 */}
      {showPresence && <PresenceButton session={session} onSessionChange={onSessionChange} />}
    </div>
  )
}
