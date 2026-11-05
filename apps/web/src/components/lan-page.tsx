import { useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"

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
type Miss = { userId: string; ip: string | null; kind: "unregistered" | "unreachable"; at: number }

function Misses({ registered }: { registered: LanIp[] }) {
  const { data } = useApi<Miss[]>("/lan/misses", 30_000)
  const userName = useUserNames()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!data || data.length === 0) return null

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
    <Section
      title="직통을 못 탄 PC"
      aside={<span className="text-sm text-muted-foreground tabular-nums">{data.length}명</span>}
    >
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
                  <TableCell className="tabular-nums">{m.ip ?? <span className="text-muted-foreground">닿지 않음</span>}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatDateTime(new Date(m.at))}</TableCell>
                  <TableCell className="text-right">
                    {m.ip ? (
                      <Button size="sm" disabled={busy !== null} onClick={() => void apply(m, existing)}>
                        {existing ? `IP 바꾸기 (${existing.ip} → ${m.ip})` : "이 IP 로 등록"}
                      </Button>
                    ) : (
                      <span className="text-xs break-keep text-muted-foreground">그 PC 브라우저에서 로컬 네트워크 접근 허용 확인</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {error && <FieldError>{error}</FieldError>}
      <p className="text-xs break-keep text-muted-foreground">
        사무실 PC 인데 바깥 중계로 주고받는 사람입니다(파일 받기·올리기가 느림). 등록한 PC 의 IP 가 바뀐 경우는 그 사람이 사이트에 들어오면 저절로 새 IP 로 고쳐집니다(여기에는 처음 등록할 사람만 남음). "닿지 않음"은 회사 밖이거나, 브라우저가 로컬 네트워크 접근을 막은 경우입니다
        (주소창 왼쪽 자물쇠 → 사이트 설정에서 허용).
      </p>
    </Section>
  )
}

function IpForm({
  initial,
  submitText,
  onSubmit,
  footer = false,
}: {
  initial?: { ip: string; name: string }
  submitText: string
  onSubmit: (body: { ip: string; name: string }) => Promise<unknown>
  footer?: boolean
}) {
  const [ip, setIp] = useState(initial?.ip ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = initial ? "lan-edit" : "lan-add"

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
