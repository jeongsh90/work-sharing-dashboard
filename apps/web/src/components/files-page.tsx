import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { FileGallery } from "@/components/requests/file-list"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type FileInfo, type RequestSummaryDto } from "@/lib/requests"
import { openRequest } from "@/lib/router"
import { useApi } from "@/lib/store"

type ArchiveItem = RequestSummaryDto & { files: FileInfo[] }

// 최종 파일 보관함: 완료된 요청의 최종 파일과 컨펌된 시안
export function FilesPage() {
  const { data, error } = useApi<ArchiveItem[]>("/archive", 60_000)
  if (!data) return <PageState error={error} />

  return (
    <div className={PAGE_GRID}>
      <Section title="완료된 작업" aside={<span className="text-sm text-muted-foreground">{data.length}건</span>}>
        {data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            아직 완료된 작업이 없습니다.
          </p>
        ) : (
          <ul className="grid grid-cols-12 gap-4 md:gap-6">
            {data.map((item) => (
              <li key={item.id} className="col-span-12 flex flex-col gap-3 rounded-xl border bg-card p-4 md:col-span-6 xl:col-span-4">
                <button type="button" className="flex flex-col gap-0.5 text-left" onClick={() => openRequest(item.id)}>
                  <span className="text-xs text-muted-foreground">
                    {item.code} · {item.workType} · {item.requesterName}
                  </span>
                  <span className="font-medium hover:underline">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    완료 {item.completedAt ? formatDateTime(new Date(item.completedAt)) : "-"}
                  </span>
                </button>
                <FileGallery files={item.files} empty="보관된 파일이 없습니다." />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
