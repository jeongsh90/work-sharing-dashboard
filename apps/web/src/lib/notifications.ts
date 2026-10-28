import { useEffect, useSyncExternalStore } from 'react'

import { api } from './api'
import { showDesktop } from './desktop-notify'
import { navigate, openRequest } from './router'
import { invalidate } from './store'

// 알림 목록. 서버(notifications 표)에 쌓인 내 알림을 주기적으로 받아 온다.
// 새 알림이 오면 열려 있는 화면 데이터도 새로 받고(다른 사람이 상태를 바꿨다는 뜻이므로),
// 켜 두었으면 PC 알림(desktop-notify.ts)으로도 띄운다.

// 알림 종류. 종류마다 툴팁 배경색이 다르다(header-actions.tsx 의 NOTIFICATION_TOOLTIP_COLORS).
// 종류와 색은 아직 정하지 않아 기본 한 가지만 둔다.
export type NotificationType = 'default'

export type AppNotification = {
  id: number
  type: NotificationType
  message: string
  requestId: number | null
  link: string | null // 요청과 관계없는 알림이 열 화면(예: 가입 승인 요청 → 'team')
  createdAt: number
  read: boolean
}

const POLL_MS = 15_000

let items: AppNotification[] = []
// 이번 로그인에서 첫 목록을 받았는지. 첫 목록(이미 쌓여 있던 알림)은 PC 알림으로 띄우지 않는다.
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function open(n: AppNotification) {
  if (n.requestId) openRequest(n.requestId)
  else navigate(n.link ?? 'notifications')
}

// PC 알림은 최근 3건까지 따로 띄우고, 더 많으면 한 건으로 묶는다.
function notifyDesktop(fresh: AppNotification[]) {
  if (fresh.length > 3) {
    showDesktop(`새 알림 ${fresh.length}건`, fresh[0].message, () => navigate('notifications'), 'wsd-summary')
    return
  }
  for (const n of fresh) showDesktop('디자인 요청·작업 관리 시스템', n.message, () => open(n), `wsd-${n.id}`)
}

function setItems(next: AppNotification[]) {
  const newest = items[0]?.id ?? 0
  const fresh = loaded ? next.filter((n) => n.id > newest && !n.read) : []
  if (fresh.length > 0) {
    invalidate()
    notifyDesktop(fresh)
  }
  loaded = true
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
    loaded = false
    emit()
    if (!userId) return
    fetchNotifications()
    // 다른 탭을 보고 있거나 창을 내려 두어도 PC 알림을 띄우려고 계속 확인한다.
    // (브라우저가 숨은 탭의 타이머를 늦추면 1분쯤 늦게 올 수 있다)
    const timer = setInterval(fetchNotifications, POLL_MS)
    window.addEventListener('focus', fetchNotifications)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', fetchNotifications)
    }
  }, [userId])
}

// 알림함을 열 때 방금 읽음으로 바꾼 알림(알림함 화면이 "새 알림"으로 강조한다). 알림함을 나가면 비운다.
const justRead = new Set<number>()
export const takeJustRead = () => {
  const ids = new Set(justRead)
  justRead.clear()
  return ids
}

export function markAllRead() {
  if (!items.some((n) => !n.read)) return
  for (const n of items) if (!n.read) justRead.add(n.id)
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
