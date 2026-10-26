import { useState } from "react"
import { Download, FileText, ImageIcon, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { DateRangePicker, type DateRange } from "@/components/date-range-picker"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { FileGallery } from "@/components/requests/file-list"
import { downloadFile, formatBytes } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type FileInfo, type RequestSummaryDto } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { useApi, useUserNames } from "@/lib/store"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"

type ArchiveItem = RequestSummaryDto & { files: FileInfo[] }

// 최종 파일 보관함: 완료된 요청의 최종 파일과 컨펌된 시안
// 카드 제목 오른쪽 다운로드 버튼: 전체 다운로드 + 파일마다 다운로드(작업 원본·컨펌 시안으로 묶음)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 여러 파일을 차례로 받는다. 한꺼번에 누르면 브라우저가 일부를 막을 수 있어 조금씩 간격을 둔다.
async function downloadAll(files: FileInfo[]) {
  for (const f of files) {
    await downloadFile(f.id, f.name)
    await sleep(400)
  }
}

function DownloadMenu({ files }: { files: FileInfo[] }) {
  const sources = files.filter((f) => f.kind === "final")
  const drafts = files.filter((f) => f.kind !== "final")
  const groups = [
    { label: "작업 원본", list: sources },
    { label: "컨펌 시안", list: drafts },
  ].filter((g) => g.list.length > 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0" aria-label="파일 다운로드">
          <Download data-icon="inline-start" />
          다운로드
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-0" data-lenis-prevent>
        <SmoothScrollArea className="max-h-96 overflow-y-auto p-1">
        <DropdownMenuItem onSelect={() => void downloadAll(files)}>
          <Download />
          <span className="font-medium">전체 다운로드</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{files.length}개</span>
        </DropdownMenuItem>
        {groups.map((g) => (
          <DropdownMenuGroup key={g.label}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{g.label}</DropdownMenuLabel>
            {g.list.map((f) => (
              <DropdownMenuItem key={f.id} onSelect={() => void downloadFile(f.id, f.name)}>
                {f.mime.startsWith("image/") ? <ImageIcon /> : <FileText />}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        </SmoothScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 완료일이 고른 기간(시작일 0시 ~ 끝일 다음 날 0시) 안인지
function inRange(at: number | null, range: DateRange | undefined) {
  if (!range?.from) return true
  if (at === null) return false
  const from = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime()
  const toDay = range.to ?? range.from
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1).getTime()
  return at >= from && at < to
}

// 한 화면에 보이는 카드 수. 넘으면 다음 장으로
const PAGE_SIZE = 30

export function FilesPage() {
  const { data, error } = useApi<ArchiveItem[]>("/archive", 60_000)
  // 제목 오른쪽: 완료일 기간 + 검색(요청 번호·제목·작업 종류·요청자·파일 이름)
  const [range, setRange] = useState<DateRange | undefined>()
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const userName = useUserNames()
  if (!data) return <PageState error={error} />

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (item) =>
      inRange(item.completedAt, range) &&
      (!q ||
        [item.code, item.title, item.workType, item.requesterName, ...item.designers.map(userName), ...item.files.map((f) => f.name)].some((v) =>
          v.toLowerCase().includes(q),
        )),
  )
  const filtered = !!range?.from || !!q
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
        title="완료된 작업"
        aside={
          <span className="text-sm text-muted-foreground tabular-nums">
            {filtered ? `${list.length} / ${data.length}건` : `${data.length}건`}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1">
              <div className="w-60">
                <DateRangePicker
                  id="files-range"
                  value={range}
                  onChange={(r) => {
                    setRange(r)
                    setPage(1)
                  }}
                  placeholder="기간 검색"
                />
              </div>
              {range?.from && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="기간 지우기"
                  onClick={() => {
                    setRange(undefined)
                    setPage(1)
                  }}
                >
                  <X />
                </Button>
              )}
            </div>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="제목·요청자·작업자·파일 검색"
                aria-label="완료된 작업 검색"
                className="pl-8"
              />
            </div>
          </div>
        }
      >
        {data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            아직 완료된 작업이 없습니다.
          </p>
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            조건에 맞는 완료된 작업이 없습니다.
          </p>
        ) : (
          <ul className="grid grid-cols-12 gap-4 md:gap-6">
            {visible.map((item) => (
              <li key={item.id} className="col-span-12 flex flex-col gap-3 rounded-xl border bg-card p-4 md:col-span-6 xl:col-span-4">
                <div className="flex items-start gap-3">
                  <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => openRequest(item.id)}>
                    <span className="text-xs text-muted-foreground">
                      {item.code} · {item.workType}
                    </span>
                    <span className="truncate font-medium hover:underline" title={item.title}>
                      {item.title}
                    </span>
                    {/* 요청자·작업자를 이름표로 나눠 보여 준다 */}
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">요청</span>
                        <span>{item.requesterName}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">작업</span>
                        <span>{item.designers.length > 0 ? item.designers.map(userName).join(", ") : "-"}</span>
                      </span>
                      <span className="text-muted-foreground">
                        완료 {item.completedAt ? formatDateTime(new Date(item.completedAt)) : "-"}
                      </span>
                    </span>
                  </button>
                  {item.files.length > 0 && <DownloadMenu files={item.files} />}
                </div>
                <FileGallery files={item.files} empty="보관된 파일이 없습니다." maxImages={4} imagesOnly />
              </li>
            ))}
          </ul>
        )}
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
