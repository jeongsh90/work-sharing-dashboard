import { useState } from "react"
import { Check, Pencil, Plug, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { invalidate, useApi } from "@/lib/store"

// 관리 → FTP 서버(슈퍼관리자): FTP 메뉴에서 쓸 FTP 접속 정보를 넣는다(서버 apps/api/src/ftp.ts).
// 비밀번호는 서버 PC 에 암호화해 두고 화면에는 다시 보여 주지 않는다. 고칠 때 비워 두면 원래 비밀번호를 그대로 쓴다.

type FtpServer = { id: string; name: string; host: string; port: number; username: string; secure: boolean; root: string }
type Body = { id?: string; name: string; host: string; port: string; username: string; password: string; secure: boolean; root: string }

export function FtpAdminPage() {
  const { data, error } = useApi<FtpServer[]>("/ftp/servers")
  const [editing, setEditing] = useState<FtpServer | null>(null)

  if (!data) return <PageState error={error} />

  const remove = async (row: FtpServer) => {
    if (!(await confirmDialog({ title: `"${row.name}" 을(를) 지울까요?`, description: "FTP 메뉴에서 이 서버가 사라집니다(FTP 의 파일은 그대로).", confirmText: "삭제", destructive: true })))
      return
    await api(`/ftp/servers/${row.id}`, { method: "DELETE" })
    invalidate()
  }

  return (
    <div className={PAGE_GRID}>
      <Section title="FTP 서버 추가" className="col-span-12 lg:col-span-4">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <p className="text-sm break-keep text-muted-foreground">
            여기 넣은 FTP 는 FTP 메뉴에서 디자인팀·관리자가 폴더 보기·올리기·내려받기를 할 수 있습니다. 비밀번호는 서버 PC 에만 암호화해 둡니다.
          </p>
          <ServerForm key={data.length} submitText="추가" onSubmit={(body) => api("/ftp/servers", { body })} />
        </div>
      </Section>

      <Section title="등록한 FTP" aside={<span className="text-sm text-muted-foreground tabular-nums">{data.length}개</span>} className="col-span-12 lg:col-span-8">
        {data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">아직 등록한 FTP 가 없습니다.</p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>주소</TableHead>
                  <TableHead>아이디</TableHead>
                  <TableHead>시작 폴더</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.host}:{row.port}
                      {row.secure && " (FTPS)"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.username}</TableCell>
                    <TableCell className="text-muted-foreground">{row.root}</TableCell>
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
      </Section>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>FTP 고치기</DialogTitle>
            <DialogDescription>비밀번호 칸을 비워 두면 원래 비밀번호를 그대로 씁니다.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ServerForm
              key={editing.id}
              initial={editing}
              submitText="저장"
              onSubmit={async (body) => {
                await api(`/ftp/servers/${editing.id}`, { method: "PATCH", body })
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

function ServerForm({
  initial,
  submitText,
  onSubmit,
  footer = false,
}: {
  initial?: FtpServer
  submitText: string
  onSubmit: (body: Body) => Promise<unknown>
  footer?: boolean
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [host, setHost] = useState(initial?.host ?? "")
  const [port, setPort] = useState(String(initial?.port ?? 21))
  const [username, setUsername] = useState(initial?.username ?? "")
  const [password, setPassword] = useState("")
  const [secure, setSecure] = useState(initial?.secure ?? false)
  const [root, setRoot] = useState(initial?.root ?? "/")
  const [pending, setPending] = useState<"save" | "test" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tested, setTested] = useState<string | null>(null)
  const id = initial ? "ftp-edit" : "ftp-add"

  const body = (): Body => ({ id: initial?.id, name: name.trim(), host: host.trim(), port: port.trim(), username: username.trim(), password, secure, root: root.trim() })
  const ready = name.trim() && host.trim() && username.trim() && (initial || password)

  const run = async (kind: "save" | "test") => {
    setPending(kind)
    setError(null)
    setTested(null)
    try {
      if (kind === "test") {
        const r = await api<{ count: number }>("/ftp/servers/test", { body: { ...body(), name: name.trim() || "test" } })
        setTested(`접속 성공 — 시작 폴더에 ${r.count}개`)
        return
      }
      const { id: _id, ...rest } = body()
      void _id
      await onSubmit(rest)
      invalidate()
      if (!initial) {
        setName("")
        setHost("")
        setPort("21")
        setUsername("")
        setPassword("")
        setSecure(false)
        setRoot("/")
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : kind === "test" ? "접속하지 못했습니다." : "저장하지 못했습니다.")
    } finally {
      setPending(null)
    }
  }

  const buttons = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={pending !== null || !host.trim() || !username.trim() || (!initial && !password)} onClick={() => void run("test")}>
        <Plug data-icon="inline-start" />
        {pending === "test" ? "확인 중…" : "접속 확인"}
      </Button>
      <Button type="submit" form={id} disabled={pending !== null || !ready}>
        {!initial && <Plus data-icon="inline-start" />}
        {pending === "save" ? "저장 중…" : submitText}
      </Button>
    </div>
  )

  return (
    <>
      <form
        id={id}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          void run("save")
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>이름</FieldLabel>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 카페24 상세페이지" />
          </Field>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field>
              <FieldLabel htmlFor={`${id}-host`}>FTP 주소</FieldLabel>
              <Input id={`${id}-host`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="yorihaeyou.ftp.cafe24.com" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-port`}>포트</FieldLabel>
              <Input id={`${id}-port`} value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="tabular-nums" />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-user`}>아이디</FieldLabel>
            <Input id={`${id}-user`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-pw`}>비밀번호</FieldLabel>
            <Input
              id={`${id}-pw`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={initial ? "바꿀 때만 입력" : ""}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-root`}>시작 폴더</FieldLabel>
            <Input id={`${id}-root`} value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/" />
            <FieldDescription>FTP 메뉴에서 이 폴더 안만 볼 수 있습니다. 전체를 보려면 / 그대로.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch id={`${id}-secure`} checked={secure} onCheckedChange={setSecure} />
            <FieldLabel htmlFor={`${id}-secure`}>암호화 접속(FTPS)</FieldLabel>
          </Field>
          {error && <FieldError>{error}</FieldError>}
          {tested && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              {tested}
            </p>
          )}
          {!footer && buttons}
        </FieldGroup>
      </form>
      {footer && <DialogFooter>{buttons}</DialogFooter>}
    </>
  )
}
