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
import { DateRangePicker, type DateRange } from "@/components/date-range-picker"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { FileGallery } from "@/components/requests/file-list"
import { downloadFile, formatBytes } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type FileInfo, type RequestSummaryDto } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { useApi } from "@/lib/store"

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
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto" data-lenis-prevent>
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

export function FilesPage() {
  const { data, error } = useApi<ArchiveItem[]>("/archive", 60_000)
  // 제목 오른쪽: 완료일 기간 + 검색(요청 번호·제목·작업 종류·요청자·파일 이름)
  const [range, setRange] = useState<DateRange | undefined>()
  const [query, setQuery] = useState("")
  if (!data) return <PageState error={error} />

  const q = query.trim().toLowerCase()
  const list = data.filter(
    (item) =>
      inRange(item.completedAt, range) &&
      (!q ||
        [item.code, item.title, item.workType, item.requesterName, ...item.files.map((f) => f.name)].some((v) =>
          v.toLowerCase().includes(q),
        )),
  )
  const filtered = !!range?.from || !!q

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
                <DateRangePicker id="files-range" value={range} onChange={setRange} placeholder="기간 검색" />
              </div>
              {range?.from && (
                <Button variant="ghost" size="icon-sm" aria-label="기간 지우기" onClick={() => setRange(undefined)}>
                  <X />
                </Button>
              )}
            </div>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목·요청자·파일 검색"
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
            {list.map((item) => (
              <li key={item.id} className="col-span-12 flex flex-col gap-3 rounded-xl border bg-card p-4 md:col-span-6 xl:col-span-4">
                <div className="flex items-start gap-3">
                  <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => openRequest(item.id)}>
                    <span className="text-xs text-muted-foreground">
                      {item.code} · {item.workType} · {item.requesterName}
                    </span>
                    <span className="truncate font-medium hover:underline" title={item.title}>
                      {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      완료 {item.completedAt ? formatDateTime(new Date(item.completedAt)) : "-"}
                    </span>
                  </button>
                  {item.files.length > 0 && <DownloadMenu files={item.files} />}
                </div>
                <FileGallery files={item.files} empty="보관된 파일이 없습니다." maxImages={4} imagesOnly />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
