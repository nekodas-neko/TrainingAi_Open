"use client"

import type { VsNormal } from "@trainingai/shared/types/day-checkin"

interface Props {
  value: VsNormal | null
  onChange: (v: VsNormal | null) => void
}

/** TN-58. The absolute 1–5 "perceived recovery" above this produced **two distinct values across
 *  96 check-ins**, sd 0.29, none of them touched — a question with no variance cannot be a target
 *  for anything, which is what blocks TN-33. People order two things more reliably than they score
 *  one, so this asks for the comparison instead.
 *
 *  **The neutral IS pre-selected (LB-191), against the recommendation and by the owner's explicit
 *  call** — he was shown TN-58's measurement and the specific cost, that a one-tap Save makes a
 *  reflexive answer indistinguishable from a considered one, and chose the default anyway. Settled:
 *  do not re-propose no-default here.
 *
 *  **What still separates "not answered" from "about the same" is the DISMISSAL, and it is now the
 *  only thing that does.** `day_checkins.vs_normal` still has no column default and the sheet
 *  still writes solely on Save, so closing with the X stores nothing at all. A later change that
 *  wrote a row on close would erase the distinction without touching this file, which is why the
 *  e2e spec asserts the dismissal and not just the control.
 *
 *  ⚠ **`LB-190`'s `vs_question` marks the WORDING shift only** (1 = yesterday, 2 = normal). The
 *  seeded neutral is a SECOND boundary inside question 1, and no stored value separates the rows
 *  before it from the ones after. See `LB-198`.
 *
 *  Tapping the selected option clears it, so a mis-tap is recoverable to unanswered rather than
 *  stuck on a value the owner did not mean — the sibling `IllnessContextPicker` does the same. With
 *  a neutral seeded that retap is also how he reaches NULL deliberately, so it carries more weight
 *  than it did. The group is a `radiogroup` because "one of three" is what is being asked; the
 *  clear-on-retap is an affordance on top of that, not a licence to pick two.
 *
 *  Options live here rather than in `packages/shared` because they are display copy with one
 *  consumer, and that file belongs to the other lane. */
const OPTIONS: { value: VsNormal; label: string; color: string }[] = [
  { value: 'better', label: 'Better',        color: 'var(--accent-green)' },
  { value: 'same',   label: 'About the same', color: 'var(--color-muted-foreground)' },
  { value: 'worse',  label: 'Worse',          color: 'var(--accent-amber)' },
]

/** LB-191. The seeded answer, owned here because this file owns the option list — a constant in
 *  the sheet could drift from the labels and seed a value the control does not offer. */
export const VS_NORMAL_DEFAULT: VsNormal = 'same'

export function VsNormalPicker({ value, onChange }: Props) {
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
