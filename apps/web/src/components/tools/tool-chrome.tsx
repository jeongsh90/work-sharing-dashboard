import { createContext, useContext, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

// 디자인 툴 창 머리(제목 줄)와 도구 화면을 잇는다:
// - ToolHeaderActions: 도구가 머리 오른쪽(X 왼쪽)에 버튼을 넣는다(예: 동영상 도구의 "저장하기")
// - useToolDirty: 저장하지 않은 작업이 있으면 X·Esc 로 닫을 때 확인 창을 띄운다
type Chrome = { actions: HTMLElement | null; setDirty: (dirty: boolean) => void }

export const ToolChromeContext = createContext<Chrome>({ actions: null, setDirty: () => {} })

export function ToolHeaderActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(ToolChromeContext)
  return actions ? createPortal(children, actions) : null
}

export function useToolDirty(dirty: boolean) {
  const { setDirty } = useContext(ToolChromeContext)
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])
  useEffect(() => () => setDirty(false), [setDirty])
}
