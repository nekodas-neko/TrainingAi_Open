import { TEMP_BASELINE_MIN_DAYS } from '@trainingai/shared/ai-periodization/deload-constants'

/**
 * How far through the temperature baseline the user is, or null when there is nothing to say
 * (Q-105-followup).
 *
 * Before `TEMP_BASELINE_MIN_DAYS` nights the elevated-temperature deload cannot fire, and the
 * explainer previously said nothing about temperature at all — from the user's side that is
 * indistinguishable from the signal not existing. The owner chose to surface the progress instead.
 *
 * **The return type is the design.** This is a `number | null`, not a `Signal`, so it structurally
 * cannot join the explainer's "why recovery is being suggested" list — an immature baseline is not a
 * reason to back off, and rendering it as one would misinform the exact decision that card exists to
 * inform. The compiler enforces that, rather than a comment asking future edits not to.
 *
 * Requires at least one night: zero means no sleep data has arrived at all, where the honest output
 * is silence rather than a progress indicator that has not started and implies a working pipeline.
 */
export function temperatureBaselineProgress(nights: number | null | undefined): number | null {
  if (nights == null || nights < 1 || nights >= TEMP_BASELINE_MIN_DAYS) return null
  return nights
}
