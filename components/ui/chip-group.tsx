'use client'

import { cn } from '@trainingai/shared/utils'

/**
 * A plain string is its own value and its own label — which is every option the meal-plan wizard
 * has. The object form exists because tags are `{ id, name }`: the value written to the payload is
 * an id the user must never see, and keying those chips by name would silently write names.
 */
export type ChipOption = string | { value: string; label: string }

interface Props {
  heading: string
  hint?: string
  options: readonly ChipOption[]
  /** Values, not labels. */
  selected: readonly string[]
  onToggle: (value: string) => void
  /** Shown in place of the chips when there are none — an empty row reads as a broken control. */
  emptyLabel?: string
}

const valueOf = (o: ChipOption) => typeof o === 'string' ? o : o.value
const labelOf = (o: ChipOption) => typeof o === 'string' ? o : o.label

/**
 * Multi-select pills.
 *
 * Lived in `meal-plan-setup-sheet.tsx` until BF-11f needed the same control for meal-type tags in
 * the meal builder — a second copy of a chip row is exactly the ≥2-sites case the repo extracts on,
 * and the pill markup here has already been copy-pasted enough times to drift.
 *
 * Deliberately **not** memoised: every call site passes at least one array, and both of the current
 * ones re-render only on the interaction that changes these chips anyway.
 */
export function ChipGroup({ heading, hint, options, selected, onToggle, emptyLabel }: Props) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        {heading}
      </p>
      {options.length === 0 && emptyLabel ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map(o => {
            const value = valueOf(o)
            const on = selected.includes(value)
            return (
              <button
                key={value}
                onClick={() => onToggle(value)}
                aria-pressed={on}
                className={cn(
                  'min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors',
                  on
                    ? 'border-brand/50 bg-brand/15 text-brand'
                    : 'border-border bg-muted/50 active:bg-muted/30',
                )}
              >
                {labelOf(o)}
              </button>
            )
          })}
        </div>
      )}
      {hint && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}
