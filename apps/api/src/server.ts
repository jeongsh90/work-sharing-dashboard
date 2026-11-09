import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, stat, statfs, unlink } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import {
  ALLOWED_ORIGINS,
  COMPANY_EMAIL_DOMAIN,
  SWITCH_ACCOUNTS,
  BACKUP_DIR,
  ONLINE_VIEWERS,
  DISK_PATH,
  PORT,
  UPLOAD_DIR,
  WEB_DIR,
} from './config.ts'
import {
  addComment,
  addPin,
  addPinComment,
  deleteComment,
  updateComment,
  archive,
  createRequest,
  deleteRequest,
  findFile,
  HttpError,
  insertFile,
  listNotifications,
  listRequests,
  notifyLink,
  markNotificationsRead,
  performAction,
  setPartStatus,
  requestDetail,
  resolvePin,
  updateRequest,
  type Action,
} from './requests.ts'
import { isImageSize, resizedImage, RESIZABLE } from './images.ts'
import { compressStatic, isCompressible, pickEncoding, sendCompressedJson } from './compress.ts'
import { answerSuggestion, createSuggestion, deleteSuggestion, listSuggestions } from './suggestions.ts'
import { createRoadmap, deleteRoadmap, listRoadmap, updateRoadmap } from './roadmap.ts'
import { createWorklogEntry, deleteWorklogEntry, teamWorklog, updateWorklogEntry, worklog } from './worklog.ts'
import { createMemo, deleteMemo, listMemos, updateMemo } from './memos.ts'
import { deleteIndexReport, getIndexReport, indexReportPdf, listIndexReports, saveIndexReport } from './index-reports.ts'
import { addChecklistItem, clearDoneChecklist, createChecklist, deleteChecklist, deleteChecklistItem, listChecklists, reorderChecklistItems, reorderChecklists, resetChecklist, updateChecklist, updateChecklistItem } from './checklists.ts'
import { startBackupSchedule } from './backup.ts'
import { startStorageSweep } from './storage-sweep.ts'
import { analyzePurchaseCert } from './purchase-cert.ts'
import { holidays } from './holidays.ts'
import { addPlanLine, deletePlanLine, importSchedulePlans, saveOwners, schedulePlans, updatePlanLine } from './schedule-plans.ts'
import { addToolHistory, canSeeToolFile, deleteToolHistory, listToolHistory } from './tool-history.ts'
import { addLibraryItems, canUseLibrary, deleteLibraryItem, listLibrary, updateLibraryItem } from './library.ts'
import { finishChunked, putChunk, startChunked } from './chunked-upload.ts'
import { renderDetail } from './detail-render.ts'
import { addDetailDraft, deleteDetailDraft, getDetailDraft, listDetailDrafts, updateDetailDraft } from './detail-drafts.ts'
import { deleteRequestDraft, getRequestDraft, saveRequestDraft } from './request-drafts.ts'
import { deleteDeptApprover, listDeptApprovers, setDeptApprover } from './dept-approvers.ts'
import { accountSecret, addAccount, deleteAccount, listAccounts, reorderAccounts, updateAccount } from './accounts.ts'
import { addLanIp, deleteLanIp, ignoreLanMiss, lanAddress, lanExternalAddress, listLanIgnored, listLanIps, listLanMisses, reportLan, startLan, unignoreLanMiss, updateLanIp } from './lan.ts'
import {
  addFtpServer,
  deleteFtpServer,
  ftpDelete,
  ftpDownload,
  ftpList,
  ftpMkdir,
  ftpUpload,
  listFtpLogs,
  listFtpServers,
  testFtpServer,
  changeFtpPassword,
  updateFtpServer,
} from './ftp.ts'
import { canSeeShareFile, createSharePost, deleteSharePost, listShare, updateSharePost } from './share.ts'
import { canSeeNoticeFile, createNotice, deleteNotice, listNotices, noticeDetail, updateNotice } from './notices.ts'
import {
  approveUser,
  createSession,
  createUser,
  deletePendingUser,
  deleteSession,
  findUser,
  isManager,
  listUsers,
  PRESENCES,
  ROLES,
  sessionUser,
  setAvatar,
  setPassword,
  superadminIds,
  updateUser,
  verifyUser,
  type PublicUser,
  type Role,
  orgMembers,
  touchSeen,
} from './users.ts'

// 회원가입 남용 막기: 같은 주소(IP)에서 한 시간에 5번까지
const signups = new Map<string, number[]>()
const SIGNUP_LIMIT = 5
const SIGNUP_WINDOW_MS = 60 * 60 * 1000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

// 응답마다 그 요청을 기억해 둔다(JSON 압축·ETag 에 요청 머리글이 필요하다)
const requestOf = new WeakMap<ServerResponse, IncomingMessage>()

function sendJson(res: ServerResponse, status: number, body: unknown) {
  sendCompressedJson(requestOf.get(res), res, status, body)
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    // Tailscale 에 연결된 PC 에서는 ts.net 주소가 내부망(100.x)으로 풀린다.
    // 공개 사이트(GitHub Pages)에서 오는 요청을 브라우저가 내부망 요청으로 보고 확인을 요구하므로 허용한다.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
}

async function readJson(req: IncomingMessage, limit = 200_000): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, '보낸 내용이 너무 큽니다.')
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (value && typeof value === 'object') return value as Record<string, unknown>
  } catch {
    // 아래에서 처리
  }
  throw new HttpError(400, '요청 형식이 올바르지 않습니다.')
}

