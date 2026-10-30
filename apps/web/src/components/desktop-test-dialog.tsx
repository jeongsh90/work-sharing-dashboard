import { useState } from "react"

import { runDesktopTest, type DesktopTestResult } from "@/lib/desktop-notify"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

// PC 알림이 안 뜰 때 확인할 곳. 위에서부터 차례로 본다.
const CHECK_STEPS = [
  "Windows 설정 → 시스템 → 알림에서 맨 위 '알림'을 켬으로",
  "같은 화면 아래 앱 목록에서 Google Chrome(또는 Microsoft Edge)을 켬으로",
  "같은 화면에서 방해 금지·집중 모드를 끄기",
  "브라우저 주소창 왼쪽 아이콘 → 사이트 설정 → 알림을 '허용'으로",
  "대시보드 탭은 닫지 말고 열어 두기(다른 탭·최소화는 괜찮음). Chrome 메모리 절약 모드를 쓰면 chrome://settings/performance 에서 이 사이트를 '항상 활성 상태로 유지'에 추가",
]

// PC 알림 테스트(헤더 버튼·내 정보 버튼 공통): 테스트 알림을 보낸 뒤 결과와 확인 단계를 창으로 보여 준다.
// run 을 버튼 onClick 에 걸고, dialog 를 화면에 함께 그린다.
export function useDesktopTest() {
  const [result, setResult] = useState<DesktopTestResult | null>(null)
  const run = async () => setResult(await runDesktopTest())

  const dialog = (
    <AlertDialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{result?.sent ? "테스트 알림을 보냈습니다" : "PC 알림을 보낼 수 없습니다"}</AlertDialogTitle>
          <AlertDialogDescription>{result?.sent ? "화면 오른쪽 아래에 알림이 떴는지 확인하세요." : result?.problem}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">알람이 안뜬다면 아래 단계를 확인하세요</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground break-keep">
            {CHECK_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={run}>
            다시 보내기
          </Button>
          <AlertDialogAction>확인</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { run, dialog }
}
