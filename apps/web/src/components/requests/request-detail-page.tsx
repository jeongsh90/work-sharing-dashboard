import { useState } from "react"
import { ArrowLeft, Check, Download } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge, UrgencyBadge } from "@/components/home/status-badge"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { ActionPanel } from "@/components/requests/action-panel"
import { FileGallery } from "@/components/requests/file-list"
import { OriginalInfo } from "@/components/requests/original-info"
import { RequestForm } from "@/components/requests/request-form-page"
import { ReviewBoard } from "@/components/requests/review-board"
import { Timeline } from "@/components/requests/timeline"
import { EDIT_ON_OPEN_KEY, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime, type RequestDetailDto, type RequestStatus } from "@/lib/requests"
import { STATUS_BEAM } from "@/lib/status-colors"
import { downloadFile } from "@/lib/api"
import { useApi, invalidate, useUserNames } from "@/lib/store"

// 진행 단계 표시. 기획 흐름: 요청 → 담당 지정 → 작업 → 컨펌 요청 → 컨펌 → 완료
const STEPS: { label: string; reached: RequestStatus[] }[] = [
  { label: "요청", reached: ["requested", "needs-info", "waiting", "in-progress", "review", "revising", "approved", "source-pending", "done"] },
  { label: "담당 지정", reached: ["waiting", "in-progress", "review", "revising", "approved", "source-pending", "done"] },
  { label: "작업", reached: ["in-progress", "review", "revising", "approved", "source-pending", "done"] },
  { label: "컨펌 요청", reached: ["review", "revising", "approved", "source-pending", "done"] },
  // 컨펌하면 작업은 완료. 그다음 작업자가 원본을 올린다(예전 요청의 approved 도 여기)
  { label: "컨펌·완료", reached: ["approved", "source-pending", "done"] },
  { label: "원본 등록", reached: ["done"] },
]

