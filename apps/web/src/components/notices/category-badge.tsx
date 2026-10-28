import { CATEGORY_STYLE, type NoticeCategory } from "@/lib/notices"

// 공지사항 말머리 배지(공지 · 주간보고)
export function CategoryBadge({ category, className = "" }: { category: NoticeCategory; className?: string }) {
  const c = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.notice
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${c.className} ${className}`}>{c.label}</span>
}
