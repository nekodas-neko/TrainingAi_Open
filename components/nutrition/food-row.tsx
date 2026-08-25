'use client'

import { memo } from 'react'
import { ChevronRight } from 'lucide-react'

interface Props {
  name: string
  /** Grey line beneath the name: *what and how much*. Absent lines simply do not render. */
  secondary?: string | null
  /** Right-hand column. `null` renders the column empty rather than collapsing it, so a list of
   *  rows keeps one ragged-right edge even when a row has no figure. */
  calories?: number | null
  showChevron?: boolean
  /** Keeps the tapped row visible under a sheet's scrim, so the sheet reads as belonging to it
   *  rather than as an unrelated screen (Q-395a). */
  highlighted?: boolean
  onPress?: () => void
  /** Row is `<button>` when pressable and a plain `<div>` otherwise — never a div with a click
   *  handler, which the WebView treats as untappable for accessibility purposes. */
  disabled?: boolean
}

/**
 * One food, drawn one way (Q-406).
 *
 * A food currently reads four different ways across the app — the diary, the library sheet, and the
 * two search lists — and each was written separately. This is the shape Q-395's design pass settled
 * on: name · grey secondary line · calories right-aligned in a fixed column · optional chevron.
 *
 * **The optional thumbnail Q-406 lists is deliberately not here yet.** No call site passes one, and
 * an unused `<img>` costs a `no-img-element` exemption for arbitrary user photo URLs. The phase that
 * first shows a thumbnail adds it, with the loader decision made where it can be seen.
 *
 * **Props are scalars, not objects.** The row renders inside `.map()`, where hooks are unavailable,
 * so a call site cannot memoise an object literal and one would silently defeat `React.memo` —
 * `meal-macro-bars.tsx` is the reference this repo already keeps for exactly that reason (Q-490).
 *
 * **The fixed-width calorie column is the point of the right-hand side.** Three of the four call
 * sites put calories somewhere different — a `w-16` column, a right-aligned block over a serving
 * sub-line, and inline inside the secondary text — so a list of foods never lined up. `tabular-nums`
 * with a fixed width is what makes a column of numbers scannable.
 */
export const FoodRow = memo(function FoodRow({
  name, secondary, calories, showChevron, highlighted, onPress, disabled,
}: Props) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-snug">{name}</span>
        {secondary && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
        )}
      </span>
      <span className="w-16 flex-none text-right text-sm font-semibold tabular-nums">
        {calories != null ? `${Math.round(calories)}` : ''}
        {calories != null && <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>}
      </span>
      {showChevron && <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />}
    </>
  )

  const className = `flex w-full items-center gap-3 px-4 py-3 text-left min-h-12${highlighted ? ' bg-brand/10' : ''}`

  return onPress ? (
    <button type="button" onClick={onPress} disabled={disabled} className={`${className} transition-colors active:bg-muted/40 disabled:opacity-50`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
})
