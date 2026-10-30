import { useEffect, useSyncExternalStore } from 'react'

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

// 알림을 띄웠으면 true. 꺼져 있거나 만들지 못하면 false
// tag 가 같은 알림은 알림 센터에서 하나로 합쳐지는데, 그대로 두면 두 번째부터는 화면에 다시 뜨지 않고 조용히 바뀌기만 한다.
// 그래서 같은 tag 로 다시 보낼 때도 다시 뜨게(renotify) 한다.
export function showDesktop(title: string, body: string, onClick: () => void, tag?: string) {
  if (currentState() !== 'on') return false
  try {
    const n = new Notification(title, { body, icon: ICON, tag, ...(tag && { renotify: true }) } as NotificationOptions)
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
    return true
  } catch {
    // 일부 환경(모바일 브라우저 등)은 페이지에서 바로 알림을 만들 수 없다.
    return false
  }
}

// 아직 권한을 묻지 않았으면 로그인 후 화면을 처음 누를 때 브라우저가 허용 여부를 묻게 한다.
// (브라우저는 클릭 같은 사용자 동작 안에서만 권한을 물을 수 있다.) 직접 끈 사람에게는 묻지 않는다.
export function useAskOnFirstClick(active: boolean) {
  useEffect(() => {
    if (!active || !desktopSupported || Notification.permission !== 'default' || !wanted) return
    const ask = () => {
      if (Notification.permission === 'default' && wanted) enableDesktop()
    }
    document.addEventListener('click', ask, { once: true, capture: true })
    return () => document.removeEventListener('click', ask, { capture: true })
  }, [active])
}

// 테스트 알림: Windows 에서 알림이 보이는지 바로 확인한다. 누를 때마다 새 알림으로 뜨게 tag 를 매번 바꾼다.
export function testDesktop() {
  return showDesktop('테스트 알림', '이 알림이 보이면 PC 알림이 잘 동작합니다.', () => {}, `wsd-test-${Date.now()}`)
}

// 지금 권한 상태(await 뒤에 다시 읽으려고 함수로 둔다)
const permission = (): NotificationPermission => Notification.permission

export type DesktopTestResult = { sent: boolean; problem?: string }

// 헤더의 "PC 알림 테스트" 버튼: 아직 꺼져 있으면 켜기(권한 묻기)부터 하고 테스트 알림을 보낸다.
export async function runDesktopTest(): Promise<DesktopTestResult> {
  if (!desktopSupported) return { sent: false, problem: '이 브라우저는 PC 알림을 지원하지 않습니다. Chrome 이나 Edge 로 열어 주세요.' }
  if (permission() === 'denied') {
    return { sent: false, problem: '브라우저에서 이 사이트의 알림이 차단되어 있습니다.' }
  }
  if (currentState() !== 'on') {
    await enableDesktop() // 켜지면 "PC 알림이 켜졌습니다" 알림이 뜬다
    if (permission() === 'denied') return { sent: false, problem: '알림 허용 창에서 차단을 누르셨습니다.' }
    if (permission() !== 'granted') return { sent: false, problem: '알림 허용 창에서 허용을 눌러 주세요.' }
    return { sent: true }
  }
  return testDesktop() ? { sent: true } : { sent: false, problem: '알림을 만들지 못했습니다. 페이지를 새로 고친 뒤 다시 눌러 주세요.' }
}
