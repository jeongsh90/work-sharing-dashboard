import { useMemo, useState, type ReactNode } from "react"
import { Check, Copy, ExternalLink, Eye, EyeOff, GripVertical, Plus, Search, Trash2 } from "lucide-react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { Tip } from "@/components/tip"
import { api, ApiError } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi } from "@/lib/store"

// 관리 → 계정 정보(슈퍼관리자): 회사에서 쓰는 외부 서비스 계정 모음(서버 apps/api/src/accounts.ts).
// 목록에는 비밀번호가 오지 않는다. 보기·복사를 누를 때만 서버에서 하나씩 꺼낸다(암호화해 저장).
// 칸마다 복사 버튼, 서비스 이름을 누르면 수정·삭제 창.

type Account = {
  id: string
  service: string
  loginId: string
  host: string
  link: string
  memo: string
  hasPassword: boolean
  hasPassword2: boolean
  updatedAt: number
  // ?secrets=1 로 받으면 함께 온다(화면에 처음부터 보임)
  password?: string
  password2?: string
}
type Secret = { password: string; password2: string }

const secretOf = (id: string) => api<Secret>(`/accounts/${id}/secret`)

// 복사 버튼: 누르면 잠깐 체크 표시
function CopyButton({ label, get }: { label: string; get: () => string | Promise<string> }) {
  const [done, setDone] = useState(false)
  return (
    <Tip content={`${label} 복사`}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`${label} 복사`}
        onClick={async (e) => {
          e.stopPropagation()
          try {
            await navigator.clipboard.writeText(await get())
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          } catch {
            // 복사 실패(권한 등)는 조용히 넘어간다
          }
        }}
      >
        {done ? <Check className="text-emerald-600" /> : <Copy />}
      </Button>
    </Tip>
  )
}

// 값 + 복사 버튼. 값이 없으면 흐린 줄표
function CopyCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return <span className="text-muted-foreground/50">-</span>
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className={`min-w-0 break-all ${mono ? "font-mono text-[13px]" : ""}`}>{value}</span>
      <CopyButton label={label} get={() => value} />
    </span>
  )
}

