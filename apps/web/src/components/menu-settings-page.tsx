import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Check, GripVertical, Lock, RotateCcw, Save, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { ROLE_LABEL, type Role, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import {
  ALL_ROLES,
  BUTTON_COLORS,
  buttonColor,
  buttonIds,
  canSetRoles,
  DEFAULT_BUTTONS,
  defaultRoles,
  MENU_GROUPS,
  menuFor,
  NO_BUTTON_MENUS,
  orderedGroups,
  PERSONAL_GROUP,
  rolesOf,
  type MenuItem,
  type MenuPrefs,
  type MenuSettings,
} from "@/lib/menu"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi, useUserNames } from "@/lib/store"

// 개인 → 메뉴 관리
// - 내 메뉴(누구나 자기 것): 묶음 안 메뉴 순서(끌어 옮기기·화살표), "버튼" 체크 시 디자인 요청처럼 사이드메뉴 맨 위 큰 버튼, 버튼 색
// - 메뉴 권한(슈퍼관리자만, 모두에게 적용): 메뉴별로 보이는 역할(개인 묶음 제외). 기본으로 허용된 역할 안에서만 줄일 수 있다

const findItem = (id: string) => MENU_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)!

export function MenuSettingsPage({ session }: { session: Session }) {
  const { data: settings, error: e1 } = useApi<MenuSettings>("/menu-settings")
  const { data: prefs, error: e2 } = useApi<MenuPrefs>("/menu-prefs")
  if (!settings || !prefs) return <PageState error={e1 ?? e2} />
  const mine = <MyMenu key={prefs.updatedAt ?? 0} session={session} settings={settings} saved={prefs} />
  if (session.role !== "superadmin") return mine
  return (
    <Tabs defaultValue="mine" className="w-full gap-0">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <TabsList>
          <TabsTrigger value="mine">내 메뉴</TabsTrigger>
          <TabsTrigger value="roles">메뉴 권한</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="mine">{mine}</TabsContent>
      <TabsContent value="roles">
        <RoleEditor key={settings.updatedAt ?? 0} saved={settings} prefs={prefs} />
      </TabsContent>
    </Tabs>
  )
}

// 저장 전에 떠나면 묻는다
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBefore)
    return () => window.removeEventListener("beforeunload", onBefore)
  }, [dirty])
}

function SaveBar({ dirty, busy, canReset, onReset, onRevert, onSave }: { dirty: boolean; busy: boolean; canReset: boolean; onReset: () => void; onRevert: () => void; onSave: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="ghost" size="sm" disabled={!canReset} onClick={onReset}>
        <RotateCcw data-icon="inline-start" />
        기본값
      </Button>
      <Button variant="outline" size="sm" disabled={!dirty} onClick={onRevert}>
        <Undo2 data-icon="inline-start" />
        되돌리기
      </Button>
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        <Save data-icon="inline-start" />
        저장
      </Button>
    </div>
  )
}

function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null
  return <p className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
}

// ── 내 메뉴 ──
type PrefsDraft = Pick<MenuPrefs, "order" | "colors"> & { buttons: string[] }
const NO_PREFS: PrefsDraft = { order: {}, buttons: DEFAULT_BUTTONS, colors: {} }

function prefsDraft(p: Pick<MenuPrefs, "order" | "buttons" | "colors"> | null): PrefsDraft {
  return {
    order: Object.fromEntries(orderedGroups(p).map((g) => [g.label, g.items.map((i) => i.id)])),
    buttons: [...buttonIds(p)],
    colors: { ...(p?.colors ?? {}) },
  }
}
// 버튼이 아닌 메뉴의 색, 기본 색은 저장하지 않는다
const cleanPrefs = (d: PrefsDraft): PrefsDraft => ({
  order: d.order,
  buttons: d.buttons,
  colors: Object.fromEntries(Object.entries(d.colors).filter(([id, c]) => d.buttons.includes(id) && c !== "default")),
})

