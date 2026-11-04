import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { UPLOAD_DIR } from './config.ts'
import { all } from './db.ts'
import { isPendingChunked } from './chunked-upload.ts'

// 저장 공간 정리: DB(files)에 없는 파일을 uploads 에서 지운다. 서버를 켤 때와 6시간마다.
//   - 끊긴 나눠 올리기 조각(<id>.part): 하루 넘게 손대지 않았고 지금 받는 중이 아닌 것(서버를 다시 켜면 받는 중 목록이 사라져 남던 것)
//   - 원본: files 에 기록이 없는 것(요청·시안·공유 글 등을 지울 때 기록만 지우고 파일이 남던 것). 올리는 중일 수 있어 6시간 넘게 그대로인 것만
//   - 줄인 이미지(resized/<id>-*.webp 등): 원본 기록이 없는 것
// 지운 개수·크기는 서버 로그에 남긴다.

const PART_STALE_MS = 24 * 60 * 60 * 1000
const ORPHAN_STALE_MS = 6 * 60 * 60 * 1000
const EVERY_MS = 6 * 60 * 60 * 1000
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

export async function sweepStorage() {
  const known = new Set(all<{ id: string }>('SELECT id FROM files').map((r) => r.id))
  // 디자인 툴 히스토리·상세페이지 임시 저장이 가리키는 파일은 files 기록이 없어도 지우지 않는다(안전장치)
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
  const keepFrom = (sql: string) => {
    try {
      for (const r of all<Record<string, string | null>>(sql)) for (const v of Object.values(r)) String(v ?? '').match(uuid)?.forEach((x) => known.add(x))
    } catch {
      // 표가 없으면 넘어간다
    }
  }
  keepFrom('SELECT file_id, asset_ids, form FROM tool_history')
  keepFrom('SELECT data FROM detail_drafts')
  keepFrom('SELECT file_id FROM detail_draft_files')
  const now = Date.now()
  let count = 0
  let bytes = 0
  const drop = async (path: string, size: number) => {
    try {
      await unlink(path)
      count++
      bytes += size
    } catch {
      // 쓰는 중이거나 이미 없음
    }
  }

  let names: string[] = []
  try {
    names = await readdir(UPLOAD_DIR)
  } catch {
    return { count, bytes }
  }
  for (const name of names) {
    if (name === 'resized') continue
    const m = name.match(ID)
    if (!m) continue
    const path = join(UPLOAD_DIR, name)
    const st = await stat(path).catch(() => null)
    if (!st?.isFile()) continue
    const age = now - st.mtimeMs
    if (name.endsWith('.part')) {
      if (age > PART_STALE_MS && !isPendingChunked(m[0])) await drop(path, st.size)
    } else if (name === m[0] && !known.has(name) && age > ORPHAN_STALE_MS) {
      await drop(path, st.size)
    }
  }

  const resized = join(UPLOAD_DIR, 'resized')
  for (const name of await readdir(resized).catch(() => [] as string[])) {
    const m = name.match(ID)
    if (!m || known.has(m[0]) || name.endsWith('.tmp')) continue
    const path = join(resized, name)
    const st = await stat(path).catch(() => null)
    if (st?.isFile()) await drop(path, st.size)
  }

  if (count) console.log(`저장 공간 정리: 쓰지 않는 파일 ${count}개, ${Math.round(bytes / 1048576)}MB 지움`)
  return { count, bytes }
}

export function startStorageSweep() {
  const run = () => void sweepStorage().catch((e) => console.error('저장 공간 정리 실패', e))
  setTimeout(run, 60_000) // 켠 직후 바쁜 때를 피해 1분 뒤
  setInterval(run, EVERY_MS).unref()
}
