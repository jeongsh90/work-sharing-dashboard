import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import { USERS_FILE } from './config.ts'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export type Role = 'superadmin'

export type PublicUser = {
  id: string
  name: string
  role: Role
}

type StoredUser = PublicUser & {
  salt: string
  hash: string
}

async function readUsers(): Promise<StoredUser[]> {
  try {
    return JSON.parse(await readFile(USERS_FILE, 'utf8')) as StoredUser[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function hashPassword(password: string, salt: Buffer) {
  return scryptAsync(password, salt, 64)
}

export async function verifyUser(id: string, password: string): Promise<PublicUser | null> {
  const user = (await readUsers()).find((u) => u.id === id)
  // 계정이 없어도 같은 시간만큼 계산해 응답 시간으로 계정 존재를 알 수 없게 한다.
  const salt = user ? Buffer.from(user.salt, 'hex') : randomBytes(16)
  const actual = await hashPassword(password, salt)
  if (!user) return null
  const expected = Buffer.from(user.hash, 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return { id: user.id, name: user.name, role: user.role }
}

export async function setUser(user: PublicUser, password: string) {
  const salt = randomBytes(16)
  const hash = await hashPassword(password, salt)
  const users = (await readUsers()).filter((u) => u.id !== user.id)
  users.push({ ...user, salt: salt.toString('hex'), hash: hash.toString('hex') })
  await mkdir(dirname(USERS_FILE), { recursive: true })
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf8')
}
