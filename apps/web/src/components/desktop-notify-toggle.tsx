import { BellRing } from "lucide-react"

import { Button } from "@/components/ui/button"
import { disableDesktop, enableDesktop, useDesktopNotify } from "@/lib/desktop-notify"

const DESCRIPTION = {
  unsupported: "이 브라우저는 PC 알림을 지원하지 않습니다. Chrome·Edge 로 열어 주세요.",
  blocked: "브라우저에서 이 사이트의 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 사이트 설정 → 알림을 '허용'으로 바꿔 주세요.",
  off: "켜 두면 다른 창을 보고 있을 때도 새 요청·컨펌·반려 알림이 Windows 알림으로 뜹니다.",
  on: "켜짐. 이 사이트가 열려 있는 동안(다른 탭·최소화 포함) 새 알림이 Windows 알림으로 뜹니다.",
}

// PC 알림 켜기/끄기. compact 는 알림함 위 안내 줄(켜져 있으면 숨긴다).
export function DesktopNotifyToggle({ compact = false }: { compact?: boolean }) {
  const state = useDesktopNotify()
  if (compact && (state === "on" || state === "unsupported")) return null

  const button =
    state === "on" ? (
      <Button variant="outline" size="sm" onClick={disableDesktop}>
        PC 알림 끄기
      </Button>
    ) : state === "off" ? (
      <Button size="sm" onClick={enableDesktop}>
        <BellRing data-icon="inline-start" />
        PC 알림 켜기
      </Button>
    ) : null

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
        <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-muted-foreground">{DESCRIPTION[state]}</p>
        {button}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{DESCRIPTION[state]}</p>
      {button && <div>{button}</div>}
    </div>
  )
}
