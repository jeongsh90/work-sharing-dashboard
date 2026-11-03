import { all, db, get, run } from './db.ts'
import { HttpError } from './requests.ts'
import { findUser, type PublicUser } from './users.ts'

// 부서별 최종 컨펌자: 그 부서 요청은 정한 사람이 컨펌할 때만 완료된다(예: 마케팅 1팀 → 유다희 팀장).
// 요청자·관리자도 반려는 할 수 있지만 컨펌(완료 처리)은 이 사람만. 정하지 않은 부서는 예전처럼 요청자·관리자.
// 부서 이름은 띄어쓰기를 빼고 맞춘다('마케팅 1팀' = '마케팅1팀'). 슈퍼관리자가 팀 관리에서 정한다.

db.exec(`
CREATE TABLE IF NOT EXISTS dept_approvers (
  dept_key   TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`)

export const deptKey = (department: string) => department.replace(/\s+/g, '')

export function approverFor(department: string): string | null {
  const key = deptKey(department ?? '')
  if (!key) return null
  return get<{ user_id: string }>('SELECT user_id FROM dept_approvers WHERE dept_key = :key', { key })?.user_id ?? null
}

function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 정할 수 있습니다.')
}

export function listDeptApprovers() {
  return all<{ dept_key: string; department: string; user_id: string; created_at: number }>('SELECT * FROM dept_approvers ORDER BY department').map((r) => ({
    key: r.dept_key,
    department: r.department,
    userId: r.user_id,
    createdAt: r.created_at,
  }))
}

export function setDeptApprover(user: PublicUser, body: Record<string, unknown>) {
  requireSuperadmin(user)
  const department = typeof body.department === 'string' ? body.department.trim().slice(0, 40) : ''
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!deptKey(department)) throw new HttpError(400, '부서를 골라 주세요.')
  const approver = findUser(userId)
  if (!approver || !approver.active) throw new HttpError(400, '최종 컨펌할 사람을 골라 주세요.')
  run(
    `INSERT INTO dept_approvers (dept_key, department, user_id, created_by, created_at) VALUES (:key, :department, :userId, :me, :now)
     ON CONFLICT(dept_key) DO UPDATE SET department = :department, user_id = :userId`,
    { key: deptKey(department), department, userId, me: user.id, now: Date.now() },
  )
  return listDeptApprovers()
}

export function deleteDeptApprover(user: PublicUser, key: string) {
  requireSuperadmin(user)
  run('DELETE FROM dept_approvers WHERE dept_key = :key', { key })
  return listDeptApprovers()
}
