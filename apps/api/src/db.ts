import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { DATA_DIR, DB_FILE, UPLOAD_DIR, USERS_FILE } from './config.ts'

// 운영 데이터는 서버 폴더의 SQLite 파일 하나에 둔다(Node 내장 node:sqlite, 별도 설치 없음).
// 업로드한 파일 자체는 data/uploads/ 에 두고 DB 에는 정보만 남긴다.
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(DB_FILE, { enableForeignKeyConstraints: true })

db.exec(`
PRAGMA journal_mode = WAL;

-- 계정. role: superadmin(슈퍼관리자) | admin(관리자) | designer(작업자) | requester(요청자)
-- hash 가 비어 있으면 아직 로그인할 수 없는 계정(관리자가 비밀번호를 정해 줘야 한다)
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  rank        TEXT NOT NULL DEFAULT '',
  position    TEXT NOT NULL DEFAULT '',
  department  TEXT NOT NULL DEFAULT '',
  presence    TEXT NOT NULL DEFAULT 'off',
  salt        TEXT,
  hash        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  INTEGER NOT NULL
);

-- 로그인 세션. 토큰 원문은 저장하지 않고 해시만 둔다. 서버를 다시 켜도 로그인이 유지된다.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

-- 디자인 요청. status 는 lib/requests.ts(화면)와 workflow.ts(서버)의 상태 이름과 같다.
CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  work_type     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  department    TEXT NOT NULL DEFAULT '',
  requester_id  TEXT NOT NULL REFERENCES users(id),
  urgency       TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL DEFAULT 'requested',
  revision      INTEGER NOT NULL DEFAULT 0,
  requested_start_at INTEGER,
  due_at        INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  started_at    INTEGER,
  approved_at   INTEGER,
  completed_at  INTEGER
);

-- 담당 작업자. ord 가 가장 작은 사람이 주 담당
CREATE TABLE IF NOT EXISTS assignees (
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  ord         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (request_id, user_id)
);

-- 요청 내용 묶음: 사이즈(제목·너비·높이) + 그 사이즈의 요청 내용. 한 요청에 여러 개.
-- 예) 자사몰 PC 메인 1920 × 600 / 문구: 겨울엔 뜨끈한 국밥 한 그릇
-- 높이가 자유(세로 길이 제한 없음)면 height 가 비어 있다.
CREATE TABLE IF NOT EXISTS request_items (
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  label       TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  body        TEXT NOT NULL,
  PRIMARY KEY (request_id, ord)
);

-- 컨펌 요청(시안 제출) 한 번 = 한 줄. round 는 1차, 2차…
-- decision: NULL(검토 중) | approved(컨펌) | rejected(반려)
CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL,
  author_id      TEXT NOT NULL REFERENCES users(id),
  note           TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  decision       TEXT,
  decided_by     TEXT REFERENCES users(id),
  decided_at     INTEGER,
  decision_note  TEXT NOT NULL DEFAULT ''
);

-- 업로드 파일. kind: reference(요청 참고 자료) | deliverable(시안) | final(최종 파일)
-- 올린 직후에는 request_id 가 비어 있고, 요청·컨펌 요청·완료 처리 때 연결된다.
CREATE TABLE IF NOT EXISTS files (
  id             TEXT PRIMARY KEY,
  request_id     INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  submission_id  INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  kind           TEXT,
  uploader_id    TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);

-- 시안 이미지 위의 핀. x, y 는 이미지 크기 대비 비율(0~1)이라 화면 크기와 상관없이 같은 자리에 꽂힌다.
CREATE TABLE IF NOT EXISTS pins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT REFERENCES users(id)
);

-- 댓글. pin_id 가 있으면 그 핀의 댓글, 없으면 요청 전체에 단 댓글
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  pin_id      INTEGER REFERENCES pins(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- 진행 기록(타임라인). 상태가 바뀌거나 담당이 바뀔 때마다 남긴다.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id     TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_assignees_user ON assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_files_request ON files(request_id);
CREATE INDEX IF NOT EXISTS idx_pins_file ON pins(file_id);
CREATE INDEX IF NOT EXISTS idx_comments_request ON comments(request_id);
CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- 건의게시판. status: open(접수) | reviewing(검토 중) | done(반영 완료) | declined(보류)
CREATE TABLE IF NOT EXISTS suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  reply       TEXT NOT NULL DEFAULT '',
  replied_by  TEXT REFERENCES users(id),
  replied_at  INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`)

