import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, GripVertical, Lock, RotateCcw, Save, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { ROLE_LABEL, type Role } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import {
  ALL_ROLES,
  buttonIds,
  canSetRoles,
  DEFAULT_BUTTONS,
  defaultRoles,
  MENU_GROUPS,
  NO_BUTTON_MENUS,
  orderedGroups,
  PERSONAL_GROUP,
  rolesOf,
  type MenuItem,
  type MenuSettings,
} from "@/lib/menu"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi, useUserNames } from "@/lib/store"

// 관리 → 메뉴 관리(슈퍼관리자)
// 1. 메뉴 순서: 묶음 안에서 끌어 옮기거나 ↑↓ 로 바꾼다
// 2. 메뉴별 권한: 역할마다 보일지 고른다(개인 묶음은 각자 자기 것이라 제외). 기본으로 허용된 역할 안에서만 줄일 수 있다
// 3. 버튼: 체크하면 "디자인 요청"처럼 사이드메뉴 맨 위(로고 아래)에 큰 버튼으로 둔다

type Draft = { order: Record<string, string[]>; roles: Record<string, Role[]>; buttons: string[] }

const findItem = (id: string) => MENU_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)!

function draftOf(settings: MenuSettings | null): Draft {
  const groups = orderedGroups(settings)
  return {
    order: Object.fromEntries(groups.map((g) => [g.label, g.items.map((i) => i.id)])),
    roles: Object.fromEntries(groups.flatMap((g) => g.items.filter((i) => canSetRoles(g.label, i.id)).map((i) => [i.id, rolesOf(g.label, i, settings)]))),
    buttons: [...buttonIds(settings)],
  }
}

// 저장할 설정: 기본과 같은 역할은 빼서, 나중에 기본이 바뀌어도 따라가게 한다
function toSettings(d: Draft): Omit<MenuSettings, "updatedBy" | "updatedAt"> {
  const roles: Record<string, Role[]> = {}
  for (const [id, list] of Object.entries(d.roles)) {
    const base = defaultRoles(findItem(id))
    if (base.some((r) => !list.includes(r))) roles[id] = list
  }
  return { order: d.order, roles, buttons: d.buttons }
}

export function MenuSettingsPage() {
  const { data, error } = useApi<MenuSettings>("/menu-settings")
  if (!data) return <PageState error={error} />
  return <Editor key={data.updatedAt ?? 0} saved={data} />
}

