import { useState } from "react"
import { Download, FileInput, History, Search, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthImage } from "@/components/requests/file-list"
import { confirmDialog } from "@/components/confirm-dialog"
import { api, downloadFile } from "@/lib/api"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"

// 디자인 툴 히스토리: 툴로 만든 이미지를 제목·썸네일로 모아 보여 주고 다시 내려받는다(서버 tool-history.ts).
export type HistoryItem<F> = {
  id: number
  title: string
  fileId: string
  form: F
  authorName: string
  createdAt: number
}

export function ToolHistory<F>({ tool, onLoad }: { tool: string; onLoad?: (form: F) => void }) {
  const { data } = useApi<HistoryItem<F>[]>(`/tools/${tool}/history`, 60_000)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const list = (data ?? []).filter((h) => !q || `${h.title} ${h.authorName}`.toLowerCase().includes(q))

  const remove = async (h: HistoryItem<F>) => {
    if (!(await confirmDialog({ title: `"${h.title}" 기록을 지울까요?`, confirmText: "삭제", destructive: true }))) return
    await api(`/tools/history/${h.id}`, { method: "DELETE" })
    invalidate()
  }

  return (
    <section className="flex flex-col gap-4 border-t pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <History className="size-4" aria-hidden />
          히스토리
        </h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {q && data ? `${list.length} / ${data.length}건` : `${data?.length ?? 0}건`}
        </span>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제품명·만든 사람 검색" aria-label="히스토리 검색" className="pl-8" />
        </div>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {data && data.length > 0 ? "검색 결과가 없습니다." : "아직 만든 이미지가 없습니다. 다운로드하면 여기에 남습니다."}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {list.map((h) => (
            <li key={h.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
              <button
                type="button"
                className="relative block aspect-[3/4] overflow-hidden bg-white"
                onClick={() => downloadFile(h.fileId, `${h.title}_r.jpg`)}
                title={`${h.title} 다운로드`}
              >
                <AuthImage fileId={h.fileId} alt={h.title} size="w640" className="size-full object-cover object-top" />
              </button>
              <div className="flex flex-col gap-1 p-3">
                <p className="truncate text-sm font-medium" title={h.title}>
                  {h.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {h.authorName} · {formatDateTime(new Date(h.createdAt))}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => downloadFile(h.fileId, `${h.title}_r.jpg`)}>
                    <Download data-icon="inline-start" />
                    다운로드
                  </Button>
                  {onLoad && (
                    <Button size="icon-sm" variant="ghost" aria-label="입력 내용 불러오기" title="입력 내용 불러오기" onClick={() => onLoad(h.form)}>
                      <FileInput />
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label="삭제" onClick={() => remove(h)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
