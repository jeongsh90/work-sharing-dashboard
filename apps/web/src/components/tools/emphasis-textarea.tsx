import { useEffect, useRef, useState } from "react"
import { Highlighter } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

// 글을 드래그해 고르면 오른쪽 위에 "강조" 버튼이 뜬다(또는 Ctrl+B). 고른 부분을 **…** 로 감싸고, 이미지에서는 그 부분만 브랜드 색으로 그린다.
// 이미 강조한 부분을 다시 고르고 누르면 강조를 푼다.
function toggle(value: string, start: number, end: number) {
  const sel = value.slice(start, end)
  // 고른 부분 바로 바깥이 ** 면 풀기
  if (value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
    return { value: value.slice(0, start - 2) + sel + value.slice(end + 2), start: start - 2, end: end - 2 }
  }
  // ** 까지 같이 골랐으면 풀기
  if (sel.length > 4 && sel.startsWith("**") && sel.endsWith("**")) {
    const inner = sel.slice(2, -2)
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length }
  }
  // 감싸기: 안쪽 ** 는 지우고, 여러 줄이면 줄마다(앞뒤 띄어쓰기는 밖으로)
  const wrapped = sel
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)(.*?)(\s*)$/)!
      return m[2] ? `${m[1]}**${m[2]}**${m[3]}` : line
    })
    .join("\n")
  return { value: value.slice(0, start) + wrapped + value.slice(end), start, end: start + wrapped.length }
}

export function EmphasisTextarea({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & { value: string; onValueChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [selected, setSelected] = useState(false)

  const check = () => {
    const el = ref.current
    setSelected(!!el && document.activeElement === el && el.selectionEnd > el.selectionStart)
  }

  // 마우스로 끌거나 Shift+방향키로 고르는 것 모두 잡는다
  useEffect(() => {
    document.addEventListener("selectionchange", check)
    return () => document.removeEventListener("selectionchange", check)
  })

  const apply = () => {
    const el = ref.current
    if (!el || el.selectionEnd <= el.selectionStart) return
    const next = toggle(value, el.selectionStart, el.selectionEnd)
    onValueChange(next.value)
    // 바뀐 글이 그려진 뒤 고른 범위를 다시 잡는다
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.start, next.end)
      check()
    })
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onSelect={check}
        onKeyUp={check}
        onMouseUp={check}
        onBlur={() => setSelected(false)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault()
            apply()
          }
        }}
        className={className}
        {...props}
      />
      {selected && (
        <Button
          type="button"
          size="xs"
          // 누를 때 입력 칸의 선택이 풀리지 않게
          onMouseDown={(e) => e.preventDefault()}
          onClick={apply}
          className="absolute -top-3 right-2 z-10 bg-orange-500 text-white shadow-sm hover:bg-orange-600"
          title="고른 글을 브랜드 색으로 강조 (Ctrl+B, 다시 누르면 풀기)"
        >
          <Highlighter data-icon="inline-start" />
          강조
        </Button>
      )}
    </div>
  )
}
