import { useState } from "react"
import { Check, Repeat2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, ApiError } from "@/lib/api"
import { ROLE_LABEL, type Role, type Session } from "@/lib/auth"
import { useApi } from "@/lib/store"

type SwitchAccount = { id: string; name: string; role: Role }

// 계정 전환: 서버에 정해 둔 묶음(apps/api/src/config.ts 의 SWITCH_ACCOUNTS)끼리 비밀번호 없이 오간다.
// 묶음에 없는 계정은 서버가 403 을 주므로 버튼이 보이지 않는다.
export function AccountSwitcher({
  currentId,
  onSwitched,
}: {
  currentId: string
  onSwitched: (token: string, user: Session) => void
}) {
  const { data } = useApi<SwitchAccount[]>("/switch", 300_000)
  const [error, setError] = useState<string | null>(null)
  if (!data || data.length < 2) return null

  const switchTo = async (id: string) => {
    setError(null)
    try {
      const { token, user } = await api<{ token: string; user: Session }>("/switch", { body: { id } })
      onSwitched(token, user)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "전환하지 못했습니다.")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-1" aria-label="계정 전환">
          <Repeat2 data-icon="inline-start" />
          <span className="hidden sm:inline">계정 전환</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">계정 전환</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data.map((a) => (
          <DropdownMenuItem key={a.id} disabled={a.id === currentId} onSelect={() => switchTo(a.id)}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                {a.name} <span className="text-xs text-muted-foreground">· {ROLE_LABEL[a.role]}</span>
              </span>
              <span className="truncate text-xs text-muted-foreground">{a.id}</span>
            </div>
            {a.id === currentId && <Check className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        {error && <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
