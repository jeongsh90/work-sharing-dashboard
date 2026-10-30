// 파일 형식 배지(확장자 기준). 디자인팀 자료실·파일공유자료실이 함께 쓴다.

export const TYPES: { key: string; label: string; exts: string[]; className: string }[] = [
  { key: "psd", label: "PSD", exts: ["psd", "psb"], className: "bg-[#001e36] text-[#31a8ff]" },
  { key: "ai", label: "AI", exts: ["ai", "eps"], className: "bg-[#330000] text-[#ff9a00]" },
  { key: "fig", label: "FIG", exts: ["fig"], className: "bg-[#1e1e1e] text-[#a259ff] ring-1 ring-white/15" },
  { key: "pdf", label: "PDF", exts: ["pdf"], className: "bg-red-600 text-white" },
  { key: "image", label: "이미지", exts: ["jpg", "jpeg", "png", "gif", "webp", "svg", "tif", "tiff", "bmp", "heic"], className: "bg-emerald-600 text-white" },
  { key: "font", label: "폰트", exts: ["ttf", "otf", "woff", "woff2"], className: "bg-slate-700 text-white" },
  { key: "zip", label: "압축", exts: ["zip", "rar", "7z", "alz", "egg"], className: "bg-amber-600 text-white" },
]
export const OTHER = { key: "etc", label: "기타", exts: [], className: "bg-muted text-muted-foreground" }

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "")
export const typeOf = (name: string) => TYPES.find((t) => t.exts.includes(extOf(name))) ?? OTHER
export const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

export function TypeBadge({ name, className = "" }: { name: string; className?: string }) {
  const t = typeOf(name)
  const ext = extOf(name)
  return (
    <span className={`flex items-center justify-center rounded-lg font-bold tracking-tight ${t.className} ${className}`}>
      {(t === OTHER ? ext || "FILE" : t.key === "image" || t.key === "font" || t.key === "zip" ? ext : t.label).toUpperCase().slice(0, 5)}
    </span>
  )
}
