import { copyFile, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BACKUP_DIR, BACKUP_KEEP_DAYS, DATA_DIR, UPLOAD_DIR } from './config.ts'
import { db } from './db.ts'

// 외장 하드 백업(BACKUP_DIR). 서버가 켜져 있는 동안 한 시간마다 돈다. 외장 하드가 빠져 있으면 건너뛴다.
//   db/wsd-latest.db           : 가장 최근 DB(한 시간마다 덮어씀). 계정·요청·알림 등 모든 정보
//   db/daily/wsd-YYYY-MM-DD.db : 날마다 하나(BACKUP_KEEP_DAYS 일 보관)
//   uploads/                   : 올린 파일(새로 생기거나 바뀐 것만 더한다. 서버에서 지워도 백업에는 남는다)
//   source/                    : 프로그램 소스(node_modules 제외, 날마다)
//   last-backup.txt            : 마지막 백업 시각과 결과

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pad = (n: number) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// 쓰는 중이어도 깨지지 않는 DB 사본(SQLite VACUUM INTO)
async function snapshotDb(target: string) {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await rm(tmp, { force: true })
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
  await rm(target, { force: true })
  await copyFile(tmp, target)
  await rm(tmp, { force: true })
}

// 원본 폴더의 파일 중 백업에 없거나 크기·시각이 다른 것만 복사(하위 폴더 포함)
async function syncFolder(from: string, to: string) {
  let copied = 0
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) {
      copied += await syncFolder(src, dst)
      continue
    }
    const s = await stat(src)
    const d = await stat(dst).catch(() => null)
    if (d && d.size === s.size && d.mtimeMs >= s.mtimeMs) continue
    await copyFile(src, dst)
    copied++
  }
  return copied
}

let lastSourceDay = ''
let running = false

export async function runBackup() {
  if (running) return null
  running = true
  const started = Date.now()
  try {
    // 외장 하드가 연결돼 있는지(드라이브 맨 위 폴더가 보이는지) 확인
    if (!(await exists(resolve(BACKUP_DIR, '..')))) {
      console.log(`백업 건너뜀: ${BACKUP_DIR} 드라이브가 연결돼 있지 않습니다.`)
      return null
    }
    await mkdir(BACKUP_DIR, { recursive: true })

    await snapshotDb(join(BACKUP_DIR, 'db', 'wsd-latest.db'))
    const daily = join(BACKUP_DIR, 'db', 'daily', `wsd-${today()}.db`)
    await mkdir(dirname(daily), { recursive: true })
    if (!(await exists(daily))) await copyFile(join(BACKUP_DIR, 'db', 'wsd-latest.db'), daily)

    // 오래된 날짜별 DB 정리
    const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86_400_000
    for (const name of await readdir(join(BACKUP_DIR, 'db', 'daily'))) {
      const m = name.match(/^wsd-(\d{4})-(\d{2})-(\d{2})\.db$/)
      if (m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < cutoff) {
        await rm(join(BACKUP_DIR, 'db', 'daily', name), { force: true })
      }
    }

    // 올린 파일(줄인 이미지 사본 resized 는 다시 만들 수 있어 뺀다)
    let uploads = 0
    if (await exists(UPLOAD_DIR)) {
      for (const entry of await readdir(UPLOAD_DIR, { withFileTypes: true })) {
        if (entry.name === 'resized') continue
        const src = join(UPLOAD_DIR, entry.name)
        const dst = join(BACKUP_DIR, 'uploads', entry.name)
        if (entry.isDirectory()) uploads += await syncFolder(src, dst)
        else {
          await mkdir(join(BACKUP_DIR, 'uploads'), { recursive: true })
          const s = await stat(src)
          const d = await stat(dst).catch(() => null)
          if (!d || d.size !== s.size || d.mtimeMs < s.mtimeMs) {
            await copyFile(src, dst)
            uploads++
          }
        }
      }
    }
    // 예전 계정 파일 등 data 폴더의 나머지 파일(DB 원본·uploads 제외)
    for (const entry of await readdir(DATA_DIR, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('wsd.db')) {
        await mkdir(join(BACKUP_DIR, 'data'), { recursive: true })
        await copyFile(join(DATA_DIR, entry.name), join(BACKUP_DIR, 'data', entry.name))
      }
    }

    // 소스(날마다 한 번)
    if (lastSourceDay !== today()) {
      await rm(join(BACKUP_DIR, 'source'), { recursive: true, force: true })
      await cp(REPO_DIR, join(BACKUP_DIR, 'source'), {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|\.git|dist)([\\/]|$)/.test(src),
      })
      lastSourceDay = today()
    }

    const summary = `${new Date().toLocaleString('ko-KR')} 백업 완료 · DB · 새 파일 ${uploads}개 · ${Math.round((Date.now() - started) / 1000)}초`
    await writeFile(join(BACKUP_DIR, 'last-backup.txt'), summary + '\n')
    console.log(summary)
    return { uploads, ms: Date.now() - started }
  } catch (e) {
    console.error('백업 실패:', e)
    await writeFile(join(BACKUP_DIR, 'last-backup.txt'), `${new Date().toLocaleString('ko-KR')} 백업 실패: ${String(e)}\n`).catch(() => {})
    return null
  } finally {
    running = false
  }
}

// 서버가 켜지면 1분 뒤 한 번, 그 뒤 한 시간마다
export function startBackupSchedule() {
  setTimeout(() => void runBackup(), 60_000)
  setInterval(() => void runBackup(), 60 * 60_000)
}