function bearer(req: IncomingMessage) {
  return req.headers.authorization?.match(/^Bearer (\w+)$/)?.[1] ?? null
}

// 내려받기 표: 큰 파일을 브라우저 자체 다운로드(진행률·이어받기, 메모리에 쌓지 않음)로 받게 한다.
// 브라우저 다운로드는 Authorization 머리말을 못 붙여서, 로그인한 화면이 이 파일 하나만 받을 수 있는 표를 받아 주소에 붙인다.
// 표는 1시간 동안(끊긴 다운로드 이어받기) 쓸 수 있고, 로그아웃하면 바로 못 쓴다(쓸 때마다 로그인 세션을 다시 확인).
const TICKET_MS = 60 * 60 * 1000
const tickets = new Map<string, { session: string; fileId: string; exp: number }>()
function issueTicket(req: IncomingMessage, fileId: string) {
  const now = Date.now()
  for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k)
  const ticket = randomBytes(24).toString('base64url')
  tickets.set(ticket, { session: bearer(req)!, fileId, exp: now + TICKET_MS })
  return ticket
}
function ticketUser(ticket: string, fileId: string) {
  const t = tickets.get(ticket)
  if (!t || t.fileId !== fileId || t.exp < Date.now()) throw new HttpError(401, '내려받기 주소가 만료됐습니다. 화면에서 다시 눌러 주세요.')
  const user = sessionUser(t.session)
  if (!user) throw new HttpError(401, '다시 로그인해 주세요.')
  return user
}

function requireUser(req: IncomingMessage): PublicUser {
  const token = bearer(req)
  const user = token ? sessionUser(token) : null
  if (!user) throw new HttpError(401, '다시 로그인해 주세요.')
  return user
}

function requireManager(user: PublicUser) {
  if (!isManager(user)) throw new HttpError(403, '관리자만 할 수 있습니다.')
}

async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req)
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!id || !password) {
    return sendJson(res, 400, { error: '아이디(회사 이메일)와 비밀번호를 입력해 주세요.' })
  }
  if (id.includes('@') && !id.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
    return sendJson(res, 400, { error: `회사 이메일(@${COMPANY_EMAIL_DOMAIN})로 로그인해 주세요.` })
  }

  const user = await verifyUser(id, password)
  if (!user) {
    // 잠그지는 않는다(10분 대기 없음). 대신 틀리면 1초 쉬고 답해 비밀번호를 마구 넣어 보는 것만 느리게 한다
    await new Promise((r) => setTimeout(r, 1000))
    return sendJson(res, 401, { error: '아이디 또는 비밀번호가 맞지 않습니다.' })
  }

  if (!user.approved) {
    return sendJson(res, 403, { error: '가입 승인을 기다리고 있습니다. 슈퍼관리자가 승인하면 로그인할 수 있습니다.' })
  }
  sendJson(res, 200, { token: createSession(user.id, { remember: body.remember === true }), user })
}

const NOTICE_PATH = /^\/api\/notices\/(\d+)$/

// 파일 올리기: 본문이 파일 그대로(멀티파트 아님). 파일 이름은 X-File-Name 헤더(URL 인코딩)로 받는다.
// 크기 제한은 두지 않는다(작업 원본 PSD 등). 메모리에 올리지 않고 받는 대로 디스크에 쓴다.
async function handleUpload(req: IncomingMessage, res: ServerResponse, user: PublicUser) {
  const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).trim().slice(0, 200)
  if (!name) throw new HttpError(400, '파일 이름이 없습니다.')
  const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0] || 'application/octet-stream'
  const id = randomUUID()
  const path = join(UPLOAD_DIR, id)
  await mkdir(UPLOAD_DIR, { recursive: true })
  let size = 0
  req.on('data', (chunk: Buffer) => {
    size += chunk.length
  })
  try {
    await pipeline(req, createWriteStream(path))
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error instanceof HttpError ? error : new HttpError(400, '파일을 받지 못했습니다.')
  }
  insertFile({ id, uploaderId: user.id, name, mime, size })
  sendJson(res, 201, { id, name, mime, size })
}

