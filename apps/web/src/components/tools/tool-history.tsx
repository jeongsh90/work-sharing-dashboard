import { useMemo, useState } from "react"
import { Download, FileInput, History, LoaderCircle, Search, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthImage } from "@/components/requests/file-list"
import { confirmDialog } from "@/components/confirm-dialog"
import { api, downloadFile } from "@/lib/api"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"
import { Tip } from "@/components/tip"

// 디자인 툴 히스토리: 툴로 만든 이미지를 제목·썸네일로 모아 보여 주고 다시 내려받는다(서버 tool-history.ts).
export type HistoryItem<F> = {
  id: number
  title: string
  fileId: string
  form: F
  authorName: string
  createdAt: number
}

// fileName: 다시 내려받을 때 이름(기본 "제품명_r.jpg" = 상품정보고시). 기록마다 다르면 두 번째 인자(기록)를 쓴다
// contain: 썸네일을 자르지 않고 칸 안에 다 보이게(가로로 긴 움짤 등)
export function ToolHistory<F>({
  tool,
  onLoad,
  fileName = (title) => `${title}_r.jpg`,
  meta,
  contain = false,
}: {
  tool: string
  onLoad?: (form: F, item: HistoryItem<F>) => void | Promise<void>
  fileName?: (title: string, item: HistoryItem<F>) => string
  // 주면 썸네일 없이 목록으로 보여 준다(상세페이지: 카테고리·번호 같은 정보 한 줄)
  meta?: (form: F) => string
  contain?: boolean
}) {
  const { data } = useApi<HistoryItem<F>[]>(`/tools/${tool}/history`, 60_000)
  const [query, setQuery] = useState("")
  // 같은 제품(제목)은 가장 최근 것만 보여 주고, 그 전 것들은 "과거 내역" 버튼을 눌러야 보인다
  const [showOld, setShowOld] = useState(false)
  const { latest, old } = useMemo(() => {
    const sorted = [...(data ?? [])].sort((a, b) => b.createdAt - a.createdAt)
    const seen = new Set<string>()
    const latest: HistoryItem<F>[] = []
    const old: HistoryItem<F>[] = []
    for (const h of sorted) {
      const key = h.title.trim()
      if (seen.has(key)) old.push(h)
      else {
        seen.add(key)
        latest.push(h)
      }
    }
    return { latest, old }
  }, [data])
  // 불러오는 중인 기록: 버튼에 도는 표시를 띄우고 그동안 다른 불러오기는 막는다(너무 빨리 끝나도 잠깐은 보이게)
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const load = async (h: HistoryItem<F>) => {
    if (!onLoad || loadingId !== null) return
    setLoadingId(h.id)
    try {
      await Promise.all([onLoad(h.form, h), new Promise((r) => setTimeout(r, 350))])
    } finally {
      setLoadingId(null)
    }
  }
  const base = showOld ? old : latest
  const q = query.trim().toLowerCase()
  const list = base.filter((h) => !q || `${h.title} ${h.authorName}`.toLowerCase().includes(q))

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
          {showOld ? "과거 내역" : "히스토리"}
        </h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {q ? `${list.length} / ${base.length}건` : `${base.length}건`}
        </span>
        {(old.length > 0 || showOld) && (
          <Button size="sm" variant={showOld ? "secondary" : "outline"} onClick={() => setShowOld((v) => !v)}>
            <History data-icon="inline-start" />
            {showOld ? "최신 내역 보기" : `과거 내역 ${old.length}건`}
          </Button>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제품명·만든 사람 검색" aria-label="히스토리 검색" className="pl-8" />
        </div>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {showOld && !q ? "과거 내역이 없습니다." : data && data.length > 0 ? "검색 결과가 없습니다." : "아직 만든 이미지가 없습니다. 다운로드하면 여기에 남습니다."}
        </p>
      ) : meta ? (
        // 목록형: 제목 · 정보(카테고리·번호) · 만든 사람·시각 · 불러오기·지우기
        <ul className="flex flex-col gap-2">
          {list.map((h) => (
            <li key={h.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <Tip content={onLoad ? "누르면 입력 내용을 불러옵니다" : undefined}><button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left disabled:opacity-50"
                disabled={!onLoad || loadingId !== null}
                onClick={() => void load(h)}
              >
                <span className="truncate font-medium hover:underline">{h.title}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {[meta(h.form), h.authorName, formatDateTime(new Date(h.createdAt))].filter(Boolean).join(" · ")}
                </span>
              </button></Tip>
              {onLoad && (
                <Button size="sm" variant="outline" disabled={loadingId !== null} onClick={() => void load(h)}>
                  {loadingId === h.id ? <LoaderCircle data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <FileInput data-icon="inline-start" />}
                  {loadingId === h.id ? "불러오는 중…" : "불러오기"}
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`${h.title} 지우기`} onClick={() => remove(h)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {list.map((h) => (
            <li key={h.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
              <Tip content={`${h.title} 다운로드`}><button
                type="button"
                className={`relative block overflow-hidden ${contain ? "aspect-square bg-muted" : "aspect-[3/4] bg-white"}`}
                onClick={() => downloadFile(h.fileId, fileName(h.title, h))}
              >
                <AuthImage fileId={h.fileId} alt={h.title} size="w640" className={contain ? "size-full object-contain" : "size-full object-cover object-top"} />
                {loadingId === h.id && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-sm font-medium backdrop-blur-[1px]">
                    <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" />
                    불러오는 중…
                  </span>
                )}
              </button></Tip>
              <div className="flex flex-col gap-1 p-3">
                <Tip content={h.title}><p className="truncate text-sm font-medium">
                  {h.title}
                </p></Tip>
                <p className="truncate text-xs text-muted-foreground">
                  {h.authorName} · {formatDateTime(new Date(h.createdAt))}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => downloadFile(h.fileId, fileName(h.title, h))}>
                    <Download data-icon="inline-start" />
                    다운로드
                  </Button>
                  {onLoad && (
                    <Tip content={"입력 내용 불러오기"}><Button size="icon-sm" variant="ghost" aria-label="입력 내용 불러오기" disabled={loadingId !== null} onClick={() => void load(h)}>
                      {loadingId === h.id ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <FileInput />}
                    </Button></Tip>
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
