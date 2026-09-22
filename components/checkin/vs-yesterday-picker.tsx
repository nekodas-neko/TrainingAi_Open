"use client"

import type { VsYesterday } from "@trainingai/shared/types/day-checkin"

interface Props {
  value: VsYesterday | null
  onChange: (v: VsYesterday | null) => void
}

/** TN-58. The absolute 1–5 "perceived recovery" above this produced **two distinct values across
 *  96 check-ins**, sd 0.29, none of them touched — a question with no variance cannot be a target
 *  for anything, which is what blocks TN-33. People order two things more reliably than they score
 *  one, so this asks for the comparison instead.
 *
 *  **No default and no pre-selection, which is the entire point.** `day_checkins.vs_yesterday` has
 *  no column default for the same reason: a neutral stored as though it were an answer is the
 *  defect TN-57 just fixed, and shipping one on the question meant to escape it would recreate it
 *  under a new name. A skipped answer stores NULL and reads as "not answered".
 *
 *  Tapping the selected option clears it, so a mis-tap is recoverable to unanswered rather than
 *  stuck on a value the owner did not mean — the sibling `IllnessContextPicker` does the same. The
 *  group is a `radiogroup` because "one of three" is what is being asked; the clear-on-retap is an
 *  affordance on top of that, not a licence to pick two.
 *
 *  Options live here rather than in `packages/shared` because they are display copy with one
 *  consumer, and that file belongs to the other lane. */
const OPTIONS: { value: VsYesterday; label: string; color: string }[] = [
  { value: 'better', label: 'Better',        color: 'var(--accent-green)' },
  { value: 'same',   label: 'About the same', color: 'var(--color-muted-foreground)' },
  { value: 'worse',  label: 'Worse',          color: 'var(--accent-amber)' },
]

export function VsYesterdayPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id="vs-yesterday-label" className="text-sm font-medium">Compared to yesterday</span>
      <div role="radiogroup" aria-labelledby="vs-yesterday-label" className="flex gap-1.5">
        {OPTIONS.map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected ? null : opt.value)}
              className="min-h-9 flex-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
              style={{
                borderColor: selected ? opt.color : undefined,
                background: selected ? `color-mix(in oklch, ${opt.color} 16%, transparent)` : undefined,
                color: selected ? opt.color : undefined,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
