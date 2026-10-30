import { join } from 'node:path'

// 서버 폴더. 화면은 web/, 계정·요청 데이터와 업로드 파일은 data/ 에 둔다. data/ 는 git 에 올리지 않는다.
export const SERVER_DIR = process.env.WSD_SERVER_DIR ?? 'D:/WSD-Dashboard'
export const WEB_DIR = join(SERVER_DIR, 'web')
export const DATA_DIR = join(SERVER_DIR, 'data')
export const DB_FILE = join(DATA_DIR, 'wsd.db')
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
// 예전 계정 파일. DB 를 처음 만들 때 한 번 옮겨 온다.
export const USERS_FILE = join(DATA_DIR, 'users.json')

// 외장 하드 백업 폴더(DB·올린 파일·소스). 테스트 서버(WSD_SERVER_DIR 지정)는 백업하지 않는다.
export const BACKUP_DIR = process.env.WSD_BACKUP_DIR ?? (process.env.WSD_SERVER_DIR ? '' : 'E:/디자인작업요청시스템')
// 날짜별 DB 백업을 며칠 남길지
export const BACKUP_KEEP_DAYS = 90

export const PORT = Number(process.env.PORT ?? 4173)

export const COMPANY_EMAIL_DOMAIN = 'owenfood.com'

// 다른 주소에서 띄운 화면이 이 API 를 부를 수 있게 허용한다.
export const ALLOWED_ORIGINS = ['https://jeongsh90.github.io', 'http://localhost:5173']

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
// 로그인 화면에서 "로그인 상태 유지"를 고르면 이 기간 동안 다시 로그인하지 않아도 된다.
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000

// 같은 아이디로 연속 실패하면 잠시 막는다.
export const MAX_FAILED_LOGINS = 5
export const LOCK_MS = 10 * 60 * 1000

// 계정 전환 묶음: 이 계정들끼리는 헤더의 "계정 전환"으로 비밀번호 없이 오갈 수 있다(테스트·운영 확인용).
// 건의게시판에 새 글이 올라오면 알림을 받을 계정
export const FEEDBACK_NOTIFY = ['admin', '49634613@owenfood.com']
// 건의게시판의 업데이트 예정 기능을 쓰고 고칠 수 있는 계정
export const ROADMAP_EDITORS = ['admin', '49634613@owenfood.com']

// 조직도에서 지금 사이트에 접속한 사람을 볼 수 있는 계정(정상훈 + 슈퍼관리자 둘)
export const ONLINE_VIEWERS = ['49634613@owenfood.com', 'admin', 'owenfood']
// 마지막 요청이 이 시간 안이면 접속 중으로 본다. 화면은 알림을 15초마다 받아 오므로 창을 열어 두면 계속 접속 중이다.
// 사이드메뉴 아래 남은 용량을 보여 줄 드라이브. 보는 계정은 ONLINE_VIEWERS 와 같다.
export const DISK_PATH = 'D:/'

export const ONLINE_MS = 2 * 60 * 1000
// 조직도에 보이지 않는 계정: admin, test 로 시작하는 계정, 부서가 "테스트"인 계정
export function hiddenFromOrg(u: { id: string; department: string }) {
  return u.id === 'admin' || u.id.startsWith('test') || u.department.replace(/\s+/g, '') === '테스트'
}

export const SWITCH_ACCOUNTS = ['admin', 'test1', 'test2', 'test3', '49634613@owenfood.com', 'owenfood_ai']
