'use client'

import { memo } from 'react'
import { ChevronLeft, Pencil } from 'lucide-react'
import { SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'

interface Props {
  onBack: () => void
  name: string
  onNameChange: (next: string) => void
  renaming: boolean
  onRenamingChange: (next: boolean) => void
  /** Editing an existing meal rather than building a new one — only the placeholder title differs. */
  editing: boolean
  hasIngredients: boolean
  servings: number
  /** Whole-batch calories, so the subtitle can say what one portion comes to. */
  batchKcal: number
}

/**
 * The builder screen's own header (Q-395a).
 *
 * The meal's name IS the title once it has one, edited in place beside a pencil — "Edit Meal" said
 * nothing the screen did not already show, and a labelled field in the body put the name and the
 * figure describing it a screen apart. The batch line is its subtitle for the same reason.
 *
 * Extracted from `saved-meals-sheet.tsx` when BF-11d's duplicate prompt took that file past the
 * 800-line ceiling — the third extraction out of that builder in two entries, which is the rule
 * working: a hotspot absorbs new features into children rather than growing.
 *
 * **Scalar props and memoised**: it sits above an ingredient list that re-renders on every
 * keystroke, and an object prop would defeat the memo silently (Q-490).
 */
export const MealBuilderHeader = memo(function MealBuilderHeader({
  onBack, name, onNameChange, renaming, onRenamingChange, editing, hasIngredients, servings, batchKcal,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onBack} aria-label="Back" className="p-2.5 -ml-1.5 text-muted-foreground hover:text-foreground rounded-lg">
        <ChevronLeft className="w-5 h-5" />
      </button>
      {/* Q-395a: the meal's name is the screen title once it has one, and the batch
          explainer is its subtitle — "Edit Meal" said nothing the screen did not already
          show, and the batch figure was buried below the fold. */}
      <div className="min-w-0 flex-1">
        {/* Artboard 5 edits the name in place, next to a pencil. It used to cost a labelled
            field of its own in the body — which was never a separate step, but did mean the
            name and the figure describing it sat a screen apart. */}
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={e => onNameChange(e.target.value)}
            onBlur={() => onRenamingChange(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onRenamingChange(false) }}
            placeholder="e.g. Post-workout shake"
            aria-label="Meal name"
            className="h-8 rounded-lg px-2 text-base font-semibold"
          />
        ) : (
          <button
            onClick={() => onRenamingChange(true)}
            aria-label={`Rename ${name.trim() || 'this meal'}`}
            className="flex min-w-0 items-center gap-1.5 text-left"
          >
            <SheetTitle className="truncate">
              {name.trim() || (editing ? 'Edit Meal' : 'Build a Meal')}
            </SheetTitle>
            <Pencil className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          </button>
        )}
        {hasIngredients && (
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            Makes {servings} {servings === 1 ? 'portion' : 'portions'} ·{' '}
            {Math.round(batchKcal / servings)} kcal each
          </p>
        )}
      </div>
    </div>
  )
})
