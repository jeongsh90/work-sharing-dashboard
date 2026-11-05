import { useEffect, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Code, Download, FolderPlus, Folder, CornerLeftUp, ExternalLink, LoaderCircle, RefreshCw, Search, Trash2, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { confirmDialog } from "@/components/confirm-dialog"
import { TypeBadge } from "@/components/file-type"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { api, ApiError, formatBytes, ftpDownloadFile, ftpFetchFile, ftpUploadFile } from "@/lib/api"
import { isManager, type Session } from "@/lib/auth"
import { PAGE_GRID } from "@/lib/layout"
import { formatDateTime } from "@/lib/requests"
import { useApi } from "@/lib/store"
import { Tip } from "@/components/tip"

// FTP: 슈퍼관리자가 등록한 FTP 서버(카페24 등)를 사이트 안에서 쓴다(서버 apps/api/src/ftp.ts 가 대신 접속).
// 폴더를 눌러 들어가고, 파일을 끌어다 놓거나 "파일 업로드"로 올리고, 줄의 받기 버튼으로 내려받는다. 지우기는 관리자만.
// 이미지는 누르면 미리보기, 줄의 <> 버튼은 <img src="웹 주소"> 를 복사한다(웹 주소는 관리 → FTP 서버에서 넣음).

type Server = { id: string; name: string; root: string; serviceStart?: string; serviceEnd?: string; serviceUrl?: string }

// 제목 옆 서비스 이용기간. 만료 30일 안이면 주황, 지나면 빨강
function ServicePeriod({ start, end, url, admin }: { start?: string; end?: string; url?: string; admin: boolean }) {
  const check = url ? (
    <Button asChild variant="outline" size="xs">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink data-icon="inline-start" />
        확인
      </a>
    </Button>
  ) : null
  // 아직 안 넣었으면: 슈퍼관리자에게만 넣는 곳 안내
  if (!start && !end)
    // 기간 없이 확인 페이지만 있으면 만료 없는 서비스(예: 카페24 쇼핑몰 호스팅)
    return check ? (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        서비스 이용기간 만료 없음
        {check}
      </span>
    ) : admin ? (
      <a href="#/ftp-servers" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        서비스 이용기간 미입력 · 관리 → FTP 서버에서 넣기
      </a>
    ) : null
  const fmt = (s: string) => s.replace(/-/g, ". ")
  let left: number | null = null
  if (end) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const e = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)))
    left = Math.round((e.getTime() - today.getTime()) / 86_400_000)
  }
  // 남은 날 배지: 넉넉하면 초록, 30일 안이면 주황, 지나면 빨강
  const tone = left === null ? "" : left < 0 ? "bg-red-500/15 text-red-600 ring-red-500/30 dark:text-red-400" : left <= 30 ? "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400"
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground tabular-nums">
      <span>서비스 이용기간 {start ? fmt(start) : ""} ~ {end ? fmt(end) : ""}</span>
      {left !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${tone}`}>{left < 0 ? `만료 ${-left}일 지남` : left === 0 ? "오늘 만료" : `D-${left}`}</span>}
      {check}
    </span>
  )
}
type Item = { name: string; raw: string; dir: boolean; size: number; modifiedAt: number | string | null; url: string | null }
// path·root·raw: FTP 의 실제 이름 바이트(base64url). 한 서버에 UTF-8·EUC-KR 이름이 섞여 있어도 그대로 지정한다
type Listing = { path: string; root: string; display: string; crumbs: { label: string; path: string }[]; items: Item[] }
type Upload = { key: string; name: string; ratio: number; error: string | null }

const LAST_KEY = "wsd-ftp-last2"
const isImage = (name: string) => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(name)
const imgTag = (url: string) => `<img src="${url}">`
function readLast(): { server?: string; paths?: Record<string, string> } {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}")
  } catch {
    return {}
  }
}
function saveLast(server: string, path: string) {
  try {
    const last = readLast()
    localStorage.setItem(LAST_KEY, JSON.stringify({ server, paths: { ...last.paths, [server]: path } }))
  } catch {
    /* 저장 못 해도 그대로 쓴다 */
  }
}


export function FtpPage({ session }: { session: Session }) {
  const { data: servers, error } = useApi<Server[]>("/ftp/servers", 300_000)
  const [serverId, setServerId] = useState<string | null>(() => readLast().server ?? null)
  // 다음에 열 폴더(목록 API 물음 줄: "" 시작 폴더, path=…, path=…&into=…, path=…&up)
  const [nav, setNav] = useState<string | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [uploads, setUploads] = useState<Upload[]>([])
  const [busy, setBusy] = useState<string | null>(null) // 내려받는 중인 파일
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null) // 미리 보는 이미지 이름
  const [copied, setCopied] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const canDelete = isManager(session)

  const server = servers?.find((s) => s.id === serverId) ?? servers?.[0] ?? null

  // 서버를 고르면 그 서버에서 마지막에 보던 폴더(없으면 시작 폴더)
  useEffect(() => {
    if (!server) return
    const last = readLast().paths?.[server.id]
    setNav(last ? `path=${last}` : "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id])

  const load = async (q = nav) => {
    if (!server || q === null) return
    setLoading(true)
    setListError(null)
    try {
      const data = await api<Listing>(`/ftp/${server.id}/list?${q}`)
      setListing(data)
      saveLast(server.id, data.path)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "폴더를 열지 못했습니다.")
      // 마지막 폴더가 없어졌으면 시작 폴더로
      if (q !== "") setNav("")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    setQuery("")
    void load(nav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, nav])

  if (!servers) return <PageState error={error} />
  if (servers.length === 0 || !server) {
    return (
      <PageState
        message={session.role === "superadmin" ? "등록한 FTP 서버가 없습니다. 관리 → FTP 서버에서 추가해 주세요." : "아직 등록한 FTP 서버가 없습니다."}
      />
    )
  }

  const current = listing?.path ?? ""
  const atRoot = !listing || listing.path === listing.root
  const items = (listing?.items ?? [])
    .filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "ko") : a.dir ? -1 : 1))

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return
    const dir = current
    const existing = new Set((listing?.items ?? []).filter((i) => !i.dir).map((i) => i.name))
    const same = files.filter((f) => existing.has(f.name))
    if (
      same.length > 0 &&
      !(await confirmDialog({
        title: `같은 이름의 파일이 있습니다(${same.length}개)`,
        description: `${same.map((f) => f.name).slice(0, 5).join(", ")}${same.length > 5 ? " 등" : ""} — 덮어쓸까요?`,
        confirmText: "덮어쓰기",
        destructive: true,
      }))
    )
      return
    const batch = files.map((f) => ({ key: `${Date.now()}-${Math.random()}`, name: f.name, ratio: 0, error: null as string | null }))
    setUploads((u) => [...u, ...batch])
    const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)))
    // 두 개씩 함께 올린다
    let next = 0
    const worker = async () => {
      while (next < files.length) {
        const i = next++
        try {
          await ftpUploadFile(server.id, dir, files[i], (ratio) => patch(batch[i].key, { ratio }))
          patch(batch[i].key, { ratio: 1 })
          setTimeout(() => setUploads((u) => u.filter((x) => x.key !== batch[i].key)), 2500)
        } catch (e) {
          patch(batch[i].key, { error: e instanceof ApiError ? e.message : "올리지 못했습니다." })
        }
      }
    }
    await Promise.all([worker(), worker()])
    void load(`path=${dir}`)
  }

  const download = async (item: Item) => {
    setBusy(item.name)
    try {
      await ftpDownloadFile(server.id, current, item.raw, item.name)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "내려받지 못했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const copySrc = async (item: Item) => {
    if (!item.url) return
    try {
      await navigator.clipboard.writeText(imgTag(item.url))
      setCopied(item.name)
      setTimeout(() => setCopied((c) => (c === item.name ? null : c)), 1800)
    } catch {
      setListError("클립보드에 복사하지 못했습니다.")
    }
  }
  const images = items.filter((i) => !i.dir && isImage(i.name))

  const remove = async (item: Item) => {
    if (
      !(await confirmDialog({
        title: `"${item.name}" 을(를) 지울까요?`,
        description: item.dir ? "빈 폴더만 지울 수 있습니다. FTP 에서 바로 지워져 되돌릴 수 없습니다." : "FTP 에서 바로 지워져 되돌릴 수 없습니다.",
        confirmText: "삭제",
        destructive: true,
      }))
    )
      return
    try {
      await api(`/ftp/${server.id}/file?path=${current}&name=${item.raw}${item.dir ? "&dir" : ""}`, { method: "DELETE" })
      void load(`path=${current}`)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : "지우지 못했습니다.")
    }
  }

  return (
    <div className={PAGE_GRID}>
      <Section
        title={server ? `FTP - ${server.name}` : "FTP"}
        aside={server && <ServicePeriod start={server.serviceStart} end={server.serviceEnd} url={server.serviceUrl} admin={session.role === "superadmin"} />}
        className="col-span-12"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMkdirOpen(true)}>
              <FolderPlus data-icon="inline-start" />새 폴더
            </Button>
            <Button onClick={() => fileInput.current?.click()}>
              <Upload data-icon="inline-start" />
              파일 업로드
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void uploadFiles(Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
          </div>
        }
      >
        {/* 서버 고르기(왼쪽) · 검색(오른쪽) */}
        <div className="flex flex-wrap items-center gap-2">
          {servers.length > 1 &&
            servers.map((s) => (
              <Button
                key={s.id}
                variant={s.id === server.id ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => {
                  // 지금 열린 서버를 다시 누르면 시작 폴더를 다시 불러온다(목록만 비우면 빈 폴더로 보임)
                  if (s.id === server.id) {
                    if (nav === "") void load("")
                    else setNav("")
                    return
                  }
                  setServerId(s.id)
                  setListing(null)
                  setNav(null)
                }}
              >
                {s.name}
              </Button>
            ))}
          <div className="relative w-full sm:ml-auto sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이 폴더에서 찾기" className="pl-8" aria-label="이 폴더에서 찾기" />
          </div>
        </div>

        {/* 경로 */}
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <Button variant="ghost" size="icon-sm" aria-label="위 폴더" disabled={atRoot} onClick={() => setNav(`path=${current}&up`)}>
            <CornerLeftUp />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNav("")}>
            {server.name}
            {server.root !== "/" && <span className="text-muted-foreground">{server.root}</span>}
          </Button>
          {(listing?.crumbs ?? []).map((c, i, all) => (
            <span key={c.path} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" />
              <Button variant="ghost" size="sm" disabled={i === all.length - 1} onClick={() => setNav(`path=${c.path}`)}>
                {c.label}
              </Button>
            </span>
          ))}
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="새로고침" onClick={() => void load(`path=${current}`)}>
            <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        </div>

        {listError && (
          <p className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {listError}
            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="닫기" onClick={() => setListError(null)}>
              <X />
            </Button>
          </p>
        )}

        {uploads.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            {uploads.map((u) => (
              <div key={u.key} className="flex items-center gap-3 text-sm">
                <Tip content={u.name}><span className="w-48 truncate sm:w-80">
                  {u.name}
                </span></Tip>
                {u.error ? (
                  <>
                    <span className="flex-1 text-destructive">{u.error}</span>
                    <Button variant="ghost" size="icon-xs" aria-label="닫기" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <>
                    <Progress value={u.ratio * 100} className="flex-1" />
                    <span className="w-10 text-right text-muted-foreground tabular-nums">{Math.round(u.ratio * 100)}%</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 목록. 파일을 끌어다 놓으면 지금 폴더에 올린다 */}
        <div
          className={`relative rounded-xl border ${dragging ? "border-primary bg-primary/5" : ""}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void uploadFiles(Array.from(e.dataTransfer.files))
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead className="w-28 text-right">크기</TableHead>
                <TableHead className="hidden w-44 md:table-cell">수정한 날</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!listing && loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    여는 중…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    {query.trim() ? "찾는 이름이 없습니다." : "빈 폴더입니다. 파일을 여기에 끌어다 놓으면 올라갑니다."}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.name}
                    className={item.dir || isImage(item.name) ? "cursor-pointer" : ""}
                    onClick={() => (item.dir ? setNav(`path=${current}&into=${item.raw}`) : isImage(item.name) && setPreview(item.name))}
                  >
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-2">
                        {item.dir ? (
                          <Folder className="size-5 shrink-0 fill-amber-400/30 text-amber-500" />
                        ) : (
                          <TypeBadge name={item.name} className="h-5 min-w-9 shrink-0 px-1 text-[10px]" />
                        )}
                        <Tip content={item.name}><span className={`truncate ${item.dir ? "font-medium" : ""}`}>
                          {item.name}
                        </span></Tip>
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{item.dir ? "" : formatBytes(item.size)}</TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                      {typeof item.modifiedAt === "number" ? formatDateTime(new Date(item.modifiedAt)) : (item.modifiedAt ?? "")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        {!item.dir && isImage(item.name) && (
                          <Tip content={item.url ? "<img src> 복사" : "관리 → FTP 서버에서 웹 주소를 넣으면 쓸 수 있습니다"} wrap><Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${item.name} img src 복사`}
                            disabled={!item.url}
                            onClick={() => void copySrc(item)}
                          >
                            {copied === item.name ? <Check className="text-emerald-600" /> : <Code />}
                          </Button></Tip>
                        )}
                        {!item.dir && (
                          <Button variant="ghost" size="icon-sm" aria-label={`${item.name} 내려받기`} disabled={busy === item.name} onClick={() => void download(item)}>
                            {busy === item.name ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Download />}
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon-sm" aria-label={`${item.name} 지우기`} onClick={() => void remove(item)}>
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl text-sm font-medium text-primary">
              놓으면 지금 폴더({listing?.display})에 올립니다
            </div>
          )}
        </div>
        <p className="text-xs break-keep text-muted-foreground">
          파일은 서버 PC 를 거쳐 FTP 로 바로 갑니다. 같은 이름이 있으면 물어본 뒤 덮어씁니다.{canDelete ? " 폴더는 비어 있을 때만 지울 수 있습니다." : ""}
        </p>
      </Section>

      <PreviewDialog
        serverId={server.id}
        dir={current}
        images={images}
        name={preview}
        onName={setPreview}
        copied={copied}
        onCopy={(item) => void copySrc(item)}
        onDownload={(item) => void download(item)}
      />

      <MkdirDialog
        open={mkdirOpen}
        dir={listing?.display ?? ""}
        onClose={() => setMkdirOpen(false)}
        onCreate={async (name) => {
          await api(`/ftp/${server.id}/mkdir`, { body: { path: current, name } })
          setMkdirOpen(false)
          void load(`path=${current}`)
        }}
      />
    </div>
  )
}

function MkdirDialog({ open, dir, onClose, onCreate }: { open: boolean; dir: string; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName("")
      setError(null)
    }
  }, [open])
  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await onCreate(name.trim())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "만들지 못했습니다.")
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 폴더</DialogTitle>
          <DialogDescription className="break-all">{dir} 안에 만듭니다.</DialogDescription>
        </DialogHeader>
        <form
          id="ftp-mkdir"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ftp-mkdir-name">폴더 이름</FieldLabel>
              <Input id="ftp-mkdir-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="ftp-mkdir" disabled={pending || !name.trim()}>
            {pending ? "만드는 중…" : "만들기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 이미지 미리보기. 같은 폴더의 이미지를 ← → 로 넘겨 본다. 한 번 받은 이미지는 닫을 때까지 다시 받지 않는다
function PreviewDialog({
  serverId,
  dir,
  images,
  name,
  onName,
  copied,
  onCopy,
  onDownload,
}: {
  serverId: string
  dir: string
  images: Item[]
  name: string | null
  onName: (name: string | null) => void
  copied: string | null
  onCopy: (item: Item) => void
  onDownload: (item: Item) => void
}) {
  const cache = useRef(new Map<string, string>())
  const [shown, setShown] = useState<{ name: string; src: string } | null>(null)
  const [failed, setFailed] = useState<{ name: string; message: string } | null>(null)
  const [size, setSize] = useState<{ name: string; w: number; h: number } | null>(null)
  const index = images.findIndex((i) => i.name === name)
  const item = index >= 0 ? images[index] : null
  const open = item !== null

  // 폴더가 바뀌거나 닫으면 받아 둔 이미지를 비운다
  useEffect(() => {
    const map = cache.current
    return () => {
      map.forEach((u) => URL.revokeObjectURL(u))
      map.clear()
    }
  }, [serverId, dir, open])

  const key = item ? `${item.raw}:${item.size}` : null
  useEffect(() => {
    if (!item || !key) return
    const hit = cache.current.get(key)
    if (hit) {
      setShown({ name: item.name, src: hit })
      return
    }
    let alive = true
    ftpFetchFile(serverId, dir, item.raw, true)
      .then((blob) => {
        const src = URL.createObjectURL(blob)
        cache.current.set(key, src)
        if (alive) setShown({ name: item.name, src })
      })
      .catch((e) => alive && setFailed({ name: item.name, message: e instanceof ApiError ? e.message : "미리보기를 불러오지 못했습니다." }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, dir, key])

  const go = (step: number) => {
    if (images.length < 2 || index < 0) return
    onName(images[(index + step + images.length) % images.length].name)
  }
  const ready = item !== null && shown?.name === item.name
  const error = item && failed?.name === item.name ? failed.message : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onName(null)}>
      <DialogContent
        className="flex max-h-[92vh] flex-col sm:max-w-4xl"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1)
          if (e.key === "ArrowRight") go(1)
        }}
      >
        <DialogHeader>
          <Tip content={item?.name}><DialogTitle className="truncate pr-6">
            {item?.name}
          </DialogTitle></Tip>
          <DialogDescription className="tabular-nums">
            {item && formatBytes(item.size)}
            {item && size?.name === item.name && ` · ${size.w} × ${size.h}px`}
            {images.length > 1 && ` · ${index + 1} / ${images.length}`}
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-h-40 flex-1 overflow-hidden rounded-lg border bg-muted/40">
          {error ? (
            <p className="p-10 text-center text-sm text-destructive">{error}</p>
          ) : !ready || !item || !shown ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              불러오는 중…
            </p>
          ) : (
            <SmoothScrollArea className="max-h-[64vh] overflow-y-auto" contentClassName="flex justify-center">
              <img
                src={shown.src}
                alt={item.name}
                className="h-auto max-w-full"
                onLoad={(e) => setSize({ name: item.name, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            </SmoothScrollArea>
          )}
          {images.length > 1 && (
            <>
              <Button variant="secondary" size="icon" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full shadow" aria-label="이전 이미지" onClick={() => go(-1)}>
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full shadow" aria-label="다음 이미지" onClick={() => go(1)}>
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
        {item && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <Tip content={item.url ? imgTag(item.url) : undefined}><code className="min-w-0 truncate text-xs text-muted-foreground">
              {item.url ? imgTag(item.url) : "웹 주소를 넣지 않은 FTP 라 img src 를 만들 수 없습니다(관리 → FTP 서버)."}
            </code></Tip>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => onDownload(item)}>
                <Download data-icon="inline-start" />
                내려받기
              </Button>
              <Button disabled={!item.url} onClick={() => onCopy(item)}>
                {copied === item.name ? <Check data-icon="inline-start" /> : <Code data-icon="inline-start" />}
                {copied === item.name ? "복사됨" : "img src 복사"}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
