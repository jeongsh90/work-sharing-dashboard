import { useRef, useState } from "react"
import { MoreHorizontal, Search, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { OverlayScrollbar } from "@/components/overlay-scrollbar"
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
  dueText,
  formatDateTime,
  isActive,
  isUnassigned,
  type DesignRequest,
  type RequestStatus,
} from "@/lib/requests"
import { api, ApiError } from "@/lib/api"
import { loadSession } from "@/lib/auth"
import { openRequest } from "@/lib/router"
import { invalidate, useUserNames, useUsers } from "@/lib/store"

const PAGE_SIZE = 8
const COLUMN_COUNT = 8

const FILTERS: { id: string; label: string; statuses: RequestStatus[] | null }[] = [
  { id: "all", label: "전체", statuses: null },
  { id: "waiting", label: "작업 대기", statuses: ["requested", "needs-info", "waiting"] },
  { id: "working", label: "작업 중", statuses: ["in-progress", "revising", "approved"] },
  { id: "review", label: "시안 확인", statuses: ["review"] },
  { id: "done", label: "완료", statuses: ["source-pending", "done", "canceled"] },
]

// 미배정(담당 없음) 요청을 맨 위에, 그다음 진행 중인 요청을 마감이 빠른 순으로, 끝난 요청은 최근 마감 순으로 뒤에
function byPriority(a: DesignRequest, b: DesignRequest) {
  const rank = (r: DesignRequest) => (isUnassigned(r) && isActive(r) ? 0 : isActive(r) ? 1 : 2)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  return rank(a) < 2 ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime()
}

// 보여 줄 요청이 없을 때만 안내 한 줄. 빈 줄로 표 높이를 채우지 않는다(내용이 있는 줄만 보인다).
function EmptyRow({ message }: { message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={COLUMN_COUNT} className="py-6 text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  )
}

export function RequestTable({ requests, emptyMessage }: { requests: DesignRequest[]; emptyMessage?: string }) {
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)
  const userName = useUserNames()
  const { users } = useUsers()
  const avatarOf = new Map(users?.map((u) => [u.id, u.avatarId]))
  // 요청 삭제는 슈퍼관리자만(서버도 다시 확인한다)
  const canDelete = loadSession()?.role === "superadmin"
  const [deleting, setDeleting] = useState<DesignRequest | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    setDeleteError(null)
    try {
      await api(`/requests/${deleting.id}`, { method: "DELETE" })
      invalidate()
      setDeleting(null)
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : "삭제하지 못했습니다.")
    } finally {
      setDeletePending(false)
    }
  }

  const matchesQuery = (r: DesignRequest) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const names = r.designers.map((id) => userName(id) ?? "")
    return [r.code, r.title, r.workType, r.requester, r.department, ...names].some((v) => v.toLowerCase().includes(q))
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

      <div ref={tableRef} className="relative rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">요청</TableHead>
              <TableHead>요청자</TableHead>
              <TableHead>담당</TableHead>
              <TableHead>시작 일시</TableHead>
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
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openRequest(r.id)}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.code} · {r.workType}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{r.requester}</div>
                    <div className="text-xs text-muted-foreground">{r.department}</div>
                  </TableCell>
                  <TableCell>
                    {isUnassigned(r) ? (
                      <span className="text-muted-foreground">미배정</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {r.designers.map((id) => (
                            <UserAvatar
                              key={id}
                              name={userName(id) || "?"}
                              avatarId={avatarOf.get(id)}
                              className="size-6 ring-2 ring-card"
                              fallbackClassName="text-[10px]"
                            />
                          ))}
                        </div>
                        <span>
                          {userName(r.designers[0])}
                          {r.designers.length > 1 && (
                            <span className="text-muted-foreground"> 외 {r.designers.length - 1}명</span>
                          )}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className={r.startedAt ? undefined : "text-muted-foreground"}>
                    {r.startedAt ? formatDateTime(r.startedAt) : "-"}
                  </TableCell>
                  <TableCell className={overdue ? "font-medium text-destructive" : undefined}>
                    {dueText(r)}
                    {overdue && <span className="ml-1 text-xs">마감 지남</span>}
                  </TableCell>
                  <TableCell>
                    <UrgencyBadge urgency={r.urgency} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge request={r} />
                  </TableCell>
                  <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.title} 관리`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openRequest(r.id)}>요청 상세</DropdownMenuItem>
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setDeleteError(null)
                                setDeleting(r)
                              }}
                            >
                              <Trash2 />
                              요청 삭제
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
            {visible.length === 0 && <EmptyRow message={query ? "검색 결과가 없습니다." : (emptyMessage ?? "해당하는 작업이 없습니다.")} />}
          </TableBody>
        </Table>
        {/* 좁은 화면에서 표가 가로로 넘칠 때 쓰는 겹침 스크롤바 */}
        <OverlayScrollbar
          target={() => tableRef.current?.querySelector<HTMLElement>("[data-slot=table-container]")}
          orientation="horizontal"
          className="absolute right-2 bottom-1 left-2 h-1.5"
        />
      </div>

      {/* 페이지 이동 */}
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

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && !deletePending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>요청을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.code} {deleting?.title}
              <br />
              시안·핀 댓글·진행 기록·첨부 파일까지 모두 지워지고 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deletePending ? "삭제 중…" : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
