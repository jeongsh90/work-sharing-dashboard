import { useState } from "react"
import { Check, Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Section } from "@/components/home/home-page"
import { UserAvatar } from "@/components/user-avatar"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { COMPANY_EMAIL_DOMAIN, ROLE_LABEL, type Role, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { DESIGN_TEAM, invalidate, useUsers, type UserInfo } from "@/lib/store"

// 팀 관리(관리자): 계정 만들기, 역할·부서 바꾸기, 비밀번호 정해 주기, 사용 중지
export function TeamPage({ session }: { session: Session }) {
  const { users, error } = useUsers()
  const [editing, setEditing] = useState<UserInfo | "new" | null>(null)

  if (!users) return <PageState error={error} />

  // 승인 전 계정은 슈퍼관리자에게만 온다. 위쪽 가입 승인 대기에서 따로 처리한다.
  const pending = users.filter((u) => !u.approved)
  const members = users.filter((u) => u.approved)
  // 부서별로 묶는다. 디자인팀이 맨 앞, 나머지는 부서 이름 순. 부서가 비면 "부서 미지정"
  const NO_TEAM = "부서 미지정"
  const groups = new Map<string, UserInfo[]>()
  for (const u of members) {
    const team = u.department.trim() || NO_TEAM
    groups.set(team, [...(groups.get(team) ?? []), u])
  }
  const rank = (t: string) => (t === DESIGN_TEAM ? 0 : t === NO_TEAM ? 2 : 1)
  const teams = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "ko"))

  return (
    <div className={PAGE_GRID}>
      {session.role === "superadmin" && <PendingSignups users={pending} />}
      <Section
        title="계정"
        aside={<span className="text-sm text-muted-foreground">{members.length}명</span>}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            계정 추가
          </Button>
        }
      >
        <ul className="grid grid-cols-12 gap-4 md:gap-6">
          {teams.map(([team, list]) => (
            <li key={team} className="col-span-12 flex flex-col rounded-xl border bg-card md:col-span-6 xl:col-span-4">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <h3 className="font-semibold">{team}</h3>
                <span className="text-sm text-muted-foreground tabular-nums">{list.length}명</span>
              </div>
              <ul className="flex flex-col divide-y">
                {list.map((u) => (
                  <MemberRow key={u.id} user={u} session={session} onEdit={() => setEditing(u)} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
      {editing && (
        <UserDialog
          key={editing === "new" ? "new" : editing.id}
          user={editing === "new" ? null : editing}
          session={session}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// 가입 승인 대기: 슈퍼관리자가 역할을 정해 승인하거나 거절한다.
function PendingSignups({ users }: { users: UserInfo[] }) {
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (u: UserInfo, action: "approve" | "reject") => {
    if (action === "reject" && !window.confirm(`${u.name}(${u.id}) 가입 신청을 거절할까요? 신청 정보는 지워집니다.`)) return
    setBusy(u.id)
    setError(null)
    try {
      await api(`/users/${encodeURIComponent(u.id)}/${action}`, { body: action === "approve" ? { role: roles[u.id] ?? u.role } : {} })
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "처리하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      title="가입 승인 대기"
      aside={
        <Badge variant={users.length > 0 ? "default" : "secondary"} className="tabular-nums">
          {users.length}건
        </Badge>
      }
    >
      {users.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          승인을 기다리는 가입 신청이 없습니다.
        </p>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">이름</TableHead>
                <TableHead>회사 이메일</TableHead>
                <TableHead>부서 · 직급</TableHead>
                <TableHead>신청일</TableHead>
                <TableHead>역할</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">승인</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4 font-medium">{u.name}</TableCell>
                  <TableCell>{u.id}</TableCell>
                  <TableCell>{[u.department, u.rank].filter(Boolean).join(" · ") || "-"}</TableCell>
                  <TableCell>{formatDateTime(new Date(u.createdAt))}</TableCell>
                  <TableCell>
                    <Select
                      value={roles[u.id] ?? u.role}
                      onValueChange={(v) => setRoles({ ...roles, [u.id]: v as Role })}
                    >
                      <SelectTrigger className="w-32" aria-label={`${u.name} 역할`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" disabled={busy !== null} onClick={() => decide(u, "approve")}>
                        <Check data-icon="inline-start" />
                        승인
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy !== null}
                        onClick={() => decide(u, "reject")}
                      >
                        <X data-icon="inline-start" />
                        거절
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Section>
  )
}

// 팀 카드 안의 한 사람: 사진, 이름, 직급·직책, 아이디, 역할, 로그인 상태, 수정
function MemberRow({ user: u, session, onEdit }: { user: UserInfo; session: Session; onEdit: () => void }) {
  const locked = u.role === "superadmin" && session.role !== "superadmin"
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${u.active ? "" : "opacity-60"}`}>
      <UserAvatar name={u.name} avatarId={u.avatarId} className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate">
          <span className="font-medium">{u.name}</span>
          {(u.rank || u.position) && (
            <span className="text-xs text-muted-foreground">{[u.rank, u.position].filter(Boolean).join(" · ")}</span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{u.id}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline">{ROLE_LABEL[u.role]}</Badge>
          {!u.active ? (
            <Badge variant="outline" className="text-muted-foreground">
              사용 중지
            </Badge>
          ) : u.canLogin ? (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              로그인 가능
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              비밀번호 없음
            </Badge>
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={locked} onClick={onEdit}>
        수정
      </Button>
    </li>
  )
}

function UserDialog({ user, session, onClose }: { user: UserInfo | null; session: Session; onClose: () => void }) {
  const [form, setForm] = useState({
    id: user?.id ?? "",
    name: user?.name ?? "",
    role: (user?.role ?? "requester") as Role,
    department: user?.department ?? "",
    rank: user?.rank ?? "",
    position: user?.position ?? "",
    password: "",
    active: user?.active ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const self = user?.id === session.id
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })

  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== "superadmin" || session.role === "superadmin")

  const save = async () => {
    if (!user && !form.id.trim()) return setError("아이디를 입력해 주세요.")
    if (!form.name.trim()) return setError("이름을 입력해 주세요.")
    if (form.password && form.password.length < 8) return setError("비밀번호는 8자 이상으로 정해 주세요.")
    setPending(true)
    setError(null)
    try {
      const { id, password, ...rest } = form
      const body = { ...rest, ...(password ? { password } : {}) }
      if (user) await api(`/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body })
      else await api("/users", { body: { id, ...body } })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? `${user.name} 계정 수정` : "계정 추가"}</DialogTitle>
          <DialogDescription>
            요청자는 디자인 요청과 컨펌을, 작업자는 요청을 맡아 시안을 올리고, 관리자는 담당 지정과 계정 관리를 합니다.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          {!user && (
            <Field>
              <FieldLabel htmlFor="u-id">아이디</FieldLabel>
              <Input id="u-id" value={form.id} onChange={set("id")} placeholder={`회사 이메일(@${COMPANY_EMAIL_DOMAIN}) 또는 짧은 아이디`} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="u-name">이름</FieldLabel>
              <Input id="u-name" value={form.name} onChange={set("name")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-role">역할</FieldLabel>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })} disabled={self}>
                <SelectTrigger id="u-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="u-dept">부서</FieldLabel>
              <Input id="u-dept" value={form.department} onChange={set("department")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-rank">직급</FieldLabel>
              <Input id="u-rank" value={form.rank} onChange={set("rank")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-position">직책</FieldLabel>
              <Input id="u-position" value={form.position} onChange={set("position")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-active">사용 여부</FieldLabel>
              <Select
                value={form.active ? "on" : "off"}
                onValueChange={(v) => setForm({ ...form, active: v === "on" })}
                disabled={self}
              >
                <SelectTrigger id="u-active" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">사용</SelectItem>
                  <SelectItem value="off">사용 중지</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="u-pw">{user ? "새 비밀번호" : "비밀번호"}</FieldLabel>
            <Input id="u-pw" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            <FieldDescription>
              {user ? "비워 두면 그대로입니다. " : "비워 두면 로그인할 수 없는 계정으로 만듭니다. "}8자 이상. 본인에게 따로 알려 주세요.
            </FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            닫기
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
