import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SmoothScrollArea } from "@/components/smooth-scroll-area"
import { Tip } from "@/components/tip"

// 색 견본을 누르면 뜨는 팔레트(Figma Libraries 처럼 묶음 제목 + 견본 줄).
// 맨 위는 상세페이지 디자인 색(detail.css :root), 그 아래는 Tailwind 기본 색(50~950, hex).

type Group = { name: string; label: string; colors: [string, string][] } // [이름, #hex]

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]
const TW: [string, string, string[]][] = [
  ["slate", "슬레이트", ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a", "#020617"]],
  ["gray", "그레이", ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827", "#030712"]],
  ["zinc", "징크", ["#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a", "#18181b", "#09090b"]],
  ["neutral", "뉴트럴", ["#fafafa", "#f5f5f5", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040", "#262626", "#171717", "#0a0a0a"]],
  ["stone", "스톤", ["#fafaf9", "#f5f5f4", "#e7e5e4", "#d6d3d1", "#a8a29e", "#78716c", "#57534e", "#44403c", "#292524", "#1c1917", "#0c0a09"]],
  ["red", "빨강", ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d", "#450a0a"]],
  ["orange", "주황", ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12", "#431407"]],
  ["amber", "앰버", ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f", "#451a03"]],
  ["yellow", "노랑", ["#fefce8", "#fef9c3", "#fef08a", "#fde047", "#facc15", "#eab308", "#ca8a04", "#a16207", "#854d0e", "#713f12", "#422006"]],
  ["lime", "라임", ["#f7fee7", "#ecfccb", "#d9f99d", "#bef264", "#a3e635", "#84cc16", "#65a30d", "#4d7c0f", "#3f6212", "#365314", "#1a2e05"]],
  ["green", "초록", ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d", "#052e16"]],
  ["emerald", "에메랄드", ["#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b", "#022c22"]],
  ["teal", "틸", ["#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a", "#042f2e"]],
  ["cyan", "시안", ["#ecfeff", "#cffafe", "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0891b2", "#0e7490", "#155e75", "#164e63", "#083344"]],
  ["sky", "하늘", ["#f0f9ff", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e", "#082f49"]],
  ["blue", "파랑", ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a", "#172554"]],
  ["indigo", "남색", ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81", "#1e1b4b"]],
  ["violet", "바이올렛", ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95", "#2e1065"]],
  ["purple", "보라", ["#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#c084fc", "#a855f7", "#9333ea", "#7e22ce", "#6b21a8", "#581c87", "#3b0764"]],
  ["fuchsia", "푸크시아", ["#fdf4ff", "#fae8ff", "#f5d0fe", "#f0abfc", "#e879f9", "#d946ef", "#c026d3", "#a21caf", "#86198f", "#701a75", "#4a044e"]],
  ["pink", "분홍", ["#fdf2f8", "#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843", "#500724"]],
  ["rose", "로즈", ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337", "#4c0519"]],
]

export const PALETTE: Group[] = [
  {
    name: "chefechan",
    label: "셰프애찬 상세페이지",
    colors: [
      ["white", "#ffffff"],
      ["brand orange", "#ff4d00"],
      ["orange-500", "#f97316"],
      ["ink", "#111111"],
      ["charcoal", "#161312"],
      ["body", "#555555"],
      ["line", "#e5e5ec"],
      ["bg alt", "#f2f2f2"],
      ["black", "#000000"],
    ],
  },
  ...TW.map(([name, label, hex]) => ({ name, label, colors: hex.map((h, i) => [`${name}-${SHADES[i]}`, h] as [string, string]) })),
]

// 견본(버튼) — 누르면 팔레트. value 는 지금 색(#hex, 틀리면 무시), onPick 에 고른 #hex
export function ColorSwatchPicker({ value, swatch, label, onPick, className = "size-6" }: { value: string; swatch: React.CSSProperties; label: string; onPick: (hex: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "")
    if (!q) return PALETTE
    return PALETTE.map((g) => (g.name.includes(q) || g.label.includes(q) ? g : { ...g, colors: g.colors.filter(([n, h]) => n.includes(q) || h.includes(q)) })).filter((g) => g.colors.length)
  }, [query])
  const current = value.trim().toLowerCase().replace(/^#?/, "#")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`${className} shrink-0 cursor-pointer rounded border outline-none focus-visible:ring-2 focus-visible:ring-ring`} style={swatch} aria-label={`${label} 팔레트에서 고르기`} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[21.5rem] gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="색 이름 (orange, 주황, 500 …)" aria-label="색 검색" className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <SmoothScrollArea className="max-h-80 overflow-y-auto" contentClassName="flex flex-col gap-3 p-3">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">
                {g.name === "chefechan" ? g.label : `${g.name} · ${g.label}`}
              </div>
              <div className="flex flex-wrap gap-1">
                {g.colors.map(([n, h]) => (
                  <Tip key={n} content={`${n} ${h}`}><button
                    type="button"
                    aria-label={`${n} ${h}`}
                    onClick={() => {
                      onPick(h)
                      setOpen(false)
                    }}
                    className={`size-6 cursor-pointer rounded border border-black/10 transition-transform hover:scale-110 dark:border-white/15 ${current === h ? "ring-2 ring-primary ring-offset-1 ring-offset-popover" : ""}`}
                    style={{ background: h }}
                  /></Tip>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">맞는 색이 없습니다</p>}
        </SmoothScrollArea>
      </PopoverContent>
    </Popover>
  )
}
