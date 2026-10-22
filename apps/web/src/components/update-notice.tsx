import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { Session } from "@/lib/auth"
import { navigate } from "@/lib/router"
import { markSeen, readSeen } from "@/lib/seen"
import { APP_VERSION, CHANGELOG, NOTICE_SINCE } from "@/lib/version"

// 업데이트 공지 팝업: 로그인하면 화면 가운데에 NOTICE_SINCE 이후 변경 내역을 띄운다.
// "다시 보지 않기"를 체크하고 닫으면 이 계정은 이번 버전 공지를 더 보지 않는다(다음 버전이 나오면 다시 뜬다).
export function UpdateNotice({ session }: { session: Session }) {
  const [open, setOpen] = useState(() => readSeen(session.id, "notice") !== APP_VERSION)
  const [hide, setHide] = useState(false)
  const releases = CHANGELOG.filter((r) => r.date >= NOTICE_SINCE)

  const close = (thenOpenVersion = false) => {
    if (hide) markSeen(session.id, "notice", APP_VERSION)
    setOpen(false)
    if (thenOpenVersion) navigate("version")
  }

  if (releases.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>업데이트 안내 · v{APP_VERSION}</DialogTitle>
          <DialogDescription>디자인 요청·작업 관리 시스템에 아래 기능이 추가·변경되었습니다.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex max-h-[55svh] flex-col gap-4 overflow-y-auto px-1" data-lenis-prevent>
          {releases.map((r) => (
            <section key={r.version} className="flex flex-col gap-1.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                v{r.version}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{r.date}</span>
              </h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Label className="flex cursor-pointer items-center gap-2 font-normal">
            <Checkbox checked={hide} onCheckedChange={(v) => setHide(v === true)} />
            다시 보지 않기
          </Label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(true)}>
              자세히 보기
            </Button>
            <Button onClick={() => close()}>확인</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
