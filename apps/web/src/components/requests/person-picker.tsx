import { useMemo, useState } from "react"
import { Check, ChevronDown, Search, UserRoundPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { UserAvatar } from "@/components/user-avatar"
import { useUsers, type UserInfo } from "@/lib/store"

// 요청한 사람 고르기(대신 작성). 이름·부서로 찾는다. 계정이 없는 사람은 맨 아래 "계정 없음"을 골라 이름을 따로 적는다.
// value: 계정 id, NO_ACCOUNT(계정 없음), "" (아직 안 고름)
export const NO_ACCOUNT = "__none__"

export function PersonPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string
  value: string
  onChange: (id: string, user: UserInfo | null) => void
  invalid?: boolean
}) {
  const { users } = useUsers()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const people = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.active && u.approved)
        .sort((a, b) => a.department.localeCompare(b.department, "ko") || a.name.localeCompare(b.name, "ko")),
    [users],
  )
  const q = query.trim().toLowerCase()
  const shown = q ? people.filter((u) => `${u.name} ${u.department} ${u.rank}`.toLowerCase().includes(q)) : people
  const picked = people.find((u) => u.id === value)

  const pick = (next: string, user: UserInfo | null) => {
    onChange(next, user)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid}
          className="w-full justify-between font-normal aria-invalid:border-destructive"
        >
          {picked ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar name={picked.name} avatarId={picked.avatarId} className="size-5" fallbackClassName="text-[10px]" />
              <span className="truncate">{picked.name}</span>
              <span className="truncate text-muted-foreground">{[picked.department, picked.rank].filter(Boolean).join(" · ")}</span>
            </span>
          ) : value === NO_ACCOUNT ? (
            <span>계정 없음 (이름 직접 입력)</span>
          ) : (
            <span className="text-muted-foreground">요청한 사람을 골라 주세요</span>
          )}
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·부서로 찾기"
            className="pl-8"
            aria-label="요청한 사람 찾기"
          />
        </div>
        <SmoothScrollArea className="max-h-72 overflow-y-auto" contentClassName="flex flex-col p-1">
          {users === undefined && <p className="p-3 text-sm text-muted-foreground">불러오는 중…</p>}
          {users !== undefined && shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">찾는 사람이 없습니다.</p>}
          {shown.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pick(u.id, u)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <UserAvatar name={u.name} avatarId={u.avatarId} className="size-6" fallbackClassName="text-[10px]" />
              <span className="font-medium">{u.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {[u.department, u.rank].filter(Boolean).join(" · ")}
              </span>
              {u.id === value && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </SmoothScrollArea>
        <div className="border-t p-1">
          <button
            type="button"
            onClick={() => pick(NO_ACCOUNT, null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <UserRoundPlus className="size-4 text-muted-foreground" />
            계정 없음 (이름 직접 입력)
            {value === NO_ACCOUNT && <Check className="ml-auto size-4 text-primary" />}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
