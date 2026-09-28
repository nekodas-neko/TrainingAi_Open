'use client'

import { Moon } from 'lucide-react'
import { useMorningSleepFeel } from '@/lib/hooks/use-morning-sleep-feel'

/**
 * LA-136 — the sleep line returns to Home, driven by what he answers each morning.
 *
 * Built to [`docs/design/2026-09-27-four-screen-mockups.html`](../../docs/design/2026-09-27-four-screen-mockups.html)
 * §LA-136, approved 2026-09-27: a divider, then a purple moon and the rating on the left with five
 * dots and `N/5` on the right, captioned underneath.
 *
 * **What it replaces was fabricated.** The old `Sleep: OK` came from a `NOT NULL` default on a field
 * the check-in stopped collecting on 25 June, so it was the stored value on 93 of 108 rows and read
 * as derived for 91 days. It was removed and nothing took its place, while the morning check-in went
 * on collecting `sleepQualityFeel` that nothing read.
 *
 * **The caption is part of what was approved, not decoration.** *"Your rating, not a score"* is what
 * stops this being mistaken for a derived number the way its predecessor was — the entry is explicit
 * that the wording is in scope, so keep it if this is reworked.
 *
 * **The label is the sheet's own word, not the mockup's gloss.** The drawing showed *"Slept well"*
 * for 4/5; the scale he actually taps is labelled `Terrible … Great`, so that is what is shown. This
 * entry exists because Home told him something he never said — showing a rating back to him in
 * different words than the one he chose is a smaller version of the same thing.
 *
 * Renders nothing when he has not answered: an absent rating is not a zero, and a placeholder here
 * would be the same invention this entry exists to undo. `useMorningSleepFeel` is also what keeps an
 * *untouched* neutral seed off the screen — see the ⛔ note on that hook.
 */
export function SleepFeelLine({ userId }: { userId?: string }) {
  const feel = useMorningSleepFeel(userId)
  if (!feel) return null

  return (
    <>
      <div className="mt-3 h-px bg-border" />
      <div className="mt-[11px] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Moon className="h-4 w-4 flex-none" style={{ color: 'var(--accent-purple)' }} />
          <span className="text-[13px] font-semibold truncate">{feel.label}</span>
        </div>
        <div className="flex items-center gap-[3px] flex-none" aria-hidden data-testid="sleep-feel-dots">
          {[1, 2, 3, 4, 5].map(dot => (
            <span
              key={dot}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dot <= feel.position ? 'var(--brand)' : 'var(--color-border)' }}
            />
          ))}
          <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">{feel.position}/5</span>
        </div>
      </div>
      {/* Screen readers get the sentence rather than a word, five dots and a fraction. */}
      <span className="sr-only">
        You rated last night&apos;s sleep {feel.label} this morning — {feel.position} out of 5.
      </span>
      <p className="mt-1 text-[11px] text-muted-foreground">Your rating, not a score</p>
    </>
  )
}
