// 버전 정보. 배포할 때 기능이 바뀌면 CHANGELOG 맨 위에 한 줄 묶음을 더하고 APP_VERSION 을 올린다.
// 배포 시각과 커밋은 빌드할 때 vite.config.ts 가 넣는다.

declare const __BUILD_TIME__: string
declare const __COMMIT__: string

export const BUILD_TIME = new Date(__BUILD_TIME__)
export const COMMIT = __COMMIT__

export type Release = { version: string; date: string; changes: string[] }

export const CHANGELOG: Release[] = [
  {
    version: '0.3.0',
    date: '2026-10-22',
    changes: [
      '건의게시판, 버전 정보 화면 추가',
      'PC(Windows) 알림과 헤더의 PC 알림 테스트 버튼',
      '요청 상세의 진행 버튼을 화면 하단에 고정하고 상태 색 외곽선으로 표시',
      '슈퍼관리자 요청 삭제',
      '디자인팀 카드: 작업 중이면 상태 색 테두리 빛, 쉬는 카드는 흐리게',
      '디자인팀 관리자도 디자인팀 카드와 담당 지정에 표시',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-21',
    changes: [
      '회원가입과 슈퍼관리자 가입 승인',
      '요청서: 작업 기간 달력(시작일~마감일), 사이즈별 요청 내용 묶음, 긴급처리요청',
      '요청자 헤더에 디자인 요청 바로가기',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-21',
    changes: [
      '첫 운영: 요청 → 담당 지정 → 작업 → 컨펌 요청(시안 핀 댓글) → 반려·수정 → 컨펌 → 작업 완료',
      '홈(금주 진행 현황, 디자인팀, 작업 현황), 받은 요청함, 내 요청, 알림함, 팀 관리, 최종 파일 보관함',
    ],
  },
]

export const APP_VERSION = CHANGELOG[0].version
