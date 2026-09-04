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

import { seedOrUpdateBaseline, baselineZ, type Baseline } from '@trainingai/shared/health/personal-baseline'
import type { ContributorGap } from '@trainingai/shared/health/readiness-composite'
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
 * same scale as a ring user's. Uses `seedOrUpdateBaseline`/`baselineZ` rather than a second baseline
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
  for (let i = 0; i < priors; i++) baseline = seedOrUpdateBaseline(baseline, Math.round(series[i]), i)
  return baseline ? baselineZ(baseline, Math.round(series[series.length - 1])) : null
}

/**
 * Q-278. Why a metric has no value for a day, or why the value it does have is degraded.
 *
 * **Keyed on the METRIC, not on a fixed list of "pillars", and that is the design decision.** The
 * entry asked whether daytime stress and resilience count as pillars before a shared representation
 * could be built. They do not have to: a caller names whatever it is rendering, gets an answer, and
 * a sixth metric later costs nothing. Enumerating pillars in a type forces a taxonomy ruling with no
 * consequence for the user, to be re-litigated every time a metric is added.
 *
 * **The reasons are the ones producers can actually distinguish, and no more.** `ContributorGap`
 * comes from `readiness-composite`, where `zToScore` already branched on "there is no input" versus
 * "the baseline is too cold" and threw the difference away. An enum with `below_gate`/`not_yet`
 * members would read well and always report the same thing, because nothing computes them.
 */
export type MetricGap = ContributorGap

export interface MetricAvailability {
  /** Whatever the caller renders — 'readiness', 'sleep', 'activity', 'daytimeStress', … */
  metric: string
  /** `absent` means there is no value at all for the day; `present` covers degraded values too. */
  state: 'present' | 'absent'
  /** Why there is no value. Null whenever `state` is `present`. */
  gap: MetricGap | null
  /**
   * For a value that WAS produced but from an incomplete picture: which inputs fell back, and why.
   * Empty on a fully-supported score. This is what lets a surface say *"computed without HRV"*
   * rather than only *"limited"*.
   */
  degradedInputs: { key: string; gap: MetricGap }[]
}

/**
 * Build the availability of one metric from the value itself and, optionally, the contributors it
 * was computed from.
 *
 * A null `value` is `absent`. Its reason is `no_input` unless every contributor that fell back did
 * so waiting on a baseline — in which case the honest answer is that history, not data, is what is
 * missing, and it is the answer a user can act on.
 */
export function metricAvailability(
  metric: string,
  value: number | null | undefined,
  contributors: Record<string, { gap: MetricGap | null }> = {},
): MetricAvailability {
  const degradedInputs = Object.entries(contributors)
    .filter(([, c]) => c.gap != null)
    .map(([key, c]) => ({ key, gap: c.gap as MetricGap }))

  if (value != null) return { metric, state: 'present', gap: null, degradedInputs }

  const awaiting = degradedInputs.length > 0 && degradedInputs.every(d => d.gap === 'awaiting_baseline')
  return { metric, state: 'absent', gap: awaiting ? 'awaiting_baseline' : 'no_input', degradedInputs }
}
