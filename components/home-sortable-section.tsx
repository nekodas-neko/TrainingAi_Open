"use client";

import { EyeOffIcon, GripVerticalIcon } from "lucide-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { cn } from "@trainingai/shared/utils";
import type { ReactNode } from "react";

interface Props {
  id: string;
  /** Position in the RENDERED list. `dnd-kit` only compares these, so the gaps left by hidden
   *  sections are harmless — the reorder itself is done by key (`moveSection`). */
  index: number;
  editMode: boolean;
  onHide?: (id: string) => void;
  children: ReactNode;
}

/**
 * One Home section: draggable to reorder and hideable, both only in edit mode.
 *
 * **It was named *Sortable* and could not sort (BF-205).** The header button set `sectionEditMode`
 * and said `aria-label="Reorder sections"`, the order was state with a loader and a saver, and a
 * `useLayoutEffect` kept a ref in sync *"so drag/sync handlers can read it synchronously"* — but
 * `setSectionOrder` had four call sites and none of them was a user gesture. The owner: *"when I
 * click the grid button on the home screen I cannot move widgets and re-arrange them."*
 *
 * **The drag is on a HANDLE, not the card**, and that is what keeps a plain vertical scroll in
 * edit mode from picking a section up. Home's sections live in a scrolling container, and a
 * whole-card drag would put the reorder and the scroll on the same touch — the direction-lock
 * class `docs/mobile-ui-and-performance.md` warns about, and the one the device pass would find.
 * `touch-none` on the handle is the other half: without it the browser claims the gesture for the
 * scroll before `PointerSensor` ever sees it.
 */
export function HomeSortableSection({ id, index, editMode, onHide, children }: Props) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled: !editMode });

  return (
    <div
      ref={ref}
      // The rendered order is otherwise unreadable from outside: the sections are a dozen
      // unrelated components with no shared marker, and the stored order is only written once a
      // drag has already happened. `e2e/bf205-home-section-drag.spec.ts` reads this.
      data-section-key={id}
      className={cn("relative transition-opacity", isDragging && "opacity-40")}
    >
      {editMode && (
        <button
          ref={handleRef}
          type="button"
          aria-label="Drag to reorder section"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 touch-none rounded-lg p-1 text-muted-foreground/70 transition active:scale-90"
        >
          <GripVerticalIcon className="h-4 w-4" />
        </button>
      )}
      {editMode && onHide && (
        <button
          onClick={() => onHide(id)}
          className="absolute right-5 top-1/2 -translate-y-1/2 z-10 rounded-lg p-1 text-muted-foreground/70 hover:text-muted-foreground active:scale-90 transition"
          aria-label="Hide section"
        >
          <EyeOffIcon className="h-4 w-4" />
        </button>
      )}
      <div className={cn(editMode && "pl-6 pr-7 transition-[padding]")}>
        {children}
      </div>
    </div>
  );
}
