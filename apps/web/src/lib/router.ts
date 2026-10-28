import { useSyncExternalStore } from 'react'

// 주소 뒤 # 로 화면을 고른다(#/inbox, #/requests/12).
// GitHub Pages 하위 경로에서도 새로 고침·뒤로 가기·주소 공유가 그대로 된다.

export type Route = { page: string; id?: string }

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'requests' && parts[1]) return { page: 'request-detail', id: parts[1] }
  if (parts[0] === 'requests' && !parts[1]) return { page: 'inbox' }
  // 공지사항: #/notices/12 상세, #/notices/12/edit 고치기, #/notices/new 새 글
  if (parts[0] === 'notices' && parts[1] === 'new') return { page: 'notice-edit', id: 'new' }
  if (parts[0] === 'notices' && parts[1] && parts[2] === 'edit') return { page: 'notice-edit', id: parts[1] }
  if (parts[0] === 'notices' && parts[1]) return { page: 'notice-detail', id: parts[1] }
  return { page: parts[0] || 'home' }
}

let current = parse(window.location.hash)

function subscribe(listener: () => void) {
  const onChange = () => {
    current = parse(window.location.hash)
    listener()
  }
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => current)
}

export function navigate(page: string, id?: string) {
  const hash =
    page === 'request-detail'
      ? `#/requests/${id}`
      : page === 'notice-detail'
        ? `#/notices/${id}`
        : page === 'notice-edit'
          ? id === 'new' ? '#/notices/new' : `#/notices/${id}/edit`
          : page === 'home'
            ? '#/'
            : `#/${page}`
  if (window.location.hash !== hash) window.location.hash = hash
  window.scrollTo({ top: 0 })
}

export function openRequest(id: string | number) {
  navigate('request-detail', String(id))
}
