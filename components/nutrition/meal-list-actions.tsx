'use client'

import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** Non-null puts the row in selection mode — the count is what Delete would remove. */
  selectedCount: number | null
  /** Whether a Select control is worth offering at all: one meal cannot be a selection. */
  canSelect: boolean
  deleting: boolean
  onStartSelecting: () => void
  onCancelSelecting: () => void
  onConfirmDelete: () => void
  onNew: () => void
}

/**
 * The Meals tab's action row — Select/New, or Cancel/Delete once a selection is running.
 *
 * Extracted when BF-51's back-stack work took `saved-meals-sheet.tsx` past the 800-line ceiling.
 * That file is on its fifth extraction across three entries, which is the size rule working rather
 * than failing: it absorbs every nutrition feature by default, so anything self-contained leaves.
 *
 * **Scalar props, and a count rather than the `Set`** — the row only ever renders the size, and a
 * `Set` prop is a new identity every render for a component that sits under a sheet re-rendering on
 * each keystroke (Q-490).
 */
export function MealListActions({
  selectedCount, canSelect, deleting, onStartSelecting, onCancelSelecting, onConfirmDelete, onNew,
}: Props) {
  return (
    <div className="flex shrink-0 gap-2 px-4">
      {selectedCount != null ? (
        <>
          <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={onCancelSelecting}>
            Cancel
          </Button>
          <Button
            variant="destructive" className="flex-1 min-h-[44px] gap-1.5"
            disabled={selectedCount === 0 || deleting}
            onClick={onConfirmDelete}
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </Button>
        </>
      ) : (
        <>
          {/* Artboard 3 puts a single `+ New` pill in the header band, not a pair of full-width
              bars. It cannot literally sit beside the title — the sheet's close ✕ is
              `absolute top-4 right-4` and owns that corner — so the pills keep their own row and
              take the drawing's weight instead of its position. */}
          <span className="flex-1" />
          {/* BF-50 ④: *"There is a 'select' button that lets you select more than one meal; but then
              you cant do anything with it except delete."* Correct — Delete is the only action this
              mode has ever offered. The entry allowed either adding a second action or **saying what
              the mode is**, and this is the second: logging several saved meals needs a meal type
              and a portion for each, which is a screen rather than a button. Naming the mode is
              honest today and costs nothing if that screen is built later. */}
          {canSelect && (
            <Button
              variant="secondary" size="sm" className="min-h-[44px] rounded-full px-4 gap-1.5"
              onClick={onStartSelecting}
            >
              <Trash2 className="w-4 h-4" />
              Delete meals
            </Button>
          )}
          <Button onClick={onNew} size="sm" className="min-h-[44px] rounded-full px-4 gap-1.5">
            <Plus className="w-4 h-4" />
            New
          </Button>
        </>
      )}
    </div>
  )
}
