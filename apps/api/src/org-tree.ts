import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DATA_DIR } from './config.ts'

// 회사 조직도(하이웍스 조직도에서 가져온 것): 부서 나무 + 부서마다 사람(이름·직급·직무) + 프로필 사진.
// 사람 이름이 들어 있어 저장소가 아니라 서버 data/ 에만 둔다: data/org-tree.json, 사진은 data/org-photos/{id}.jpg
// 화면(조직도)은 이 나무로 본부 → 팀 → 파트 순서대로 보여 주고, 같은 이름의 사이트 계정이 있으면 상태·접속을 함께 붙인다.

const TREE_FILE = join(DATA_DIR, 'org-tree.json')
const PHOTO_DIR = join(DATA_DIR, 'org-photos')

// 연락처: 휴대폰(하이웍스에서 공개로 둔 사람만) · 내선(회사 전화) · 메일
export type OrgTreeMember = { id: string; name: string; position: string; job: string; rest: boolean; photo: boolean; cell: string; phone: string; email: string }
export type OrgTreeNode = { id: string; name: string; parent: string | null; members: OrgTreeMember[] }
export type OrgTree = { updatedAt: number; source: string; nodes: OrgTreeNode[] }

let memory: OrgTree | null | undefined

export async function readOrgTree(): Promise<OrgTree | null> {
  if (memory !== undefined) return memory
  try {
    memory = JSON.parse(await readFile(TREE_FILE, 'utf8')) as OrgTree
  } catch {
    memory = null
  }
  return memory
}

const ID = /^[A-Za-z0-9_-]{1,40}$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// 받은 나무를 확인해 저장한다. photos: { 사람 id: base64 JPEG } (있는 사람만)
export async function saveOrgTree(body: Record<string, unknown>) {
  const raw = body.nodes
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) throw new Error('부서 목록이 올바르지 않습니다.')
  const photos = (body.photos && typeof body.photos === 'object' ? body.photos : {}) as Record<string, unknown>
  const nodes: OrgTreeNode[] = raw.map((n) => {
    const o = (n ?? {}) as Record<string, unknown>
    const id = str(o.id, 40)
    if (!ID.test(id)) throw new Error('부서 id 가 올바르지 않습니다.')
    const members = (Array.isArray(o.members) ? o.members : []).map((m) => {
      const p = (m ?? {}) as Record<string, unknown>
      const mid = str(p.id, 40)
      if (!ID.test(mid)) throw new Error('사람 id 가 올바르지 않습니다.')
      const tel = (v: unknown) => str(v, 30).replace(/[^0-9+()\- ]/g, '')
      const email = str(p.email, 120)
      return { id: mid, name: str(p.name, 40), position: str(p.position, 40), job: str(p.job, 40), rest: p.rest === true, photo: typeof photos[mid] === 'string', cell: tel(p.cell), phone: tel(p.phone), email: /^[^\s@]+@[^\s@]+$/.test(email) ? email : '' }
    })
    return { id, name: str(o.name, 60), parent: o.parent ? str(o.parent, 40) : null, members }
  })
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) if (n.parent && !ids.has(n.parent)) throw new Error(`${n.name}: 위 부서가 없습니다.`)
  await mkdir(PHOTO_DIR, { recursive: true })
  for (const [id, b64] of Object.entries(photos)) {
    if (!ID.test(id) || typeof b64 !== 'string') continue
    const data = Buffer.from(b64, 'base64')
    // JPEG 만(FF D8), 한 장 2MB 까지
    if (data.length < 4 || data.length > 2_000_000 || data[0] !== 0xff || data[1] !== 0xd8) continue
    await writeFile(join(PHOTO_DIR, `${id}.jpg`), data)
  }
  const tree: OrgTree = { updatedAt: Date.now(), source: str(body.source, 40) || 'hiworks', nodes }
  await writeFile(TREE_FILE + '.tmp', JSON.stringify(tree))
  await rename(TREE_FILE + '.tmp', TREE_FILE)
  memory = tree
  return { nodes: nodes.length, members: nodes.reduce((s, n) => s + n.members.length, 0), photos: nodes.reduce((s, n) => s + n.members.filter((m) => m.photo).length, 0) }
}

export async function readOrgPhoto(id: string) {
  if (!ID.test(id)) return null
  try {
    return await readFile(join(PHOTO_DIR, `${id}.jpg`))
  } catch {
    return null
  }
}