async function handleFile(
  req: IncomingMessage,
  res: ServerResponse,
  user: PublicUser,
  id: string,
  download: boolean,
  size: string | null,
  saveAs: string | null = null,
) {
  const file = findFile(id)
  // 어디에도 붙지 않은 파일은 올린 사람만 볼 수 있다. 프로필 사진은 로그인한 누구나 볼 수 있다.
  // 디자인 툴 히스토리 이미지(kind 'tool')는 디자인팀 누구나 본다
  const toolFile = file?.kind === 'tool' && canSeeToolFile(user)
  // 디자인팀 자료실 파일(kind 'library')은 디자인팀·관리자가 본다
  const libraryFile = (file?.kind === 'library' && canUseLibrary(user)) || (file?.kind === 'notice' && canSeeNoticeFile(user)) || (file?.kind === 'share' && canSeeShareFile(user))
  if (!file || (file.request_id === null && file.kind !== 'avatar' && !toolFile && !libraryFile && file.uploader_id !== user.id)) {
    throw new HttpError(404, '파일을 찾을 수 없습니다.')
  }
  // 화면용 줄인 이미지(썸네일·크게 보기). 내려받기는 늘 원본
  if (!download && size && isImageSize(size) && RESIZABLE.has(file.mime)) {
    const resized = await resizedImage(file.id, size)
    // 너무 길어 줄이지 못한 이미지는 아래에서 원본을 보낸다
    if (resized) {
      res.writeHead(200, {
        'Content-Type': resized.type,
        'Content-Length': resized.data.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(resized.data)
      return
    }
  }
  // 저장 이름: 화면이 정한 이름(예: 디자인 툴 결과 "제목_r.jpg")이 있으면 그것, 없으면 올린 이름
  const name = saveAs?.replace(/[\\/\0\r\n]/g, '_').trim().slice(0, 200) || file.name
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`
  const headers = {
    'Content-Type': file.mime,
    'Content-Disposition': disposition,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  }
  // 이어받기(Range: bytes=시작-끝): 큰 파일 다운로드가 중간에 끊겨도 브라우저가 끊긴 데부터 다시 받는다
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : file.size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : file.size - 1
    start = Math.max(0, start)
    end = Math.min(end, file.size - 1)
    if (start > end || start >= file.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${file.size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${file.size}` })
    await pipeline(createReadStream(join(UPLOAD_DIR, file.id), { start, end }), res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': file.size })
  await pipeline(createReadStream(join(UPLOAD_DIR, file.id)), res)
}

// 회원가입: 회사 이메일로만 가입하고, 슈퍼관리자가 승인해야 로그인할 수 있다.
async function handleSignup(req: IncomingMessage, res: ServerResponse) {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  const recent = (signups.get(ip) ?? []).filter((t) => t > Date.now() - SIGNUP_WINDOW_MS)
  if (recent.length >= SIGNUP_LIMIT) throw new HttpError(429, '가입 신청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.')

  const body = await readJson(req)
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
  if (!new RegExp(`^[a-z0-9._-]+@${COMPANY_EMAIL_DOMAIN.replace('.', '\\.')}$`).test(id) || id.length > 60) {
    throw new HttpError(400, `회사 이메일(@${COMPANY_EMAIL_DOMAIN})을 입력해 주세요.`)
  }
  const f = userFields(body)
  if (!f.name) throw new HttpError(400, '이름을 입력해 주세요.')
  if (!f.department) throw new HttpError(400, '부서를 입력해 주세요.')
  // 가입할 때는 요청자·작업자만 고를 수 있다. 관리자 역할은 슈퍼관리자가 정한다.
  const role: Role = f.role === 'designer' ? 'designer' : 'requester'
  const password = checkPassword(body.password)
  if (findUser(id)) throw new HttpError(409, '이미 가입했거나 승인을 기다리는 이메일입니다.')

  createUser(id, { name: f.name, role, rank: f.rank ?? '', position: '', department: f.department }, { approved: false })
  await setPassword(id, password)
  signups.set(ip, [...recent, Date.now()])
  notifyLink(superadminIds(), `가입 승인 요청: ${f.name} (${f.department}, ${id})`, 'team')
  sendJson(res, 201, { ok: true })
}

function requireSuperadmin(user: PublicUser) {
  if (user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 가입을 승인할 수 있습니다.')
}

function userFields(body: Record<string, unknown>) {
  const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
  const role = body.role === undefined ? undefined : ROLES.includes(body.role as Role) ? (body.role as Role) : null
  if (role === null) throw new HttpError(400, '역할이 올바르지 않습니다.')
  return {
    name: str(body.name),
    role,
    rank: str(body.rank),
    position: str(body.position),
    department: str(body.department),
  }
}

function checkPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, '비밀번호는 8자 이상으로 정해 주세요.')
  return value
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (method === 'POST' && path === '/api/login') return handleLogin(req, res)
  if (method === 'POST' && path === '/api/signup') return handleSignup(req, res)
  // 사내망 직통 주소(lan.ts). 화면이 이 주소의 /api/lan 에 닿으면 같은 사무실이라 보고 파일을 그쪽으로 주고받는다.
  if (method === 'GET' && path === '/api/lan') return sendJson(res, 200, { url: lanAddress(), externalUrl: lanExternalAddress() })

  if (method === 'POST' && path === '/api/logout') {
    const token = bearer(req)
    if (token) deleteSession(token)
    return sendJson(res, 200, { ok: true })
  }

  let m: RegExpMatchArray | null
  // 내려받기 표로 받는 파일(브라우저 자체 다운로드, 로그인 머리말 없음)
  if (method === 'GET' && (m = path.match(/^\/api\/files\/([0-9a-f-]{36})$/)) && url.searchParams.get('ticket')) {
    const owner = ticketUser(url.searchParams.get('ticket')!, m[1])
    return handleFile(req, res, owner, m[1], true, null, url.searchParams.get('name'))
  }

  const user = requireUser(req)
  touchSeen(user.id)

  // ── 사내망 직통 PC(IP) 등록(관리 → 사내망 직통, 슈퍼관리자, lan.ts) ──
  // 부서별 최종 컨펌자(팀 관리, 슈퍼관리자가 정함. 보기는 로그인한 누구나)
  if (path === '/api/dept-approvers') {
    if (method === 'GET') return sendJson(res, 200, listDeptApprovers())
    if (method === 'POST') return sendJson(res, 200, setDeptApprover(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/dept-approvers\/([^/]+)$/)) && method === 'DELETE') return sendJson(res, 200, deleteDeptApprover(user, decodeURIComponent(m[1])))
  if (path === '/api/lan/report' && method === 'POST') return sendJson(res, 200, await reportLan(user, await readJson(req), String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()))
  if (path === '/api/lan/misses' && method === 'GET') return sendJson(res, 200, listLanMisses(user))
  if (path === '/api/lan/ignored' && method === 'GET') return sendJson(res, 200, listLanIgnored(user))
  if ((m = path.match(/^\/api\/lan\/ignored\/([^/]+)$/))) {
    if (method === 'POST') return sendJson(res, 200, ignoreLanMiss(user, decodeURIComponent(m[1])))
    if (method === 'DELETE') return sendJson(res, 200, unignoreLanMiss(user, decodeURIComponent(m[1])))
  }
  if (path === '/api/lan/ips') {
    if (method === 'GET') return sendJson(res, 200, listLanIps(user))
    if (method === 'POST') return sendJson(res, 201, addLanIp(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/lan\/ips\/([0-9a-f-]{36})$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateLanIp(user, m[1], await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteLanIp(user, m[1]))
  }

  // ── 계정 정보(accounts.ts, 슈퍼관리자): 목록에는 비밀번호 없음, /secret 으로 하나씩
  if (path === '/api/accounts/order' && method === 'POST') return sendJson(res, 200, reorderAccounts(user, await readJson(req)))
  if (path === '/api/accounts') {
    if (method === 'GET') return sendJson(res, 200, listAccounts(user, url.searchParams.has('secrets')))
    if (method === 'POST') return sendJson(res, 201, addAccount(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/accounts\/([0-9a-f-]{36})\/secret$/)) && method === 'GET') return sendJson(res, 200, accountSecret(user, m[1]))
  if ((m = path.match(/^\/api\/accounts\/([0-9a-f-]{36})$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateAccount(user, m[1], await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteAccount(user, m[1]))
  }

  // ── FTP(ftp.ts): 서버 목록·관리(슈퍼관리자) + 폴더 보기·올리기·내려받기 ──
  if (path === '/api/ftp/servers') {
    if (method === 'GET') return sendJson(res, 200, listFtpServers(user))
    if (method === 'POST') return sendJson(res, 201, addFtpServer(user, await readJson(req)))
  }
  if (path === '/api/ftp/logs' && method === 'GET') return sendJson(res, 200, listFtpLogs(user))
  if (path === '/api/ftp/servers/test' && method === 'POST') return sendJson(res, 200, await testFtpServer(user, await readJson(req)))
  if ((m = path.match(/^\/api\/ftp\/servers\/([0-9a-f-]{36})\/password$/)) && method === 'POST') {
    return sendJson(res, 200, await changeFtpPassword(user, m[1], await readJson(req)))
  }
  if ((m = path.match(/^\/api\/ftp\/servers\/([0-9a-f-]{36})$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateFtpServer(user, m[1], await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteFtpServer(user, m[1]))
  }
  if ((m = path.match(/^\/api\/ftp\/([0-9a-f-]{36})\/(list|file|mkdir)$/))) {
    const q = url.searchParams
    if (m[2] === 'list' && method === 'GET') return sendJson(res, 200, await ftpList(user, m[1], q))
    if (m[2] === 'mkdir' && method === 'POST') return sendJson(res, 201, await ftpMkdir(user, m[1], await readJson(req)))
    if (m[2] === 'file') {
      if (method === 'GET') return ftpDownload(res, user, m[1], q)
      if (method === 'PUT') return sendJson(res, 201, await ftpUpload(req, user, m[1], q))
      if (method === 'DELETE') return sendJson(res, 200, await ftpDelete(user, m[1], q))
    }
  }

  // ── 서버 드라이브 남은 용량(슈퍼관리자 계정만). 다른 계정은 null ──
  if (path === '/api/disk' && method === 'GET') {
    if (user.role !== 'superadmin') return sendJson(res, 200, null)
    const s = await statfs(DISK_PATH)
    return sendJson(res, 200, { drive: DISK_PATH.slice(0, 2), total: s.blocks * s.bsize, free: s.bavail * s.bsize })
  }

  // ── 조직도. 접속 중 표시는 ONLINE_VIEWERS 에게만 ──
  if (path === '/api/org' && method === 'GET') {
    const canSeeOnline = ONLINE_VIEWERS.includes(user.id)
    return sendJson(res, 200, { canSeeOnline, members: orgMembers(canSeeOnline) })
  }

  // ── 계정 전환(SWITCH_ACCOUNTS 묶음끼리만) ──
  if (path === '/api/switch') {
    if (!SWITCH_ACCOUNTS.includes(user.id)) throw new HttpError(403, '계정 전환을 쓸 수 없는 계정입니다.')
    const accounts = listUsers().filter((u) => SWITCH_ACCOUNTS.includes(u.id) && u.active && u.approved && u.canLogin)
    if (method === 'GET') return sendJson(res, 200, accounts.map((u) => ({ id: u.id, name: u.name, role: u.role, avatarId: u.avatarId })))
    if (method === 'POST') {
      const body = await readJson(req)
      const target = accounts.find((u) => u.id === body.id)
      if (!target) throw new HttpError(400, '전환할 수 없는 계정입니다.')
      return sendJson(res, 200, { token: createSession(target.id), user: target })
    }
  }

  // ── 내 정보 ──
  if (path === '/api/me') {
    if (method === 'GET') return sendJson(res, 200, { user })
    if (method === 'PATCH') {
      const body = await readJson(req)
      if (body.avatarId !== undefined) {
        const result = setAvatar(user.id, typeof body.avatarId === 'string' ? body.avatarId : null)
        if ('error' in result) throw new HttpError(400, result.error as string)
        if (result.removed) await unlink(join(UPLOAD_DIR, result.removed)).catch(() => {})
      }
      if (body.presence !== undefined) {
        if (!PRESENCES.includes(body.presence as never)) throw new HttpError(400, '상태 값이 올바르지 않습니다.')
        updateUser(user.id, { presence: body.presence as string })
      }
      if (body.newPassword !== undefined) {
        const ok = await verifyUser(user.id, typeof body.currentPassword === 'string' ? body.currentPassword : '')
        if (!ok) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다.')
        await setPassword(user.id, checkPassword(body.newPassword))
        return sendJson(res, 200, { user: findUser(user.id), token: createSession(user.id) })
      }
      return sendJson(res, 200, { user: findUser(user.id) })
    }
  }

  // ── 팀원 현재 상태(퇴근·회의 중 등) 바꾸기: 관리자가 한 명 또는 여러 명을 한 번에 ──
  if (path === '/api/presence' && method === 'POST') {
    requireManager(user)
    const body = await readJson(req)
    if (!PRESENCES.includes(body.presence as never)) throw new HttpError(400, '상태 값이 올바르지 않습니다.')
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
    if (ids.length === 0) throw new HttpError(400, '상태를 바꿀 사람을 골라 주세요.')
    for (const id of ids) {
      const target = findUser(id)
      if (!target || !target.active || !target.approved) throw new HttpError(404, '없는 계정이 있습니다.')
      updateUser(id, { presence: body.presence as string })
    }
    return sendJson(res, 200, { ok: true, count: ids.length })
  }

  // ── 사용자(팀 관리) ──
  if (path === '/api/users') {
    if (method === 'GET') {
      // 승인 전 계정은 슈퍼관리자에게만 보인다. 관리자가 아니면 비활성 계정과 로그인 가능 여부도 감춘다.
      const users = listUsers().filter((u) => u.approved || user.role === 'superadmin')
      return sendJson(res, 200, isManager(user) ? users : users.filter((u) => u.active).map((u) => ({ ...u, canLogin: false })))
    }
    if (method === 'POST') {
      requireManager(user)
      const body = await readJson(req)
      const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : ''
      if (!/^[a-z0-9._@-]{2,60}$/.test(id)) throw new HttpError(400, '아이디는 영문 소문자·숫자·.-_@ 로 2~60자입니다.')
      if (id.includes('@') && !id.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
        throw new HttpError(400, `이메일 아이디는 @${COMPANY_EMAIL_DOMAIN} 만 쓸 수 있습니다.`)
      }
      if (findUser(id)) throw new HttpError(409, '이미 있는 아이디입니다.')
      const f = userFields(body)
      if (!f.name || !f.role) throw new HttpError(400, '이름과 역할을 입력해 주세요.')
      if (f.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 슈퍼관리자를 만들 수 있습니다.')
      createUser(id, { name: f.name, role: f.role, rank: f.rank ?? '', position: f.position ?? '', department: f.department ?? '' })
      if (body.password) await setPassword(id, checkPassword(body.password))
      return sendJson(res, 201, { user: findUser(id) })
    }
  }
  if ((m = path.match(/^\/api\/users\/([^/]+)\/(approve|reject)$/)) && method === 'POST') {
    requireSuperadmin(user)
    const target = findUser(decodeURIComponent(m[1]))
    if (!target || target.approved) throw new HttpError(404, '승인을 기다리는 가입 신청이 없습니다.')
    if (m[2] === 'reject') {
      deletePendingUser(target.id)
      return sendJson(res, 200, { ok: true })
    }
    const body = await readJson(req)
    const role = ROLES.includes(body.role as Role) ? (body.role as Role) : target.role
    approveUser(target.id, role)
    return sendJson(res, 200, { user: findUser(target.id) })
  }
  if ((m = path.match(/^\/api\/users\/([^/]+)$/)) && method === 'PATCH') {
    requireManager(user)
    const target = findUser(decodeURIComponent(m[1]))
    if (!target) throw new HttpError(404, '계정을 찾을 수 없습니다.')
    if (target.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자 계정은 바꿀 수 없습니다.')
    const body = await readJson(req)
    const f = userFields(body)
    if (f.role === 'superadmin' && user.role !== 'superadmin') throw new HttpError(403, '슈퍼관리자만 슈퍼관리자를 지정할 수 있습니다.')
    if (target.id === user.id && (body.active === false || (f.role && f.role !== user.role))) {
      throw new HttpError(400, '내 계정의 역할이나 사용 여부는 바꿀 수 없습니다.')
    }
    updateUser(target.id, {
      ...f,
      role: f.role ?? undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      show_on_home: typeof body.showOnHome === 'boolean' ? body.showOnHome : undefined,
    })
    if (body.password) await setPassword(target.id, checkPassword(body.password))
    return sendJson(res, 200, { user: findUser(target.id) })
  }

  // ── 요청 ──
  if (path === '/api/requests') {
    if (method === 'GET') return sendJson(res, 200, listRequests())
    if (method === 'POST') {
      const body = await readJson(req)
      const id = createRequest(user, body)
      // 임시저장한 요청서로 보냈으면 임시저장은 지운다(파일은 요청에 붙었다)
      if (body.clearDraft === true) deleteRequestDraft(user)
      return sendJson(res, 201, { id })
    }
  }
  // 요청서 임시저장(request-drafts.ts): 한 사람당 하나
  if (path === '/api/request-draft') {
    if (method === 'GET') return sendJson(res, 200, getRequestDraft(user))
    if (method === 'PUT') return sendJson(res, 200, saveRequestDraft(user, await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteRequestDraft(user, url.searchParams.get('files') === '1'))
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'GET') return sendJson(res, 200, requestDetail(user, id))
    if (method === 'PATCH') {
      updateRequest(user, id, await readJson(req))
      return sendJson(res, 200, requestDetail(user, id))
    }
    if (method === 'DELETE') {
      const fileIds = deleteRequest(user, id)
      await Promise.all(fileIds.map((f) => unlink(join(UPLOAD_DIR, f)).catch(() => {})))
      return sendJson(res, 200, { ok: true })
    }
  }
  // 개별 컨펌: 작업자별 상태 바꾸기(관리자)
  if ((m = path.match(/^\/api\/requests\/(\d+)\/part-status$/)) && method === 'POST') {
    const id = Number(m[1])
    setPartStatus(user, id, await readJson(req))
    return sendJson(res, 200, requestDetail(user, id))
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)\/actions\/([a-z-]+)$/)) && method === 'POST') {
    const id = Number(m[1])
    performAction(user, id, m[2] as Action, await readJson(req))
    return sendJson(res, 200, requestDetail(user, id))
  }
  if ((m = path.match(/^\/api\/requests\/(\d+)\/comments$/)) && method === 'POST') {
    const id = Number(m[1])
    addComment(user, id, null, await readJson(req))
    return sendJson(res, 201, requestDetail(user, id))
  }
  if (path === '/api/archive' && method === 'GET') return sendJson(res, 200, archive())

  // ── 파일·핀 ──
  if (path === '/api/uploads' && method === 'POST') return handleUpload(req, res, user)
  if (path === '/api/uploads/chunked' && method === 'POST') return sendJson(res, 201, await startChunked(user, await readJson(req)))
  if ((m = path.match(/^\/api\/uploads\/chunked\/([0-9a-f-]{36})$/)) && method === 'PUT') {
    return sendJson(res, 200, await putChunk(req, user, m[1], Number(url.searchParams.get('offset'))))
  }
  if ((m = path.match(/^\/api\/uploads\/chunked\/([0-9a-f-]{36})\/finish$/)) && method === 'POST') {
    return sendJson(res, 201, await finishChunked(user, m[1]))
  }
  if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})$/)) && method === 'GET') {
    return handleFile(req, res, user, m[1], url.searchParams.has('download'), url.searchParams.get('size'))
  }
  if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})\/ticket$/)) && method === 'POST') {
    return sendJson(res, 200, { ticket: issueTicket(req, m[1]) })
  }
  if ((m = path.match(/^\/api\/files\/([0-9a-f-]{36})\/pins$/)) && method === 'POST') {
    const pinId = addPin(user, m[1], await readJson(req))
    return sendJson(res, 201, { id: pinId })
  }
  if ((m = path.match(/^\/api\/pins\/(\d+)\/comments$/)) && method === 'POST') {
    addPinComment(user, Number(m[1]), await readJson(req))
    return sendJson(res, 201, { ok: true })
  }
  // 핀 댓글 고치기·지우기(쓴 사람·슈퍼관리자). 핀의 첫 글을 지우면 핀째로 지운다
  if ((m = path.match(/^\/api\/comments\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateComment(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteComment(user, Number(m[1])))
  }
  if ((m = path.match(/^\/api\/pins\/(\d+)\/resolve$/)) && method === 'POST') {
    const body = await readJson(req)
    resolvePin(user, Number(m[1]), body.resolved !== false)
    return sendJson(res, 200, { ok: true })
  }

  // ── 공지사항 ──
  if (path === '/api/notices') {
    if (method === 'GET') return sendJson(res, 200, listNotices(user))
    if (method === 'POST') return sendJson(res, 201, await createNotice(user, await readJson(req, 2 * 1024 * 1024)))
  }
  if ((m = path.match(NOTICE_PATH))) {
    const id = Number(m[1])
    if (method === 'GET') return sendJson(res, 200, noticeDetail(user, id))
    if (method === 'PATCH') return sendJson(res, 200, await updateNotice(user, id, await readJson(req, 2 * 1024 * 1024)))
    if (method === 'DELETE') return sendJson(res, 200, await deleteNotice(user, id))
  }

  // ── 디자인팀 자료실 ──
  if (path === '/api/library') {
    if (method === 'GET') return sendJson(res, 200, listLibrary(user))
    if (method === 'POST') return sendJson(res, 201, addLibraryItems(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/library\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateLibraryItem(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, await deleteLibraryItem(user, Number(m[1])))
  }

  // ── 파일공유자료실 ──
  if (path === '/api/share') {
    if (method === 'GET') return sendJson(res, 200, listShare(user))
    if (method === 'POST') return sendJson(res, 201, createSharePost(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/share\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, await updateSharePost(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, await deleteSharePost(user, Number(m[1])))
  }

  // ── 건의게시판 ──
  if (path === '/api/suggestions') {
    if (method === 'GET') return sendJson(res, 200, listSuggestions())
    if (method === 'POST') return sendJson(res, 201, createSuggestion(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/suggestions\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'PATCH') return sendJson(res, 200, answerSuggestion(user, id, await readJson(req)))
    if (method === 'DELETE') {
      deleteSuggestion(user, id)
      return sendJson(res, 200, { ok: true })
    }
  }

  // ── 디자인 툴 > 수매확인서: PDF 를 받아 첫 장 이미지·강조 위치를 돌려준다(디자인팀·관리자) ──
  if (path === '/api/tools/purchase-cert' && method === 'POST') {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 30 * 1024 * 1024) throw new HttpError(413, 'PDF 는 30MB 까지 올릴 수 있습니다.')
      chunks.push(chunk as Buffer)
    }
    return sendJson(res, 200, await analyzePurchaseCert(Buffer.concat(chunks)))
  }

  // ── 디자인 툴 > 상세페이지: 섹션 HTML 을 Edge 로 찍어 860 폭 JPG 로 돌려준다(detail-render.ts). 그림이 data: 로 들어 있어 크다 ──
  if (path === '/api/tools/detail-render' && method === 'POST') {
    return sendJson(res, 200, await renderDetail(await readJson(req, 150 * 1024 * 1024)))
  }
  // 상세페이지 임시 저장(detail-drafts.ts)
  if (path === '/api/tools/detail-drafts') {
    if (method === 'GET') return sendJson(res, 200, listDetailDrafts(user))
    if (method === 'POST') return sendJson(res, 201, addDetailDraft(user, await readJson(req, 4 * 1024 * 1024)))
  }
  if ((m = path.match(/^\/api\/tools\/detail-drafts\/([0-9a-f-]{36})$/))) {
    if (method === 'GET') return sendJson(res, 200, getDetailDraft(user, m[1]))
    if (method === 'PUT') return sendJson(res, 200, await updateDetailDraft(user, m[1], await readJson(req, 4 * 1024 * 1024)))
    if (method === 'DELETE') return sendJson(res, 200, await deleteDetailDraft(user, m[1]))
  }

  // ── 디자인 툴 히스토리(만든 이미지 남기기·찾기·지우기) ──
  if ((m = path.match(/^\/api\/tools\/([a-z-]+)\/history$/))) {
    if (method === 'GET') return sendJson(res, 200, listToolHistory(user, m[1], url.searchParams.get('q') ?? ''))
    if (method === 'POST') return sendJson(res, 201, await addToolHistory(user, m[1], await readJson(req, 30 * 1024 * 1024)))
  }
  if ((m = path.match(/^\/api\/tools\/history\/(\d+)$/)) && method === 'DELETE') {
    return sendJson(res, 200, deleteToolHistory(user, Number(m[1])))
  }

  // ── 공휴일(달력 표시용). ?year=2026 ──
  if (path === '/api/holidays' && method === 'GET') {
    return sendJson(res, 200, await holidays(Number(url.searchParams.get('year'))))
  }

  // ── 디자인팀 예정일정(팀 엑셀 '2026_일정' 시트). 보기: 누구나 · 엑셀 올리기: 관리자 ──
  if (path === '/api/schedule-plans') {
    if (method === 'GET') return sendJson(res, 200, await schedulePlans())
    if (method === 'POST') {
      requireManager(user)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > 30 * 1024 * 1024) throw new HttpError(413, '엑셀은 30MB 까지 올릴 수 있습니다.')
        chunks.push(chunk as Buffer)
      }
      return sendJson(res, 200, await importSchedulePlans(Buffer.concat(chunks), (url.searchParams.get('name') ?? '').slice(0, 100)))
    }
  }

  if (path === '/api/schedule-plans/owners' && method === 'PUT') return sendJson(res, 200, await saveOwners(user, await readJson(req)))
  if (path === '/api/schedule-plans/lines' && method === 'POST') return sendJson(res, 201, await addPlanLine(user, await readJson(req)))
  if ((m = path.match(/^\/api\/schedule-plans\/lines\/(\d{4}-\d{2}-\d{2})\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, await updatePlanLine(user, m[1], Number(m[2]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, await deletePlanLine(user, m[1], Number(m[2])))
  }

  // ── 구글 색인 보고서(index-reports.ts): 슈퍼관리자만 ──
  if (path === '/api/index-reports') {
    if (method === 'GET') return sendJson(res, 200, listIndexReports(user))
    if (method === 'POST') return sendJson(res, 201, saveIndexReport(user, await readJson(req, 40_000_000)))
  }
  if ((m = path.match(/^\/api\/index-reports\/(\d+)(\/pdf)?$/))) {
    const id = Number(m[1])
    if (m[2] && method === 'GET') {
      const pdf = indexReportPdf(user, id)
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.data.length,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pdf.name)}`,
        'Cache-Control': 'private, no-store',
      })
      return res.end(pdf.data)
    }
    if (!m[2] && method === 'GET') return sendJson(res, 200, getIndexReport(user, id))
    if (!m[2] && method === 'DELETE') return sendJson(res, 200, deleteIndexReport(user, id))
  }

  // ── 메모(memos.ts): 계정마다 내 것만 ──
  if (path === '/api/memos') {
    if (method === 'GET') return sendJson(res, 200, listMemos(user))
    if (method === 'POST') return sendJson(res, 201, createMemo(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/memos\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateMemo(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteMemo(user, Number(m[1])))
  }

  // ── 체크리스트(checklists.ts): 계정마다 내 것만 ──
  if (path === '/api/checklists') {
    if (method === 'GET') return sendJson(res, 200, listChecklists(user))
    if (method === 'POST') return sendJson(res, 201, createChecklist(user, await readJson(req)))
  }
  if (path === '/api/checklists/order' && method === 'POST') return sendJson(res, 200, reorderChecklists(user, await readJson(req)))
  if ((m = path.match(/^\/api\/checklists\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateChecklist(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteChecklist(user, Number(m[1])))
  }
  if ((m = path.match(/^\/api\/checklists\/(\d+)\/(items|order|reset|clear-done)$/)) && method === 'POST') {
    const id = Number(m[1])
    if (m[2] === 'items') return sendJson(res, 201, addChecklistItem(user, id, await readJson(req)))
    if (m[2] === 'order') return sendJson(res, 200, reorderChecklistItems(user, id, await readJson(req)))
    if (m[2] === 'reset') return sendJson(res, 200, resetChecklist(user, id))
    return sendJson(res, 200, clearDoneChecklist(user, id))
  }
  if ((m = path.match(/^\/api\/checklist-items\/(\d+)$/))) {
    if (method === 'PATCH') return sendJson(res, 200, updateChecklistItem(user, Number(m[1]), await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteChecklistItem(user, Number(m[1])))
  }

  // ── 업무일지(내 진행 기록 + 날마다 메모) ──
  if (path === '/api/worklog/team' && method === 'GET') {
    return sendJson(res, 200, teamWorklog(user, url.searchParams.get('from'), url.searchParams.get('to')))
  }
  if (path === '/api/worklog' && method === 'GET') {
    return sendJson(res, 200, worklog(user, url.searchParams.get('from'), url.searchParams.get('to')))
  }
  if (path === '/api/worklog/entries' && method === 'POST') {
    return sendJson(res, 201, createWorklogEntry(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/worklog\/entries\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'PATCH') return sendJson(res, 200, updateWorklogEntry(user, id, await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteWorklogEntry(user, id))
  }

  // ── 업데이트 예정 기능(건의게시판 오른쪽) ──
  if (path === '/api/roadmap') {
    if (method === 'GET') return sendJson(res, 200, listRoadmap(user))
    if (method === 'POST') return sendJson(res, 201, createRoadmap(user, await readJson(req)))
  }
  if ((m = path.match(/^\/api\/roadmap\/(\d+)$/))) {
    const id = Number(m[1])
    if (method === 'PATCH') return sendJson(res, 200, updateRoadmap(user, id, await readJson(req)))
    if (method === 'DELETE') return sendJson(res, 200, deleteRoadmap(user, id))
  }

  // ── 알림 ──
  if (path === '/api/notifications' && method === 'GET') return sendJson(res, 200, listNotifications(user.id))
  if (path === '/api/notifications/read' && method === 'POST') {
    markNotificationsRead(user.id)
    return sendJson(res, 200, { ok: true })
  }

  sendJson(res, 404, { error: '찾을 수 없습니다.' })
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  const filePath = normalize(join(WEB_DIR, urlPath))
  if (!filePath.startsWith(normalize(WEB_DIR + sep)) && filePath !== normalize(WEB_DIR)) {
    return sendJson(res, 404, { error: '찾을 수 없습니다.' })
  }

  let target = filePath
  try {
    if ((await stat(target)).isDirectory()) target = join(target, 'index.html')
  } catch {
    // 화면 주소는 모두 index.html 로 보낸다.
    target = join(WEB_DIR, 'index.html')
  }

  try {
    const [data, info] = await Promise.all([readFile(target), stat(target)])
    const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream'
    const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
    // 글자 파일(JS·CSS·HTML 등)은 압축해서 보낸다
    const encoding = isCompressible(type) ? pickEncoding(req) : null
    const body = compressStatic(target, info.mtimeMs, data, encoding)
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cache,
      'Content-Length': body.length,
      ...(encoding ? { 'Content-Encoding': encoding, Vary: 'Accept-Encoding' } : {}),
    })
    res.end(body)
  } catch {
    sendJson(res, 404, { error: '화면 파일이 없습니다. apps/web 에서 npm run deploy:server 를 실행해 주세요.' })
  }
}

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  requestOf.set(res, req)
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res)

    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    await handleApi(req, res, url)
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) sendJson(res, error.status, { error: error.message })
      return
    }
    console.error(error)
    if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했습니다.' })
  }
}
const server = createServer(handler)
// 사내망 직통(https, data/lan.json 이 있을 때만). 같은 요청 처리를 쓴다.
void startLan(handler)

// Node 는 요청 하나를 5분(requestTimeout 기본값) 안에 다 받지 못하면 끊는다.
// 바깥(Funnel)에서는 올리는 속도가 초당 수백 KB 라 수백 MB 짜리 작업 원본(FIG·PSD)이 중간에 끊겼다. 받는 시간 제한은 없앤다.
// 머리글(headersTimeout)은 그대로 두어, 머리글만 보내고 버티는 연결은 계속 끊긴다.
server.requestTimeout = 0

// 외장 하드 백업(BACKUP_DIR 이 있을 때만)
if (BACKUP_DIR) startBackupSchedule()
// 쓰지 않는 업로드 파일(끊긴 조각·기록이 지워진 원본·줄인 이미지) 정리
startStorageSweep()

server.listen(PORT, () => {
  console.log(`WSD 서버: http://localhost:${PORT} (화면 ${WEB_DIR})`)
})
