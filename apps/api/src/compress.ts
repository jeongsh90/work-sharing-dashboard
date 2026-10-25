import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

// 응답 압축(brotli 우선, 없으면 gzip)과 JSON 의 ETag(바뀐 게 없으면 304).
// 화면 파일은 한 번 압축한 결과를 기억해 두고 다시 쓴다.

export type Encoding = 'br' | 'gzip' | null

export function pickEncoding(req: IncomingMessage): Encoding {
  const accept = String(req.headers['accept-encoding'] ?? '')
  if (/\bbr\b/.test(accept)) return 'br'
  if (/\bgzip\b/.test(accept)) return 'gzip'
  return null
}

export function compress(data: Buffer, encoding: Encoding, { quality = 5 } = {}) {
  if (encoding === 'br') return brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality } })
  if (encoding === 'gzip') return gzipSync(data, { level: 6 })
  return data
}

// 글자로 된 파일만 압축한다(이미지·글꼴은 이미 압축돼 있다).
const TEXT_TYPES = /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/
export const isCompressible = (type: string) => TEXT_TYPES.test(type)

// 화면 파일 압축 결과 기억(파일 경로·수정 시각·방식별). 배포하면 수정 시각이 바뀌어 새로 만든다.
const staticCache = new Map<string, Buffer>()
export function compressStatic(path: string, mtimeMs: number, data: Buffer, encoding: Encoding) {
  if (!encoding) return data
  const key = `${path}|${mtimeMs}|${encoding}`
  let out = staticCache.get(key)
  if (!out) {
    // 화면 파일은 한 번만 압축하므로 가장 강하게
    out = compress(data, encoding, { quality: 11 })
    if (staticCache.size > 500) staticCache.clear()
    staticCache.set(key, out)
  }
  return out
}

// JSON 응답: 1KB 이상이면 압축하고, GET 200 이면 ETag 를 붙여 같은 내용은 304 로 돌려준다.
// 로그인 정보마다 내용이 다를 수 있어 브라우저 캐시는 늘 서버에 다시 물어보게 한다(no-cache).
export function sendCompressedJson(req: IncomingMessage | undefined, res: ServerResponse, status: number, body: unknown) {
  const json = Buffer.from(JSON.stringify(body))
  const headers: Record<string, string | number> = { 'Content-Type': 'application/json; charset=utf-8' }
  const cacheable = req?.method === 'GET' && status === 200
  if (cacheable) {
    const etag = `"${createHash('sha1').update(json).digest('base64url')}"`
    headers['Cache-Control'] = 'private, no-cache'
    headers.ETag = etag
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }
  } else {
    headers['Cache-Control'] = 'no-store'
  }
  const encoding = req && json.length >= 1024 ? pickEncoding(req) : null
  const out = compress(json, encoding)
  if (encoding) {
    headers['Content-Encoding'] = encoding
    headers.Vary = 'Accept-Encoding'
  }
  headers['Content-Length'] = out.length
  res.writeHead(status, headers)
  res.end(out)
}
