import { useSyncExternalStore } from 'react'

// 화면 안 알림 목록. 서버 알림 기능이 생기면 받은 알림을 pushNotification 으로 넣는다.

// 알림 종류. 종류마다 툴팁 배경색이 다르다(header-actions.tsx 의 NOTIFICATION_TOOLTIP_COLORS).
// 종류와 색은 아직 정하지 않아 기본 한 가지만 둔다.
export type NotificationType = 'default'

export type AppNotification = {
  id: number
  type: NotificationType
  message: string
  createdAt: number
  read: boolean
}

let items: AppNotification[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function pushNotification(message: string, type: NotificationType = 'default') {
  items = [{ id: nextId++, type, message, createdAt: Date.now(), read: false }, ...items]
  emit()
}

export function markAllRead() {
  if (!items.some((n) => !n.read)) return
  items = items.map((n) => ({ ...n, read: true }))
  emit()
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

// 개발 중 확인용: 브라우저 콘솔에서 __wsdNotify('메시지') 로 알림을 띄운다. 배포 빌드에는 없다.
if (import.meta.env.DEV) {
  ;(window as unknown as { __wsdNotify: typeof pushNotification }).__wsdNotify = pushNotification
}