function MyMenu({ session, settings, saved }: { session: Session; settings: MenuSettings; saved: MenuPrefs }) {
  const [draft, setDraft] = useState<PrefsDraft>(() => prefsDraft(saved))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [drag, setDrag] = useState<{ group: string; id: string } | null>(null)

  const key = (d: PrefsDraft) => JSON.stringify(cleanPrefs(d))
  const savedKey = useMemo(() => key(prefsDraft(saved)), [saved])
  const dirty = key(draft) !== savedKey
  const isDefault = key(draft) === key(prefsDraft(NO_PREFS))
  useLeaveGuard(dirty)

  // 내게 보이는 메뉴만(순서는 초안대로)
  const groups = menuFor(session, settings, draft)

  const move = (group: string, id: string, to: number) =>
    setDraft((d) => {
      // 내게 안 보이는 메뉴는 제자리에 두고, 보이는 메뉴끼리 자리를 바꾼다
      const visible = groups.find((g) => g.label === group)!.items.map((i) => i.id)
      const list = visible.filter((x) => x !== id)
      list.splice(Math.max(0, Math.min(to, list.length)), 0, id)
      // 보이는 메뉴가 있던 자리에만 새 순서를 채운다(순서를 함께 쓰는 다른 계정의 메뉴 자리는 그대로)
      let k = 0
      const full = d.order[group].map((x) => (visible.includes(x) ? list[k++] : x))
      return { ...d, order: { ...d.order, [group]: full } }
    })
  const toggleButton = (id: string, on: boolean) => setDraft((d) => ({ ...d, buttons: on ? [...d.buttons, id] : d.buttons.filter((x) => x !== id) }))
  const setColor = (id: string, color: string) => setDraft((d) => ({ ...d, colors: { ...d.colors, [id]: color } }))

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await api("/menu-prefs", { method: "PUT", body: cleanPrefs(draft) })
      invalidate()
      setMessage({ ok: true, text: "저장했습니다. 사이드메뉴에 바로 반영됩니다." })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "저장하지 못했습니다." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="내 메뉴"
        className="col-span-12 lg:col-span-8"
        aside={<span className="text-sm text-muted-foreground">{saved.updatedAt ? `마지막 저장 ${formatDateTime(new Date(saved.updatedAt))}` : "기본 메뉴 사용 중"}</span>}
        action={
          <SaveBar
            dirty={dirty}
            busy={busy}
            canReset={!isDefault}
            onReset={() => setDraft(prefsDraft(NO_PREFS))}
            onRevert={() => setDraft(prefsDraft(saved))}
            onSave={() => void save()}
          />
        }
      >
        <p className="text-sm break-keep text-muted-foreground">
          내 사이드메뉴만 바뀝니다. 묶음 안에서 메뉴를 끌어 옮기거나 화살표로 순서를 바꾸고, "버튼"을 체크하면 디자인 요청처럼 사이드메뉴 맨 위에 큰
          버튼으로 보입니다. 버튼 색도 고를 수 있습니다.
        </p>
        {saved.sharedOrder && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm break-keep">
            이 계정은 계정 전환으로 함께 쓰는 계정들과 <b>메뉴 순서</b>를 같이 씁니다. 여기서 순서를 바꾸면 그 계정들에도 같은 순서가 적용됩니다(버튼·버튼
            색은 계정마다 따로).
          </p>
        )}
        <Message message={message} />

        {groups.map((g) => (
          <div key={g.label} className="rounded-xl border bg-card">
            <h3 className="border-b px-4 py-2.5 font-medium">{g.label}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">순서</TableHead>
                  <TableHead>메뉴</TableHead>
                  <TableHead className="w-16 text-center">버튼</TableHead>
                  <TableHead className="w-24 text-center">버튼 색</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.items.map((item, index) => {
                  const isButton = draft.buttons.includes(item.id)
                  return (
                    <TableRow
                      key={item.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move"
                        setDrag({ group: g.label, id: item.id })
                      }}
                      onDragOver={(e) => {
                        if (!drag || drag.group !== g.label || drag.id === item.id) return
                        e.preventDefault()
                        move(g.label, drag.id, index)
                      }}
                      onDragEnd={() => setDrag(null)}
                      className={drag?.id === item.id ? "opacity-50" : undefined}
                    >
                      <TableCell>
                        <OrderButtons item={item} index={index} count={g.items.length} onMove={(to) => move(g.label, item.id, to)} />
                      </TableCell>
                      <TableCell>
                        <MenuName item={item} />
                      </TableCell>
                      <TableCell className="text-center">
                        {NO_BUTTON_MENUS.includes(item.id) ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : (
                          <Checkbox aria-label={`${item.title} 버튼으로`} checked={isButton} onCheckedChange={(v) => toggleButton(item.id, v === true)} />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {isButton ? (
                          <ColorPicker title={item.title} value={draft.colors[item.id] ?? "default"} onChange={(c) => setColor(item.id, c)} />
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ))}
      </Section>

      <Preview settings={settings} prefs={draft} role={session.role} department={session.department} />
    </div>
  )
}

function ColorPicker({ title, value, onChange }: { title: string; value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = buttonColor(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`${title} 버튼 색: ${current.label}`} className="gap-1.5 px-2">
          <span className={`size-4 rounded-full ${current.swatch}`} aria-hidden />
          <span className="text-xs">{current.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end">
        <div className="grid grid-cols-6 gap-1.5">
          {BUTTON_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={c.key === current.key}
              onClick={() => {
                onChange(c.key)
                setOpen(false)
              }}
              className={`flex size-7 items-center justify-center rounded-full ${c.swatch} ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring ${c.key === current.key ? "ring-2 ring-ring" : ""}`}
            >
              {c.key === current.key && <Check className={`size-3.5 ${c.key === "outline" || c.key === "amber" ? "text-foreground" : "text-white"} ${c.key === "default" ? "text-primary-foreground" : ""}`} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function OrderButtons({ item, index, count, onMove }: { item: MenuItem; index: number; count: number; onMove: (to: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
      <Button variant="ghost" size="icon-sm" aria-label={`${item.title} 위로`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`${item.title} 아래로`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown />
      </Button>
    </div>
  )
}

function MenuName({ item, locked = false }: { item: MenuItem; locked?: boolean }) {
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

// ── 메뉴 권한(슈퍼관리자) ──
type RolesDraft = Record<string, Role[]>

function rolesDraft(s: Pick<MenuSettings, "roles"> | null): RolesDraft {
  return Object.fromEntries(MENU_GROUPS.flatMap((g) => g.items.filter((i) => canSetRoles(g.label, i.id)).map((i) => [i.id, rolesOf(g.label, i, s)])))
}
// 기본과 같은 역할은 빼서, 나중에 기본이 바뀌어도 따라가게 한다
function cleanRoles(d: RolesDraft): RolesDraft {
  return Object.fromEntries(Object.entries(d).filter(([id, list]) => defaultRoles(findItem(id)).some((r) => !list.includes(r))))
}

function RoleEditor({ saved, prefs }: { saved: MenuSettings; prefs: MenuPrefs }) {
  const userName = useUserNames()
  const [draft, setDraft] = useState<RolesDraft>(() => rolesDraft(saved))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const savedKey = useMemo(() => JSON.stringify(cleanRoles(rolesDraft(saved))), [saved])
  const dirty = JSON.stringify(cleanRoles(draft)) !== savedKey
  const isDefault = Object.keys(cleanRoles(draft)).length === 0
  useLeaveGuard(dirty)

  const toggleRole = (id: string, role: Role, on: boolean) =>
    setDraft((d) => {
      const next = on ? [...d[id], role] : d[id].filter((r) => r !== role)
      return { ...d, [id]: ALL_ROLES.filter((r) => next.includes(r)) }
    })

  const save = async () => {
    const hidden = Object.entries(draft).filter(([, r]) => r.length === 0).map(([id]) => findItem(id).title)
    if (hidden.length && !(await confirmDialog({ title: "아무에게도 보이지 않는 메뉴가 있습니다", description: `${hidden.join(", ")} — 이대로 저장할까요?`, confirmText: "저장" })))
      return
    setBusy(true)
    setMessage(null)
    try {
      await api("/menu-settings", { method: "PUT", body: { roles: cleanRoles(draft) } })
      invalidate()
      setMessage({ ok: true, text: "저장했습니다. 다른 사람 화면에는 1분 안에 반영됩니다." })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "저장하지 못했습니다." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title="메뉴 권한"
        className="col-span-12 lg:col-span-8"
        aside={
          <span className="text-sm text-muted-foreground">
            {saved.updatedAt ? `마지막 저장 ${formatDateTime(new Date(saved.updatedAt))} · ${userName(saved.updatedBy ?? "")}` : "기본 권한 사용 중"}
          </span>
        }
        action={
          <SaveBar
            dirty={dirty}
            busy={busy}
            canReset={!isDefault}
            onReset={() => setDraft(rolesDraft(null))}
            onRevert={() => setDraft(rolesDraft(saved))}
            onSave={() => void save()}
          />
        }
      >
        <p className="text-sm break-keep text-muted-foreground">
          모든 사람에게 적용됩니다. 역할 칸은 그 역할에게 메뉴가 보일지를 정하고, 회색 칸은 그 역할이 원래 쓸 수 없는 메뉴라 켤 수 없습니다. 개인 묶음은
          각자 자기 것만 보는 메뉴라 권한을 바꾸지 않습니다. 메뉴를 숨기면 사이드메뉴와 그 메뉴 주소가 함께 막힙니다.
        </p>
        <Message message={message} />

        {MENU_GROUPS.filter((g) => g.label !== PERSONAL_GROUP).map((g) => (
          <div key={g.label} className="rounded-xl border bg-card">
            <h3 className="border-b px-4 py-2.5 font-medium">{g.label}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>메뉴</TableHead>
                  {ALL_ROLES.map((r) => (
                    <TableHead key={r} className="w-20 text-center">
                      {ROLE_LABEL[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <MenuName item={item} locked={!canSetRoles(g.label, item.id)} />
                    </TableCell>
                    {ALL_ROLES.map((r) => (
                      <TableCell key={r} className="text-center">
                        <RoleBox group={g.label} item={item} role={r} draft={draft} onChange={(on) => toggleRole(item.id, r, on)} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </Section>

      <RolePreview settings={{ roles: draft }} prefs={prefs} />
    </div>
  )
}

function RoleBox({ group, item, role, draft, onChange }: { group: string; item: MenuItem; role: Role; draft: RolesDraft; onChange: (on: boolean) => void }) {
  if (!defaultRoles(item).includes(role)) return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]} (쓸 수 없음)`} checked={false} disabled />
  if (!canSetRoles(group, item.id)) return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]} (고정)`} checked disabled />
  return <Checkbox aria-label={`${item.title} ${ROLE_LABEL[role]}`} checked={draft[item.id].includes(role)} onCheckedChange={(v) => onChange(v === true)} />
}

function RolePreview({ settings, prefs }: { settings: Pick<MenuSettings, "roles">; prefs: MenuPrefs }) {
  const [role, setRole] = useState<Role>("requester")
  return (
    <Preview
      settings={settings}
      prefs={prefs}
      role={role}
      department={role === "requester" ? "" : "디자인팀"}
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
    />
  )
}

// 미리 보기: 저장 전 설정으로 사이드메뉴를 보여 준다
function Preview({
  settings,
  prefs,
  role,
  department,
  action,
}: {
  settings: Pick<MenuSettings, "roles">
  prefs: Pick<MenuPrefs, "order" | "buttons" | "colors">
  role: Role
  department: string
  action?: React.ReactNode
}) {
  const groups = menuFor({ role, department }, settings, prefs)
  const asButton = buttonIds(prefs)
  const buttons = groups.flatMap((g) => g.items).filter((i) => asButton.has(i.id))

  return (
    <Section title="미리 보기" className="col-span-12 lg:col-span-4" action={action}>
      <div className="flex flex-col gap-4 rounded-xl border bg-sidebar p-3 lg:sticky lg:top-20">
        {buttons.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {buttons.map((i) => (
              <div
                key={i.id}
                className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium ${buttonColor(prefs.colors[i.id]).button || "bg-primary text-primary-foreground"}`}
              >
                <i.icon className="size-4" aria-hidden />
                {i.title}
              </div>
            ))}
          </div>
        )}
        {groups
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
