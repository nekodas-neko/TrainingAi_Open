// Which readiness inputs a user actually has for a day, and the confidence that follows.
//
// The app was built around one source that supplies every input at once (the ring's nightly
// rollup). A user on Health Connect — or on nothing but manual logs — has a subset, and every
// score surface used to render blank rather than degrade (Q-43). This is the one place that
// decides what "enough" means, so a route can't invent its own bar.
//
// It is deliberately NOT a re-tuning of what the score means on reduced inputs: the composite
// weights are unchanged and missing contributors still fall back to the composite's own neutral.
// This only labels how much of the picture the number was computed from.

import { updateBaseline, baselineZ, type Baseline } from '@trainingai/shared/health/personal-baseline'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

export type ReadinessInputKey =
  | 'sleep'
  | 'hrv'
  | 'restingHeartRate'
  | 'temperature'
  | 'activity'
  | 'checkin'

/** The baseline-relative recovery signals. Confidence is judged on these four alone — activity
 *  and the morning check-in shift the score but say nothing about how well the body recovered. */
export const CORE_READINESS_INPUTS: ReadinessInputKey[] = ['sleep', 'hrv', 'restingHeartRate', 'temperature']

const ALL_INPUTS: ReadinessInputKey[] = [...CORE_READINESS_INPUTS, 'activity', 'checkin']

export interface ScoreAvailability {
  available: ReadinessInputKey[]
  missing: ReadinessInputKey[]
  /** `full` = all four core signals; `partial` = two or three; `minimal` = one or none. */
  confidence: 'full' | 'partial' | 'minimal'
  /** True whenever the score was computed from less than the full core — the UI's cue to
   *  qualify the number rather than hide it. */
  limited: boolean
}

export function scoreAvailability(present: Partial<Record<ReadinessInputKey, boolean>>): ScoreAvailability {
  const available = ALL_INPUTS.filter(k => present[k] === true)
  const coreCount = CORE_READINESS_INPUTS.filter(k => present[k] === true).length
  const confidence: ScoreAvailability['confidence'] =
    coreCount === CORE_READINESS_INPUTS.length ? 'full' : coreCount >= 2 ? 'partial' : 'minimal'
  return {
    available,
    missing: ALL_INPUTS.filter(k => present[k] !== true),
    confidence,
    limited: confidence !== 'full',
  }
}

/**
 * Fold a chronological series into the rolling personal baseline and return the last sample's
 * z-score against the baseline as it stood BEFORE that sample — the same pre-update relationship
 * `oura_daily_summary` persists for ring users, so a Health Connect user's contributors are on the
 * same scale as a ring user's. Uses `updateBaseline`/`baselineZ` rather than a second baseline
 * implementation (One Formula, One Place).
 *
 * `minPriorSamples` is not optional discipline. A cold baseline is wildly overconfident — two
 * samples of a steady 50 bpm produce z = 8, which the composite would read as a perfect resting-HR
 * day. The default matches the composite's own maturity gate, so a metric with sparse history
 * returns null (→ neutral) instead of a fabricated extreme, even when the user's overall history
 * is long enough for the composite to score.
 */
export function trailingBaselineZ(
  series: readonly number[],
  minPriorSamples = BASELINE_MIN_NIGHTS,
): number | null {
  const priors = series.length - 1
  if (priors < Math.max(1, minPriorSamples)) return null
  let baseline: Baseline | null = null
  for (let i = 0; i < priors; i++) baseline = updateBaseline(baseline, Math.round(series[i]), i)
  return baseline ? baselineZ(baseline, Math.round(series[series.length - 1])) : null
}
