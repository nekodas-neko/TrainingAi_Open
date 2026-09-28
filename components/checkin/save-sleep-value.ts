import { verdictToStoredFeel, type StoredSleepVerdict } from '@/components/health/sleep/sleep-verdict-copy'

/**
 * TN-82 — the sheet no longer ASKS for sleep quality or recovery; it announces what it filled.
 *
 * **This value is the fallback for a day with no verdict to announce** — the baseline is still
 * filling, or the ring has not drained the night. It is not a rating and never reads as one:
 * it ships with `touched: false`, and `answeredMorningScales` nulls every untouched value, which is
 * the whole of TN-57.
 *
 * ⚠ **It also has to stay a NUMBER, and that is load-bearing in a way its own definition does not
 * show.** `dayCheckinHasAnswers` (Q-465) rejects a body with no answer in it: on the web route that
 * is a 400, and in `pushMutations` it is a poison pill with no retry, so the check-in would be
 * dropped permanently. That guard has never fired in real use for exactly one reason, recorded in
 * its own header — *"both live writers always send at least two numeric scales, because their state
 * initialises from NEUTRAL_SCALES rather than from null"*. **Removing the two scales removes that
 * property**, so the sleep value stays numeric on every save to put it back. `saveSleepValue` below
 * is the single place that decides it.
 */
const NEUTRAL_SLEEP_FEEL = 3

/**
 * What the save writes for `sleepQualityFeel`, and whether it counts as HIS answer.
 *
 * The plan's hard constraint (§4), and the reason this is one function rather than an expression at
 * the call site: **only a correction is touched.** An auto-fill that flagged itself touched would
 * destroy the variable the design exists to create and re-create TN-57 — 91 days of a default
 * presented back to him as his own answer.
 */
export function saveSleepValue(
  correction: number | null,
  verdict: StoredSleepVerdict | null,
): { value: number; touched: boolean } {
  if (correction != null) return { value: correction, touched: true }
  if (verdict) return { value: verdictToStoredFeel(verdict.verdict), touched: false }
  return { value: NEUTRAL_SLEEP_FEEL, touched: false }
}