function Editor({ saved }: { saved: MenuSettings }) {
  const userName = useUserNames()
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [drag, setDrag] = useState<{ group: string; id: string } | null>(null)

  const savedDraft = useMemo(() => JSON.stringify(toSettings(draftOf(saved))), [saved])
  const dirty = JSON.stringify(toSettings(draft)) !== savedDraft
  const isDefault = JSON.stringify(toSettings(draft)) === JSON.stringify(toSettings(draftOf(null)))

  // 저장하지 않고 떠나면 묻는다
  useEffect(() => {
    if (!dirty) return
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBefore)
    return () => window.removeEventListener("beforeunload", onBefore)
  }, [dirty])

  const move = (group: string, id: string, to: number) =>
    setDraft((d) => {
      const list = d.order[group].filter((x) => x !== id)
      list.splice(Math.max(0, Math.min(to, list.length)), 0, id)
      return { ...d, order: { ...d.order, [group]: list } }
    })

  const toggleRole = (id: string, role: Role, on: boolean) =>
    setDraft((d) => {
      const next = on ? [...d.roles[id], role] : d.roles[id].filter((r) => r !== role)
      return { ...d, roles: { ...d.roles, [id]: ALL_ROLES.filter((r) => next.includes(r)) } }
    })

  const toggleButton = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, buttons: on ? [...d.buttons, id] : d.buttons.filter((x) => x !== id) }))

  const save = async () => {
    // 슈퍼관리자가 보는 메뉴가 하나도 안 남는 일은 없다(홈·메뉴 관리는 잠김). 모든 역할을 끈 메뉴는 한 번 묻는다
    const hidden = Object.entries(draft.roles).filter(([, r]) => r.length === 0).map(([id]) => findItem(id).title)
    if (hidden.length && !(await confirmDialog({ title: "아무에게도 보이지 않는 메뉴가 있습니다", description: `${hidden.join(", ")} — 이대로 저장할까요?`, confirmText: "저장" })))
      return
    setBusy(true)
    setMessage(null)
    try {
      await api("/menu-settings", { method: "PUT", body: toSettings(draft) })
      invalidate()
      setMessage({ ok: true, text: "저장했습니다. 다른 사람 화면에는 1분 안에 반영됩니다." })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "저장하지 못했습니다." })
    } finally {
      setBusy(false)
    }
  }

  const resetDefault = async () => {
    if (await confirmDialog({ title: "기본 메뉴로 되돌릴까요?", description: "순서·권한·버튼이 처음 상태가 됩니다. 저장을 눌러야 반영됩니다.", confirmText: "되돌리기" }))
      setDraft(draftOf(null))
  }

  const preview: MenuSettings = { ...toSettings(draft), updatedBy: null, updatedAt: null }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="메뉴 순서·권한"
        className="col-span-12 lg:col-span-8"
        aside={
          saved.updatedAt ? (
            <span className="text-sm text-muted-foreground">
              마지막 저장 {formatDateTime(new Date(saved.updatedAt))} · {userName(saved.updatedBy ?? "")}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">기본 메뉴 사용 중</span>
          )
        }
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={isDefault} onClick={() => void resetDefault()}>
              <RotateCcw data-icon="inline-start" />
              기본값
            </Button>
            <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
              <Undo2 data-icon="inline-start" />
              되돌리기
            </Button>
            <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
              <Save data-icon="inline-start" />
              저장
            </Button>
          </div>
        }
      >
        <p className="text-sm break-keep text-muted-foreground">
          묶음 안에서 메뉴를 끌어 옮기거나 화살표로 순서를 바꿉니다. 역할 칸은 그 역할에게 메뉴가 보일지를 정하고, 회색 칸은 그 역할이 원래 쓸 수 없는
          메뉴라 켤 수 없습니다. "버튼"을 체크하면 디자인 요청처럼 사이드메뉴 맨 위에 큰 버튼으로 보입니다.
        </p>
        {message && <p className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>}

        {MENU_GROUPS.map((g) => {
          const personal = g.label === PERSONAL_GROUP
          const ids = draft.order[g.label]
          return (
            <div key={g.label} className="rounded-xl border bg-card">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <h3 className="font-medium">{g.label}</h3>
                {personal && <span className="text-xs text-muted-foreground">각자 자기 것만 보는 메뉴라 권한은 바꾸지 않습니다</span>}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">순서</TableHead>
                    <TableHead>메뉴</TableHead>
                    {ALL_ROLES.map((r) => (
                      <TableHead key={r} className="w-20 text-center">
                        {ROLE_LABEL[r]}
                      </TableHead>
                    ))}
                    <TableHead className="w-16 text-center">버튼</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ids.map((id, index) => {
                    const item = findItem(id)
                    return (
                      <TableRow
                        key={id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move"
                          setDrag({ group: g.label, id })
                        }}
                        onDragOver={(e) => {
                          if (!drag || drag.group !== g.label || drag.id === id) return
                          e.preventDefault()
                          move(g.label, drag.id, index)
                        }}
                        onDragEnd={() => setDrag(null)}
                        className={drag?.id === id ? "opacity-50" : undefined}
                      >
                        <TableCell>
                          <div className="flex items-center gap-0.5">
                            <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
                            <Button variant="ghost" size="icon-sm" aria-label={`${item.title} 위로`} disabled={index === 0} onClick={() => move(g.label, id, index - 1)}>
                              <ArrowUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${item.title} 아래로`}
                              disabled={index === ids.length - 1}
                              onClick={() => move(g.label, id, index + 1)}
                            >
                              <ArrowDown />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <MenuName item={item} locked={!personal && !canSetRoles(g.label, id)} />
                        </TableCell>
                        {ALL_ROLES.map((r) => (
                          <TableCell key={r} className="text-center">
                            <RoleBox group={g.label} item={item} role={r} draft={draft} onChange={(on) => toggleRole(id, r, on)} />
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          {NO_BUTTON_MENUS.includes(id) ? (
                            <span className="text-xs text-muted-foreground">-</span>
                          ) : (
                            <Checkbox
                              aria-label={`${item.title} 버튼으로`}
                              checked={draft.buttons.includes(id)}
                              onCheckedChange={(v) => toggleButton(id, v === true)}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )
        })}
        <p className="text-xs break-keep text-muted-foreground">
          메뉴를 숨기면 사이드메뉴와 그 메뉴 주소가 함께 막힙니다. 기본 버튼은 {DEFAULT_BUTTONS.map((id) => findItem(id).title).join(", ")} 입니다.
        </p>
      </Section>

      <Preview settings={preview} />
    </div>
  )
}

function MenuName({ item, locked }: { item: MenuItem; locked: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-medium break-keep">{item.title}</span>
      {item.designTeam && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">디자인팀만</span>}
      {locked && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title="이 메뉴는 권한을 바꾸지 않습니다">
          <Lock className="size-3" aria-hidden />
          고정
        </span>
      )}
    </div>
  )
}

function RoleBox({ group, item, role, draft, onChange }: { group: string; item: MenuItem; role: Role; draft: Draft; onChange: (on: boolean) => void }) {
  const allowedByDefault = defaultRoles(item).includes(role)
  if (!allowedByDefault) return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]} (쓸 수 없음)`} checked={false} disabled />
  if (!canSetRoles(group, item.id)) return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]} (고정)`} checked disabled />
  return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]}`} checked={draft.roles[item.id].includes(role)} onCheckedChange={(v) => onChange(v === true)} />
}

// 미리 보기: 역할을 고르면 저장 전 설정으로 그 역할의 사이드메뉴를 보여 준다(디자인팀 메뉴는 디자인팀 기준)
function Preview({ settings }: { settings: MenuSettings }) {
  const [role, setRole] = useState<Role>("requester")
  const visible = orderedGroups(settings).map((g) => ({
    ...g,
    items: g.items.filter((i) => rolesOf(g.label, i, settings).includes(role) && (!i.designTeam || role !== "requester")),
  }))
  const asButton = buttonIds(settings)
  const buttons = visible.flatMap((g) => g.items).filter((i) => asButton.has(i.id))

  return (
    <Section
      title="미리 보기"
      className="col-span-12 lg:col-span-4"
      action={
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger size="sm" className="w-32" aria-label="미리 볼 역할">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-col gap-4 rounded-xl border bg-sidebar p-3 lg:sticky lg:top-20">
        {buttons.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {buttons.map((i) => (
              <div key={i.id} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground">
                <i.icon className="size-4" aria-hidden />
                {i.title}
              </div>
            ))}
          </div>
        )}
        {visible
          .map((g) => ({ ...g, items: g.items.filter((i) => !asButton.has(i.id)) }))
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <span className="px-2 text-xs text-sidebar-foreground/70">{g.label}</span>
              {g.items.map((i) => (
                <div key={i.id} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground">
                  <i.icon className="size-4" aria-hidden />
                  {i.title}
                </div>
              ))}
            </div>
          ))}
      </div>
    </Section>
  )
}