// 비밀번호 칸: 기본은 보임 + 가리기 + 복사
function SecretCell({ account, which, label }: { account: Account; which: "password" | "password2"; label: string }) {
  const has = which === "password" ? account.hasPassword : account.hasPassword2
  const value = account[which]
  const [hidden, setHidden] = useState(false)
  if (!has) return <span className="text-muted-foreground/50">-</span>
  const get = async () => value ?? (await secretOf(account.id))[which]
  const shown = hidden ? null : (value ?? null)
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 font-mono text-[13px] break-all">{shown ?? "••••••••"}</span>
      <Tip content={shown ? "가리기" : "보기"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${label} ${shown ? "가리기" : "보기"}`}
          onClick={(e) => {
            e.stopPropagation()
            setHidden(!hidden)
          }}
        >
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </Tip>
      <CopyButton label={label} get={get} />
    </span>
  )
}

// 끌어서 순서 바꾸는 표 줄. 왼쪽 손잡이를 잡고 끈다(키보드: 손잡이에서 스페이스 → 방향키 → 스페이스). 검색 중에는 끄기
function SortableRow({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const handle = (
    <Tip content={disabled ? "검색 중에는 순서를 바꿀 수 없습니다" : "끌어서 순서 바꾸기"}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label="끌어서 순서 바꾸기"
        className={`flex h-7 w-6 touch-none items-center justify-center rounded text-muted-foreground ${disabled ? "cursor-not-allowed opacity-30" : "cursor-grab hover:text-foreground active:cursor-grabbing"}`}
      >
        <GripVertical className="size-4" />
      </button>
    </Tip>
  )
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`align-top ${isDragging ? "relative z-10 bg-muted shadow-lg" : ""}`}
    >
      {children(handle)}
    </TableRow>
  )
}

export function AccountsPage() {
  const { data, error } = useApi<Account[]>("/accounts?secrets=1", 300_000)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<Account | "new" | null>(null)
  // 끌어 놓은 순서(서버 저장이 끝나 새 목록이 올 때까지 이 순서로 보여 준다)
  const [order, setOrder] = useState<string[] | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sorted = useMemo(() => {
    if (!data || !order) return data ?? []
    const pos = new Map(order.map((id, i) => [id, i]))
    return [...data].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
  }, [data, order])
  const searching = query.trim() !== ""
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((a) => [a.service, a.loginId, a.host, a.link, a.memo].some((v) => v.toLowerCase().includes(q)))
  }, [sorted, query])

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = sorted.map((a) => a.id)
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    setOrder(next)
    setOrderError(null)
    try {
      await api("/accounts/order", { body: { ids: next } })
      invalidate()
    } catch (e) {
      setOrder(null)
      setOrderError(e instanceof ApiError ? e.message : "순서를 저장하지 못했습니다.")
    }
  }

  if (!data) return <PageState error={error} />

  return (
    <div className={PAGE_GRID}>
      <Section
        title="계정 정보"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{data.length}개</span>}
        action={
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="서비스·아이디·메모 찾기" aria-label="계정 찾기" className="pl-8" />
            </div>
            <Button onClick={() => setEditing("new")}>
              <Plus data-icon="inline-start" />
              추가
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
          <SortableContext items={list.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-9" />
                <TableHead className="w-[15%]">서비스</TableHead>
                <TableHead className="w-[20%]">아이디</TableHead>
                <TableHead className="w-[16%]">비밀번호</TableHead>
                <TableHead className="w-[17%]">호스트 · 계정 비밀번호</TableHead>
                <TableHead className="w-[12%]">링크</TableHead>
                <TableHead>메모</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a) => (
                <SortableRow key={a.id} id={a.id} disabled={searching}>
                  {(handle) => (
                  <>
                  <TableCell className="px-1">{handle}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Tip content="누르면 수정·삭제">
                      <button type="button" className="text-left font-medium break-keep hover:underline" onClick={() => setEditing(a)}>
                        {a.service}
                      </button>
                    </Tip>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <CopyCell label={`${a.service} 아이디`} value={a.loginId} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SecretCell account={a} which="password" label={`${a.service} 비밀번호`} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <CopyCell label={`${a.service} 호스트`} value={a.host} />
                      {a.hasPassword2 && <SecretCell account={a} which="password2" label={`${a.service} 계정 비밀번호`} />}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {a.link ? (
                      <span className="flex items-center gap-1">
                        <Tip content={a.link}>
                          <Button asChild variant="outline" size="xs">
                            <a href={a.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink data-icon="inline-start" />
                              열기
                            </a>
                          </Button>
                        </Tip>
                        <CopyButton label={`${a.service} 링크`} get={() => a.link} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-pre-line break-keep text-muted-foreground">{a.memo}</TableCell>
                  </>
                  )}
                </SortableRow>
              ))}
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {data.length ? "맞는 계정이 없습니다." : "아직 넣은 계정이 없습니다. 오른쪽 위 추가로 넣어 주세요."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </SortableContext>
          </DndContext>
        </div>
        {orderError && <p className="text-sm text-destructive">{orderError}</p>}
        <p className="text-xs text-muted-foreground break-keep">
          슈퍼관리자만 봅니다. 비밀번호는 서버에 암호화해 두고 이 화면에만 보입니다(눈 아이콘으로 가리기). 서비스 이름을 누르면 고치거나 지울 수 있습니다. 왼쪽 손잡이(⋮⋮)를 끌어 순서를 바꿉니다(검색 중에는 안 됨).
        </p>
      </Section>
      {editing && <AccountDialog account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const [service, setService] = useState(account?.service ?? "")
  const [loginId, setLoginId] = useState(account?.loginId ?? "")
  const [host, setHost] = useState(account?.host ?? "")
  const [link, setLink] = useState(account?.link ?? "")
  const [memo, setMemo] = useState(account?.memo ?? "")
  // 비밀번호는 창을 열 때 서버에서 꺼낸다(null = 아직 안 불러옴 → 저장 때 보내지 않아 그대로 둠)
  const [password, setPassword] = useState<string | null>(account ? null : "")
  const [password2, setPassword2] = useState<string | null>(account ? null : "")
  const [show, setShow] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSecret = async () => {
    if (!account || password !== null) return
    const s = await secretOf(account.id)
    setPassword(s.password)
    setPassword2(s.password2)
  }

  const save = async () => {
    setPending(true)
    setError(null)
    try {
      const body = {
        service,
        loginId,
        host,
        link: link.trim() && !/^https?:\/\//i.test(link.trim()) ? `https://${link.trim()}` : link,
        memo,
        ...(password !== null ? { password } : {}),
        ...(password2 !== null ? { password2 } : {}),
      }
      if (account) await api(`/accounts/${account.id}`, { method: "PATCH", body })
      else await api("/accounts", { body })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  const remove = async () => {
    if (!account) return
    if (!(await confirmDialog({ title: `"${account.service}" 계정 정보를 지울까요?`, description: "지우면 되돌릴 수 없습니다.", confirmText: "삭제", destructive: true }))) return
    try {
      await api(`/accounts/${account.id}`, { method: "DELETE" })
      invalidate()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "지우지 못했습니다.")
    }
  }

  const secretInput = (id: string, label: string, value: string | null, set: (v: string) => void) => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={value ?? ""}
          placeholder={value === null ? "•••••••• (보기를 누르면 불러옵니다)" : ""}
          onFocus={() => void loadSecret()}
          onChange={(e) => set(e.target.value)}
          className="font-mono"
        />
        <Tip content={show ? "가리기" : "보기"}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`${label} ${show ? "가리기" : "보기"}`}
            onClick={async () => {
              await loadSecret()
              setShow(!show)
            }}
          >
            {show ? <EyeOff /> : <Eye />}
          </Button>
        </Tip>
      </div>
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? "계정 정보 고치기" : "계정 정보 추가"}</DialogTitle>
          <DialogDescription>
            {account ? `마지막 수정 ${formatDateTime(new Date(account.updatedAt))}` : "비밀번호는 서버에 암호화해 저장합니다."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="account-form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="acc-service">서비스</FieldLabel>
              <Input id="acc-service" value={service} onChange={(e) => setService(e.target.value)} maxLength={100} placeholder="예: 드롭박스" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acc-id">아이디</FieldLabel>
              <Input id="acc-id" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="off" />
            </Field>
            {secretInput("acc-pw", "비밀번호", password, setPassword)}
            <Field>
              <FieldLabel htmlFor="acc-host">호스트</FieldLabel>
              <Input id="acc-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="예: owenfood.speedgabia.com" />
            </Field>
            {secretInput("acc-pw2", "계정 비밀번호 (호스트용 등, 없으면 비움)", password2, setPassword2)}
            <Field>
              <FieldLabel htmlFor="acc-link">링크</FieldLabel>
              <Input id="acc-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" />
            </Field>
            <Field>
              <FieldLabel htmlFor="acc-memo">메모</FieldLabel>
              <Textarea id="acc-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className="min-h-16 break-keep" />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter className="sm:justify-between">
          {account ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove()}>
              <Trash2 data-icon="inline-start" />
              삭제
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" form="account-form" disabled={pending || !service.trim()}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
