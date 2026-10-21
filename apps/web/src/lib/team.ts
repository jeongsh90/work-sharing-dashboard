import type { Designer } from './requests'

// 디자인팀 구성원. 서버에 사용자 정보가 생기면 그 값으로 바꾼다.
// 직급·직책은 아는 것만 넣었다. 빈 값은 화면에 "직급·직책 미입력"으로 보인다.
export const TEAM: Designer[] = [
  { id: 'jsh', name: '정상훈', rank: '과장', position: '' },
  { id: 'whs', name: '원효선', rank: '', position: '' },
  { id: 'ldh', name: '이동훈', rank: '', position: '' },
  { id: 'ayj', name: '안예지', rank: '', position: '' },
]
