'use client'

import { Check } from 'lucide-react'
import { storedOrderLabels } from '@trainingai/shared/types/day-checkin'
import { verdictCopy, type StoredSleepVerdict } from '@/components/health/sleep/sleep-verdict-copy'

interface Props {
  verdict: StoredSleepVerdict
  /** The stored 1–5 he corrected it to, or null while the app's own answer stands. */
  correction: number | null
  onCorrect: (stored: number) => void
  /** Only offered on a prominent announcement — see the note on acknowledgement below. */
  acknowledged: boolean
  onAcknowledge: () => void
}

/**
 * TN-82 — the check-in states what it filled, and he corrects it in one tap.
 *
 * **No question is asked, and that is the whole point.** Asking has failed three times on this
 * sheet, across every affordance and position available: a one-tap emoji mood collected 17 answers
 * then zero, a 1–5 scale seeded at the midpoint collected 3 of 82, and a relative picker placed
 * first specifically to escape them collected 2 of 82. `perceived_recovery` has **0 touched answers
 * in 102 check-ins**. So the app fills the category itself and announces it; his only interaction is
 * to disagree.
 *
 * **The reason is load-bearing, not decoration.** A verdict with no stated cause cannot be argued
 * with — "your sleep was bad" invites being ignored, "5h10, 1h20 short of your usual" invites either
 * a nod or a correction. `verdictCopy` owns that sentence and quotes the snapshot's own numbers.
 *
 * ⛔ **Saving the sheet is NOT an acknowledgement, and the distinction is the instrument.** Under
 * correction-only feedback, silence is ambiguous between *"right"* and *"not looked at"* — and zero
 * corrections reads exactly like success, which is the same shape as the 35-of-36 neutral 3s that
 * started this. The owner has saved 82 of 82 sheets while touching a scale in 3, so promoting that
 * reflex to agreement would manufacture the very data the plan forbids. Acknowledgement therefore
 * requires an explicit tap on the announcement itself, and it is only offered on the **prominent**
 * one: a quiet ordinary-day line cannot carry a deliberate dismissal, so its silence stays recorded
 * as unknown.
 */
export function SleepAnnouncement({ verdict, correction, onCorrect, acknowledged, onAcknowledge }: Props) {
  const { line, prominent } = verdictCopy(verdict)
  const labels = storedOrderLabels('sleepQualityFeel')

  return (
    <div className={prominent
      ? 'rounded-xl border border-border/60 bg-muted/40 px-3 py-3'
      : 'px-1 py-1'}>
      <p className={prominent ? 'text-sm leading-snug' : 'text-xs text-muted-foreground leading-snug'}>
        {line}
      </p>

      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {correction == null ? 'Not right? Set it yourself' : 'You set this'}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {labels.map((label, i) => {
          const stored = i + 1
          const picked = correction === stored
          return (
            <button
              key={label}
              type="button"
              onClick={() => onCorrect(stored)}
              aria-pressed={picked}
              className={`min-h-11 px-3 rounded-full text-xs font-semibold border transition-[transform,background-color] duration-100 active:scale-95 motion-reduce:active:scale-100 motion-reduce:transition-none ${
                picked
                  ? 'bg-foreground text-background border-transparent'
                  : 'bg-foreground/5 text-muted-foreground border-border/60'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {prominent && correction == null && (
        <button
          type="button"
          onClick={onAcknowledge}
          aria-pressed={acknowledged}
          className="mt-2 -mx-2 min-h-11 px-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-[transform,opacity] duration-100 active:scale-95 motion-reduce:active:scale-100 motion-reduce:transition-none"
        >
          <Check className={`h-3.5 w-3.5 ${acknowledged ? 'text-brand' : ''}`} />
          {acknowledged ? 'Marked as right' : "That's right"}
        </button>
      )}
    </div>
  )
}
