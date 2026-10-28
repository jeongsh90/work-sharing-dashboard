import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Download, FileText, ImageIcon, List, Pencil, Pin, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { confirmDialog } from "@/components/confirm-dialog"
import { PageState } from "@/components/page-state"
import { api, downloadLargeFile, formatBytes } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { toViewHtml, type NoticeDetail } from "@/lib/notices"
import { formatDateTime } from "@/lib/requests"
import { navigate } from "@/lib/router"
import { invalidate } from "@/lib/store"

// 공지사항 상세: 제목·작성자·작성일·조회, 본문, 첨부 파일, 이전·다음 글.
// 열면 읽음으로 남고(서버), 메뉴의 N 표시가 바로 꺼지게 목록을 새로 받는다.

export const NOTICE_COLUMN = "col-span-12 lg:col-span-10 lg:col-start-2 xl:col-span-8 xl:col-start-3"

// 저장된 본문(HTML)을 안전하게 걸러 보여 준다. 그림은 로그인 주소로 바꿔 채운다.
export function NoticeContent({ html }: { html: string }) {
  const [view, setView] = useState<{ src: string; html: string } | null>(null)
  useEffect(() => {
    let alive = true
    void toViewHtml(html).then((out) => alive && setView({ src: html, html: out }))
    return () => {
      alive = false
    }
  }, [html])
  if (!view || view.src !== html) return <div className="min-h-40" />
  return <div className="rich-content" dangerouslySetInnerHTML={{ __html: view.html }} />
}

export function NoticeDetailPage({ id, session }: { id: string; session: Session }) {
  const [data, setData] = useState<NoticeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api<NoticeDetail>(`/notices/${id}`).then(
      (d) => {
        if (!alive) return
        setData(d)
        invalidate()
      },
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [id])
  if (!data) return <PageState error={error} />

  const manager = isManager(session)
  const remove = async () => {
    if (!(await confirmDialog({ title: "이 공지사항을 지울까요?", description: "첨부 파일과 본문 그림도 함께 지워집니다.", confirmText: "삭제", destructive: true }))) return
    await api(`/notices/${data.id}`, { method: "DELETE" })
    invalidate()
    navigate("notices")
  }

  return (
    <div className={PAGE_GRID}>
      <article className={`${NOTICE_COLUMN} flex flex-col gap-6`}>
        <header className="flex flex-col gap-3">
          {data.pinned && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              <Pin className="size-3" />
              고정 공지
            </span>
          )}
          <h2 className="text-xl font-bold break-keep">{data.title}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.authorName}</span>
            <span className="tabular-nums">{formatDateTime(new Date(data.createdAt))}</span>
            {data.updatedAt - data.createdAt > 60_000 && <span className="tabular-nums">수정 {formatDateTime(new Date(data.updatedAt))}</span>}
            <span className="tabular-nums">조회 {data.views}</span>
          </div>
          <Separator />
        </header>

        <NoticeContent html={data.body} />

        {data.files.length > 0 && (
          <section className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold">첨부 파일 {data.files.length}</h3>
            <ul className="flex flex-col gap-1">
              {data.files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => void downloadLargeFile(f.id, f.name)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {f.mime.startsWith("image/") ? <ImageIcon className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                    <Download className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 이전·다음 글 */}
        <nav className="flex flex-col divide-y overflow-hidden rounded-xl border text-sm" aria-label="이전·다음 공지">
          {[
            { label: "다음 글", icon: ChevronUp, item: data.next },
            { label: "이전 글", icon: ChevronDown, item: data.prev },
          ].map(({ label, icon: Icon, item }) => (
            <div key={label} className="flex items-center gap-3 px-4 py-3">
              <span className="flex w-16 shrink-0 items-center gap-1 text-muted-foreground">
                <Icon className="size-4" />
                {label}
              </span>
              {item ? (
                <a href={`#/notices/${item.id}`} className="min-w-0 truncate hover:underline">
                  {item.title}
                </a>
              ) : (
                <span className="text-muted-foreground">없습니다.</span>
              )}
            </div>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate("notices")}>
            <List data-icon="inline-start" />
            목록
          </Button>
          {manager && (
            <>
              <Button variant="outline" className="ml-auto" onClick={() => navigate("notice-edit", String(data.id))}>
                <Pencil data-icon="inline-start" />
                수정
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => void remove()}>
                <Trash2 data-icon="inline-start" />
                삭제
              </Button>
            </>
          )}
        </div>
      </article>
    </div>
  )
}
