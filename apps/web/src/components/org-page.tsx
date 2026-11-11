import { useEffect, useMemo, useRef, useState } from "react"
import { Mail, MessageCircle, Phone, Search, Smartphone } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { Section } from "@/components/home/home-page"
import { OverlayScrollbar } from "@/components/overlay-scrollbar"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { PageState } from "@/components/page-state"
import { UserAvatar } from "@/components/user-avatar"
import { apiFetch } from "@/lib/api"
import { loadSession, type Role } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { PRESENCE_DOT, PRESENCE_LABEL, type Presence } from "@/lib/presence"
import { initials } from "@/lib/requests"
import { DESIGN_TEAM, useApi } from "@/lib/store"
import { cn } from "@/lib/utils"

// 조직도: 회사 조직도(하이웍스에서 가져온 부서 나무)를 본부 → 팀 → 파트 순서대로 보여 준다.
// 사이트 계정과 이름이 같은 사람은 상태(디자인팀)·접속 여부·1:1 채팅을 함께 붙인다.
// 회사 조직도가 아직 없으면 사이트 계정을 부서별로 묶어 보여 준다(예전 화면).
// 정상훈·슈퍼관리자(서버 ONLINE_VIEWERS)에게만 지금 사이트에 접속한 사람을 함께 보여 준다.

type OrgMember = {
  id: string
  name: string
  role: Role
  rank: string
  position: string
  department: string
  presence: Presence
  avatarId: string | null
  online?: boolean
  lastSeenAt?: number | null
}
type TreeMember = { id: string; name: string; position: string; job: string; rest: boolean; photo: boolean; cell?: string; phone?: string; email?: string }
type TreeNode = { id: string; name: string; parent: string | null; members: TreeMember[] }
type OrgTree = { updatedAt: number; source: string; nodes: TreeNode[] }
type OrgData = { canSeeOnline: boolean; members: OrgMember[]; tree?: OrgTree | null; canEditTree?: boolean }

const NO_TEAM = "부서 미지정"
// 직급이 높은 사람부터. 목록에 없는 직급은 맨 뒤.
const RANKS = ["대표", "부사장", "전무", "상무", "이사", "실장", "부장", "차장", "팀장", "과장", "대리", "주임", "사원", "인턴"]
const rankOrder = (rank: string) => {
  const i = RANKS.findIndex((r) => rank.replace(/\s+/g, "").startsWith(r))
  return i < 0 ? RANKS.length : i
}
const deptKey = (d: string) => d.replace(/\s+/g, "") || NO_TEAM

// 띄어쓰기만 다른 부서는 한 부서로 묶고, 이름은 가장 많이 쓴 표기. 디자인팀이 맨 앞, 나머지는 사람 많은 순.
function groupByDepartment(members: OrgMember[]) {
  const groups = new Map<string, OrgMember[]>()
  for (const m of members) groups.set(deptKey(m.department), [...(groups.get(deptKey(m.department)) ?? []), m])
  return [...groups.entries()]
    .map(([key, list]) => {
      const count = new Map<string, number>()
      for (const m of list) count.set(m.department.trim(), (count.get(m.department.trim()) ?? 0) + 1)
      const name = key === NO_TEAM ? NO_TEAM : [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return { key, name, list: [...list].sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.name.localeCompare(b.name, "ko")) }
    })
    .sort(
      (a, b) =>
        Number(b.key === DESIGN_TEAM) - Number(a.key === DESIGN_TEAM) ||
        Number(a.key === NO_TEAM) - Number(b.key === NO_TEAM) ||
        b.list.length - a.list.length ||
        a.name.localeCompare(b.name, "ko"),
    )
}

