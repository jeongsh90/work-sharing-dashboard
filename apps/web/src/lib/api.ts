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
  if (file.size > CHUNKED_FROM) return uploadChunked(file, () => {})
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

// 큰 파일(PSD 등)을 올리며 진행률(0~1)을 알려 준다. fetch 는 올리는 진행률을 못 받아 XMLHttpRequest 를 쓴다.
// CHUNKED_FROM 보다 크면 나눠서 여러 연결로 함께 올린다(uploadChunked).
export function uploadFileWithProgress(file: File, onProgress: (ratio: number) => void): Promise<UploadedFile> {
  if (file.size > CHUNKED_FROM) return uploadChunked(file, onProgress)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/uploads`)
    const token = storedToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let body: { error?: string } | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadedFile)
      else reject(new ApiError(xhr.status, body?.error ?? `파일을 올리지 못했습니다: ${file.name}`))
    }
    xhr.onerror = () => reject(new ApiError(0, `파일을 올리지 못했습니다: ${file.name}`))
    xhr.send(file)
  })
}

// 나눠 올리기(서버 apps/api/src/chunked-upload.ts). 바깥(Funnel)에서는 연결 하나가 초당 수백 KB 로 느려서,
// 파일을 CHUNK 크기로 나눠 PARALLEL 개씩 함께 보낸다(재 보니 연결 8개 안팎에서 3~5배). 끊긴 조각은 그 조각만 다시 보낸다.
const CHUNKED_FROM = 16 * 1024 * 1024
const CHUNK = 8 * 1024 * 1024
const PARALLEL = 6
const RETRIES = 4

function sendChunk(id: string, offset: number, blob: Blob, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${API_BASE}/api/uploads/chunked/${id}?offset=${offset}`)
    const token = storedToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let message: string | undefined
      try {
        message = JSON.parse(xhr.responseText)?.error
      } catch {
        message = undefined
      }
      reject(new ApiError(xhr.status, message ?? '조각을 올리지 못했습니다.'))
    }
    xhr.onerror = () => reject(new ApiError(0, '연결이 끊겼습니다.'))
    xhr.send(blob)
  })
}

async function uploadChunked(file: File, onProgress: (ratio: number) => void): Promise<UploadedFile> {
  const { id } = await api<{ id: string }>('/uploads/chunked', {
    body: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size },
  })
  const offsets = Array.from({ length: Math.ceil(file.size / CHUNK) }, (_, i) => i * CHUNK)
  const loaded = new Map<number, number>() // 조각마다 올라간 양
  const report = () => onProgress([...loaded.values()].reduce((s, v) => s + v, 0) / file.size)
  let next = 0
  const worker = async () => {
    while (next < offsets.length) {
      const offset = offsets[next++]
      const blob = file.slice(offset, offset + CHUNK)
      for (let attempt = 1; ; attempt++) {
        try {
          await sendChunk(id, offset, blob, (n) => {
            loaded.set(offset, n)
            report()
          })
          loaded.set(offset, blob.size)
          report()
          break
        } catch (e) {
          loaded.set(offset, 0)
          report()
          // 서버가 거절한 것(404 등)은 다시 보내도 안 되므로 바로 멈춘다
          if (attempt >= RETRIES || (e instanceof ApiError && e.status >= 400 && e.status < 500)) {
            throw new ApiError(e instanceof ApiError ? e.status : 0, `파일을 올리지 못했습니다: ${file.name}`)
          }
          await new Promise((r) => setTimeout(r, 1000 * attempt))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, offsets.length) }, worker))
  return api<UploadedFile>(`/uploads/chunked/${id}/finish`, { body: {} })
}

// 고른 파일을 차례로 올린다.
export async function uploadAll(files: File[]): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = []
  for (const file of files) uploaded.push(await uploadFile(file))
  return uploaded
}

// 파일 보기는 로그인이 필요해 <img src> 로 바로 쓸 수 없다. 받아서 브라우저 안 주소(blob:)로 바꾼다.
const blobCache = new Map<string, Promise<string>>()

// 화면용 줄인 이미지 크기(서버 apps/api/src/images.ts). 없으면 원본.
// thumb: 작은 그림 칸, view: 눌러서 크게 보기, wide: 세로로 긴 시안을 그대로 보기
export type ImageSize =
  | 'thumb'
  | 'view'
  | 'wide'
  | `w${640 | 960 | 1280 | 1600 | 1920}`
  | `v${640 | 960 | 1280 | 1600 | 1920}`

// 칸 너비(px)에 맞는 가로 크기. 화면 배율(레티나)을 곱하고, 정해 둔 단계 중 그보다 큰 가장 작은 것을 고른다.
const STEPS = [640, 960, 1280, 1600, 1920] as const
const step = (need: number) => STEPS.find((s) => s >= need) ?? 1920

export function sizeForWidth(cssWidth: number): ImageSize {
  return `w${step(cssWidth * (window.devicePixelRatio || 1))}`
}

// 가로·세로 칸 안에 맞춰 보일 때(크게 보기 창). 긴 쪽 기준으로 고른다.
export function sizeForBox(cssWidth: number, cssHeight: number): ImageSize {
  return `v${step(Math.max(cssWidth, cssHeight) * (window.devicePixelRatio || 1))}`
}

// 이미지 비교용 크기 순위(단계 숫자). 창을 줄일 때 다시 받지 않으려고 쓴다.
export const sizeRank = (v: ImageSize | null) => (v && /^[wv]\d+$/.test(v) ? Number(v.slice(1)) : 0)

// 로그인이 필요한 파일을 브라우저 안 주소(blob:)로 받는다. 같은 파일은 한 번만 받는다.
export function fileUrl(id: string, size?: ImageSize) {
  const key = size ? `${id}:${size}` : id
  let pending = blobCache.get(key)
  if (!pending) {
    pending = apiFetch(size ? `/files/${id}?size=${size}` : `/files/${id}`).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, '파일을 불러오지 못했습니다.')
      return URL.createObjectURL(await res.blob())
    })
    pending.catch(() => blobCache.delete(key))
    blobCache.set(key, pending)
  }
  return pending
}

export function useFileUrl(id: string | null | undefined, size?: ImageSize) {
  const [state, setState] = useState<{ id: string; url: string | null; error: boolean } | null>(null)
  const key = id ? (size ? `${id}:${size}` : id) : null
  useEffect(() => {
    if (!id || !key) return
    let alive = true
    fileUrl(id, size).then(
      (url) => alive && setState({ id: key, url, error: false }),
      () => alive && setState({ id: key, url: null, error: true }),
    )
    return () => {
      alive = false
    }
  }, [id, key, size])
  const current = state && state.id === key ? state : null
  return { url: current?.url ?? null, error: current?.error ?? false }
}

export async function downloadFile(id: string, name: string) {
  const url = await fileUrl(id)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

// 큰 파일 내려받기: 받아 둔 주소를 남겨 두지 않는다(PSD 처럼 큰 파일이 메모리에 계속 남지 않게)
export async function downloadLargeFile(id: string, name: string) {
  const res = await apiFetch(`/files/${id}?download`)
  if (!res.ok) throw new ApiError(res.status, '파일을 내려받지 못했습니다.')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)}KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)}MB`
  if (size < 1024 ** 4) return `${(size / 1024 ** 3).toFixed(1)}GB`
  return `${(size / 1024 ** 4).toFixed(2)}TB`
}
