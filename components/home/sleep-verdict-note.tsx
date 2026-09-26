'use client'

import { useState } from 'react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { verdictCopy, type StoredSleepVerdict } from '@/components/health/sleep/sleep-verdict-copy'

interface VerdictResponse {
  verdict: StoredSleepVerdict | null
  baselineNightsRequired?: number
}

interface Props {
  /** The night's wake date, `YYYY-MM-DD` in the user's zone. */
  date: string
  /** Opens the morning check-in, where the sleep scale the correction sets actually lives. */
  onCorrect: () => void
}

/**
 * Last night's verdict, stated on Home (TN-85).
 *
 * **The modal is not a home for this.** The morning sheet auto-opens once a day, retires itself on
 * close, and only exists on `/session-select` — and the owner has saved 82 of those sheets in three
 * months while touching a scale in 3 of them. An announcement delivered once into the one surface
 * with a three-month record of reflexive dismissal produces silence, and the whole instrument is
 * him *disagreeing*: silence and agreement become indistinguishable. So the verdict also lives
 * somewhere that lasts the day and stays correctable.
 *
 * **It renders nothing rather than a placeholder** when there is no verdict — the baseline is still
 * filling, or the ring has not drained the night yet. A card that says "not enough data" every
 * morning is a card that gets tuned out, and this one must not be.
 */
export function SleepVerdictNote({ date, onCorrect }: Props) {
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<VerdictResponse>(
    `sleep-verdict:${date}`, `/api/sleep-verdict?date=${date}`, TTL_MEDIUM,
    // `cachedFetch` swallows `!res.ok`, including this app's own rate limit. Silence here would be
    // read as "nothing to say about last night", which is a different claim entirely.
    { onError: () => setFailed(true) },
  )

  const verdict = data?.verdict ?? null
  if (failed || !verdict) return null

  const { line, prominent } = verdictCopy(verdict)

  return (
    // A SIBLING of the card, never inside it: the card is itself a `role="button"` that navigates,
    // and a button inside a button is both invalid and the shape `check-nested-buttons.js` fails on.
    <div className={prominent
      ? 'mt-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5'
      : 'mt-2 px-1'}>
      <p className={prominent ? 'text-sm leading-snug' : 'text-xs text-muted-foreground leading-snug'}>
        {line}
      </p>
      <button
        type="button"
        onClick={() => {
          // Fire-and-forget: the correction that matters is the VALUE, and that is written by the
          // check-in save path (TN-57). This only records that he disagreed, and a failed record
          // must not stop the sheet opening — the sheet is what he asked for by tapping.
          void fetch('/api/sleep-verdict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, state: 'corrected' }),
          }).catch(() => {})
          onCorrect()
        }}
        className="mt-1.5 -mx-2 min-h-11 px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2 transition-[transform,opacity] duration-100 active:scale-95 motion-reduce:active:scale-100 motion-reduce:transition-none"
      >
        That&apos;s wrong
      </button>
    </div>
  )
}
