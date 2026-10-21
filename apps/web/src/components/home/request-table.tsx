import { useMemo, useState } from "react"
import { MoreHorizontal, Search } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge, UrgencyBadge } from "@/components/home/status-badge"
import {
  formatDue,
  initials,
  isActive,
  type DesignRequest,
  type Designer,
  type RequestStatus,
} from "@/lib/requests"

const PAGE_SIZE = 8

const FILTERS: { id: string; label: string; statuses: RequestStatus[] | null }[] = [
  { id: "all", label: "전체", statuses: null },
  { id: "waiting", label: "작업 대기", statuses: ["requested", "needs-info", "waiting"] },
  { id: "working", label: "작업 중", statuses: ["in-progress", "revising"] },
  { id: "review", label: "시안 확인", statuses: ["review"] },
  { id: "done", label: "완료", statuses: ["done", "canceled"] },
]

// 진행 중인 요청을 마감이 빠른 순으로 먼저, 끝난 요청은 최근 마감 순으로 뒤에
function byPriority(a: DesignRequest, b: DesignRequest) {
  if (isActive(a) !== isActive(b)) return isActive(a) ? -1 : 1
  return isActive(a) ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime()
}

export function RequestTable({ requests, designers }: { requests: DesignRequest[]; designers: Designer[] }) {
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const designerName = useMemo(() => new Map(designers.map((d) => [d.id, d.name])), [designers])

  const matchesQuery = (r: DesignRequest) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const names = r.designers.map((id) => designerName.get(id) ?? "")
    return [r.title, r.workType, r.requester, r.department, ...names].some((v) => v.toLowerCase().includes(q))
  }

  const searched = requests.filter(matchesQuery)
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.id, f.statuses ? searched.filter((r) => f.statuses!.includes(r.status)).length : searched.length]),
  )
  const statuses = FILTERS.find((f) => f.id === filter)?.statuses
  const rows = searched.filter((r) => !statuses || statuses.includes(r.status)).sort(byPriority)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  // 마감 지남 판단 기준 시각. 화면을 열 때 한 번 잡는다.
  const [now] = useState(() => new Date())

  const go = (next: number) => (event: React.MouseEvent) => {
    event.preventDefault()
    setPage(Math.min(Math.max(next, 1), pageCount))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onValueChange={(v) => {
            setFilter(v)
            setPage(1)
          }}
        >
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>
                {f.label}
                <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="제목·요청자·디자이너 검색"
            aria-label="작업 검색"
            className="pl-8"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">요청</TableHead>
              <TableHead>요청자</TableHead>
              <TableHead>담당</TableHead>
              <TableHead>마감 일시</TableHead>
              <TableHead>긴급도</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-12 pr-4 text-right">
                <span className="sr-only">관리</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const overdue = isActive(r) && r.dueAt < now
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{r.workType}</div>
                  </TableCell>
                  <TableCell>
                    <div>{r.requester}</div>
                    <div className="text-xs text-muted-foreground">{r.department}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {r.designers.map((id) => (
                          <Avatar key={id} className="size-6 ring-2 ring-card">
                            <AvatarFallback className="text-[10px]">{initials(designerName.get(id) ?? "?")}</AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span>
                        {designerName.get(r.designers[0])}
                        {r.designers.length > 1 && (
                          <span className="text-muted-foreground"> 외 {r.designers.length - 1}명</span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={overdue ? "font-medium text-destructive" : undefined}>
                    {formatDue(r.dueAt)}
                    {overdue && <span className="ml-1 text-xs">마감 지남</span>}
                  </TableCell>
                  <TableCell>
                    <UrgencyBadge urgency={r.urgency} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge request={r} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.title} 관리`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled>요청 상세 (준비 중)</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {query ? "검색 결과가 없습니다." : "해당하는 작업이 없습니다."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" text="이전" aria-label="이전 페이지" onClick={go(current - 1)} />
            </PaginationItem>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <PaginationItem key={n}>
                <PaginationLink href="#" isActive={n === current} onClick={go(n)}>
                  {n}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext href="#" text="다음" aria-label="다음 페이지" onClick={go(current + 1)} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}
