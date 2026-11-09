import { useState } from "react"
import { Check, Pencil, Plus, Trash2, Undo2, X } from "lucide-react"

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi, useUserNames } from "@/lib/store"

// 관리 → 사내망 직통(슈퍼관리자): 같은 사무실 PC 의 IP 와 이름을 등록하면 그 PC 는 파일 올리기·큰 파일 받기를
// 바깥 중계 대신 서버 PC 로 바로 주고받는다(서버 apps/api/src/lan.ts). 등록하지 않은 IP 는 그대로 중계를 쓴다.

type LanIp = { id: string; ip: string; name: string; createdBy: string; createdAt: number; lastSeen: number | null }

export function LanPage() {
  const { data, error } = useApi<LanIp[]>("/lan/ips")
  const userName = useUserNames()
  const [editing, setEditing] = useState<LanIp | null>(null)

  if (!data) return <PageState error={error} />

  const remove = async (row: LanIp) => {
    if (!(await confirmDialog({ title: `"${row.name}"(${row.ip}) 을 지울까요?`, description: "그 PC 는 다시 바깥 중계로 파일을 주고받습니다(느려짐).", confirmText: "삭제", destructive: true })))
      return
    await api(`/lan/ips/${row.id}`, { method: "DELETE" })
    invalidate()
  }

  return (
    <div className={PAGE_GRID}>
      <Section title="PC 등록" className="col-span-12 lg:col-span-4">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <p className="text-sm break-keep text-muted-foreground">
            등록한 PC 는 파일 올리기·큰 파일 받기가 바깥 중계 대신 서버 PC 로 바로 가서 훨씬 빠릅니다. IP 는 그 PC 에서 명령 프롬프트 → ipconfig 의
            "IPv4 주소"입니다.
          </p>
          <IpForm key={data.length} submitText="추가" onSubmit={(body) => api("/lan/ips", { body })} />
        </div>
      </Section>

      <div className="col-span-12 flex flex-col gap-8 lg:col-span-8">
      <Misses registered={data} />

      <Section
        title="등록한 PC"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{data.length}대</span>}
      >
        {data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">아직 등록한 PC 가 없습니다.</p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>마지막 사용</TableHead>
                  <TableHead>등록</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular-nums">{row.ip}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.lastSeen ? formatDateTime(new Date(row.lastSeen)) : "아직 없음"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{userName(row.createdBy)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon-sm" aria-label={`${row.name} 고치기`} onClick={() => setEditing(row)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${row.name} 지우기`} onClick={() => void remove(row)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs break-keep text-muted-foreground">
          공유기가 PC 의 IP 를 바꾸면(PC 를 끄거나 절전한 뒤 등) 그 PC 는 다시 느려집니다. "마지막 사용"이 오래됐으면 그 PC 의 IP 를 다시 확인해 고쳐
          주세요. 공유기에서 PC 별 IP 를 고정해 두면 바뀌지 않습니다.
        </p>
      </Section>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PC 고치기</DialogTitle>
            <DialogDescription>IP 나 이름을 고칩니다.</DialogDescription>
          </DialogHeader>
          {editing && (
            <IpForm
              key={editing.id}
              initial={editing}
              submitText="저장"
              onSubmit={async (body) => {
                await api(`/lan/ips/${editing.id}`, { method: "PATCH", body })
                setEditing(null)
              }}
              footer
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── 직통을 못 탄 PC: 사무실에 있는데 바깥 중계(느림)로 주고받는 사람(최근 3일) ──
// 등록 안 된 IP 로 들어온 사람은 그 IP 를 바로 등록하거나, 이름이 같은 등록 PC 의 IP 를 바꾼다(공유기가 IP 를 바꾼 경우)
type Miss = { userId: string; ip: string | null; publicIp?: string | null; kind: "unregistered" | "unreachable"; at: number }

function Misses({ registered }: { registered: LanIp[] }) {
  const { data } = useApi<Miss[]>("/lan/misses", 30_000)
  const { data: ignored } = useApi<{ userId: string; at: number }[]>("/lan/ignored")
  const userName = useUserNames()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [allowing, setAllowing] = useState<Miss | null>(null) // IP 를 모르는 사람 허용 → IP 직접 입력
  if (!data || (data.length === 0 && !ignored?.length)) return null

  // 거절: 이 사람은 직통을 쓰지 않는다(재택·AI 계정 등) → 목록에서 빼고 다시 올리지 않는다
  const reject = async (m: Miss) => {
    const name = userName(m.userId)
    if (!(await confirmDialog({ title: `${name} 을 거절할까요?`, description: "목록에서 빠지고 다시 올라오지 않습니다. 아래 \"거절한 사람\"에서 되돌릴 수 있습니다.", confirmText: "거절", destructive: true })))
      return
    setBusy(m.userId)
    setError(null)
    try {
      await api(`/lan/ignored/${encodeURIComponent(m.userId)}`, { method: "POST" })
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "거절하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }
  const undoReject = async (userId: string) => {
    await api(`/lan/ignored/${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => {})
    invalidate()
  }

  const apply = async (m: Miss, existing: LanIp | undefined) => {
    if (!m.ip) return
    setBusy(m.userId)
    setError(null)
    try {
      if (existing) await api(`/lan/ips/${existing.id}`, { method: "PATCH", body: { ip: m.ip, name: existing.name, userId: m.userId } })
      else await api("/lan/ips", { body: { ip: m.ip, name: userName(m.userId), userId: m.userId } })
      invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
    <Section
      title="직통을 못 탄 PC"
      aside={<span className="text-sm text-muted-foreground tabular-nums">{data.length}명</span>}
    >
      {data.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">지금 직통을 못 탄 PC 가 없습니다.</p>
      ) : (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>사람</TableHead>
              <TableHead>지금 IP</TableHead>
              <TableHead>확인한 때</TableHead>
              <TableHead className="text-right">처리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((m) => {
              const name = userName(m.userId)
              const existing = registered.find((r) => r.name.includes(name))
              return (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="tabular-nums">
                    {m.ip ?? (m.publicIp ? <span className="text-amber-700 dark:text-amber-300">외부 IP {m.publicIp}</span> : <span className="text-muted-foreground">닿지 않음</span>)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatDateTime(new Date(m.at))}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {m.ip && existing && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {existing.ip} → {m.ip}
                        </span>
                      )}
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => (m.ip ? void apply(m, existing) : setAllowing(m))}
                      >
                        <Check data-icon="inline-start" />
                        허용
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void reject(m)}>
                        <X data-icon="inline-start" />
                        거절
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      )}
      {error && <FieldError>{error}</FieldError>}
      <p className="text-xs break-keep text-muted-foreground">
        사내 IP 가 잡히면 그 IP 로 저절로 등록됩니다(이미 등록한 사람은 새 IP 로 고침). 여기에는 사내 IP 를 알아내지 못해 외부 IP 로만 보인 PC 가 남습니다 — 브라우저가 로컬 네트워크 접근을 막은 경우가 많습니다
        (주소창 왼쪽 자물쇠 → 사이트 설정에서 허용하면 다음 접속 때 저절로 등록). 허용은 사내 IP 를 직접 입력해 등록하고, 거절한 사람은 다시 올라오지 않습니다.
      </p>
      {ignored && ignored.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>거절한 사람</span>
          {ignored.map((g) => (
            <span key={g.userId} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5">
              {userName(g.userId)}
              <Button variant="ghost" size="icon-xs" aria-label={`${userName(g.userId)} 거절 되돌리기`} onClick={() => void undoReject(g.userId)}>
                <Undo2 />
              </Button>
            </span>
          ))}
        </div>
      )}
    </Section>

    <Dialog open={allowing !== null} onOpenChange={(o) => !o && setAllowing(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{allowing ? `${userName(allowing.userId)} 허용` : "허용"}</DialogTitle>
          <DialogDescription className="break-keep">
            사이트가 이 PC 의 IP 를 알아내지 못했습니다. 그 PC 에서 명령 프롬프트 → ipconfig 의 "IPv4 주소"를 넣어 주세요.
          </DialogDescription>
        </DialogHeader>
        {allowing && (
          <IpForm
            key={allowing.userId}
            formId="lan-allow"
            initial={{ ip: "", name: userName(allowing.userId) }}
            submitText="허용"
            onSubmit={async (body) => {
              await api("/lan/ips", { body: { ...body, userId: allowing.userId } })
              setAllowing(null)
            }}
            footer
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

function IpForm({
  initial,
  formId,
  submitText,
  onSubmit,
  footer = false,
}: {
  initial?: { ip: string; name: string }
  formId?: string
  submitText: string
  onSubmit: (body: { ip: string; name: string }) => Promise<unknown>
  footer?: boolean
}) {
  const [ip, setIp] = useState(initial?.ip ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = formId ?? (initial ? "lan-edit" : "lan-add")

  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await onSubmit({ ip: ip.trim(), name: name.trim() })
      invalidate()
      if (!initial) {
        setIp("")
        setName("")
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  const button = (
    <Button type="submit" form={id} disabled={pending || !ip.trim() || !name.trim()}>
      {!initial && <Plus data-icon="inline-start" />}
      {pending ? "저장 중…" : submitText}
    </Button>
  )

  return (
    <>
      <form
        id={id}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-ip`}>IP</FieldLabel>
            <Input id={`${id}-ip`} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.219.77" inputMode="decimal" className="tabular-nums" />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>이름</FieldLabel>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 디자인팀 이동훈 자리" />
            <FieldDescription>누구 자리 PC 인지 알아볼 수 있게 적어 주세요.</FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          {!footer && <div className="flex justify-end">{button}</div>}
        </FieldGroup>
      </form>
      {footer && <DialogFooter>{button}</DialogFooter>}
    </>
  )
}