function seenText(at: number | null | undefined) {
  if (!at) return "접속 기록 없음"
  const min = Math.floor((Date.now() - at) / 60_000)
  if (min < 60) return `${Math.max(min, 1)}분 전`
  if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 조직도 사진(로그인이 필요한 서버 파일): 한 번 받은 사진은 기억해 두고 다시 쓴다
const photoCache = new Map<string, Promise<string | null>>()
function useOrgPhoto(id: string | null) {
  const [url, setUrl] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    let p = photoCache.get(id)
    if (!p) {
      p = apiFetch(`/org/photo/${encodeURIComponent(id)}`)
        .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
        .catch(() => null)
      photoCache.set(id, p)
    }
    p.then((u) => alive && setUrl({ id, url: u }))
    return () => {
      alive = false
    }
  }, [id])
  return url && url.id === id ? url.url : null
}

// 사진: 회사 조직도 사진 → 사이트 프로필 사진 → 이름 첫 글자
function PersonAvatar({ name, photoId, avatarId, className }: { name: string; photoId: string | null; avatarId: string | null; className?: string }) {
  const photo = useOrgPhoto(photoId)
  if (!photoId && avatarId) return <UserAvatar name={name} avatarId={avatarId} className={className} />
  return (
    <Avatar className={className}>
      {photo && <AvatarImage src={photo} alt={`${name} 프로필 사진`} className="object-cover" />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

function OnlineDot({ online }: { online?: boolean }) {
  return (
    <span
      className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card", online ? "bg-emerald-500" : "bg-muted-foreground/40")}
      aria-label={online ? "접속 중" : "접속 안 함"}
    />
  )
}

function ChatButton({ m }: { m: OrgMember }) {
  if (m.id === loadSession()?.id) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground" aria-label={`${m.name}에게 1:1 채팅 (준비 중)`}>
          <MessageCircle />
        </Button>
      </TooltipTrigger>
      <TooltipContent>1:1 채팅 (준비 중)</TooltipContent>
    </Tooltip>
  )
}

// 사이트 계정 상태 줄(디자인팀 상태 · 접속)
function StatusLine({ m, canSeeOnline }: { m: OrgMember; canSeeOnline: boolean }) {
  const designer = m.role === "designer" || deptKey(m.department) === DESIGN_TEAM
  if (!designer && !canSeeOnline) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {designer && (
        <>
          <span className={cn("size-1.5 rounded-full", PRESENCE_DOT[m.presence] ?? PRESENCE_DOT.off)} aria-hidden />
          <span>{PRESENCE_LABEL[m.presence] ?? PRESENCE_LABEL.off}</span>
        </>
      )}
      {canSeeOnline && (
        <span className={cn(designer && "before:mr-1.5 before:content-['·']", m.online && "text-emerald-600 dark:text-emerald-400")}>
          {m.online ? "접속 중" : seenText(m.lastSeenAt)}
        </span>
      )}
    </div>
  )
}

// 예전 화면(사이트 계정만)의 한 사람
function Person({ m, canSeeOnline, className }: { m: OrgMember; canSeeOnline: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="relative shrink-0">
        <UserAvatar name={m.name} avatarId={m.avatarId} className="size-9" />
        {canSeeOnline && <OnlineDot online={m.online} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">{m.name}</span>
          {m.rank && <span className="shrink-0 text-xs text-muted-foreground">{m.rank}</span>}
        </div>
        <StatusLine m={m} canSeeOnline={canSeeOnline} />
      </div>
      <ChatButton m={m} />
    </div>
  )
}

type Built = { node: TreeNode; children: Built[]; total: number }

// 부서 나무 만들기(검색어가 있으면 맞는 사람만 남기고, 사람이 없는 부서는 뺀다. 부서 이름이 맞으면 그 부서 사람은 모두 남긴다)
function buildTree(nodes: TreeNode[], q: string): Built | null {
  const kids = new Map<string | null, TreeNode[]>()
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  const query = q.replace(/\s+/g, "").toLowerCase()
  const hit = (s: string) => s.replace(/\s+/g, "").toLowerCase().includes(query)
  const walk = (n: TreeNode, deptHit: boolean): Built | null => {
    const inDept = deptHit || (!!query && hit(n.name))
    const members = !query || inDept ? n.members : n.members.filter((m) => hit(m.name) || hit(m.position) || hit(m.job))
    const children = (kids.get(n.id) ?? []).map((c) => walk(c, inDept)).filter((c): c is Built => !!c)
    const total = members.length + children.reduce((s, c) => s + c.total, 0)
    if (query && total === 0) return null
    return { node: { ...n, members }, children, total }
  }
  const root = kids.get(null)?.[0]
  return root ? walk(root, false) : null
}

type SiteOf = (name: string) => OrgMember | undefined

// 전화번호 보기 좋게: 01040668653 → 010-4066-8653, 0212345678 → 02-1234-5678 (모양을 모르면 그대로)
function fmtTel(v: string) {
  const d = v.replace(/[^0-9]/g, "")
  if (/^02\d{7,8}$/.test(d)) return d.replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3")
  if (/^0\d{9,10}$/.test(d)) return d.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3")
  if (/^1\d{7}$/.test(d)) return d.replace(/^(\d{4})(\d{4})$/, "$1-$2")
  return v
}

// 조직도 속 한 사람 카드(홈 디자인팀 카드처럼): 사진 · 이름 · 직급·직무 · 연락처(휴대폰·내선·메일).
// 사이트 계정이 있는 디자인팀은 작업 상태, 접속을 볼 수 있으면 접속 점도. lead = 대표·본부장(조금 크게, 테두리 강조)
function PersonBox({ p, site, canSeeOnline, lead }: { p: TreeMember; site?: OrgMember; canSeeOnline: boolean; lead?: boolean }) {
  const designer = site && (site.role === "designer" || deptKey(site.department) === DESIGN_TEAM)
  const sub = [p.position, p.job].filter(Boolean).join(" · ")
  const contacts = [
    p.cell && { icon: Smartphone, text: fmtTel(p.cell), href: `tel:${p.cell.replace(/[^0-9+]/g, "")}`, label: "휴대폰" },
    p.phone && { icon: Phone, text: fmtTel(p.phone), href: `tel:${p.phone.replace(/[^0-9+]/g, "")}`, label: "회사 전화" },
    p.email && { icon: Mail, text: p.email, href: `mailto:${p.email}`, label: "메일" },
  ].filter(Boolean) as { icon: typeof Phone; text: string; href: string; label: string }[]
  return (
    <div className={cn("relative flex w-52 flex-col items-center rounded-xl border bg-card px-3 pt-4 pb-3 text-center shadow-xs", lead && "w-56 border-primary/60")}>
      {designer && site && (
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full border bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", PRESENCE_DOT[site.presence] ?? PRESENCE_DOT.off)} aria-hidden />
          {PRESENCE_LABEL[site.presence] ?? PRESENCE_LABEL.off}
        </span>
      )}
      {site && (
        <span className="absolute top-1 right-1">
          <ChatButton m={site} />
        </span>
      )}
      <span className="relative">
        <PersonAvatar name={p.name} photoId={p.photo ? p.id : null} avatarId={site?.avatarId ?? null} className={lead ? "size-16" : "size-14"} />
        {canSeeOnline && site && <OnlineDot online={site.online} />}
      </span>
      <div className="mt-2 flex items-center gap-1">
        <span className={cn("font-semibold", lead ? "text-base" : "text-sm")}>{p.name}</span>
        {p.rest && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            휴직
          </Badge>
        )}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {contacts.length > 0 && (
        <div className="mt-2.5 flex w-full flex-col gap-1 border-t pt-2.5">
          {contacts.map((c) => (
            <a
                key={c.label}
                href={c.href}
                className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`${p.name} ${c.label} ${c.text}`}
              >
                <c.icon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate tabular-nums">{c.text}</span>
              </a>
          ))}
        </div>
      )}
    </div>
  )
}

