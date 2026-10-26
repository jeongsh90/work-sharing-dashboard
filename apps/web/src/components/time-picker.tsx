import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// 시각 고르기(shadcn Select 두 개: 시 · 분). 값은 'HH:MM'. 분은 5분 단위이고, 지금 값이 5분 단위가 아니면 그 값도 넣어 둔다.
const pad = (n: number) => String(n).padStart(2, "0")
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h))
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5))

export function TimePicker({
  value,
  onChange,
  className,
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
}) {
  const [h = "09", m = "00"] = value.split(":")
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort()
  const label = (hh: string) => {
    const n = Number(hh)
    return `${n < 12 ? "오전" : "오후"} ${pad(n % 12 === 0 ? 12 : n % 12)}시`
  }
  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <Select value={h} onValueChange={(v) => onChange(`${v}:${m}`)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="시">
          <SelectValue>{label(h)}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {HOURS.map((hh) => (
            <SelectItem key={hh} value={hh}>
              {label(hh)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={m} onValueChange={(v) => onChange(`${h}:${v}`)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="분">
          <SelectValue>{m}분</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {minutes.map((mm) => (
            <SelectItem key={mm} value={mm}>
              {mm}분
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
