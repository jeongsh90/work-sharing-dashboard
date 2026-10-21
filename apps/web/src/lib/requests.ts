// 디자인 요청과 디자이너. 상태 이름은 기획 v0.2 8장(진행 상태)을 따른다.

export type RequestStatus =
  | 'requested' // 요청됨
  | 'needs-info' // 보완 필요
  | 'waiting' // 작업 대기
  | 'in-progress' // 작업 중
  | 'review' // 시안 확인
  | 'revising' // 수정 중 (n차)
  | 'done' // 완료
  | 'canceled' // 취소

export type Urgency = 'normal' | 'urgent' | 'critical'

export type DesignRequest = {
  id: string
  title: string
  workType: string
  requester: string
  department: string
  designers: string[] // 담당 디자이너 id, 첫 번째가 주 담당
  startedAt: Date | null // 실제 시작 시각('작업 중'으로 바꾼 때). 시작 전이면 null
  dueAt: Date
  urgency: Urgency
  status: RequestStatus
  revision: number // 수정 차수. 수정 중일 때 표시
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

export const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: '요청됨',
  'needs-info': '보완 필요',
  waiting: '작업 대기',
  'in-progress': '작업 중',
  review: '시안 확인',
  revising: '수정 중',
  done: '완료',
  canceled: '취소',
}

export function statusText(request: DesignRequest) {
  return request.status === 'revising' ? `${request.revision}차 수정 중` : STATUS_LABEL[request.status]
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  normal: '보통',
  urgent: '급함',
  critical: '매우 급함',
}

// 끝나지 않은(진행 중인) 상태
export const ACTIVE_STATUSES: RequestStatus[] = ['requested', 'needs-info', 'waiting', 'in-progress', 'review', 'revising']

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

export function formatDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 아바타에 넣을 짧은 이름. "디자이너 A" → "A", 그 밖에는 첫 글자
export function initials(name: string) {
  const last = name.split(" ").pop() ?? name
  return last.length <= 2 ? last : name.slice(0, 1)
}
