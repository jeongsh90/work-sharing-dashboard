// 디자인 요청과 디자이너. 상태 이름은 기획 v0.2 8장(진행 상태)과 서버(apps/api/src/requests.ts)를 따른다.

export type RequestStatus =
  | 'requested' // 요청됨
  | 'needs-info' // 보완 필요
  | 'waiting' // 작업 대기
  | 'in-progress' // 작업 중
  | 'review' // 시안 확인(컨펌 요청 중)
  | 'revising' // 수정 중 (n차)
  | 'approved' // 컨펌 완료(작업 완료 처리 전)
  | 'source-pending' // 완료(원본 대기): 컨펌으로 작업은 끝났고 작업자가 원본 파일을 올리기를 기다린다
  | 'done' // 완료
  | 'canceled' // 취소

export type Urgency = 'normal' | 'urgent' | 'critical'

export type DesignRequest = {
  id: string
  code: string // REQ-0001
  title: string
  workType: string
  requesterId: string
  requester: string // 요청자 이름
  department: string
  designers: string[] // 담당 작업자 id, 첫 번째가 주 담당
  createdAt: Date
  requestedStartAt: Date | null // 요청자가 고른 작업 시작일(작업 기간의 시작)
  startedAt: Date | null // 실제 시작 시각('작업 중'으로 바꾼 때). 시작 전이면 null
  dueAt: Date
  completedAt: Date | null
  ongoing: boolean // 계속 업무(마감 없음). 이때 dueAt 은 아주 먼 날짜라 마감 지남·이번 주 마감에 걸리지 않는다
  urgency: Urgency
  status: RequestStatus
  revision: number // 수정 차수. 수정 중일 때 표시
}

// 서버 응답(시각은 숫자)
export type RequestSummaryDto = {
  id: number
  code: string
  title: string
  workType: string
  department: string
  requesterId: string
  requesterName: string
  designers: string[]
  urgency: Urgency
  status: RequestStatus
  revision: number
  requestedStartAt: number | null // 요청자가 고른 작업 시작일
  ongoing: boolean // 계속 업무(마감 없음)
  dueAt: number
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

const toDate = (v: number | null) => (v === null ? null : new Date(v))

export function toRequest(dto: RequestSummaryDto): DesignRequest {
  return {
    id: String(dto.id),
    code: dto.code,
    title: dto.title,
    workType: dto.workType,
    requesterId: dto.requesterId,
    requester: dto.requesterName,
    department: dto.department,
    designers: dto.designers,
    createdAt: new Date(dto.createdAt),
    requestedStartAt: toDate(dto.requestedStartAt),
    startedAt: toDate(dto.startedAt),
    dueAt: new Date(dto.dueAt),
    completedAt: toDate(dto.completedAt),
    ongoing: dto.ongoing,
    urgency: dto.urgency,
    status: dto.status,
    revision: dto.revision,
  }
}

export type Designer = {
  id: string
  name: string
  rank: string // 직급
  position: string // 직책
}

// 카드 이름 아래 줄: "과장 · 팀장"처럼 직급과 직책
export function designerTitle(d: Designer) {
  return [d.rank, d.position].filter(Boolean).join(' · ') || '직급·직책 미입력'
}

// 요청서의 작업 종류
export const WORK_TYPES = ['메인 배너', '띠 배너', '상세페이지', '기획전 페이지', 'SNS 콘텐츠', '인쇄물', '간단 수정', '기타']

export const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: '요청됨',
  'needs-info': '보완 필요',
  waiting: '작업 대기',
  'in-progress': '작업 중',
  review: '시안 확인',
  revising: '수정 중',
  approved: '컨펌 완료',
  'source-pending': '완료(원본 대기)',
  done: '완료',
  canceled: '취소',
}

export function statusText(request: Pick<DesignRequest, 'status' | 'revision'>) {
  return request.status === 'revising' ? `${request.revision}차 수정 중` : STATUS_LABEL[request.status]
}

// 화면에서는 두 가지로만 구분한다: 보통(표시 없음) / 긴급요청. critical 은 예전 데이터용
export const URGENCY_LABEL: Record<Urgency, string> = {
  normal: '보통',
  urgent: '긴급요청',
  critical: '긴급요청',
}

// 끝나지 않은(진행 중인) 상태
export const ACTIVE_STATUSES: RequestStatus[] = [
  'requested',
  'needs-info',
  'waiting',
  'in-progress',
  'review',
  'revising',
  'approved',
]

