import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DesignerCards } from "@/components/home/designer-cards"
import { RequestTable } from "@/components/home/request-table"
import { StatCards } from "@/components/home/stat-cards"
import { PAGE_GRID } from "@/lib/layout"
import { SAMPLE_PRESENCE, SAMPLE_REQUESTS } from "@/lib/sample-data"
import { TEAM } from "@/lib/team"

function Section({
  title,
  aside,
  action,
  children,
}: {
  title: string
  aside?: React.ReactNode
  action?: React.ReactNode // 제목 줄 오른쪽 끝
  children: React.ReactNode
}) {
  return (
    <section className="col-span-12 flex min-w-0 flex-col gap-3">
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

export function HomePage({ onNavigate }: { onNavigate: (menuId: string) => void }) {
  // 서버 API 가 생기면 예시 데이터 대신 API 응답을 넘긴다.
  const requests = SAMPLE_REQUESTS
  const designers = TEAM

  return (
    <div className={PAGE_GRID}>
      <div className="col-span-12 -mb-4 flex items-center gap-2">
        <Badge variant="outline" className="text-muted-foreground">
          예시 데이터
        </Badge>
        <span className="text-xs text-muted-foreground">서버에 요청 데이터가 생기면 실제 값으로 바뀝니다.</span>
      </div>
      <Section
        title="금주 진행 현황"
        action={<MoreButton label="금주 진행 현황 자세히 보기 (디자인팀 일정)" onClick={() => onNavigate("schedule")} />}
      >
        <StatCards requests={requests} />
      </Section>
      <Section title="디자인팀" aside={<span className="text-sm text-muted-foreground">{designers.length}명</span>}>
        <DesignerCards designers={designers} requests={requests} presence={SAMPLE_PRESENCE} />
      </Section>
      <Section title="작업 현황">
        <RequestTable requests={requests} designers={designers} />
      </Section>
    </div>
  )
}
