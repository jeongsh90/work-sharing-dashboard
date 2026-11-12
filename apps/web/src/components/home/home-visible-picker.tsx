import { useState } from "react"
import { ChevronDown, ChevronUp, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { api } from "@/lib/api"
import type { Session } from "@/lib/auth"
import { invalidate, type UserInfo } from "@/lib/store"

// 홈 디자인팀 카드에 보일 작업자 고르기(관리자). 팀 관리의 "메인 노출"과 같은 값을 바꾼다.
// 위·아래 화살표로 카드 순서도 바꾼다(계정 순서 sort 에 저장, 모두에게 같은 순서).
export function HomeVisiblePicker({ designers, session }: { designers: UserInfo[]; session: Session }) {
  const [busy, setBusy] = useState<string | null>(null)
  const shown = designers.filter((d) => d.showOnHome).length
  // 누르자마자 순서가 바뀌어 보이게 잠깐 들고 있는 순서(저장 후 새 목록이 오면 비운다)
  const [order, setOrder] = useState<string[] | null>(null)
  const list = order ? order.map((id) => designers.find((d) => d.id === id)).filter((d): d is UserInfo => !!d) : designers

  const move = async (i: number, dir: -1 | 1) => {
    const ids = list.map((d) => d.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOrder(ids)
    try {
      await api("/users/order", { method: "POST", body: { ids } })
      invalidate()
    } finally {
      setTimeout(() => setOrder(null), 1500)
    }
  }

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
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>홈에 보일 작업자</PopoverTitle>
          <PopoverDescription className="break-keep">체크한 사람만 디자인팀 카드에 보입니다. 화살표로 카드 순서를 바꿉니다. 팀 관리의 &lsquo;메인 노출&rsquo;과 같습니다.</PopoverDescription>
        </PopoverHeader>
        <ul className="mt-2 flex flex-col gap-0.5">
          {list.map((d, i) => {
            // 관리자는 슈퍼관리자 계정을 바꿀 수 없다
            const locked = d.role === "superadmin" && session.role !== "superadmin"
            return (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent has-[[role=checkbox]:disabled]:cursor-not-allowed has-[[role=checkbox]:disabled]:opacity-60">
                  <Checkbox
                    checked={d.showOnHome}
                    disabled={locked || busy === d.id}
                    aria-label={`${d.name} 홈에 보이기`}
                    onCheckedChange={(v) => void toggle(d, v === true)}
                  />
                  <span className="truncate">{d.name}</span>
                  {d.rank && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{d.rank}</span>}
                  <span className={`flex shrink-0 ${d.rank ? "" : "ml-auto"}`}>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`${d.name} 위로`} disabled={i === 0} onClick={(ev) => { ev.preventDefault(); void move(i, -1) }}>
                      <ChevronUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`${d.name} 아래로`} disabled={i === list.length - 1} onClick={(ev) => { ev.preventDefault(); void move(i, 1) }}>
                      <ChevronDown />
                    </Button>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
