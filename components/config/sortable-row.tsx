"use client"

import type { ReactNode } from "react"
import { useSortable } from "@dnd-kit/react/sortable"
import { cn } from "@trainingai/shared/utils"

interface SortableRowProps {
  id: string
  index: number
  group?: string
  data?: Record<string, unknown>
  className?: string
  children: (args: { handleRef: (el: Element | null) => void }) => ReactNode
}

export function SortableRow({ id, index, group, data, className, children }: SortableRowProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, group, data })
  return (
    <div
      ref={ref}
      className={cn(className, "transition-opacity", isDragging && "opacity-40")}
    >
      {children({ handleRef })}
    </div>
  )
}
