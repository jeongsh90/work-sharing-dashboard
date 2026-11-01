import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { HttpError, insertFile } from './requests.ts'
import type { PublicUser } from './users.ts'

// 큰 파일 나눠 올리기. 바깥(Funnel)은 연결 하나의 속도가 초당 수백 KB 로 느리지만 여러 연결을 함께 쓰면 몇 배 빨라진다.
// 화면이 파일을 조각(기본 8MB)으로 나눠 여러 개를 동시에 보내고, 서버는 받은 조각을 파일의 제자리(offset)에 쓴다.
//   POST /api/uploads/chunked            { name, mime, size } → { id }
//   PUT  /api/uploads/chunked/:id?offset=N  (본문 = 조각)
//   POST /api/uploads/chunked/:id/finish → 일반 올리기와 같은 { id, name, mime, size }
// 조각이 끊기면 그 조각만 다시 보내면 된다. 다 받기 전 파일은 uploads/<id>.part 로 두고, 다 받으면 이름을 바꿔 등록한다.

const MAX_CHUNK = 64 * 1024 * 1024
const STALE_MS = 24 * 60 * 60 * 1000 // 하루 넘게 마무리되지 않은 올리기는 지운다

type Pending = { uploaderId: string; name: string; mime: string; size: number; received: Map<number, number>; touched: number }
const pending = new Map<string, Pending>()

const partPath = (id: string) => join(UPLOAD_DIR, `${id}.part`)

function sweep() {
  const now = Date.now()
  for (const [id, p] of pending) {
    if (now - p.touched > STALE_MS) {
      pending.delete(id)
      void unlink(partPath(id)).catch(() => {})
    }
  }
}

export async function startChunked(user: PublicUser, body: Record<string, unknown>) {
  sweep()
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  if (!name) throw new HttpError(400, '파일 이름이 없습니다.')
  const size = Number(body.size)
  if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, '파일 크기가 올바르지 않습니다.')
  const mime = (typeof body.mime === 'string' && body.mime.split(';')[0]) || 'application/octet-stream'
  const id = randomUUID()
  // 미리 전체 크기로 만들어 두고 조각을 제자리에 쓴다
  const fh = await open(partPath(id), 'w')
  await fh.truncate(size)
  await fh.close()
  pending.set(id, { uploaderId: user.id, name, mime, size, received: new Map(), touched: Date.now() })
  return { id }
}

function own(user: PublicUser, id: string) {
  const p = pending.get(id)
  if (!p || p.uploaderId !== user.id) throw new HttpError(404, '올리던 파일을 찾을 수 없습니다. 처음부터 다시 올려 주세요.')
  return p
}

export async function putChunk(req: IncomingMessage, user: PublicUser, id: string, offset: number) {
  const p = own(user, id)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= p.size) throw new HttpError(400, '조각 위치가 올바르지 않습니다.')
  const fh = await open(partPath(id), 'r+')
  let written = 0
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      if (written + chunk.length > MAX_CHUNK || offset + written + chunk.length > p.size) throw new HttpError(413, '조각이 너무 큽니다.')
      await fh.write(chunk, 0, chunk.length, offset + written)
      written += chunk.length
    }
  } catch (error) {
    throw error instanceof HttpError ? error : new HttpError(400, '조각을 받지 못했습니다.')
  } finally {
    await fh.close()
  }
  p.received.set(offset, written)
  p.touched = Date.now()
  return { ok: true }
}

export async function finishChunked(user: PublicUser, id: string) {
  const p = own(user, id)
  // 받은 조각이 처음부터 끝까지 빈틈없이 이어지는지
  let end = 0
  for (const [offset, length] of [...p.received].sort((a, b) => a[0] - b[0])) {
    if (offset > end) break
    end = Math.max(end, offset + length)
  }
  if (end < p.size) throw new HttpError(400, '아직 다 올라가지 않았습니다. 다시 시도해 주세요.')
  pending.delete(id)
  await rename(partPath(id), join(UPLOAD_DIR, id))
  insertFile({ id, uploaderId: user.id, name: p.name, mime: p.mime, size: p.size })
  return { id, name: p.name, mime: p.mime, size: p.size }
}
