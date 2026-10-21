import type { Presence } from './presence'
import type { DesignRequest, RequestStatus, Urgency } from './requests'

// 서버에 요청 데이터가 생기기 전까지 화면을 확인하려고 쓰는 예시 데이터.
// 실제 요청이 아니다. 담당자만 실제 팀원(lib/team.ts)에 나눠 붙였다.
// 서버 API 가 생기면 이 파일을 지우고 API 응답으로 바꾼다.

// 예시 행의 담당 기호 → 팀원 id
const ASSIGNEE: Record<string, string> = { lead: 'jsh', a: 'whs', b: 'ldh', c: 'ayj', d: 'whs', e: 'ldh', f: 'ayj' }

// 오늘을 기준으로 며칠 뒤 몇 시
function at(days: number, hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

type Row = [string, string, string, string, string[], number, number, Urgency, RequestStatus, number?]

const ROWS: Row[] = [
  ['10월 4주차 메인 배너 - 가을 국밥 기획전', '메인 배너', 'MD 김○○', 'MD 1팀', ['b'], 1, 10, 'urgent', 'in-progress'],
  ['한우 사골곰탕 상세페이지 리뉴얼', '상세페이지', 'MD 이○○', 'MD 2팀', ['a'], 3, 18, 'normal', 'review'],
  ['주간 톡메시지 배너', '띠 배너', '마케팅 박○○', '마케팅팀', ['b'], 2, 11, 'normal', 'waiting'],
  ['스마트스토어 기획전 페이지', '기획전 페이지', 'MD 김○○', 'MD 1팀', ['b', 'e'], 5, 14, 'normal', 'in-progress'],
  ['인스타그램 신상품 카드뉴스', 'SNS 콘텐츠', '마케팅 최○○', '마케팅팀', ['c'], 0, 17, 'critical', 'revising', 2],
  ['명절 선물세트 리플릿', '인쇄물', '영업 정○○', '영업팀', ['d'], 9, 12, 'normal', 'waiting'],
  ['사내 게시판 안내문', '인쇄물', '총무 한○○', '총무팀', ['d'], 4, 9, 'normal', 'requested'],
  ['육개장 상세페이지 움짤 교체', '상세페이지', 'MD 이○○', 'MD 2팀', ['f'], 1, 15, 'urgent', 'in-progress'],
  ['자사몰 PC 메인 리사이징', '간단 수정', 'MD 김○○', 'MD 1팀', ['e'], 0, 13, 'normal', 'done'],
  ['블랙프라이데이 기획전 배너 세트', '기획전 페이지', '마케팅 박○○', '마케팅팀', ['b', 'c'], 12, 10, 'normal', 'needs-info'],
  ['설렁탕 상세페이지 문구 수정', '간단 수정', 'MD 이○○', 'MD 2팀', ['a'], -1, 16, 'normal', 'done'],
  ['유튜브 썸네일 3종', 'SNS 콘텐츠', '마케팅 최○○', '마케팅팀', ['c'], 6, 18, 'normal', 'in-progress'],
  ['신제품 패키지 스티커', '인쇄물', '영업 정○○', '영업팀', ['d', 'lead'], 8, 11, 'urgent', 'review'],
  ['쿠팡 상세페이지 규격 변환', '상세페이지', 'MD 김○○', 'MD 1팀', ['a', 'e'], 2, 17, 'normal', 'revising', 1],
  ['연말 감사 이벤트 팝업', '메인 배너', '마케팅 박○○', '마케팅팀', ['e'], 14, 10, 'normal', 'requested'],
  ['갈비탕 상세페이지 신규', '상세페이지', 'MD 이○○', 'MD 2팀', ['a'], -3, 18, 'normal', 'done'],
  ['매장 POP 포스터', '인쇄물', '영업 정○○', '영업팀', ['d'], -2, 12, 'normal', 'canceled'],
  ['10월 5주차 메인 배너', '메인 배너', 'MD 김○○', 'MD 1팀', ['b'], 7, 10, 'normal', 'waiting'],
  ['라이브커머스 배너 4종', '띠 배너', '마케팅 최○○', '마케팅팀', ['f', 'c'], 3, 13, 'urgent', 'in-progress'],
  ['곰탕 3종 묶음 상세페이지', '상세페이지', 'MD 이○○', 'MD 2팀', ['a'], 10, 18, 'normal', 'waiting'],
  ['사원증 디자인 개편', '기타', '총무 한○○', '총무팀', ['lead'], 15, 17, 'normal', 'in-progress'],
  ['네이버 브랜드스토어 배너', '띠 배너', 'MD 김○○', 'MD 1팀', ['e'], -5, 11, 'normal', 'done'],
]

export const SAMPLE_REQUESTS: DesignRequest[] = ROWS.map(
  ([title, workType, requester, department, designers, days, hour, urgency, status, revision = 0], i) => ({
    id: `REQ-${String(i + 1).padStart(4, '0')}`,
    title,
    workType,
    requester,
    department,
    designers: [...new Set(designers.map((d) => ASSIGNEE[d]))],
    dueAt: at(days, hour),
    urgency,
    status,
    revision,
  }),
)

// 작업자 현재 상태 예시. 작업자가 직접 상태를 바꾸는 기능이 생기면 지운다.
export const SAMPLE_PRESENCE: Record<string, Presence> = { jsh: 'working', whs: 'meeting', ldh: 'working', ayj: 'away' }
