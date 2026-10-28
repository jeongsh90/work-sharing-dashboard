import { useSyncExternalStore } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// 확인 창(shadcn AlertDialog). 브라우저 기본 confirm() 대신 쓴다.
//   if (!(await confirmDialog({ title: '지울까요?', confirmText: '삭제', destructive: true }))) return
// 화면 맨 바깥(main.tsx)에 <ConfirmHost /> 를 한 번 둔다.

type Request = { title: string; description?: string; confirmText?: string; destructive?: boolean; resolve: (ok: boolean) => void }

let current: Request | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function confirmDialog(options: Omit<Request, "resolve">) {
  return new Promise<boolean>((resolve) => {
    current?.resolve(false)
    current = { ...options, resolve }
    emit()
  })
}

function close(ok: boolean) {
  current?.resolve(ok)
  current = null
  emit()
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>취소</AlertDialogCancel>
          <AlertDialogAction
            variant={req?.destructive ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {req?.confirmText ?? "확인"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
