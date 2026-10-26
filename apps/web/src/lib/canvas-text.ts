// 디자인 툴 캔버스 그리기 공통: 글꼴(Noto Sans KR 500·700) 불러오기와 칸 폭에 맞춘 줄바꿈.

export const FONT = '"Noto Sans KR"'

// 글꼴을 한 번만 불러온다(Google Fonts). 못 불러와도 그리기는 이어 간다.
let fontsReady: Promise<void> | null = null
export function loadFonts() {
  if (!fontsReady) {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700&display=block"
    document.head.appendChild(link)
    fontsReady = new Promise<void>((resolve) => {
      link.onload = () =>
        Promise.all([document.fonts.load(`700 40px ${FONT}`, "가나다"), document.fonts.load(`500 26px ${FONT}`, "가나다")]).then(
          () => resolve(),
          () => resolve(),
        )
      link.onerror = () => resolve()
    })
  }
  return fontsReady
}

export type TextStyle = { weight: 500 | 700; size: number; spacing: number } // spacing: 글자 크기 대비 자간(예 -0.02)

export function applyFont(ctx: CanvasRenderingContext2D, s: TextStyle) {
  ctx.font = `${s.weight} ${s.size}px ${FONT}`
  ctx.letterSpacing = `${s.size * s.spacing}px`
}

// 줄바꿈 조각: space = 앞에 띄어쓰기가 있었는지(쪼갠 조각끼리는 붙여 쓴다)
type Piece = { t: string; space: boolean }

// 낱말 단위 줄바꿈(word-break: keep-all 과 같다: 띄어쓰기에서만 줄을 바꾼다). 낱말 하나가 칸보다 길면 쉼표 뒤에서, 그래도 길면 글자 단위로 끊어
// 칸 밖으로 넘치지 않게 한다. 글자는 바꾸지 않는다(띄어쓰기도 원문 그대로). 줄바꿈 문자는 새 줄.
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const width = (s: string) => ctx.measureText(s).width
  const lines: string[] = []
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("")
      continue
    }
    const pieces: Piece[] = []
    para
      .trim()
      .split(/ +/)
      .forEach((word, wi) => {
        const first = (t: string, i: number) => ({ t, space: wi > 0 && i === 0 })
        if (width(word) <= maxWidth) return pieces.push(first(word, 0))
        // 쉼표 뒤에서 나누고, 그래도 긴 조각은 글자 단위로
        const parts = word.split(/(?<=,)/).flatMap((p) => {
          if (width(p) <= maxWidth) return [p]
          const chunks: string[] = []
          let cur = ""
          for (const ch of p) {
            if (cur && width(cur + ch) > maxWidth) {
              chunks.push(cur)
              cur = ch
            } else cur += ch
          }
          if (cur) chunks.push(cur)
          return chunks
        })
        parts.forEach((p, i) => pieces.push(first(p, i)))
      })
    let line = ""
    for (const p of pieces) {
      const next = line ? `${line}${p.space ? " " : ""}${p.t}` : p.t
      if (line && width(next) > maxWidth) {
        lines.push(line)
        line = p.t
      } else line = next
    }
    lines.push(line)
  }
  return lines
}
