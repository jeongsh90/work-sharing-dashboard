import { useEffect, useState } from "react"
import { Check, EllipsisVertical, ListChecks, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { confirmDialog } from "@/components/confirm-dialog"
import { Section } from "@/components/home/home-page"
import { PageState } from "@/components/page-state"
import { SortableList } from "@/components/sortable-list"
import { api, ApiError } from "@/lib/api"
import { PAGE_GRID, SHEET_STACK } from "@/lib/layout"
import { invalidate, useApi } from "@/lib/store"

// 체크리스트(개인 메뉴): 계정마다 자기 체크리스트를 여러 개 만들어 항목을 체크한다(남의 것은 안 보임, 서버 apps/api/src/checklists.ts).
// 같은 확인을 되풀이할 때는 "모두 해제"로 처음 상태로 돌린다.

type Item = { id: number; body: string; done: boolean; doneAt: number | null }
type List = { id: number; title: string; updatedAt: number; items: Item[] }

const SELECTED_KEY = "wsd.checklist.selected"
const readSelected = () => {
  try {
    return Number(localStorage.getItem(SELECTED_KEY)) || null
  } catch {
    return null
  }
}
const writeSelected = (id: number) => {
  try {
    localStorage.setItem(SELECTED_KEY, String(id))
  } catch {
    /* 저장 못 해도 괜찮다 */
  }
}

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// inSheet: 헤더 버튼으로 연 오른쪽 시트 안(위아래로 쌓는다)
export function ChecklistPage({ inSheet = false }: { inSheet?: boolean } = {}) {
  const { data, error } = useApi<List[]>("/checklists")
  // 체크·순서는 바로 화면에 반영하고(서버 응답을 기다리지 않음) 저장 뒤 다시 받는다
  const [lists, setLists] = useState<List[] | null>(null)
  useEffect(() => {
    if (data) setLists(data)
  }, [data])
  const [selected, setSelected] = useState<number | null>(readSelected)
  const [newTitle, setNewTitle] = useState("")
  const [pageError, setPageError] = useState<string | null>(null)

  if (!lists) return <PageState error={error} />

  const current = lists.find((l) => l.id === selected) ?? lists[0] ?? null
  const select = (id: number) => {
    setSelected(id)
    writeSelected(id)
  }
  const patchList = (id: number, f: (l: List) => List) => setLists((ls) => ls && ls.map((l) => (l.id === id ? f(l) : l)))

  const createList = async () => {
    const title = newTitle.trim()
    if (!title) return
    setPageError(null)
    try {
      const { id } = await api<{ id: number }>("/checklists", { body: { title } })
      setNewTitle("")
      select(id)
      invalidate()
    } catch (e) {
      setPageError(errText(e, "만들지 못했습니다."))
    }
  }

  const reorderLists = (next: List[]) => {
    setLists(next)
    void api("/checklists/order", { body: { ids: next.map((l) => l.id) } })
      .catch((e) => setPageError(errText(e, "순서를 저장하지 못했습니다.")))
      .finally(invalidate)
  }

  return (
    <div className={inSheet ? SHEET_STACK : PAGE_GRID}>
      {/* 왼쪽: 내 체크리스트 목록 */}
      <Section
        title="내 체크리스트"
        aside={<span className="text-sm text-muted-foreground tabular-nums">{lists.length}개</span>}
        className={inSheet ? "" : "col-span-12 lg:col-span-4"}
      >
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void createList()
            }}
          >
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={60} placeholder="새 체크리스트 이름" aria-label="새 체크리스트 이름" />
            <Button type="submit" disabled={!newTitle.trim()}>
              <Plus data-icon="inline-start" />
              만들기
            </Button>
          </form>
          {pageError && <FieldError>{pageError}</FieldError>}
          {lists.length === 0 ? (
            <p className="py-6 text-center text-sm break-keep text-muted-foreground">
              아직 체크리스트가 없습니다. 이름을 넣고 만들어 보세요(예: 상세페이지 올리기 전 확인).
            </p>
          ) : (
            <SortableList
              items={lists}
              onReorder={reorderLists}
              className="flex flex-col gap-1"
              renderItem={(l, handle) => {
                const done = l.items.filter((i) => i.done).length
                const active = current?.id === l.id
                return (
                  <div className={`flex items-center gap-1 rounded-lg pr-2 ${active ? "bg-accent" : "hover:bg-muted/60"}`}>
                    {handle}
                    <button
                      type="button"
                      onClick={() => select(l.id)}
                      aria-current={active ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm outline-none focus-visible:underline"
                    >
                      <span className={`min-w-0 flex-1 truncate ${active ? "font-medium" : ""}`}>{l.title}</span>
                      <span
                        className={`shrink-0 text-xs tabular-nums ${l.items.length > 0 && done === l.items.length ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                      >
                        {done}/{l.items.length}
                      </span>
                    </button>
                  </div>
                )
              }}
            />
          )}
        </div>
      </Section>

      {/* 오른쪽: 고른 체크리스트의 항목 */}
      <div className={inSheet ? "" : "col-span-12 lg:col-span-8"}>
        {current ? (
          <ListView key={current.id} list={current} patch={(f) => patchList(current.id, f)} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            <ListChecks className="size-8" />
            왼쪽에서 체크리스트를 만들면 여기에서 항목을 넣고 체크합니다.
          </div>
        )}
      </div>
    </div>
  )
}

function ListView({ list, patch, onDeleted }: { list: List; patch: (f: (l: List) => List) => void; onDeleted: () => void }) {
  const [newItem, setNewItem] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(list.title)
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)
  const [hideDone, setHideDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = list.items.filter((i) => i.done).length
  const total = list.items.length
  const percent = total ? Math.round((done / total) * 100) : 0
  const shown = hideDone ? list.items.filter((i) => !i.done) : list.items

  // 서버에 보내고, 실패하면 알린 뒤 서버 내용으로 되돌린다(다시 받기)
  const save = async (p: Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await p
    } catch (e) {
      setError(errText(e, fallback))
    } finally {
      invalidate()
    }
  }

  const addItem = async () => {
    const body = newItem.trim()
    if (!body) return
    setNewItem("")
    const tempId = -Date.now()
    patch((l) => ({ ...l, items: [...l.items, { id: tempId, body, done: false, doneAt: null }] }))
    await save(api(`/checklists/${list.id}/items`, { body: { body } }), "항목을 넣지 못했습니다.")
  }

  const toggle = (item: Item, value: boolean) => {
    if (item.id < 0) return
    patch((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: value, doneAt: value ? Date.now() : null } : i)) }))
    void save(api(`/checklist-items/${item.id}`, { method: "PATCH", body: { done: value } }), "저장하지 못했습니다.")
  }

  const saveEdit = async () => {
    if (!editing) return
    const body = editing.body.trim()
    setEditing(null)
    if (!body) return
    patch((l) => ({ ...l, items: l.items.map((i) => (i.id === editing.id ? { ...i, body } : i)) }))
    await save(api(`/checklist-items/${editing.id}`, { method: "PATCH", body: { body } }), "고치지 못했습니다.")
  }

  const removeItem = (item: Item) => {
    patch((l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }))
    void save(api(`/checklist-items/${item.id}`, { method: "DELETE" }), "지우지 못했습니다.")
  }

  const reorderItems = (next: Item[]) => {
    // 완료 숨기기 중이면 숨긴 항목은 원래 자리 뒤에 그대로 둔다
    const rest = list.items.filter((i) => !next.some((n) => n.id === i.id))
    const all = [...next, ...rest]
    patch((l) => ({ ...l, items: all }))
    void save(api(`/checklists/${list.id}/order`, { body: { ids: all.map((i) => i.id) } }), "순서를 저장하지 못했습니다.")
  }

  const rename = async () => {
    const t = title.trim()
    setRenaming(false)
    if (!t || t === list.title) return setTitle(list.title)
    patch((l) => ({ ...l, title: t }))
    await save(api(`/checklists/${list.id}`, { method: "PATCH", body: { title: t } }), "이름을 바꾸지 못했습니다.")
  }

  const reset = async () => {
    patch((l) => ({ ...l, items: l.items.map((i) => ({ ...i, done: false, doneAt: null })) }))
    await save(api(`/checklists/${list.id}/reset`, { method: "POST" }), "해제하지 못했습니다.")
  }

  const clearDone = async () => {
    if (!(await confirmDialog({ title: `완료한 항목 ${done}개를 지울까요?`, description: "지운 항목은 되돌릴 수 없습니다.", confirmText: "지우기", destructive: true }))) return
    patch((l) => ({ ...l, items: l.items.filter((i) => !i.done) }))
    await save(api(`/checklists/${list.id}/clear-done`, { method: "POST" }), "지우지 못했습니다.")
  }

  const removeList = async () => {
    if (!(await confirmDialog({ title: `"${list.title}" 체크리스트를 지울까요?`, description: `항목 ${total}개도 함께 지워지고 되돌릴 수 없습니다.`, confirmText: "삭제", destructive: true })))
      return
    await save(api(`/checklists/${list.id}`, { method: "DELETE" }), "지우지 못했습니다.")
    onDeleted()
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {/* 제목 줄: 이름(누르면 고치기) + 진행 + 메뉴 */}
      <div className="flex min-h-8 items-center gap-2">
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} aria-label="체크리스트 이름" onKeyDown={(e) => e.key === "Escape" && (setTitle(list.title), setRenaming(false))} />
            <Button type="submit" size="icon" aria-label="이름 저장">
              <Check />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="취소" onClick={() => (setTitle(list.title), setRenaming(false))}>
              <X />
            </Button>
          </form>
        ) : (
          <>
            <h2 className="min-w-0 truncate text-base font-semibold">{list.title}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {done}/{total}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={done === 0} onClick={() => void reset()}>
                <RotateCcw data-icon="inline-start" />
                모두 해제
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="체크리스트 메뉴">
                    <EllipsisVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>
                    <Pencil />
                    이름 바꾸기
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setHideDone((v) => !v)}>
                    <ListChecks />
                    {hideDone ? "완료 항목 보이기" : "완료 항목 숨기기"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={done === 0} onSelect={() => void clearDone()}>
                    <Trash2 />
                    완료 항목 지우기
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void removeList()}>
                    <Trash2 />
                    체크리스트 삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="flex items-center gap-3">
          <Progress value={percent} className="flex-1" aria-label="진행률" />
          <span className={`w-10 text-right text-xs tabular-nums ${total > 0 && done === total ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
            {percent}%
          </span>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addItem()
          }}
        >
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} maxLength={300} placeholder="항목을 입력하고 Enter" aria-label="새 항목" />
          <Button type="submit" variant="outline" disabled={!newItem.trim()}>
            <Plus data-icon="inline-start" />
            추가
          </Button>
        </form>
        {error && <FieldError>{error}</FieldError>}

        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">항목을 넣어 주세요.</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">모두 완료했습니다. (완료 항목 숨김 중)</p>
        ) : (
          <SortableList
            items={shown}
            onReorder={reorderItems}
            className="flex flex-col"
            renderItem={(item, handle) => (
              <div className="group flex items-center gap-2 rounded-lg pr-1 hover:bg-muted/50">
                {handle}
                {editing?.id === item.id ? (
                  <form
                    className="flex flex-1 gap-2 py-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void saveEdit()
                    }}
                  >
                    <Input
                      autoFocus
                      value={editing.body}
                      maxLength={300}
                      aria-label="항목 고치기"
                      onChange={(e) => setEditing({ id: item.id, body: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    />
                    <Button type="submit" size="icon" aria-label="저장">
                      <Check />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="취소" onClick={() => setEditing(null)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  <>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                      <Checkbox checked={item.done} disabled={item.id < 0} onCheckedChange={(v) => toggle(item, v === true)} />
                      <span className={`min-w-0 flex-1 text-sm break-keep ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.body}</span>
                    </label>
                    <div className="flex transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label={`${item.body} 고치기`} disabled={item.id < 0} onClick={() => setEditing({ id: item.id, body: item.body })}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${item.body} 지우기`} disabled={item.id < 0} onClick={() => removeItem(item)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          />
        )}
      </div>
      <p className="text-xs break-keep text-muted-foreground">
        내 계정에서만 보이는 체크리스트입니다(계정 전환으로 묶인 계정끼리는 함께 봅니다). 왼쪽 손잡이(⋮⋮)를 끌어 순서를 바꾸고, 같은 확인을 다시 할 때는 "모두 해제"를 누르세요.
      </p>
    </section>
  )
}
