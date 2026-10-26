import { CrowdCanvas } from "@/components/ui/skiper-ui/skiper39"
import peeps from "@/assets/login/open-peeps.webp"

// 로그인·회원가입 화면 배경: 사람들이 화면 아래를 걸어 다니는 그림(Skiper UI skiper39 · Open Peeps 일러스트).
// 움직임 줄이기 설정이면 그리지 않는다. Skiper UI 무료판은 출처 표시가 필요해 오른쪽 아래에 작게 적는다.
export default function LoginBackground() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null
  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <CrowdCanvas src={peeps} rows={15} cols={7} />
      </div>
      <p className="absolute right-3 bottom-2 z-10 rounded bg-background/70 px-1.5 text-[10px] text-muted-foreground">
        배경:{" "}
        <a href="https://skiper-ui.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          Skiper UI
        </a>{" "}
        ·{" "}
        <a href="https://www.openpeeps.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          Open Peeps
        </a>
      </p>
    </>
  )
}
