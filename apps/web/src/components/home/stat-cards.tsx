import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { isActive, isThisWeek, type DesignRequest } from "@/lib/requests"

export function StatCards({ requests }: { requests: DesignRequest[] }) {
  const active = requests.filter(isActive)
  const stats = [
    { label: "진행 중 전체", value: active.length, note: "완료·취소를 뺀 요청" },
    { label: "이번 주 마감", value: active.filter((r) => isThisWeek(r.dueAt)).length, note: "월요일 ~ 일요일" },
    {
      label: "작업 중",
      value: active.filter((r) => r.status === "in-progress" || r.status === "revising").length,
      note: "수정 중 포함",
    },
    { label: "검토 대기", value: active.filter((r) => r.status === "review").length, note: "시안 확인을 기다리는 요청" },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="gap-2">
          <CardHeader>
            <CardDescription>{s.label}</CardDescription>
            <CardTitle className="text-3xl font-bold tabular-nums">
              {s.value}
              <span className="ml-1 text-base font-medium text-muted-foreground">건</span>
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">{s.note}</CardFooter>
        </Card>
      ))}
    </div>
  )
}
