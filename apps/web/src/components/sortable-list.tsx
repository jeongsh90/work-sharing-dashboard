import type { ReactNode } from "react"
import { GripVertical } from "lucide-react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// 끌어서 순서 바꾸는 목록(@dnd-kit). 줄 왼쪽 손잡이(⋮⋮)를 잡고 끈다. 키보드: 손잡이에서 스페이스 → 방향키 → 스페이스.
export function SortableList<T extends { id: number }>({
  items,
  onReorder,
  renderItem,
  className,
}: {
  items: T[]
  onReorder: (next: T[]) => void
  renderItem: (item: T, handle: ReactNode) => ReactNode
  className?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.id === active.id)
    const to = items.findIndex((i) => i.id === over.id)
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {(handle) => renderItem(item, handle)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ id, children }: { id: number; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="끌어서 순서 바꾸기"
      className="flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      {children(handle)}
    </div>
  )
}
