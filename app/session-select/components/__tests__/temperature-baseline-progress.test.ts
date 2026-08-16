// Q-105-followup. Before 30 nights of history the elevated-temperature deload cannot fire, and the
// "Why this recommendation?" explainer said nothing about temperature at all — from the user's side
// indistinguishable from the signal not existing. The owner chose to surface the progress instead
// (2026-08-14), for new accounts and baseline resets; the owner's own baseline was already at 40.
//
// The property that keeps this honest is not tested here because it cannot be violated: the helper
// returns `number | null`, not a `Signal`, so it structurally cannot join the explainer's "why
// recovery is being suggested" list. An immature baseline is not a reason to back off, and the
// compiler enforces that rather than a comment asking future edits not to.
import { describe, it, expect } from 'vitest'
import { temperatureBaselineProgress } from '../temperature-baseline-progress'
import { TEMP_BASELINE_MIN_DAYS } from '@trainingai/shared/ai-periodization/deload-constants'

describe('temperatureBaselineProgress', () => {
  it('reports the count while the baseline is still building', () => {
    expect(temperatureBaselineProgress(18)).toBe(18)
  })

  it('goes silent exactly at the threshold, not one past it', () => {
    expect(temperatureBaselineProgress(TEMP_BASELINE_MIN_DAYS - 1)).toBe(TEMP_BASELINE_MIN_DAYS - 1)
    expect(temperatureBaselineProgress(TEMP_BASELINE_MIN_DAYS)).toBeNull()
  })

  it('stays silent well past maturity — the owner is at 40', () => {
    expect(temperatureBaselineProgress(40)).toBeNull()
  })

  // Zero means no sleep data has arrived at all. A progress indicator that has not started is worse
  // than silence: it implies a pipeline that is working when none is.
  it('stays silent at zero, and when the field is absent', () => {
    expect(temperatureBaselineProgress(0)).toBeNull()
    expect(temperatureBaselineProgress(null)).toBeNull()
    expect(temperatureBaselineProgress(undefined)).toBeNull()
  })

  it('renders from one night — the first point the pipeline has proven itself', () => {
    expect(temperatureBaselineProgress(1)).toBe(1)
  })

  // Defensive rather than reachable: n_history is a count and cannot go negative, but returning a
  // negative here would render "-3 of 30 nights".
  it('treats a negative count as nothing to say', () => {
    expect(temperatureBaselineProgress(-3)).toBeNull()
  })
})
