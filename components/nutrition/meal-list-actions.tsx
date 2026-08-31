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
          {/* BF-73 ②. These were two equal-weight pills, which overstated the destructive one:
              creating a meal is the frequent act and deleting several is rare. The owner asked for
              *"a big 'New' button + a small delete bin"*, and the hierarchy is the point.

              **The bin keeps a full 44 dp hit box while reading as small.** Shrinking the label to
              an icon is the request; shrinking the target is a tap-floor regression, and this repo
              has a floor for exactly that reason.

              **Its accessible name still says `Delete meals`, and that wording is load-bearing.**
              BF-50 ④ renamed this control from `Select` *because* the owner could not tell what the
              mode was for — *"you cant do anything with it except delete"* — so the words are the
              fix that entry shipped. Dropping them visually is only safe while the accessible name
              carries them; `aria-label="Delete"` would quietly undo it.

              An icon-only entry point is defensible here specifically because the bin opens
              **selection mode** and deletes nothing on tap — the destructive confirm is still two
              steps away. */}
          {canSelect && (
            <Button
              variant="secondary" size="icon"
              className="h-11 w-11 shrink-0 rounded-full"
              aria-label="Delete meals"
              onClick={onStartSelecting}
            >
              <Trash2 className="w-[18px] h-[18px]" />
            </Button>
          )}
          <Button onClick={onNew} className="h-11 flex-1 rounded-full gap-1.5 text-[15px] font-semibold">
            <Plus className="w-[18px] h-[18px]" />
            New
          </Button>
        </>
      )}
    </div>
  )
}
