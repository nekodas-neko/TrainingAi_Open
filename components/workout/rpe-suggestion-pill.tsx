'use client'

import { memo } from 'react'
import { X } from 'lucide-react'

interface Props {
  /** The weight to pre-fill if he takes it. */
  weightKg: number
  /** `computeRpeAdjustment`'s own sentence — shown as the reason, never re-worded here. */
  note: string
  onAccept: () => void
  onDismiss: () => void
}

/**
 * The one-tap offer BF-220 asks for: *he told the app the set was too heavy, and the next set card
 * did not move.*
 *
 * **It offers; it never applies.** Accepting pre-fills the weight dial and nothing else — the plan,
 * the prescription and the logged set are untouched. That shape was chosen over applying the cut
 * automatically because this is the screen he cannot afford to distrust: the first time a load drops
 * that he wanted to keep, the number on the card stops meaning anything. A suggestion he ignores
 * costs one glance.
 *
 * **Props are scalars** — it renders beside a set card whose call site re-renders on every dial
 * detent, and an object prop would silently defeat the `memo` (Q-490).
 */
export const RpeSuggestionPill = memo(function RpeSuggestionPill({ weightKg, note, onAccept, onDismiss }: Props) {
  return (
    <div
      className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2"
      role="group"
      aria-label="Load suggestion from your last set"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-amber-500">Drop to {weightKg} kg?</p>
        {/* The engine's sentence. Deliberately not paraphrased: the card and next week's
            prescription must give one reason, not two wordings of it. */}
        <p className="truncate text-2xs text-muted-foreground">{note}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        className="tap-target-44 tap-dense shrink-0 rounded-lg px-3 py-1.5 text-2xs font-bold"
        style={{ background: 'var(--color-brand)', color: 'var(--brand-foreground)' }}
      >
        Use it
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss load suggestion"
        className="tap-target-44 tap-dense shrink-0 rounded-lg p-1 text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
