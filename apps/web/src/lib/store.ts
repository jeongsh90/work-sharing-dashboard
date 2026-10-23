import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from './api'
import type { Role } from './auth'
import type { Presence } from './presence'
import { toRequest, type Designer, type RequestSummaryDto } from './requests'

// 서버 데이터 읽기. 같은 주소는 한 번 받은 값을 기억해 화면을 옮겨도 바로 보이고,
// 주기적으로(기본 30초), 그리고 창으로 돌아올 때 다시 받아 다른 사람이 바꾼 내용도 반영한다.
// 무언가를 바꾼 뒤에는 invalidate() 로 열려 있는 모든 화면을 새로 받는다.

const cache = new Map<string, unknown>()
let version = 0
const listeners = new Set<() => void>()

export function invalidate() {
  version++
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearCache() {
  cache.clear()
}

export function useApi<T>(path: string | null, pollMs = 30_000) {
  const v = useSyncExternalStore(subscribe, () => version)
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({
    path,
    data: path ? ((cache.get(path) as T) ?? null) : null,
    error: null,
  })

  useEffect(() => {
    if (!path) return
    let alive = true
    const load = () =>
      api<T>(path).then(
        (data) => {
          cache.set(path, data)
          if (alive) setState({ path, data, error: null })
        },
        (error: Error) => alive && setState((s) => ({ path, data: s.path === path ? s.data : null, error: error.message })),
      )
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), pollMs)
    // 다른 창(예: 요청자 창과 작업자 창)을 오가면 돌아온 즉시 새로 받는다.
    const onFocus = () => document.visibilityState === 'visible' && load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [path, v, pollMs])

  const current = state.path === path ? state : null
  return {
    data: current?.data ?? (path ? ((cache.get(path) as T) ?? null) : null),
    error: current?.error ?? null,
  }
}

export function useRequests() {
  const { data, error } = useApi<RequestSummaryDto[]>('/requests')
  const requests = useMemo(() => data?.map(toRequest) ?? null, [data])
  return { requests, error }
}

export type UserInfo = Designer & {
  role: Role
  department: string
  presence: Presence
  active: boolean
  canLogin: boolean
  approved: boolean // 회원가입 후 슈퍼관리자 승인 여부
  avatarId: string | null // 프로필 사진 파일 id
  createdAt: number
}

export function useUsers() {
  const { data, error } = useApi<UserInfo[]>('/users', 60_000)
  return { users: data, error }
}

// 디자인 작업을 맡는 사람: 작업자, 그리고 부서가 디자인팀인 관리자(관리 권한을 가진 디자이너)
export const DESIGN_TEAM = '디자인팀'

export function isDesignWorker(u: Pick<UserInfo, 'role' | 'department'>) {
  return u.role === 'designer' || ((u.role === 'admin' || u.role === 'superadmin') && u.department.replace(/\s+/g, '') === DESIGN_TEAM)
}

// 홈의 디자인팀 카드와 담당 지정에 쓰는 작업자 목록
export function useDesigners() {
  const { users } = useUsers()
  return useMemo(() => users?.filter((u) => u.active && u.approved && isDesignWorker(u)) ?? null, [users])
}

export function useUserNames() {
  const { users } = useUsers()
  return useMemo(() => {
    const map = new Map(users?.map((u) => [u.id, u.name]))
    return (id: string | null | undefined) => (id ? (map.get(id) ?? id) : '')
  }, [users])
}
