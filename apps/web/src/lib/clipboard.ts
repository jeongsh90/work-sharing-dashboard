// 클립보드 복사.
// navigator.clipboard 는 https·localhost 에서만 동작한다. http://192.168.x.x:4173 처럼
// IP 로 접속하면 브라우저가 막으므로, 그때는 copy 이벤트에 직접 데이터를 실어 execCommand('copy') 로 복사한다.

function legacyCopy(data: Record<string, string>) {
  const ta = document.createElement("textarea")
  ta.value = data["text/plain"] ?? ""
  ta.setAttribute("readonly", "")
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none"
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault()
    for (const [type, value] of Object.entries(data)) e.clipboardData?.setData(type, value)
  }
  document.addEventListener("copy", onCopy, true)
  let ok = false
  try {
    ok = document.execCommand("copy")
  } finally {
    document.removeEventListener("copy", onCopy, true)
    ta.remove()
    active?.focus?.()
  }
  if (!ok) throw new Error("클립보드에 복사하지 못했습니다.")
}

/** 글자 복사 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 권한 거부 등 → 아래 방식으로
    }
  }
  legacyCopy({ "text/plain": text })
}

/** 서식(HTML)째 복사 — 붙여 넣는 곳이 서식을 받으면 양식 그대로, 아니면 plain 글자 */
export async function copyHtml(html: string, plain: string = html): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ])
      return
    } catch {
      // 아래 방식으로
    }
  }
  legacyCopy({ "text/html": html, "text/plain": plain })
}
