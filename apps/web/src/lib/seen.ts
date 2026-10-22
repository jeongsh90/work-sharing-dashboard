import { useSyncExternalStore } from 'react'

// "읽음" 표시: 메뉴의 N 배지와 업데이트 공지 팝업에 쓴다.
// 이 브라우저에 사람(계정)마다 따로 남긴다. 예) 건의게시판에서 마지막으로 본 글 번호, 마지막으로 본 버전

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const keyOf = (userId: string, name: string) => `wsd-seen:${userId}:${name}`

export function readSeen(userId: string, name: string): string | null {
  try {
    return localStorage.getItem(keyOf(userId, name))
  } catch {
    return null
  }
}

export function markSeen(userId: string, name: string, value: string) {
  try {
    if (localStorage.getItem(keyOf(userId, name)) === value) return
    localStorage.setItem(keyOf(userId, name), value)
  } catch {
    // 저장할 수 없으면 이번 화면에서만 읽음 처리된다.
  }
  emit()
}

export function useSeen(userId: string, name: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => readSeen(userId, name),
  )
}