// 이미 만들어진 DB 에 나중에 생긴 칸을 더한다.
function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

// 요청자가 원하는 작업 시작일(작업 기간의 시작). 마감은 due_at
addColumn('requests', 'requested_start_at', 'INTEGER')
// 회원가입으로 만든 계정은 슈퍼관리자가 승인해야(approved = 1) 로그인할 수 있다. 기존 계정은 승인된 것으로 둔다.
addColumn('users', 'approved', 'INTEGER NOT NULL DEFAULT 1')
// 요청과 관계없는 알림(가입 승인 요청 등)이 열 화면. 예: 'team'
addColumn('notifications', 'link', 'TEXT')
// 프로필 사진(files.id). 사진 파일은 kind = 'avatar' 로 표시하고 로그인한 사람 누구나 볼 수 있다.
addColumn('users', 'avatar_id', 'TEXT')
// 마지막으로 서버에 요청한 시각(조직도의 접속 중 표시)
addColumn('users', 'last_seen_at', 'INTEGER')
// 계속 업무(마감 없음). 1 이면 due_at 에는 아주 먼 날짜(ONGOING_DUE)를 넣어 마감 정렬에서 맨 뒤로 간다.
addColumn('requests', 'ongoing', 'INTEGER NOT NULL DEFAULT 0')

// 여러 쿼리를 한 번에 반영하거나 모두 취소한다.
export function transaction<T>(work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type Row = Record<string, unknown>

export function all<T = Row>(sql: string, params: Record<string, unknown> = {}) {
  return db.prepare(sql).all(params as never) as T[]
}

export function get<T = Row>(sql: string, params: Record<string, unknown> = {}) {
  return db.prepare(sql).get(params as never) as T | undefined
}

export function run(sql: string, params: Record<string, unknown> = {}) {
  return db.prepare(sql).run(params as never)
}

// 처음 켤 때: 예전 계정 파일(users.json)의 계정을 옮기고, 디자인팀 구성원을 작업자로 넣는다.
// 구성원 계정은 비밀번호가 없어 로그인할 수 없다. 관리자가 팀 관리 화면에서 비밀번호를 정한다.
const TEAM_SEED = [
  { id: 'jsh', name: '정상훈', rank: '과장', sort: 1 },
  { id: 'whs', name: '원효선', rank: '대리', sort: 2 },
  { id: 'ldh', name: '이동훈', rank: '사원', sort: 3 },
  { id: 'ayj', name: '안예지', rank: '사원', sort: 4 },
]

function seed() {
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n
  if (count > 0) return
  const now = Date.now()
  if (existsSync(USERS_FILE)) {
    const legacy = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as { id: string; name: string; role: string; salt: string; hash: string }[]
    for (const u of legacy) {
      run(
        `INSERT INTO users (id, name, role, salt, hash, sort, created_at) VALUES (:id, :name, :role, :salt, :hash, 0, :now)`,
        { id: u.id, name: u.name, role: u.role, salt: u.salt, hash: u.hash, now },
      )
    }
  }
  for (const t of TEAM_SEED) {
    run(
      `INSERT INTO users (id, name, role, rank, department, sort, created_at) VALUES (:id, :name, 'designer', :rank, '디자인팀', :sort, :now)`,
      { ...t, now },
    )
  }
}

seed()