// 부서 이름 상자(팀·파트 머리)
function DeptLabel({ name, count, strong, onClick }: { name: string; count: number; strong?: boolean; onClick?: () => void }) {
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm whitespace-nowrap",
    strong ? "border-primary/50 bg-primary/10 font-semibold" : "bg-muted font-medium",
    onClick && "cursor-pointer transition-colors hover:border-primary hover:bg-primary/15",
  )
  const body = (
    <>
      {name}
      <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}명</span>
    </>
  )
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  )
}

// 한 줄(열) 안에 사람들을 위에서 아래로. 그 아래 파트(구내식당 등)는 작은 제목 + 사람
function MemberStack({ b, siteOf, canSeeOnline }: { b: Built; siteOf: SiteOf; canSeeOnline: boolean }) {
  const parts: Built[] = []
  const collect = (x: Built) => x.children.forEach((c) => (parts.push(c), collect(c)))
  collect(b)
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      {b.node.members.map((p) => (
        <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
      ))}
      {parts.map((c) => (
        <div key={c.node.id} className="mt-2 flex flex-col items-center gap-2">
          <DeptLabel name={c.node.name} count={c.node.members.length} />
          {c.node.members.map((p) => (
            <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
          ))}
        </div>
      ))}
    </div>
  )
}

// 가로로 넓으면 옆으로 넘겨 본다(부드러운 스크롤 + 아래 스크롤 막대)
function ChartScroll({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  // 처음에는 가운데(맨 위 상자)가 보이게
  useEffect(() => {
    const el = box.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const id = requestAnimationFrame(() => el.scrollTo({ left: Math.max(0, (el.scrollWidth - el.clientWidth) / 2), behavior: "instant" as ScrollBehavior }))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div ref={box} className="relative">
      <SmoothScrollArea orientation="horizontal" className="overflow-x-auto pb-4" contentClassName="org-tree mx-auto w-max min-w-full py-2">
        {children}
      </SmoothScrollArea>
      <OverlayScrollbar always orientation="horizontal" target={() => box.current?.firstElementChild as HTMLElement | null} className="absolute right-1 bottom-0.5 left-1 h-1.5" />
    </div>
  )
}

// 전체보기: 대표 → 본부·사업부(본부장) → 그 아래 팀 이름. 본부·팀을 누르면 그 탭으로
function OverviewChart({ root, siteOf, canSeeOnline, onOpen }: { root: Built; siteOf: SiteOf; canSeeOnline: boolean; onOpen: (id: string) => void }) {
  return (
    <ChartScroll>
      <ul>
        <li>
          <div className="flex flex-col items-center gap-2">
            <DeptLabel name={root.node.name} count={root.total} strong />
            <div className="flex flex-wrap justify-center gap-3">
              {root.node.members.map((p) => (
                <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} lead />
              ))}
            </div>
          </div>
          <ul>
            {root.children.map((d) => (
              <li key={d.node.id}>
                <div className="flex flex-col items-center gap-2">
                  <DeptLabel name={d.node.name} count={d.total} strong onClick={() => onOpen(d.node.id)} />
                  {d.node.members.slice(0, d.children.length ? 2 : 0).map((p) => (
                    <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
                  ))}
                  <div className="mt-1 flex flex-col items-center gap-1.5">
                    {(d.children.length === 1 && d.children[0].children.length ? d.children[0].children : d.children).map((t) => (
                      <DeptLabel key={t.node.id} name={t.node.name} count={t.total} onClick={() => onOpen(d.node.id)} />
                    ))}
                    {d.children.length === 0 && <span className="text-xs text-muted-foreground">{d.node.members.length}명</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </ChartScroll>
  )
}

// 본부·사업부 탭: 본부장 → 팀(열) → 팀원. 팀이 하나뿐이고 그 아래 파트가 있으면(F4·F3) 그 팀을 가운데 두고 파트를 열로
function DivisionChart({ d, siteOf, canSeeOnline }: { d: Built; siteOf: SiteOf; canSeeOnline: boolean }) {
  const only = d.children.length === 1 && d.children[0].children.length > 0 ? d.children[0] : null
  const columns = only ? only.children : d.children
  const column = (t: Built) => (
    <li key={t.node.id}>
      <DeptLabel name={t.node.name} count={t.total} strong={deptKey(t.node.name) === DESIGN_TEAM} />
      <MemberStack b={t} siteOf={siteOf} canSeeOnline={canSeeOnline} />
    </li>
  )
  return (
    <ChartScroll>
      <ul>
        <li>
          <div className="flex flex-col items-center gap-2">
            <DeptLabel name={d.node.name} count={d.total} strong />
            {d.node.members.length > 0 && d.children.length > 0 && (
              <div className="flex flex-wrap justify-center gap-3">
                {d.node.members.map((p) => (
                  <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} lead />
                ))}
              </div>
            )}
          </div>
          {d.children.length === 0 ? (
            // 아래 팀이 없는 부서(본부): 사람을 여러 줄로
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,13rem)] justify-center gap-2">
              {d.node.members.map((p) => (
                <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
              ))}
            </div>
          ) : only ? (
            <ul>
              <li>
                <DeptLabel name={only.node.name} count={only.total} />
                {only.node.members.length > 0 && (
                  <div className="mt-3 grid grid-cols-[repeat(auto-fit,13rem)] justify-center gap-2" style={{ maxWidth: "calc(13rem * 4 + 1.5rem)" }}>
                    {only.node.members.map((p) => (
                      <PersonBox key={p.id} p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
                    ))}
                  </div>
                )}
                <ul>{columns.map(column)}</ul>
              </li>
            </ul>
          ) : (
            <ul>{columns.map(column)}</ul>
          )}
        </li>
      </ul>
    </ChartScroll>
  )
}

function CompanyTree({ data, tree }: { data: OrgData; tree: OrgTree }) {
  const { canSeeOnline, members } = data
  const [q, setQ] = useState("")
  const [tab, setTab] = useState("all")
  const full = useMemo(() => buildTree(tree.nodes, ""), [tree])
  const found = useMemo(() => (q.trim() ? buildTree(tree.nodes, q) : null), [tree, q])
  // 같은 이름의 사이트 계정(이름이 겹치는 계정이 둘 이상이면 붙이지 않는다)
  const siteByName = useMemo(() => {
    const m = new Map<string, OrgMember | null>()
    for (const u of members) m.set(u.name.trim(), m.has(u.name.trim()) ? null : u)
    return m
  }, [members])
  const siteOf: SiteOf = (name) => siteByName.get(name.trim()) ?? undefined
  const allNames = useMemo(() => new Set(tree.nodes.flatMap((n) => n.members.map((m) => m.name.trim()))), [tree])
  const notInTree = data.canEditTree ? members.filter((u) => !allNames.has(u.name.trim())) : []
  const totalPeople = tree.nodes.reduce((s, n) => s + n.members.length, 0)
  const updated = new Date(tree.updatedAt)
  // 찾기 결과: 사람마다 부서 경로(본부 › 팀 › 파트)
  const results = useMemo(() => {
    if (!found) return []
    const out: { p: TreeMember; path: string }[] = []
    const walk = (b: Built, path: string[]) => {
      const here = b.node.parent ? [...path, b.node.name] : path
      for (const p of b.node.members) out.push({ p, path: here.join(" › ") || b.node.name })
      b.children.forEach((c) => walk(c, here))
    }
    walk(found, [])
    return out
  }, [found])
  if (!full) return null
  const division = full.children.find((d) => d.node.id === tab)

  return (
    <>
      <Section
        title="조직도"
        aside={
          <span className="text-sm text-muted-foreground tabular-nums">
            부서 {tree.nodes.length - 1} · {totalPeople}명
          </span>
        }
        action={
          <div className="relative w-56 max-w-[60vw]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·직급·부서 찾기" className="h-8 pl-8" aria-label="조직도에서 찾기" />
          </div>
        }
      >
        <p className="-mt-1 text-xs text-muted-foreground">
          하이웍스 조직도 기준 · {updated.getFullYear()}.{updated.getMonth() + 1}.{updated.getDate()} 가져옴
        </p>
        {found !== null || q.trim() ? (
          results.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">찾는 사람이 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-3">
              {results.map(({ p, path }) => (
                <li key={p.id} className="flex flex-col items-center gap-1">
                  <span className="max-w-52 truncate text-xs text-muted-foreground">{path}</span>
                  <PersonBox p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <Tabs value={division ? tab : "all"} onValueChange={setTab} className="gap-4">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="all">전체보기</TabsTrigger>
              {full.children.map((d) => (
                <TabsTrigger key={d.node.id} value={d.node.id}>
                  {d.node.name}
                  <span className="text-xs text-muted-foreground tabular-nums">{d.total}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {division ? (
              <DivisionChart key={division.node.id} d={division} siteOf={siteOf} canSeeOnline={canSeeOnline} />
            ) : (
              <OverviewChart root={full} siteOf={siteOf} canSeeOnline={canSeeOnline} onOpen={setTab} />
            )}
          </Tabs>
        )}
      </Section>
      {notInTree.length > 0 && !q && (
        <Section title="회사 조직도에 없는 사이트 계정" aside={<span className="text-sm text-muted-foreground tabular-nums">{notInTree.length}명</span>}>
          <ul className="grid w-full grid-cols-12 gap-4 md:gap-6">
            {notInTree.map((m) => (
              <li key={m.id} className="col-span-12 rounded-xl border bg-card px-4 py-3 sm:col-span-6 xl:col-span-4 2xl:col-span-3">
                <Person m={m} canSeeOnline={canSeeOnline} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

export function OrgPage() {
  const { data, error } = useApi<OrgData>("/org", 20_000)
  if (!data) return <PageState error={error} />

  const { canSeeOnline, members } = data
  const online = members.filter((m) => m.online)

  return (
    <div className={PAGE_GRID}>
      {canSeeOnline && (
        <Section title="지금 접속 중" aside={<span className="text-sm text-muted-foreground tabular-nums">{online.length}명</span>}>
          {online.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">지금 사이트에 접속한 사람이 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {online.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1">
                  <span className="relative">
                    <UserAvatar name={m.name} avatarId={m.avatarId} className="size-7" />
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500" aria-hidden />
                  </span>
                  <span className="text-sm font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.department.trim() || NO_TEAM}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {data.tree ? <CompanyTree data={data} tree={data.tree} /> : <SiteAccountsOrg members={members} canSeeOnline={canSeeOnline} />}
    </div>
  )
}

// 회사 조직도가 없을 때: 사이트 계정을 부서별로
function SiteAccountsOrg({ members, canSeeOnline }: { members: OrgMember[]; canSeeOnline: boolean }) {
  const teams = groupByDepartment(members)
  return (
    <Section
      title="조직도"
      aside={
        <span className="text-sm text-muted-foreground tabular-nums">
          부서 {teams.length} · {members.length}명
        </span>
      }
    >
      <ul className="grid w-full grid-cols-12 gap-4 md:gap-6">
        {teams.map((t) => (
          <li key={t.key} className="col-span-12 flex flex-col rounded-xl border bg-card sm:col-span-6 xl:col-span-4 2xl:col-span-3">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <h3 className="font-semibold">{t.name}</h3>
              <span className="text-sm text-muted-foreground tabular-nums">{t.list.length}명</span>
              {canSeeOnline && t.list.some((m) => m.online) && (
                <span className="ml-auto text-xs text-emerald-600 tabular-nums dark:text-emerald-400">접속 {t.list.filter((m) => m.online).length}</span>
              )}
            </div>
            <ul className="flex flex-col divide-y">
              {t.list.map((m, i) => (
                <li key={m.id} className={cn("px-4 py-3", i === 0 && t.list.length > 1 && "bg-muted/40")}>
                  <Person m={m} canSeeOnline={canSeeOnline} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  )
}
