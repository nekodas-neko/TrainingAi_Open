/**
 * How much of the HR Recovery Profile actually carries signal, said out loud.
 *
 * `aggregateHrRecoveryProfile` has returned `informativeShare` since Q-516 shipped its re-banding,
 * and nothing rendered it. That is the state the entry warned about in its own words: **four
 * populated buckets look like a working feature whether or not they are.** A reader seeing four
 * rows of numbers has no way to tell that most of their rests never got high enough to measure.
 */
export interface InformativeShareNote {
  /** Whole percent, for display. */
  pct: number
  /** Under half. The caveat stops being a footnote and becomes the headline about the table. */
  minority: boolean
}

/** Below this the note is emphasised rather than stated in passing. */
export const MINORITY_MAX_PCT = 50

/**
 * `null` when there is nothing to disclose.
 *
 * A share of 1 means every banded episode carries signal — there are no dimmed rows to explain, and
 * a "100% of your rests are informative" line would be noise on a table that is entirely fine. A
 * null share means no banded episodes at all, and the card renders nothing in that case anyway.
 */
export function informativeShareNote(share: number | null | undefined): InformativeShareNote | null {
  if (share == null || share >= 1) return null
  const pct = Math.round(share * 100)
  return { pct, minority: pct < MINORITY_MAX_PCT }
}
