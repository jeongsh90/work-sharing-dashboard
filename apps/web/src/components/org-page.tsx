import { useEffect, useMemo, useState } from "react"
import { MessageCircle, Search } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { Section } from "@/components/home/home-page"
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
type TreeMember = { id: string; name: string; position: string; job: string; rest: boolean; photo: boolean }
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

// 회사 조직도의 한 사람: 사진 · 이름 · 직급 · 직무(+ 사이트 계정이면 상태·접속·채팅)
function TreePerson({ p, site, canSeeOnline, size = "md" }: { p: TreeMember; site?: OrgMember; canSeeOnline: boolean; size?: "md" | "lg" }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="relative shrink-0">
        <PersonAvatar name={p.name} photoId={p.photo ? p.id : null} avatarId={site?.avatarId ?? null} className={size === "lg" ? "size-11" : "size-9"} />
        {canSeeOnline && site && <OnlineDot online={site.online} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate font-medium">{p.name}</span>
          {p.position && <span className="shrink-0 text-xs text-muted-foreground">{p.position}</span>}
          {p.rest && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              휴직
            </Badge>
          )}
        </div>
        {site ? <StatusLine m={site} canSeeOnline={canSeeOnline} /> : p.job ? <div className="truncate text-xs text-muted-foreground">{p.job}</div> : null}
      </div>
      {site && <ChatButton m={site} />}
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

// 본부 안에 보일 카드: 팀마다 한 장. 팀이 하나뿐이고(F4·F3) 그 아래 파트가 있으면 파트마다 한 장씩 나눈다(한 카드가 너무 길어지지 않게)
function cardsOf(d: Built): Built[] {
  if (d.children.length === 0) return [d]
  if (d.children.length === 1 && d.children[0].children.length > 0) {
    const only = d.children[0]
    const own = only.node.members.length ? [{ node: only.node, children: [], total: only.node.members.length }] : []
    return [...own, ...only.children]
  }
  return d.children
}

// 팀 카드: 팀 사람 + 아래 파트(구내식당·전처리 …)는 카드 안에 작은 제목으로
function TeamCard({ t, siteOf, canSeeOnline }: { t: Built; siteOf: (name: string) => OrgMember | undefined; canSeeOnline: boolean }) {
  const parts: { b: Built; depth: number }[] = []
  const collect = (b: Built, depth: number) => {
    for (const c of b.children) {
      parts.push({ b: c, depth })
      collect(c, depth + 1)
    }
  }
  collect(t, 0)
  const design = deptKey(t.node.name) === DESIGN_TEAM
  return (
    <li className={cn("col-span-12 flex flex-col rounded-xl border bg-card sm:col-span-6 xl:col-span-4 2xl:col-span-3", design && "border-primary/50")}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h4 className="font-semibold">{t.node.name}</h4>
        <span className="text-sm text-muted-foreground tabular-nums">{t.total}명</span>
      </div>
      {t.node.members.length > 0 && (
        <ul className="flex flex-col divide-y">
          {t.node.members.map((p, i) => (
            <li key={p.id} className={cn("px-4 py-3", i === 0 && t.node.members.length > 1 && "bg-muted/40")}>
              <TreePerson p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
            </li>
          ))}
        </ul>
      )}
      {parts.map(({ b, depth }) => (
        <div key={b.node.id} className="border-t">
          <div className="flex items-center gap-1.5 bg-muted/30 px-4 py-1.5 text-xs font-semibold text-muted-foreground" style={{ paddingLeft: 16 + depth * 12 }}>
            {b.node.name}
            <span className="font-normal tabular-nums">{b.node.members.length}명</span>
          </div>
          {b.node.members.length > 0 && (
            <ul className="flex flex-col divide-y">
              {b.node.members.map((p) => (
                <li key={p.id} className="px-4 py-2.5" style={{ paddingLeft: 16 + depth * 12 }}>
                  <TreePerson p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </li>
  )
}

function CompanyTree({ data, tree }: { data: OrgData; tree: OrgTree }) {
  const { canSeeOnline, members } = data
  const [q, setQ] = useState("")
  const built = useMemo(() => buildTree(tree.nodes, q), [tree, q])
  // 같은 이름의 사이트 계정(이름이 겹치는 계정이 둘 이상이면 붙이지 않는다)
  const siteByName = useMemo(() => {
    const m = new Map<string, OrgMember | null>()
    for (const u of members) m.set(u.name.trim(), m.has(u.name.trim()) ? null : u)
    return m
  }, [members])
  const siteOf = (name: string) => siteByName.get(name.trim()) ?? undefined
  const allNames = useMemo(() => new Set(tree.nodes.flatMap((n) => n.members.map((m) => m.name.trim()))), [tree])
  const notInTree = data.canEditTree ? members.filter((u) => !allNames.has(u.name.trim())) : []
  const totalPeople = tree.nodes.reduce((s, n) => s + n.members.length, 0)
  const updated = new Date(tree.updatedAt)

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
        {!built ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">찾는 사람이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-8">
            {/* 대표 */}
            {built.node.members.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <h3 className="text-sm font-semibold text-muted-foreground">{built.node.name}</h3>
                <ul className="flex flex-wrap justify-center gap-3">
                  {built.node.members.map((p) => (
                    <li key={p.id} className="w-64 rounded-xl border bg-card px-4 py-3">
                      <TreePerson p={p} site={siteOf(p.name)} canSeeOnline={canSeeOnline} size="lg" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 본부·사업부마다: 맡은 사람 + 팀 카드 */}
            {built.children.map((d) => (
              <section key={d.node.id} className="flex flex-col gap-3" aria-label={d.node.name}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-base font-semibold">{d.node.name}</h3>
                    <span className="text-sm text-muted-foreground tabular-nums">{d.total}명</span>
                  </div>
                  {d.children.length > 0 &&
                    d.node.members.map((p) => (
                      <div key={p.id} className="min-w-0 rounded-full border bg-card py-1 pr-2 pl-1">
                        <div className="flex items-center gap-2">
                          <span className="relative shrink-0">
                            <PersonAvatar name={p.name} photoId={p.photo ? p.id : null} avatarId={siteOf(p.name)?.avatarId ?? null} className="size-7" />
                          </span>
                          <span className="text-sm font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{[p.position, p.job].filter(Boolean).join(" · ")}</span>
                        </div>
                      </div>
                    ))}
                </div>
                <ul className="grid w-full grid-cols-12 items-start gap-4 md:gap-6">
                  {cardsOf(d).map((t) => (
                    <TeamCard key={t.node.id} t={t} siteOf={siteOf} canSeeOnline={canSeeOnline} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
