import type { Designer } from './requests'

// 디자인팀 구성원. 서버에 사용자 정보가 생기면 그 값으로 바꾼다.
// 직책이 정해지면 position 에 넣는다. 둘 다 비면 화면에 "직급·직책 미입력"으로 보인다.
export const TEAM: Designer[] = [
  { id: 'jsh', name: '정상훈', rank: '과장', position: '' },
  { id: 'whs', name: '원효선', rank: '대리', position: '' },
  { id: 'ldh', name: '이동훈', rank: '사원', position: '' },
  { id: 'ayj', name: '안예지', rank: '사원', position: '' },
]
