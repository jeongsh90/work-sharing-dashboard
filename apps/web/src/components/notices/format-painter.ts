import { Extension, type Editor } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"

// 서식 복사(한글·워드의 모양 복사).
//   Ctrl+Shift+C : 커서(또는 고른 글 첫 글자)의 글자 모양(굵게·기울임·밑줄·취소선·색)과 문단 모양(제목 단계·정렬)을 기억
//   Ctrl+Shift+V : 고른 글(또는 커서가 있는 문단)에 기억한 모양을 입힘. 기억한 게 없으면 원래대로 서식 없이 붙여 넣기
//   도구 막대 붓 버튼: 누르면 복사하고 대기 → 다음에 글을 드래그해 고르면 바로 입히고 끝(Esc 로 취소)

type Copied = {
  marks: { type: string; attrs: Record<string, unknown> }[]
  block: { type: string; level?: number; textAlign?: string | null }
}

export type PainterStorage = { copied: Copied | null; armed: boolean; listeners: Set<() => void> }

const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "textStyle"])

function storageOf(editor: Editor) {
  return (editor.storage as unknown as { formatPainter: PainterStorage }).formatPainter
}

export function copyFormat(editor: Editor) {
  const { state } = editor
  const { from, to, empty, $from } = state.selection
  let marks = empty ? (state.storedMarks ?? $from.marks()) : null
  if (!marks) {
    // 고른 글의 첫 글자 모양
    state.doc.nodesBetween(from, to, (node) => {
      if (marks || !node.isText) return !marks
      marks = node.marks
      return false
    })
  }
  const parent = $from.parent
  const st = storageOf(editor)
  st.copied = {
    marks: (marks ?? []).filter((m) => MARK_TYPES.has(m.type.name)).map((m) => ({ type: m.type.name, attrs: { ...m.attrs } })),
    block: { type: parent.type.name, level: parent.attrs.level as number | undefined, textAlign: (parent.attrs.textAlign as string | null | undefined) ?? null },
  }
  st.listeners.forEach((l) => l())
  return true
}

export function pasteFormat(editor: Editor) {
  const copied = storageOf(editor).copied
  if (!copied) return false
  const { empty } = editor.state.selection
  let chain = editor.chain().focus()
  // 문단 모양: 제목 단계 또는 보통 문단, 정렬
  if (copied.block.type === "heading" && copied.block.level) chain = chain.setNode("heading", { level: copied.block.level })
  else if (copied.block.type === "paragraph") chain = chain.setNode("paragraph")
  chain = copied.block.textAlign ? chain.setTextAlign(copied.block.textAlign) : chain.unsetTextAlign()
  // 글자 모양: 고른 글이 있으면 그 글에, 없으면 이어 쓸 글자에
  if (!empty) {
    chain = chain.unsetAllMarks()
    for (const m of copied.marks) chain = chain.setMark(m.type, m.attrs)
  } else {
    chain = chain.command(({ tr, state }) => {
      tr.setStoredMarks(copied.marks.map((m) => state.schema.marks[m.type].create(m.attrs)))
      return true
    })
  }
  return chain.run()
}

export function setPainterArmed(editor: Editor, armed: boolean) {
  const st = storageOf(editor)
  st.armed = armed
  st.listeners.forEach((l) => l())
}

export const FormatPainter = Extension.create<object, PainterStorage>({
  name: "formatPainter",
  addStorage() {
    return { copied: null, armed: false, listeners: new Set() }
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => copyFormat(this.editor),
      "Mod-Shift-v": () => pasteFormat(this.editor),
      Escape: () => {
        if (!this.storage.armed) return false
        setPainterArmed(this.editor, false)
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const storage = this.storage
    return [
      new Plugin({
        key: new PluginKey("formatPainter"),
        props: {
          handleDOMEvents: {
            // 붓 대기 중이면 드래그로 고른 글에 바로 입힌다
            mouseup: () => {
              if (!storage.armed) return false
              setTimeout(() => {
                if (editor.state.selection.empty) return
                pasteFormat(editor)
                setPainterArmed(editor, false)
              }, 0)
              return false
            },
          },
        },
      }),
    ]
  },
})
