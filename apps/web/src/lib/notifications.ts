import { useSyncExternalStore } from 'react'

// 화면 안 알림 목록. 서버 알림 기능이 생기면 받은 알림을 pushNotification 으로 넣는다.
export type AppNotification = {
  id: number
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

export function pushNotification(message: string) {
  items = [{ id: nextId++, message, createdAt: Date.now(), read: false }, ...items]
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
