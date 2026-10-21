import { LoaderCircle } from "lucide-react"

// 데이터를 받는 중이거나 받지 못했을 때 화면 가운데에 띄운다.
export function PageState({ error, message }: { error?: string | null; message?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : message ? (
        <p>{message}</p>
      ) : (
        <>
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          <p>불러오는 중…</p>
        </>
      )}
    </div>
  )
}
