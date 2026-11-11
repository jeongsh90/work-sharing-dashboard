import loginBg from "@/assets/login/login-bg.jpg"

// 로그인·회원가입 카드 오른쪽 칸: 배경 그림 + 아래쪽 어두운 그라데이션 위에 제목.
// 그림이 어두워 테마와 상관없이 글자는 흰색이다. 좁은 화면(md 미만)에서는 숨긴다.
export function LoginSide({ note }: { note?: string }) {
  return (
    <div className="relative hidden flex-col justify-end gap-1 overflow-hidden bg-muted p-8 md:flex">
      <img src={loginBg} alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/90 via-black/50 to-transparent" aria-hidden />
      <p className="relative text-sm text-white/70">DESIGN REQUEST &amp; WORK</p>
      <p className="relative text-xl font-bold text-white">디자인 요청·작업 관리 시스템</p>
      {note && <p className="relative mt-2 text-sm text-white/70">{note}</p>}
    </div>
  )
}
