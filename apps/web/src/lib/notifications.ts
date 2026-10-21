import { useEffect, useSyncExternalStore } from 'react'

import { api } from './api'
import { invalidate } from './store'

// 알림 목록. 서버(notifications 표)에 쌓인 내 알림을 주기적으로 받아 온다.
// 새 알림이 오면 열려 있는 화면 데이터도 새로 받는다(다른 사람이 상태를 바꿨다는 뜻이므로).

// 알림 종류. 종류마다 툴팁 배경색이 다르다(header-actions.tsx 의 NOTIFICATION_TOOLTIP_COLORS).
// 종류와 색은 아직 정하지 않아 기본 한 가지만 둔다.
export type NotificationType = 'default'

export type AppNotification = {
  id: number
  type: NotificationType
  message: string
  requestId: number | null
  createdAt: number
  read: boolean
}

const POLL_MS = 15_000

let items: AppNotification[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function setItems(next: AppNotification[]) {
  const newest = items[0]?.id ?? 0
  if (next.length > 0 && next[0].id > newest && items.length > 0) invalidate()
  items = next
  emit()
}

async function fetchNotifications() {
  try {
    const list = await api<Omit<AppNotification, 'type'>[]>('/notifications')
    setItems(list.map((n) => ({ ...n, type: 'default' })))
  } catch {
    // 연결이 끊기면 다음 주기에 다시 받는다.
  }
}

// 로그인한 동안 App 에서 한 번 부른다.
export function useNotificationSync(userId: string | null) {
  useEffect(() => {
    items = []
    emit()
    if (!userId) return
    fetchNotifications()
    const timer = setInterval(() => document.visibilityState === 'visible' && fetchNotifications(), POLL_MS)
    window.addEventListener('focus', fetchNotifications)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', fetchNotifications)
    }
  }, [userId])
}

export function markAllRead() {
  if (!items.some((n) => !n.read)) return
  items = items.map((n) => ({ ...n, read: true }))
  emit()
  api('/notifications/read', { body: {} }).catch(() => {})
}

export function useNotifications() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
  )
  return { items: list, unread: list.filter((n) => !n.read).length }
}
