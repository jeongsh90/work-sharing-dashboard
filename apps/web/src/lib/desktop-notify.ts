import { useSyncExternalStore } from 'react'

// PC(운영체제) 알림. 브라우저 Notification API 로 Windows 알림 센터에 띄운다.
// - 브라우저는 사용자가 버튼을 눌렀을 때만 권한을 물을 수 있어 "PC 알림 켜기" 버튼으로 켠다.
// - 사이트가 열려 있는 동안(다른 탭·최소화 포함)에만 뜬다. 브라우저를 닫으면 오지 않는다.
// - 켜 두면 화면을 보고 있을 때도 화면 안 툴팁과 함께 뜬다.

const PREF_KEY = 'wsd-desktop-notify' // 이 브라우저에서 PC 알림을 쓸지(on/off)

export type DesktopState = 'unsupported' | 'blocked' | 'off' | 'on'

export const desktopSupported = typeof window !== 'undefined' && 'Notification' in window

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // 저장할 수 없으면 이번 화면에서만 적용된다.
  }
}

let wanted = readPref()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function currentState(): DesktopState {
  if (!desktopSupported) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && wanted ? 'on' : 'off'
}

export function useDesktopNotify() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    currentState,
  )
}

export async function enableDesktop() {
  if (!desktopSupported) return
  wanted = true
  writePref(true)
  if (Notification.permission === 'default') await Notification.requestPermission()
  emit()
  if (Notification.permission === 'granted') {
    showDesktop('PC 알림이 켜졌습니다', '새 요청·컨펌·반려 알림이 이렇게 표시됩니다.', () => {})
  }
}

export function disableDesktop() {
  wanted = false
  writePref(false)
  emit()
}

const ICON = `${import.meta.env.BASE_URL}favicon.svg`

export function showDesktop(title: string, body: string, onClick: () => void, tag?: string) {
  if (currentState() !== 'on') return
  try {
    const n = new Notification(title, { body, icon: ICON, tag })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  } catch {
    // 일부 환경(모바일 브라우저 등)은 페이지에서 바로 알림을 만들 수 없다.
  }
}

// 내 정보의 "테스트 알림" 버튼: Windows 에서 알림이 보이는지 바로 확인한다.
export function testDesktop() {
  showDesktop('테스트 알림', '이 알림이 보이면 PC 알림이 잘 동작합니다.', () => {}, 'wsd-test')
}
