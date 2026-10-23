import { useEffect, useState } from 'react'

// 서버(apps/api) 호출. 로그인 토큰은 auth.ts 가 저장하고 여기서 꺼내 쓴다.

// 비어 있으면 같은 주소의 /api 를 쓴다(로컬 개발은 vite 프록시, Tailscale 은 같은 서버).
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

const SESSION_KEY = 'wsd-session'

// 로그인 정보는 이 탭(sessionStorage)에 두고, "로그인 상태 유지"면 브라우저(localStorage)에 둔다.
export function readSessionRaw(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function storedToken(): string | null {
  try {
    const raw = readSessionRaw()
    return raw ? (JSON.parse(raw) as { token: string }).token : null
  } catch {
    return null
  }
}

export { SESSION_KEY }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 로그인이 풀리면(401) 화면을 로그인으로 돌린다. App 이 이 이벤트를 듣는다.
export const UNAUTHORIZED_EVENT = 'wsd-unauthorized'

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = storedToken()
  return fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await apiFetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/login')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, body?.error ?? '요청을 처리하지 못했습니다.')
  }
  return body as T
}

export type UploadedFile = { id: string; name: string; mime: string; size: number }

// 파일 하나를 올린다. 올린 뒤 받은 id 를 요청·컨펌 요청·완료 처리에 붙인다.
export async function uploadFile(file: File): Promise<UploadedFile> {
  let res: Response
  try {
    res = await apiFetch('/uploads', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    })
  } catch {
    throw new ApiError(0, `파일을 올리지 못했습니다: ${file.name}`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `파일을 올리지 못했습니다: ${file.name}`)
  return body
}

// 고른 파일을 차례로 올린다.
export async function uploadAll(files: File[]): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = []
  for (const file of files) uploaded.push(await uploadFile(file))
  return uploaded
}

// 파일 보기는 로그인이 필요해 <img src> 로 바로 쓸 수 없다. 받아서 브라우저 안 주소(blob:)로 바꾼다.
const blobCache = new Map<string, Promise<string>>()

function fileUrl(id: string) {
  let pending = blobCache.get(id)
  if (!pending) {
    pending = apiFetch(`/files/${id}`).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, '파일을 불러오지 못했습니다.')
      return URL.createObjectURL(await res.blob())
    })
    pending.catch(() => blobCache.delete(id))
    blobCache.set(id, pending)
  }
  return pending
}

export function useFileUrl(id: string | null | undefined) {
  const [state, setState] = useState<{ id: string; url: string | null; error: boolean } | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    fileUrl(id).then(
      (url) => alive && setState({ id, url, error: false }),
      () => alive && setState({ id, url: null, error: true }),
    )
    return () => {
      alive = false
    }
  }, [id])
  const current = state && state.id === id ? state : null
  return { url: current?.url ?? null, error: current?.error ?? false }
}

export async function downloadFile(id: string, name: string) {
  const url = await fileUrl(id)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)}KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)}MB`
  if (size < 1024 ** 4) return `${(size / 1024 ** 3).toFixed(1)}GB`
  return `${(size / 1024 ** 4).toFixed(2)}TB`
}