export function isActive(request: DesignRequest) {
  return ACTIVE_STATUSES.includes(request.status)
}

// 이번 주(월요일 0시 ~ 다음 주 월요일 0시)
export function isThisWeek(date: Date, now = new Date()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return date >= start && date < end
}

export type BusyLevel = 'free' | 'normal' | 'busy'

export const BUSY_LABEL: Record<BusyLevel, string> = { free: '여유', normal: '보통', busy: '바쁨' }

// 기획 v0.2 D13: 바쁜 정도 3단계. 기준 건수는 화면 설계 때 다시 정한다.
export function busyLevel(activeCount: number): BusyLevel {
  if (activeCount <= 1) return 'free'
  if (activeCount <= 3) return 'normal'
  return 'busy'
}

// 담당자가 아직 없는 요청(요청됨 상태). 작업 현황 표 맨 위에 둔다.
export function isUnassigned(request: DesignRequest) {
  return request.designers.length === 0
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDateTime(date: Date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 마감 표시: 계속 업무면 "계속 업무"
export function dueText(r: { ongoing: boolean; dueAt: Date }) {
  return r.ongoing ? '계속 업무' : formatDateTime(r.dueAt)
}

// <input type="datetime-local"> 값(로컬 시각)
export function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "방금", "5분 전", "3시간 전", 하루가 지나면 날짜
export function timeAgo(date: Date, now = new Date()) {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`
  return formatDateTime(date)
}

// 아바타에 넣을 짧은 이름. "디자이너 A" → "A", 그 밖에는 첫 글자
export function initials(name: string) {
  const last = name.split(' ').pop() ?? name
  return last.length <= 2 ? last : name.slice(0, 1)
}

// ── 요청 상세(서버 GET /api/requests/:id) ──

export type FileInfo = {
  id: string
  name: string
  mime: string
  size: number
  kind: 'reference' | 'deliverable' | 'final' | null
  uploaderId: string
  createdAt: number
}

export type CommentDto = { id: number; pinId: number | null; authorId: string; body: string; createdAt: number }

export type PinDto = {
  id: number
  fileId: string
  x: number
  y: number
  authorId: string
  createdAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  comments: CommentDto[]
}

export type SubmissionDto = {
  id: number
  round: number
  authorId: string
  note: string
  createdAt: number
  decision: 'approved' | 'rejected' | null
  decidedBy: string | null
  decidedAt: number | null
  decisionNote: string
  files: FileInfo[]
}

export type EventDto = {
  id: number
  actorId: string
  type: string
  fromStatus: RequestStatus | null
  toStatus: RequestStatus | null
  note: string
  createdAt: number
}

// 서버가 정해 주는, 지금 로그인한 사람이 이 요청에 할 수 있는 동작
export type RequestAction =
  | 'edit'
  | 'assign'
  | 'reassign'
  | 'take'
  | 'request-info'
  | 'resubmit'
  | 'start'
  | 'submit'
  | 'reject'
  | 'approve'
  | 'complete'
  | 'upload-source'
  | 'cancel'
  | 'pin'
  | 'comment'
  | 'resolve'
  | 'undo'
  | 'ask-requester'

// 요청 내용 한 묶음: 사이즈(제목·너비·높이) + 그 사이즈의 요청 내용. 높이가 null 이면 자유(제한 없음)
export type RequestItem = { label: string; width: number | null; height: number | null; body: string }

export type RequestDetailDto = RequestSummaryDto & {
  description: string
  items: RequestItem[]
  references: FileInfo[]
  finals: FileInfo[]
  submissions: SubmissionDto[]
  pins: PinDto[]
  comments: CommentDto[]
  events: EventDto[]
  actions: RequestAction[]
  undo: { label: string; to: RequestStatus } | null // 작업 취소로 되돌릴 마지막 단계와 돌아갈 상태
}

// 진행 기록에 보이는 동작 이름
export const EVENT_LABEL: Record<string, string> = {
  create: '요청 등록',
  edit: '요청 내용 수정',
  assign: '작업자 지정',
  reassign: '작업자 변경',
  take: '담당 맡음',
  'request-info': '보완 요청',
  resubmit: '보완 완료',
  start: '작업 시작',
  submit: '컨펌 요청',
  reject: '반려',
  approve: '컨펌',
  complete: '작업 완료',
  'upload-source': '원본 업로드',
  cancel: '요청 취소',
  undo: '작업 취소',
  'ask-requester': '요청자 확인 요청',
}
