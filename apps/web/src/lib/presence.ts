import { api } from './api'
import { updateStoredUser, type Session } from './auth'
import { invalidate } from './store'

// 작업자의 현재 상태(자리 상태). 요청의 진행 상태와는 다르다.
// 작업자가 내 정보나 사용자 메뉴에서 바꾸고, 서버(users.presence)에 저장한다.
export type Presence = 'working' | 'away' | 'meeting' | 'outside' | 'vacation' | 'off'

export const PRESENCE_LABEL: Record<Presence, string> = {
  working: '작업 중',
  away: '자리 비움',
  meeting: '회의 중',
  outside: '외근',
  vacation: '휴가',
  off: '퇴근',
}

// 상태 점 색. 글자와 함께 보여 색만으로 구분하지 않는다.
export const PRESENCE_DOT: Record<Presence, string> = {
  working: 'bg-emerald-500',
  away: 'bg-amber-400',
  meeting: 'bg-violet-500',
  outside: 'bg-sky-500',
  vacation: 'bg-rose-400',
  off: 'bg-slate-400',
}

// 관리자가 팀원 상태를 바꾼다(한 명 또는 여러 명)
export async function setTeamPresence(ids: string[], presence: Presence) {
  await api('/presence', { body: { ids, presence } })
  invalidate()
}

export async function savePresence(presence: Presence) {
  const { user } = await api<{ user: Session }>('/me', { method: 'PATCH', body: { presence } })
  updateStoredUser(user)
  invalidate()
  return user
}
