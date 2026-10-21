import { useSyncExternalStore } from 'react'

// 라이트/다크 테마. 고른 값은 이 브라우저에 기억하고, 고른 적이 없으면 Windows(시스템) 설정을 따른다.
// index.html 의 인라인 스크립트가 같은 키로 첫 화면 전에 테마를 적용한다.
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'wsd-theme'
const listeners = new Set<() => void>()

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 저장할 수 없으면 이번 화면에서만 바뀐다.
  }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    current,
  )
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
