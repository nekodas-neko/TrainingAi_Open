'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { perPortion, showsPerPortion, type MealMacroTotals } from '@/components/nutrition/meal-builder-portions'

interface Props {
  hasIngredients: boolean
  batchKcal: number
  protein: number
  carbs: number
  fat: number
  servings: number
  saving: boolean
  /** Editing an existing meal rather than building a new one — the button says which. */
  editing: boolean
  canSave: boolean
  onSave: () => void
}

/**
 * **The pinned footer is the point of the builder screen.**
 *
 * It keeps the batch total, the macro split and the per-portion figure on screen *while ingredients
 * are being edited* — which is the whole reason to have a screen here rather than a list. The same
 * numbers were always computed live, but sat in a card partway down the scroll, so the moment you
 * were editing the thing that changed them they were gone. Artboard 5 pins them.
 *
 * Extracted from `saved-meals-sheet.tsx` when BF-11c's candidate picker took that file past the
 * 800-line ceiling. **Scalar props and memoised**, because it re-renders on every keystroke in the
 * ingredient list and an object prop would defeat the memo silently (Q-490).
 */
export const MealBuilderFooter = memo(function MealBuilderFooter({
  hasIngredients, batchKcal, protein, carbs, fat, servings, saving, editing, canSave, onSave,
}: Props) {
  // `px-4` matches the scrolling body above it (BF-45 ③): the footer is a sibling of that
  // container, not a child, so it does not inherit the gutter — the Save button ran to the sheet's
  // edge while the ingredients it saves sat 16px in.
  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-t border-border px-4 pt-2.5">
      {/* BF-121: two labelled lines rather than one row mixing denominators. The batch total is
          what the ingredient list sums to and is worth keeping while a whole tray is entered; the
          per-portion line is what `Log this meal` writes and what the detail sheet already shows.
          A second LINE rather than six more numbers on the first: that row already carries a label,
          a kcal figure and three macros, and squeezing more onto it at 412 dp is exactly how BF-116
          happened one screen over. */}
      {hasIngredients && (
        <div className="flex flex-col gap-1">
          <MacroLine label="Batch" totals={{ calories: batchKcal, protein, carbs, fat }} bold />
          {showsPerPortion(servings) && (
            <MacroLine
              label="Per portion"
              totals={perPortion({ calories: batchKcal, protein, carbs, fat }, servings)}
            />
          )}
        </div>
      )}
      <Button
        className="w-full h-12 font-semibold"
        // `onClick={onSave}` would hand React's click event to `onSave`'s first parameter. That is
        // invisible to TypeScript — `() => void` accepts a handler with more parameters, and
        // `onClick` accepts a nullary one — and it broke `handleSave(overwrite?)` silently: every
        // save from this button looked like an "overwrite this existing meal" save, which skipped
        // BF-11d's duplicate check entirely and sent `undefined` where BF-11f's tags should be.
        onClick={() => onSave()}
        disabled={saving || !canSave}
      >
        {saving ? (editing ? 'Updating…' : 'Saving…') : (editing ? 'Update Meal' : 'Save Meal')}
      </Button>
    </div>
  )
})

/**
 * One labelled row of kcal + P/C/F. Two instances rather than two copies, so the batch and
 * per-portion lines cannot drift in format — which is the shape of the bug this fixes.
 */
function MacroLine({ label, totals, bold }: { label: string; totals: MealMacroTotals; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
      <span className={`tabular-nums ${bold ? 'text-sm font-bold' : 'text-xs font-semibold text-muted-foreground'}`}>
        {Math.round(totals.calories)} kcal
      </span>
      <span className="flex-1" />
      {/* `MACRO_COLORS`, like every other macro readout — the artboard's own hex values are this
          palette, so parity and the token rule agree here. */}
      <span className="text-xs font-semibold tabular-nums" style={{ color: MACRO_COLORS.protein }}>
        {Math.round(totals.protein)} P
      </span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: MACRO_COLORS.carbs }}>
        {Math.round(totals.carbs)} C
      </span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: MACRO_COLORS.fat }}>
        {Math.round(totals.fat)} F
      </span>
    </div>
  )
}
