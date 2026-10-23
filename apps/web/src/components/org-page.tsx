import { Building2 } from "lucide-react"

import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { UserAvatar } from "@/components/user-avatar"
import type { Role } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { PRESENCE_DOT, PRESENCE_LABEL, type Presence } from "@/lib/presence"
import { DESIGN_TEAM, useApi } from "@/lib/store"
import { cn } from "@/lib/utils"

// 조직도: 부서별로 사람을 묶어 회사 아래 가지로 보여 준다. 테스트·admin 계정은 서버에서 뺀다.
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

function Person({ m, canSeeOnline, className }: { m: OrgMember; canSeeOnline: boolean; className?: string }) {
  const designer = m.role === "designer" || deptKey(m.department) === DESIGN_TEAM
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="relative shrink-0">
        <UserAvatar name={m.name} avatarId={m.avatarId} className="size-9" />
        {canSeeOnline && (
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card",
              m.online ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            aria-label={m.online ? "접속 중" : "접속 안 함"}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">{m.name}</span>
          {m.rank && <span className="shrink-0 text-xs text-muted-foreground">{m.rank}</span>}
        </div>
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
      </div>
    </div>
  )
}

export function OrgPage() {
  const { data, error } = useApi<{ canSeeOnline: boolean; members: OrgMember[] }>("/org", 20_000)
  if (!data) return <PageState error={error} />

  const { canSeeOnline, members } = data
  const teams = groupByDepartment(members)
  const online = members.filter((m) => m.online)

  return (
    <div className={PAGE_GRID}>
      {canSeeOnline && (
        <Section
          title="지금 접속 중"
          aside={<span className="text-sm text-muted-foreground tabular-nums">{online.length}명</span>}
        >
          {online.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              지금 사이트에 접속한 사람이 없습니다.
            </p>
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

      <Section
        title="조직도"
        aside={
          <span className="text-sm text-muted-foreground tabular-nums">
            부서 {teams.length} · {members.length}명
          </span>
        }
      >
        <div className="flex flex-col items-center">
          {/* 회사(맨 위 가지) */}
          <div className="flex items-center gap-2 rounded-xl border bg-card px-5 py-3 font-semibold shadow-xs">
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            오웬푸드
          </div>
          <div className="h-6 w-px bg-border" aria-hidden />
          {/* 부서 가지 */}
          <ul className="grid w-full grid-cols-12 gap-4 md:gap-6">
            {teams.map((t) => (
              <li
                key={t.key}
                className="col-span-12 flex flex-col rounded-xl border bg-card sm:col-span-6 xl:col-span-4 2xl:col-span-3"
              >
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <h3 className="font-semibold">{t.name}</h3>
                  <span className="text-sm text-muted-foreground tabular-nums">{t.list.length}명</span>
                  {canSeeOnline && t.list.some((m) => m.online) && (
                    <span className="ml-auto text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
                      접속 {t.list.filter((m) => m.online).length}
                    </span>
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
        </div>
      </Section>
    </div>
  )
}
