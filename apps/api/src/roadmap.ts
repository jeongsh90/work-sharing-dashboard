import { ROADMAP_EDITORS } from './config.ts'
import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import type { PublicUser } from './users.ts'

// 건의게시판 오른쪽 "업데이트 예정 기능" 목록. 정해 둔 계정(config.ts 의 ROADMAP_EDITORS)만 쓰고 고친다.

export const ROADMAP_STATUSES = ['예정', '검토 중', '진행 중', '완료'] as const
type RoadmapStatus = (typeof ROADMAP_STATUSES)[number]

db.exec(`
CREATE TABLE IF NOT EXISTS roadmap (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT '예정',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`)

// 처음 만들 때는 예전에 화면 코드에 적어 두었던 목록으로 채운다.
if (get<{ n: number }>('SELECT COUNT(*) AS n FROM roadmap')!.n === 0) {
  const seed: [string, RoadmapStatus][] = [
    ['원본 파일이 올라오지 않으면 작업자에게 다시 알림', '예정'],
    ['브라우저를 닫아도 받는 PC 알림(웹 푸시)', '검토 중'],
    ['요청자에게 다른 부서 요청 가리기(열람 범위)', '검토 중'],
    ['첫 로그인 때 비밀번호 바꾸기 안내', '예정'],
    ['디자인팀 일정 주간 보기', '예정'],
    ['알림 종류별 색 구분', '예정'],
  ]
  const now = Date.now()
  seed.forEach(([title, status], i) =>
    run('INSERT INTO roadmap (title, status, created_at, updated_at) VALUES (:title, :status, :t, :t)', { title, status, t: now + i }),
  )
}

type RoadmapRow = { id: number; title: string; status: RoadmapStatus; created_at: number }

export function canEditRoadmap(user: PublicUser) {
  return ROADMAP_EDITORS.includes(user.id)
}

export function listRoadmap(user: PublicUser) {
  const items = all<RoadmapRow>('SELECT id, title, status, created_at FROM roadmap ORDER BY created_at').map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
  }))
  return { canEdit: canEditRoadmap(user), items }
}

function fields(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw new HttpError(400, '기능 이름을 입력해 주세요.')
  if (title.length > 100) throw new HttpError(400, '기능 이름은 100자까지 입력할 수 있습니다.')
  const status = ROADMAP_STATUSES.includes(body.status as RoadmapStatus) ? (body.status as RoadmapStatus) : '예정'
  return { title, status }
}

function requireEditor(user: PublicUser) {
  if (!canEditRoadmap(user)) throw new HttpError(403, '업데이트 예정 기능은 정해 둔 관리자만 쓸 수 있습니다.')
}

export function createRoadmap(user: PublicUser, body: Record<string, unknown>) {
  requireEditor(user)
  const { title, status } = fields(body)
  const now = Date.now()
  run('INSERT INTO roadmap (title, status, created_at, updated_at) VALUES (:title, :status, :now, :now)', { title, status, now })
  return listRoadmap(user)
}

export function updateRoadmap(user: PublicUser, id: number, body: Record<string, unknown>) {
  requireEditor(user)
  if (!get('SELECT id FROM roadmap WHERE id = :id', { id })) throw new HttpError(404, '항목을 찾을 수 없습니다.')
  const { title, status } = fields(body)
  run('UPDATE roadmap SET title = :title, status = :status, updated_at = :now WHERE id = :id', { id, title, status, now: Date.now() })
  return listRoadmap(user)
}

export function deleteRoadmap(user: PublicUser, id: number) {
  requireEditor(user)
  run('DELETE FROM roadmap WHERE id = :id', { id })
  return listRoadmap(user)
}
