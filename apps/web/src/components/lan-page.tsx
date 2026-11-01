import { useEffect, useState } from "react"
import { CircleCheck, CircleSlash, LoaderCircle, Monitor, RefreshCw, Trash2, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { api, ApiError, API_BASE, lanDeviceToken, setLanDeviceToken, storedToken } from "@/lib/api"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { invalidate, useApi, useUserNames } from "@/lib/store"

// 관리 → 사내망 직통: 같은 사무실 PC 가 파일을 바깥 중계 대신 서버 PC 로 바로 주고받게 PC 를 등록한다(서버 apps/api/src/lan.ts).
// 등록은 그 PC 에서 이 화면을 열어 "이 PC 등록"을 누른다. IP 가 아니라 그 브라우저에 둔 열쇠로 알아보므로 IP 가 바뀌어도 그대로 쓴다.

type Device = { id: string; name: string; lastIp: string; createdBy: string; createdAt: number; lastSeen: number }
type Here =
  | { state: "checking" }
  | { state: "off" } // 서버에 사내망 주소가 없음
  | { state: "unreachable"; url: string } // 이 PC 에서 닿지 않음(회사 밖·방화벽)
  | { state: "ok"; url: string; ip: string; device: { id: string; name: string } | null }

// 사내망 주소로 보내는 요청(로그인 + 이 PC 열쇠)
async function lanFetch(url: string, path: string, init: RequestInit = {}) {
  const token = storedToken()
  const device = lanDeviceToken()
  const res = await fetch(`${url}/api${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { "X-Lan-Device": device } : {}),
    },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "요청을 처리하지 못했습니다.")
  return body
}

export function LanPage() {
  const { data: devices, error } = useApi<Device[]>("/lan/devices")
  const userName = useUserNames()
  const [here, setHere] = useState<Here>({ state: "checking" })
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const check = async () => {
    setHere({ state: "checking" })
    try {
      const { url } = (await (await fetch(`${API_BASE}/api/lan`)).json()) as { url: string | null }
      if (!url) return setHere({ state: "off" })
      try {
        const who = (await lanFetch(url, "/lan/whoami")) as { ip: string; device: { id: string; name: string } | null }
        // 서버에서 지운 PC 면 이 브라우저의 열쇠도 버린다
        if (!who.device && lanDeviceToken()) setLanDeviceToken(null)
        setHere({ state: "ok", url, ...who })
        if (who.device) setName(who.device.name)
      } catch {
        setHere({ state: "unreachable", url })
      }
    } catch {
      setHere({ state: "off" })
    }
  }
  useEffect(() => {
    void check()
  }, [])

  if (!devices) return <PageState error={error} />

  const register = async () => {
    if (here.state !== "ok" || !name.trim()) return
    setPending(true)
    setMessage(null)
    try {
      const { token } = (await lanFetch(here.url, "/lan/devices", { method: "POST", body: JSON.stringify({ name: name.trim() }) })) as { token: string }
      setLanDeviceToken(token)
      invalidate()
      await check()
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "등록하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  const remove = async (d: Device) => {
    if (!(await confirmDialog({ title: `"${d.name}" PC 를 지울까요?`, description: "그 PC 는 다시 바깥 중계로 파일을 주고받습니다(느려짐).", confirmText: "삭제", destructive: true })))
      return
    await api(`/lan/devices/${d.id}`, { method: "DELETE" })
    if (here.state === "ok" && here.device?.id === d.id) setLanDeviceToken(null)
    invalidate()
    await check()
  }

  return (
    <div className={PAGE_GRID}>
      <Section title="이 PC" className="col-span-12 lg:col-span-5">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <p className="text-sm break-keep text-muted-foreground">
            같은 사무실 PC 를 등록하면 파일 올리기·큰 파일 받기가 바깥 중계 대신 서버 PC 로 바로 가서 훨씬 빠릅니다. 등록할 PC 에서 이 화면을 열어 등록해
            주세요. 공유기가 IP 를 바꿔도 등록은 그대로입니다(브라우저마다 따로 등록).
          </p>
          {here.state === "checking" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              사내망 주소에 닿는지 확인하는 중…
            </p>
          ) : here.state === "off" ? (
            <p className="flex items-center gap-2 text-sm">
              <CircleSlash className="size-4 text-muted-foreground" />
              서버에 사내망 직통이 켜져 있지 않습니다.
            </p>
          ) : here.state === "unreachable" ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <CircleSlash className="size-4 text-destructive" />이 PC 에서는 사내망 주소에 닿지 않습니다
              </p>
              <p className="break-keep text-muted-foreground">
                회사 밖이거나 다른 네트워크에 연결된 PC 입니다. 사무실 PC 인데 이렇게 보이면 서버 PC 에서 open-lan-4443-all.bat 을 실행했는지,
                브라우저가 "로컬 네트워크 접근"을 물었을 때 허용했는지 확인해 주세요.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Monitor className="size-4 text-muted-foreground" />
                <span className="tabular-nums">IP {here.ip}</span>
                {here.device ? (
                  <Badge className="gap-1 bg-emerald-600 text-white">
                    <CircleCheck className="size-3" />
                    등록됨 · 빠른 길 사용 중
                  </Badge>
                ) : (
                  <Badge variant="outline">등록 안 됨</Badge>
                )}
              </div>
              <Field>
                <FieldLabel htmlFor="lan-name">PC 이름</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="lan-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    placeholder="예: 디자인팀 이동훈 자리"
                    onKeyDown={(e) => e.key === "Enter" && void register()}
                  />
                  <Button disabled={pending || !name.trim()} onClick={() => void register()}>
                    <Zap data-icon="inline-start" />
                    {here.device ? "이름 바꾸기" : "이 PC 등록"}
                  </Button>
                </div>
                <FieldDescription>누구 자리 PC 인지 알아볼 수 있게 적어 주세요.</FieldDescription>
                {message && <FieldError>{message}</FieldError>}
              </Field>
            </>
          )}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void check()}>
            <RefreshCw data-icon="inline-start" />
            다시 확인
          </Button>
        </div>
      </Section>

      <Section
        title="등록한 PC"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{devices.length}대</span>}
        className="col-span-12 lg:col-span-7"
      >
        {devices.length === 0 ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">아직 등록한 PC 가 없습니다.</p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PC 이름</TableHead>
                  <TableHead>마지막 IP</TableHead>
                  <TableHead>마지막 사용</TableHead>
                  <TableHead>등록</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.name}
                      {here.state === "ok" && here.device?.id === d.id && <span className="ml-2 text-xs text-primary">(이 PC)</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{d.lastIp || "-"}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDateTime(new Date(d.lastSeen))}</TableCell>
                    <TableCell className="text-muted-foreground">{userName(d.createdBy)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label={`${d.name} 지우기`} onClick={() => void remove(d)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  )
}
