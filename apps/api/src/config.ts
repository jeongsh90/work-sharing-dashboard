import { join } from 'node:path'

// 서버 폴더. 화면은 web/, 계정은 data/ 에 둔다. data/ 는 git 에 올리지 않는다.
export const SERVER_DIR = process.env.WSD_SERVER_DIR ?? 'D:/WSD-Dashboard'
export const WEB_DIR = join(SERVER_DIR, 'web')
export const USERS_FILE = join(SERVER_DIR, 'data', 'users.json')

export const PORT = Number(process.env.PORT ?? 4173)

export const COMPANY_EMAIL_DOMAIN = 'owenfood.com'

// 다른 주소에서 띄운 화면이 이 API 를 부를 수 있게 허용한다.
export const ALLOWED_ORIGINS = ['https://jeongsh90.github.io', 'http://localhost:5173']

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

// 같은 아이디로 연속 실패하면 잠시 막는다.
export const MAX_FAILED_LOGINS = 5
export const LOCK_MS = 10 * 60 * 1000
