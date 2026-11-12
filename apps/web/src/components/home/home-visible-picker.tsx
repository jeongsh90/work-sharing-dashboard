import { useState } from "react"
import { Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { api } from "@/lib/api"
import type { Session } from "@/lib/auth"
import { invalidate, type UserInfo } from "@/lib/store"

// 홈 디자인팀 카드에 보일 작업자 고르기(관리자). 팀 관리의 "메인 노출"과 같은 값을 바꾼다.
export function HomeVisiblePicker({ designers, session }: { designers: UserInfo[]; session: Session }) {
  const [busy, setBusy] = useState<string | null>(null)
  const shown = designers.filter((d) => d.showOnHome).length

  const toggle = async (d: UserInfo, v: boolean) => {
    setBusy(d.id)
    try {
      await api(`/users/${encodeURIComponent(d.id)}`, { method: "PATCH", body: { showOnHome: v } })
      invalidate()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Eye data-icon="inline-start" />
          노출 작업자
          <span className="text-muted-foreground tabular-nums">
            {shown}/{designers.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>홈에 보일 작업자</PopoverTitle>
          <PopoverDescription className="break-keep">체크한 사람만 디자인팀 카드에 보입니다. 팀 관리의 &lsquo;메인 노출&rsquo;과 같습니다.</PopoverDescription>
        </PopoverHeader>
        <ul className="mt-2 flex flex-col gap-0.5">
          {designers.map((d) => {
            // 관리자는 슈퍼관리자 계정을 바꿀 수 없다
            const locked = d.role === "superadmin" && session.role !== "superadmin"
            return (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <Checkbox
                    checked={d.showOnHome}
                    disabled={locked || busy === d.id}
                    aria-label={`${d.name} 홈에 보이기`}
                    onCheckedChange={(v) => void toggle(d, v === true)}
                  />
                  <span className="truncate">{d.name}</span>
                  {d.rank && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{d.rank}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
