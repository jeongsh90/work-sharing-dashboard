import { Badge } from "@/components/ui/badge"
import { DesignerCards } from "@/components/home/designer-cards"
import { RequestTable } from "@/components/home/request-table"
import { StatCards } from "@/components/home/stat-cards"
import { SAMPLE_DESIGNERS, SAMPLE_REQUESTS } from "@/lib/sample-data"

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function HomePage() {
  // 서버 API 가 생기면 예시 데이터 대신 API 응답을 넘긴다.
  const requests = SAMPLE_REQUESTS
  const designers = SAMPLE_DESIGNERS

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-8 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-muted-foreground">
          예시 데이터
        </Badge>
        <span className="text-xs text-muted-foreground">서버에 요청 데이터가 생기면 실제 값으로 바뀝니다.</span>
      </div>
      <Section title="진행 현황">
        <StatCards requests={requests} />
      </Section>
      <Section title="디자인팀" aside={<span className="text-sm text-muted-foreground">{designers.length}명</span>}>
        <DesignerCards designers={designers} requests={requests} />
      </Section>
      <Section title="작업 현황">
        <RequestTable requests={requests} designers={designers} />
      </Section>
    </div>
  )
}
