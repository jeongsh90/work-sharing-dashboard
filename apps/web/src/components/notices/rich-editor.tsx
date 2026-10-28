import { useState } from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import TextAlign from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Placeholder } from "@tiptap/extensions"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ApiError, fileUrl, uploadFile } from "@/lib/api"

// 공지사항 에디터(Tiptap). 굵게·기울임·밑줄·취소선·제목·글자색·정렬·목록·인용·구분선·링크·그림.
// 그림은 고르거나 붙여 넣으면 바로 서버에 올리고, 본문에는 파일 id(data-file-id)를 남긴다(lib/notices.ts).

// 그림 노드에 파일 id 를 함께 둔다
const NoticeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-file-id"),
        renderHTML: (attrs) => (attrs.fileId ? { "data-file-id": attrs.fileId } : {}),
      },
    }
  },
})

const COLORS = [
  { label: "기본", value: null },
  { label: "주황(브랜드)", value: "#f97316" },
  { label: "빨강", value: "#ef4444" },
  { label: "파랑", value: "#3b82f6" },
  { label: "초록", value: "#16a34a" },
  { label: "회색", value: "#6b7280" },
]

async function insertImages(editor: Editor, files: File[], onError: (m: string) => void, setBusy: (b: boolean) => void) {
  const images = files.filter((f) => f.type.startsWith("image/"))
  if (images.length === 0) return
  setBusy(true)
  try {
    for (const file of images) {
      const up = await uploadFile(file)
      const src = await fileUrl(up.id)
      editor
        .chain()
        .focus()
        .insertContent({ type: "image", attrs: { src, alt: file.name.replace(/\.[^.]+$/, ""), fileId: up.id } })
        .run()
    }
  } catch (e) {
    onError(e instanceof ApiError ? e.message : "그림을 올리지 못했습니다.")
  } finally {
    setBusy(false)
  }
}

export function RichEditor({
  initialHtml,
  onChange,
  onError,
}: {
  initialHtml: string
  onChange: (html: string) => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      NoticeImage,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "공지 내용을 적어 주세요. 그림은 붙여 넣거나 끌어 놓아도 됩니다." }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: { class: "rich-content min-h-80 px-4 py-3 outline-none", "aria-label": "공지 내용" },
      // 붙여 넣기·끌어 놓기한 그림도 올린다
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.some((f) => f.type.startsWith("image/"))) return false
        void insertImages(editor!, files, onError, setBusy)
        return true
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])]
        if (!files.some((f) => f.type.startsWith("image/"))) return false
        event.preventDefault()
        void insertImages(editor!, files, onError, setBusy)
        return true
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  if (!editor) return null
  return (
    <div className="overflow-hidden rounded-lg border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Toolbar editor={editor} busy={busy} setBusy={setBusy} onError={onError} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Tool({ icon: Icon, label, active, onClick, disabled }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // 누를 때 본문 선택이 풀리지 않게
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon />
    </Button>
  )
}

function Toolbar({ editor, busy, setBusy, onError }: { editor: Editor; busy: boolean; setBusy: (b: boolean) => void; onError: (m: string) => void }) {
  // 버튼 눌림 상태는 선택이 바뀔 때마다 다시 읽는다
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  // 색을 고르면 창을 닫고 선택을 풀어(끝으로 커서) 바뀐 색이 바로 보이게 한다. 선택 표시(파란 바탕)에 가려 안 바뀐 것처럼 보이지 않게.
  const pickColor = (value: string | null) => {
    const end = editor.state.selection.to
    const chain = c()
    ;(value ? chain.setColor(value) : chain.unsetColor()).setTextSelection(end).run()
    setColorOpen(false)
  }
  const [href, setHref] = useState("")
  const c = () => editor.chain().focus()

  const pickImage = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.multiple = true
    input.onchange = () => void insertImages(editor, [...(input.files ?? [])], onError, setBusy)
    input.click()
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
      <Tool icon={Undo2} label="실행 취소" disabled={!s.canUndo} onClick={() => c().undo().run()} />
      <Tool icon={Redo2} label="다시 실행" disabled={!s.canRedo} onClick={() => c().redo().run()} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tool icon={Heading2} label="큰 제목" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} />
      <Tool icon={Heading3} label="작은 제목" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tool icon={Bold} label="굵게 (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()} />
      <Tool icon={Italic} label="기울임 (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()} />
      <Tool icon={Underline} label="밑줄 (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()} />
      <Tool icon={Strikethrough} label="취소선" active={s.strike} onClick={() => c().toggleStrike().run()} />
      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="글자 색" title="글자 색" onMouseDown={(e) => e.preventDefault()}>
            <Palette style={s.color ? { color: s.color } : undefined} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-auto flex-row gap-1 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
          {COLORS.map((col) => (
            <button
              key={col.label}
              type="button"
              title={col.label}
              aria-label={col.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickColor(col.value)}
              className={`size-7 rounded-md border ${s.color === col.value ? "ring-2 ring-ring" : ""}`}
              style={{ background: col.value ?? "var(--foreground)" }}
            />
          ))}
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tool icon={AlignLeft} label="왼쪽 정렬" active={s.left} onClick={() => c().setTextAlign("left").run()} />
      <Tool icon={AlignCenter} label="가운데 정렬" active={s.center} onClick={() => c().setTextAlign("center").run()} />
      <Tool icon={AlignRight} label="오른쪽 정렬" active={s.right} onClick={() => c().setTextAlign("right").run()} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tool icon={List} label="글머리 기호" active={s.bullet} onClick={() => c().toggleBulletList().run()} />
      <Tool icon={ListOrdered} label="번호 목록" active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
      <Tool icon={Quote} label="인용" active={s.quote} onClick={() => c().toggleBlockquote().run()} />
      <Tool icon={Minus} label="구분선" onClick={() => c().setHorizontalRule().run()} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Popover
        open={linkOpen}
        onOpenChange={(o) => {
          setLinkOpen(o)
          if (o) setHref((editor.getAttributes("link").href as string | undefined) ?? "")
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={s.link ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="링크"
            title="링크"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Link2 />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const url = href.trim()
              if (!url) c().extendMarkRange("link").unsetLink().run()
              else c().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run()
              setLinkOpen(false)
            }}
          >
            <Input value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" aria-label="링크 주소" autoFocus />
            <Button type="submit" size="sm">
              {href.trim() ? "넣기" : "빼기"}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <Tool icon={busy ? LoaderCircle : ImagePlus} label="그림 넣기" disabled={busy} onClick={pickImage} />
    </div>
  )
}
