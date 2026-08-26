'use client'

import { memo } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { MealThumb } from './meal-thumb'

interface Props {
  name: string
  /** Grey line beneath the name: *what and how much*. Absent lines simply do not render. */
  secondary?: string | null
  /** Right-hand column. `null` renders the column empty rather than collapsing it, so a list of
   *  rows keeps one ragged-right edge even when a row has no figure. */
  calories?: number | null
  showChevron?: boolean
  /**
   * Renders the 40 px meal tile on the left. Two props, not one nullable string, because the
   * distinction is real: `showThumb` says a row belongs to a list that has tiles, `thumbSrc` says
   * whether this particular row has a photo. A row in a tiled list with no photo still gets the
   * placeholder — that is the point of it (BF-32), and one nullable prop could not say so.
   */
  showThumb?: boolean
  /** A stored `data:` URI. Null renders the placeholder; only meaningful with `showThumb`. */
  thumbSrc?: string | null
  /** Keeps the tapped row visible under a sheet's scrim, so the sheet reads as belonging to it
   *  rather than as an unrelated screen (Q-395a). */
  highlighted?: boolean
  /**
   * An amber caution line under `secondary`. Q-406's owner decision (2026-08-26): the warning
   * **stays in the row**. The decided design had sent its sentence to the food's detail, and this
   * surface has none — tapping the row adds the food outright — so building that would have deleted
   * the only visible explanation on a warning meant to be read *before* use.
   *
   * One optional string, not a node: three call sites omit it, the same as the six other optional
   * props here. The entry's "no warning slot" bullet was written when the sentence was leaving the
   * row; it is not, so a slot is what keeping it costs.
   */
  warning?: string | null
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
 * **The thumbnail arrived in BF-32**, on the owner's instruction. It was deferred because an
 * `<img>` for an arbitrary user photo URL costs a `no-img-element` exemption and a loader decision;
 * a saved meal's photo is a `data:` URI capped at 128 px, so neither applies. It is opt-in per call
 * site — the artboards put tiles on meal-level rows only (the day screen, My Meals), never on the
 * ingredient rows inside a meal — and `meal-thumb.tsx` carries the rest of the reasoning.
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
  name, secondary, calories, showChevron, showThumb, thumbSrc, highlighted, warning, onPress, disabled,
}: Props) {
  const body = (
    <>
      {showThumb && <MealThumb src={thumbSrc} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-snug">{name}</span>
        {secondary && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
        )}
        {warning && (
          // Not truncated, unlike the lines above: a caution that trails off into an ellipsis is a
          // caution nobody reads. The icon carries the state alongside the words, so this is not
          // colour-only.
          <span
            className="mt-0.5 flex items-start gap-1 text-[10px] leading-snug"
            style={{ color: 'var(--accent-amber)' }}
          >
            <AlertTriangle className="mt-px h-3 w-3 flex-none" />
            {warning}
          </span>
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