// 진행 단계: 지름 56px 원(휴대폰은 44px)을 선으로 잇는다. 지난 단계는 체크, 현재 단계는 지금 상태 색 테두리, 남은 단계는 흐린 번호
function Steps({ status }: { status: RequestStatus }) {
  if (status === "canceled") return null
  const current = STEPS.reduce((last, s, i) => (s.reached.includes(status) ? i : last), 0)
  const color = STATUS_BEAM[status]
  return (
    <ol className="flex w-full max-w-4xl items-start py-4" aria-label="진행 단계">
      {STEPS.map((s, i) => {
        const done = i < current || status === "done"
        const now = i === current && status !== "done"
        return (
          <li key={s.label} className="flex min-w-0 flex-1 items-start last:flex-none">
            <div className="flex w-11 shrink-0 flex-col items-center gap-2 sm:w-14" aria-current={now ? "step" : undefined}>
              <span
                className={`flex size-11 items-center justify-center rounded-full border-2 text-sm sm:size-14 sm:text-base font-semibold tabular-nums transition-colors ${
                  done ? "border-foreground bg-foreground text-background" : now ? "bg-card shadow-sm" : "border-dashed border-border text-muted-foreground"
                }`}
                style={now ? { borderColor: color, color, boxShadow: `0 0 0 4px color-mix(in oklab, ${color} 15%, transparent)` } : undefined}
              >
                {done ? <Check className="size-5 sm:size-6" aria-hidden /> : i + 1}
              </span>
              <span
                className={`text-center text-xs whitespace-nowrap ${now ? "font-semibold" : done ? "font-medium" : "text-muted-foreground"}`}
                style={now ? { color } : undefined}
              >
                {s.label}
              </span>
            </div>
            {/* 다음 단계로 잇는 선(원 가운데 높이). 지난 구간은 진하게 */}
            {i < STEPS.length - 1 && (
              <span className={`mx-1 mt-[21px] h-0.5 min-w-2 flex-1 sm:mt-7 rounded-full ${i < current || status === "done" ? "bg-foreground" : "bg-border"}`} aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

export function RequestDetailPage({ id, session, onBack }: { id: string; session: Session; onBack: () => void }) {
  const { data: detail, error } = useApi<RequestDetailDto>(`/requests/${id}`, 15_000)
  const userName = useUserNames()
  // 목록의 "요청 수정"으로 들어오면 바로 수정 모드
  const [editing, setEditing] = useState(() => {
    try {
      if (sessionStorage.getItem(EDIT_ON_OPEN_KEY) !== id) return false
      sessionStorage.removeItem(EDIT_ON_OPEN_KEY)
      return true
    } catch {
      return false
    }
  })
  const [round, setRound] = useState<number | null>(null)
  // 마감 지남 판단 기준 시각. 화면을 열 때 한 번 잡는다.
  const [now] = useState(() => Date.now())

  if (!detail) return <PageState error={error} />

  const rounds = detail.submissions
  const shown = rounds.find((s) => s.round === round) ?? rounds[rounds.length - 1]
  const overdue = detail.status !== "done" && detail.status !== "canceled" && detail.dueAt < now

  const content = (
    <Section title="요청 내용" className="col-span-12 lg:col-span-7">
      <Card>
        <CardContent className="flex flex-col gap-5">
          {/* 사이즈 + 요청 내용 묶음. 묶음이 없던 예전 요청은 요청 내용만 보여 준다. */}
          {detail.items.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {detail.items.map((item, i) => (
                <li key={i} className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="min-w-0 truncate font-medium">{item.label}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {item.width ?? "자유"} × {item.height ?? "자유"}
                    </span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{detail.description}</p>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">참고 자료</h3>
            <FileGallery files={detail.references} empty="첨부한 참고 자료가 없습니다." />
          </div>
          {(detail.finals.length > 0 || (detail.originalKind && detail.originalKind !== "file")) && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">작업 원본</h3>
              <OriginalInfo kind={detail.originalKind} link={detail.originalLink} tool={detail.originalTool} />
              {detail.finals.length > 0 && <FileGallery files={detail.finals} />}
            </div>
          )}
        </CardContent>
      </Card>
    </Section>
  )

  const review = (
    <Section
      title="시안"
      aside={rounds.length > 0 && <span className="text-sm text-muted-foreground">{rounds.length}차까지</span>}
    >
      {!shown ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          아직 올라온 시안이 없습니다. 작업자가 컨펌 요청을 하면 여기에 보입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rounds.length > 1 && (
            <Tabs value={String(shown.round)} onValueChange={(v) => setRound(Number(v))}>
              <TabsList>
                {rounds.map((s) => (
                  <TabsTrigger key={s.id} value={String(s.round)}>
                    {s.round}차
                    {s.decision === "rejected" && <span className="text-xs text-destructive">반려</span>}
                    {s.decision === "approved" && <span className="text-xs text-emerald-600">컨펌</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{shown.round}차 시안</span>
              <span className="text-xs text-muted-foreground">
                {userName(shown.authorId)} · {formatDateTime(new Date(shown.createdAt))}
              </span>
              {shown.decision === null && <Badge variant="secondary">확인 중</Badge>}
              {shown.decision === "rejected" && (
                <Badge variant="secondary" className="bg-orange-500/15 text-orange-800 dark:text-orange-300">
                  반려
                </Badge>
              )}
              {shown.decision === "approved" && (
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  컨펌
                </Badge>
              )}
              {/* 이 차수 시안 이미지만 한 번에 내려받기(원본 없이 컨펌 이미지만 필요할 때) */}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={async () => {
                  for (const f of shown.files) await downloadFile(f.id, f.name)
                }}
              >
                <Download data-icon="inline-start" />
                시안 이미지 받기{shown.files.length > 1 ? ` (${shown.files.length}개)` : ""}
              </Button>
            </div>
            {shown.note && <p className="whitespace-pre-wrap text-muted-foreground">{shown.note}</p>}
            {shown.decision && (
              <p className="text-xs text-muted-foreground">
                {userName(shown.decidedBy)}님이 {formatDateTime(new Date(shown.decidedAt!))}에{" "}
                {shown.decision === "approved" ? "컨펌" : "반려"}
                {shown.decisionNote && <span className="text-foreground"> — {shown.decisionNote}</span>}
              </p>
            )}
          </div>
          <ReviewBoard key={shown.id} detail={detail} submission={shown} session={session} onChanged={invalidate} />
        </div>
      )}
    </Section>
  )

  return (
    // 진행 버튼이 화면 하단에 고정되므로(ActionPanel) 맨 아래 내용이 가리지 않게 여백을 둔다
    <div className={`${PAGE_GRID} ${editing ? "" : "pb-40 md:pb-28"}`}>
      <div className="col-span-12 flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          목록으로
        </Button>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{detail.code}</span>
            <StatusBadge request={detail} />
            <UrgencyBadge urgency={detail.urgency} />
          </div>
          <h2 className="text-xl font-semibold break-words">{detail.title}</h2>
        </div>
        <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 sm:grid-cols-3 xl:grid-cols-6">
          <Meta label="작업 종류">{detail.workType}</Meta>
          <Meta label="요청자">
            {detail.requesterName}
            {detail.department && <span className="text-muted-foreground"> · {detail.department}</span>}
            {/* 대신 작성한 요청: 받은 경로와 쓴 사람 */}
            {detail.source && (
              <span className="mt-1 flex w-fit items-center rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                {detail.source} 요청{detail.createdBy && ` · 작성 ${userName(detail.createdBy)}`}
              </span>
            )}
          </Meta>
          <Meta label="담당">
            {detail.designers.length === 0 ? (
              <span className="text-muted-foreground">미배정</span>
            ) : (
              detail.designers.map(userName).join(", ")
            )}
          </Meta>
          {/* 작업 기간: 요청자가 고른 시작일 ~ 마감 일시. 시작일이 없거나 마감일과 같으면 마감 일시만. 계속 업무는 시작일 ~ 계속 */}
          <Meta label="작업 기간">
            <span className={overdue ? "font-medium text-destructive" : undefined}>
              {detail.ongoing ? (
                `${detail.requestedStartAt ? `${new Date(detail.requestedStartAt).getMonth() + 1}월 ${new Date(detail.requestedStartAt).getDate()}일 ~ ` : ""}계속 업무`
              ) : (
                <>
              {detail.requestedStartAt !== null &&
                new Date(detail.requestedStartAt).toDateString() !== new Date(detail.dueAt).toDateString() &&
                `${new Date(detail.requestedStartAt).getMonth() + 1}월 ${new Date(detail.requestedStartAt).getDate()}일 ~ `}
              {formatDateTime(new Date(detail.dueAt))}
              {overdue && " · 마감 지남"}
                </>
              )}
            </span>
          </Meta>
          <Meta label="등록">{formatDateTime(new Date(detail.createdAt))}</Meta>
          <Meta label="시작">{detail.startedAt ? formatDateTime(new Date(detail.startedAt)) : "-"}</Meta>
        </dl>
        <Steps status={detail.status} />
        {!editing && <ActionPanel detail={detail} onEdit={() => setEditing(true)} onChanged={() => invalidate()} />}
      </div>

      {editing ? (
        <Section title="요청 수정" className="col-span-12 lg:col-span-8 xl:col-span-6">
          <Card>
            <CardContent>
              <RequestForm
                session={session}
                initial={detail}
                onDone={() => setEditing(false)}
                onCancel={() => setEditing(false)}
              />
            </CardContent>
          </Card>
        </Section>
      ) : (
        <>
          {rounds.length > 0 && review}
          {content}
          <Section title="진행 기록" className="col-span-12 lg:col-span-5">
            <Card>
              <CardHeader className="sr-only">
                <CardTitle>진행 기록과 댓글</CardTitle>
              </CardHeader>
              <CardContent>
                <Timeline detail={detail} />
              </CardContent>
            </Card>
          </Section>
          {rounds.length === 0 && review}
        </>
      )}
    </div>
  )
}
