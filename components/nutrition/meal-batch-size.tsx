'use client'

import { memo } from 'react'
import { Plus, Minus, AlertTriangle } from 'lucide-react'

interface Props {
  servings: number
  onChange: (next: number) => void
  /**
   * An imported recipe whose page never stated a yield (BF-11c). The ingredient figures are the
   * WHOLE batch until the user answers, and nothing else on screen would reveal that — so this is
   * the one prompt the builder cannot infer from what it is showing.
   */
  unstatedYield: boolean
  /** Any answer clears the prompt, whichever control gave it. */
  onYieldAnswered: () => void
  /** Whole-batch calories, so the note can say what one portion of it comes to. */
  batchKcal: number
}

/**
 * How many portions a saved meal makes.
 *
 * Extracted from `saved-meals-sheet.tsx` when BF-11c's unstated-yield prompt took that file past
 * the 800-line ceiling — the repo's rule is that a hotspot absorbs new features into a child rather
 * than growing, and the builder has two more entries (BF-11d, BF-11f) still due to land in it.
 *
 * **Scalar props, and memoised.** It renders inside a form that re-renders on every keystroke in the
 * ingredient list; an object prop would defeat the memo silently (Q-490).
 */
export const MealBatchSize = memo(function MealBatchSize({
  servings, onChange, unstatedYield, onYieldAnswered, batchKcal,
}: Props) {
  // A recipe is often not one plate — the ingredients describe the whole batch, and this is what
  // turns that into a portion. Without it a meal plan put a two-serving tub of ice cream into one
  // slot as if it were one meal.
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        This recipe makes
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, Math.round((servings - 1) * 4) / 4))}
          aria-label="Fewer servings"
          className="flex-none w-12 h-12 rounded-lg bg-muted flex items-center justify-center"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          value={servings}
          onChange={e => {
            const n = parseFloat(e.target.value)
            if (Number.isFinite(n) && n >= 0.25) { onChange(Math.min(50, Math.round(n * 4) / 4)); onYieldAnswered() }
          }}
          aria-label="Servings this meal makes"
          className="min-w-0 flex-1 min-h-12 rounded-lg bg-muted px-2 text-sm font-bold tabular-nums text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => { onChange(Math.min(50, Math.round((servings + 1) * 4) / 4)); onYieldAnswered() }}
          aria-label="More servings"
          className="flex-none w-12 h-12 rounded-lg bg-muted flex items-center justify-center"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="flex-none text-xs text-muted-foreground">
          {servings === 1 ? 'portion' : 'portions'}
        </span>
      </div>
      {unstatedYield && (
        // The one case the figures below cannot reveal: the page gave a whole recipe and
        // never said how many it feeds, so leaving this at 1 quietly turns a loaf into a
        // portion. Amber and worded, never colour alone.
        <p
          className="flex items-start gap-1.5 text-[11px] leading-snug"
          style={{ color: 'var(--accent-amber)' }}
        >
          <AlertTriangle className="mt-px h-3 w-3 flex-none" />
          <span>
            That page didn&rsquo;t say how many this serves, so the ingredients below are the
            <strong> whole recipe</strong>. Set how many portions it makes before saving.
          </span>
        </p>
      )}
      {servings !== 1 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Enter the ingredients for the <strong>whole batch</strong> below. Logging this
          meal, and a meal plan using it, takes one portion —{' '}
          {Math.round(batchKcal / servings)} kcal of the{' '}
          {Math.round(batchKcal)} below.
        </p>
      )}
    </div>
  )
})
