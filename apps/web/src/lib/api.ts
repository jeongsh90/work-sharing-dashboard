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

// 사내망 직통(서버 apps/api/src/lan.ts): 같은 사무실 PC 는 바깥 중계(Funnel, 초당 2.5MB 안팎) 대신 서버 PC 로 바로 파일을 주고받는다.
// 서버가 알려 준 사내망 주소에 닿으면 올리기·큰 파일 받기를 그쪽으로 보낸다. 회사 밖이면 닿지 않아 그대로 중계를 쓴다.
// (처음 한 번 브라우저가 "로컬 네트워크 접근"을 물을 수 있다. 허용하면 다음부터 빠른 길을 쓴다)
// 슈퍼관리자가 관리 → 사내망 직통에 IP 를 등록한 PC 만 쓴다. 등록하지 않은 PC 는 서버가 막아(403) 그대로 중계를 쓴다.
let lanUrl: string | null = null
let lanChecked = 0
let lanProbe: Promise<string | null> | null = null

function probeLan() {
  // 닿지 않았으면 1분 뒤 다시 본다(허용을 늦게 눌렀거나 사무실에 막 들어온 경우)
  if (lanProbe && (lanUrl || Date.now() - lanChecked < 60_000)) return lanProbe
  lanProbe = (async () => {
    let url: string | null = null
    try {
      const info = (await (await fetch(`${API_BASE}/api/lan`)).json()) as { url: string | null; externalUrl?: string | null }
      // 사내망 주소 먼저, 닿지 않으면 회사 밖용 주소(설정했을 때만). 어느 쪽이든 서버가 등록한 IP 만 통과시킨다
      const candidates = [info.url, info.externalUrl].filter((u): u is string => !!u)
      if (candidates.length === 0) return null
      for (const candidate of candidates) {
        url = candidate
        let res: Response
        try {
          res = await fetch(`${candidate}/api/lan`, { signal: AbortSignal.timeout(8000) })
        } catch {
          continue // 닿지 않음 → 다음 주소
        }
        if (res.ok) {
          lanResult = { ok: true }
          return candidate
        }
        // 등록 안 된 IP: 받은 표를 본 주소에 알려 관리 화면에 "누가·어느 IP"로 보이게 한다
        const body = (await res.json().catch(() => null)) as { nonce?: string } | null
        lanResult = body?.nonce ? { nonce: body.nonce } : null
        return null
      }
      // 어느 주소에도 닿지 않음(회사 밖, 또는 브라우저가 로컬 네트워크 접근을 막음)
      lanResult = { unreachable: true }
      return null
    } catch {
      if (url) lanResult = { unreachable: true }
      return null
    } finally {
      lanChecked = Date.now()
      void reportLan()
    }
  })().then((url) => (lanUrl = url))
  return lanProbe
}
if (typeof window !== 'undefined') void probeLan()

// 사내망 확인 결과를 서버에 알린다(관리 → 사내망 직통의 "직통을 못 탄 PC"). 로그인한 뒤에만, 같은 결과는 10분에 한 번
let lanResult: { ok: true } | { nonce: string } | { unreachable: true } | null = null
let lanReported = { key: '', at: 0 }
async function reportLan() {
  if (!lanResult || !storedToken()) return
  const key = JSON.stringify(lanResult)
  if (key === lanReported.key && Date.now() - lanReported.at < 10 * 60_000) return
  lanReported = { key, at: Date.now() }
  const body = lanResult
  if ('nonce' in body) lanResult = null // 표는 한 번만 쓴다
  await api('/lan/report', { body }).catch(() => {})
}

