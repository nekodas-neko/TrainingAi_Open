/**
 * Whether a score cell's number carries a caveat, and what that caveat says.
 *
 * Extracted because the predicate was written out at three sites in `oura-score-chip-row.tsx` —
 * the label glyph, the band layout and the compact layout — and each new qualifier had to find all
 * three. `provisional` is the third, and the first one where missing a site would leave a number
 * that is *going to change* looking settled on one layout and marked on another.
 */
export interface ScoreQualifiers {
  /** Ring not worn enough hours today for a confident reading. Dims the cell as well as marking it. */
  lowWear?: boolean
  /** Computed from fewer than the usual inputs. Marked, not dimmed — the reading is trustworthy,
   *  there is just less behind it. */
  limited?: boolean
  /** The night behind this number has not finished syncing, so the number itself can still move.
   *  Not dimmed either: it is the best reading available right now, it is simply not the last one. */
  provisional?: boolean
}

/** An em-dash "—" is the empty state, and an empty state has nothing to qualify. */
export function isQualified(q: ScoreQualifiers, display: string): boolean {
  return Boolean(q.lowWear || q.limited || q.provisional) && display !== '—'
}

/**
 * The spoken form, appended to the cell's aria-label.
 *
 * Every qualifier that applies is read, because they are independent: a night can be both
 * still-syncing and short on wear, and a screen-reader user who hears only the first would take
 * the number as settled.
 */
export function qualifierPhrase(q: ScoreQualifiers): string {
  const parts: string[] = []
  if (q.lowWear) parts.push("ring wasn't worn enough hours today for a confident reading")
  if (q.limited) parts.push('based on part of the usual inputs')
  if (q.provisional) parts.push('last night is still syncing, so this number can still change')
  return parts.length ? ` — ${parts.join('; ')}` : ''
}
