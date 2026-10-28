import { useState } from "react"
import { Paperclip, PenLine, Pin, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { isRecent, type NoticeSummary } from "@/lib/notices"
import { formatDateTime } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { useApi } from "@/lib/store"

// 공지사항 목록: 고정 글이 맨 위, 나머지는 최신 순. 안 읽은 글은 굵게 + N.
const PAGE_SIZE = 15

export function NoticeListPage({ session }: { session: Session }) {
  const { data, error } = useApi<NoticeSummary[]>("/notices", 60_000)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  if (!data) return <PageState error={error} />

  const q = query.trim().toLowerCase()
  const list = data.filter((n) => !q || `${n.title} ${n.authorName}`.toLowerCase().includes(q))
  // 번호: 고정 글은 "공지", 나머지는 오래된 글부터 1번
  const numbered = data.filter((n) => !n.pinned)
  const numberOf = new Map(numbered.map((n, i) => [n.id, numbered.length - i]))
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const go = (next: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    setPage(Math.min(Math.max(next, 1), pageCount))
    window.scrollTo({ top: 0 })
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="공지사항"
        className="col-span-12 xl:col-span-10 xl:col-start-2"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{q ? `${list.length} / ${data.length}건` : `${data.length}건`}</span>}
        action={
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="제목·작성자 검색"
                aria-label="공지사항 검색"
                className="pl-8"
              />
            </div>
            {isManager(session) && (
              <Button onClick={() => navigate("notice-edit", "new")}>
                <PenLine data-icon="inline-start" />
                글쓰기
              </Button>
            )}
          </div>
        }
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20 pl-4 text-center">번호</TableHead>
                <TableHead>제목</TableHead>
                <TableHead className="hidden w-32 md:table-cell">작성자</TableHead>
                <TableHead className="hidden w-40 sm:table-cell">작성일</TableHead>
                <TableHead className="hidden w-20 pr-4 text-right md:table-cell">조회</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-14 text-center text-muted-foreground">
                    {data.length === 0 ? "아직 공지사항이 없습니다." : "찾는 공지사항이 없습니다."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((n) => {
                  const unread = !n.read && n.authorId !== session.id
                  return (
                    <TableRow
                      key={n.id}
                      className={`cursor-pointer ${n.pinned ? "bg-primary/5 hover:bg-primary/10" : ""}`}
                      onClick={() => navigate("notice-detail", String(n.id))}
                    >
                      <TableCell className="pl-4 text-center text-muted-foreground tabular-nums">
                        {n.pinned ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                            <Pin className="size-3" />
                            공지
                          </span>
                        ) : (
                          numberOf.get(n.id)
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <a
                            href={`#/notices/${n.id}`}
                            className={`truncate hover:underline ${unread ? "font-bold" : n.pinned ? "font-semibold" : "font-normal"}`}
                            title={n.title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {n.title}
                          </a>
                          {n.attachments > 0 && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label="첨부 파일" />}
                          {unread && isRecent(n.createdAt) && (
                            <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] leading-4 font-bold text-white" aria-label="새 글">
                              N
                            </span>
                          )}
                        </div>
                        {/* 좁은 화면: 작성자·작성일을 제목 아래에 */}
                        <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                          {n.authorName} · {formatDateTime(new Date(n.createdAt))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden truncate text-muted-foreground md:table-cell">{n.authorName}</TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">{formatDateTime(new Date(n.createdAt))}</TableCell>
                      <TableCell className="hidden pr-4 text-right text-muted-foreground tabular-nums md:table-cell">{n.views}</TableCell>
                    </TableRow>
                  )
                })
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
      </Section>
    </div>
  )
}