// 파일을 주고받을 서버 주소. 사내망 확인이 늦으면(1.5초) 기다리지 않고 중계로 보낸다.
async function fileBase() {
  await Promise.race([probeLan(), new Promise((r) => setTimeout(r, 1500))])
  void reportLan()
  return lanUrl ?? API_BASE
}
// 로그인한 뒤 한 번 확인 결과를 알린다(처음 확인은 로그인 전에 끝났을 수 있다)
export function reportLanAfterLogin() {
  void probeLan().then(() => reportLan())
}
// 사내망 주소로 보내다 연결이 끊기면 이번 화면에서는 중계로 돌아간다
function lanFailed(base: string) {
  if (base !== API_BASE && base === lanUrl) lanUrl = null
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
export function uploadFile(file: File): Promise<UploadedFile> {
  return uploadFileWithProgress(file, () => {})
}

// 큰 파일(PSD 등)을 올리며 진행률(0~1)을 알려 준다. fetch 는 올리는 진행률을 못 받아 XMLHttpRequest 를 쓴다.
// CHUNKED_FROM 보다 크면 나눠서 여러 연결로 함께 올린다(uploadChunked). 사내망이면 사내망 주소로 보낸다.
export async function uploadFileWithProgress(file: File, onProgress: (ratio: number) => void): Promise<UploadedFile> {
  if (file.size > CHUNKED_FROM) return uploadChunked(file, onProgress)
  const base = await fileBase()
  try {
    return await uploadWhole(base, file, onProgress)
  } catch (e) {
    // 사내망 주소로 보내다 연결이 끊기면 중계로 한 번 더 보낸다
    if (!(e instanceof ApiError && e.status === 0) || base === API_BASE) throw e
    lanFailed(base)
    return uploadWhole(API_BASE, file, onProgress)
  }
}

function uploadWhole(base: string, file: File, onProgress: (ratio: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/api/uploads`)
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

function sendChunk(base: string, id: string, offset: number, blob: Blob, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${base}/api/uploads/chunked/${id}?offset=${offset}`)
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
  // 시작·마무리는 늘 쓰는 주소로, 조각은 사내망이면 사내망 주소로 보낸다(같은 서버라 섞여도 된다)
  await fileBase()
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
          const base = lanUrl ?? API_BASE
          try {
            await sendChunk(base, id, offset, blob, (n) => {
              loaded.set(offset, n)
              report()
            })
          } catch (e) {
            // 사내망 주소에서 끊기면 남은 조각은 중계로 보낸다
            if (e instanceof ApiError && e.status === 0) lanFailed(base)
            throw e
          }
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
    // r: 줄인 이미지 규칙이 바뀌면 올린다(브라우저가 1년 캐시함). 2 = 움직이는 WebP 는 원본
    pending = apiFetch(size ? `/files/${id}?size=${size}&r=2` : `/files/${id}`).then(async (res) => {
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

// 내려받기는 크기와 상관없이 브라우저 자체 다운로드로(최종 파일·요청 첨부에도 큰 PSD 가 있다)
export function downloadFile(id: string, name: string) {
  return downloadLargeFile(id, name)
}

// 큰 파일 내려받기(자료실·파일공유·공지 첨부): 브라우저 자체 다운로드로 받는다.
// 다운로드 목록에 진행률이 보이고, 메모리에 쌓지 않고 바로 디스크에 쓰며, 끊기면 이어받는다(PSD 수백 MB 도 받게).
// 브라우저 다운로드는 로그인 머리말을 못 붙여서 이 파일만 받을 수 있는 표(1시간)를 받아 주소에 붙인다.
// 사내망이면 사내망 주소에서 받는다(빠름).
export async function downloadLargeFile(id: string, name: string) {
  const [base, { ticket }] = await Promise.all([fileBase(), api<{ ticket: string }>(`/files/${id}/ticket`, { body: {} })])
  const a = document.createElement('a')
  // 저장 이름은 서버가 Content-Disposition 으로 정한다(name 을 넘겨 화면이 정한 이름으로)
  a.href = `${base}/api/files/${id}?download&ticket=${encodeURIComponent(ticket)}&name=${encodeURIComponent(name)}`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)}KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)}MB`
  if (size < 1024 ** 4) return `${(size / 1024 ** 3).toFixed(1)}GB`
  return `${(size / 1024 ** 4).toFixed(2)}TB`
}

// ── FTP(서버 apps/api/src/ftp.ts). 서버 PC 가 FTP 에 대신 접속해 흘려 보낸다. 사내망이면 사내망 주소로(빠름) ──
export function ftpUploadFile(serverId: string, dir: string, file: File, onProgress: (ratio: number) => void): Promise<void> {
  const send = (base: string) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', `${base}/api/ftp/${serverId}/file?path=${encodeURIComponent(dir)}`)
      const token = storedToken()
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve()
        let message = `올리지 못했습니다: ${file.name}`
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message
        } catch {
          /* 그대로 */
        }
        reject(new ApiError(xhr.status, message))
      }
      xhr.onerror = () => reject(new ApiError(0, `올리지 못했습니다: ${file.name}`))
      xhr.send(file)
    })
  return (async () => {
    const base = await fileBase()
    try {
      await send(base)
    } catch (e) {
      if (base === API_BASE || !(e instanceof ApiError) || e.status !== 0) throw e
      lanFailed(base)
      onProgress(0)
      await send(API_BASE)
    }
  })()
}

// dir·raw 는 FTP 목록이 준 바이트 경로·이름(base64url), name 은 저장할 파일 이름
export async function ftpDownloadFile(serverId: string, dir: string, raw: string, name: string) {
  const url = URL.createObjectURL(await ftpFetchFile(serverId, dir, raw, false))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// FTP 파일 내용(미리보기면 이미지 형식으로, 사용 기록에 남지 않음)
export async function ftpFetchFile(serverId: string, dir: string, raw: string, preview: boolean): Promise<Blob> {
  const base = await fileBase()
  const token = storedToken()
  const get = (b: string) =>
    fetch(`${b}/api/ftp/${serverId}/file?path=${encodeURIComponent(dir)}&name=${encodeURIComponent(raw)}${preview ? '&preview' : ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  let res: Response
  try {
    res = await get(base)
  } catch {
    if (base === API_BASE) throw new ApiError(0, '내려받지 못했습니다.')
    lanFailed(base)
    res = await get(API_BASE)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? (preview ? '미리보기를 불러오지 못했습니다.' : '내려받지 못했습니다.'))
  }
  return res.blob()
}
