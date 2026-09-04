// Readiness composite using open_health's recovered Oura weights (Oura BLE Phase 5
// addendum A4, R²=0.969): RHR ~17%, Previous Night ~15%, HRV Balance ~15%,
// Temperature ~13%, Sleep Balance ~12%, Prev-Day Activity ~10%, Recovery Index
// ~10%, Activity Balance ~7%. Used only when Oura Cloud's own readiness score isn't
// available (the frozen-since-re-key path) — this is our own approximation built
// from the personal baselines in oura_daily_summary (A3), not a reproduction of
// Oura's proprietary model.
//
// Baseline-relative contributors (RHR, HRV Balance, Temperature, Sleep Balance) are
// cold for the first ~14 nights of accrued history — those are flagged provisional
// and fall back to a neutral 50, exactly as open_health does. Recovery Index has no
// calibratable hours→score mapping (per the addendum), so it's always neutral/
// provisional; its raw hours are surfaced separately for display, never scored.

export const BASELINE_MIN_NIGHTS = 14

// Weights recalibrated 2026-07-22 (core-cards overhaul, W-D): rebalanced to sum EXACTLY 1.00 (was
// 0.99, so the old composite could never reach 100) and made room for a `checkin` contributor — the
// user's morning mood/energy self-report — so a genuinely great day (great biometrics + a good
// check-in) can reach a true 100. See docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md.
export const READINESS_WEIGHTS = {
  restingHeartRate: 0.15,
  previousNight:    0.16,
  hrvBalance:        0.15,
  temperature:       0.10,
  sleepBalance:      0.10,
  prevDayActivity:   0.09,
  recoveryIndex:     0.09,
  activityBalance:   0.06,
  checkin:           0.10,
} as const

export interface ReadinessCompositeInputs {
  /** Normalized deviation of tonight's resting HR from the personal baseline
   *  (lower RHR than baseline = better). */
  rhrZ: number | null
  /** Normalized deviation of tonight's HRV from the personal baseline (higher = better). */
  hrvZ: number | null
  /** Normalized deviation of tonight's temperature from the personal baseline
   *  (closer to baseline, either direction, = better — a fever/illness signal). */
  tempZ: number | null
  /** Normalized deviation of tonight's sleep duration from the personal baseline. */
  sleepBalanceZ: number | null
  /** Our own 0-100 sleep score for last night (lib/health/sleep-score.ts). */
  previousNightScore: number | null
  /** Our own 0-100 activity score for the day before last night. */
  prevDayActivityScore: number | null
  /** Our own 0-100 activity score for today. */
  activityBalanceScore: number | null
  /** The user's morning mood/energy check-in mapped to 0-100 (drained→30 … pumped→100). Null when
   *  there's no check-in that day → neutral 50 (so a perfect 100 needs a logged good check-in). */
  checkinScore?: number | null
  /** Nights of baseline history accrued (oura_daily_summary.n_history). */
  nHistory: number
  /** Recovery Index — hours between the overnight HR minimum and wake
   *  (lib/health/recovery-index.ts). More hours = HR settled earlier in the night = better. */
  recoveryIndexHours?: number | null
}

/** Why a contributor could not be scored. See {@link ReadinessContributor.gap}. */
export type ContributorGap = 'no_input' | 'awaiting_baseline'

export interface ReadinessContributor {
  score: number // 0-100
  /** True when this contributor fell back to neutral — either no signal, or the
   *  baseline hasn't accrued the minimum history yet. */
  provisional: boolean
  /**
   * The number this score was computed FROM — a z-score for the baseline-relative contributors, raw
   * hours for the Recovery Index, a 0-100 value for the ones that pass through. `null` when the
   * contributor fell back to neutral because there was no input at all.
   *
   * **This is stored, and storing it is the point (Q-501).** A persisted contributor used to be
   * `{score, provisional}` and nothing else, so a stored row could not be re-derived from itself:
   * the only way to ask "what produced this 58?" was to read today's `oura_daily_summary` and assume
   * it was unchanged. It is often not — summaries get recomputed and the derived rows built from
   * them are not recomputed in step. Measured 2026-08-26 against production: of 42 rows carrying a
   * Recovery Index contributor, **7 match neither the current anchor nor the previous one**, so
   * their score cannot be reproduced from any model applied to the stored hours.
   *
   * With the input alongside the score, a row answers the question by itself, and `score = f(input)`
   * under the stamped `model_versions.readiness` becomes checkable without a second table.
   */
  input: number | null
  /**
   * Q-278. WHY this contributor fell back to the neutral 50, or null when it was genuinely scored.
   *
   * The distinction already existed in the code and was being thrown away: `zToScore` returns the
   * same NEUTRAL for `z == null` (there is no input at all) and for `nHistory <
   * BASELINE_MIN_NIGHTS` (there IS an input, the baseline is just too cold to score it). Those read
   * very differently to a user — "we have no HRV for you" versus "we have HRV but not enough
   * history yet" — and collapsing them is why a surface could say a score was limited but never say
   * what would fix it.
   *
   * Deliberately only two values, because those are the only two the producers can actually tell
   * apart. An enum with more members would have to invent the difference.
   */
  gap: ContributorGap | null
}

export interface ReadinessCompositeResult {
  score: number // 0-100, weighted composite
  contributors: Record<keyof typeof READINESS_WEIGHTS, ReadinessContributor>
}

const NEUTRAL: ReadinessContributor = { score: 50, provisional: true, input: null, gap: 'no_input' }
/** The input exists; the personal baseline is not mature enough to score it yet (Q-278). Same score
 *  and same `provisional` as NEUTRAL — only the reason differs, which is the whole point. */
const AWAITING_BASELINE: ReadinessContributor = { score: 50, provisional: true, input: null, gap: 'awaiting_baseline' }

// Points added per z-unit around the neutral 50. Recalibrated 2026-07-22 (W-D): 50/1.5 ≈ 33.3, so a
// contributor reaches a full 100 at +1.5σ (a realistically-great day) rather than the former +2.5σ
// (which needed a 2.5-sigma day on every axis at once — statistically unreachable, capping readiness
// ~86 even on a perfect day). Our own approximation; Oura's real curve isn't public.
export const Z_POINTS_PER_UNIT = 50 / 1.5

/**
 * The morning check-in's energy level → 0-100 sub-score. Lives here, next to the weight it feeds,
 * so the readiness route and the admin day-review audit can't map the same check-in differently.
 */
export const CHECKIN_ENERGY_SCORE: Record<string, number> = {
  drained: 30, low: 50, ok: 72, good: 88, pumped: 100,
}

/** Map a logged energy level to its readiness sub-score; null when unrecognised or not logged. */
export function checkinScoreFromEnergy(energyLevel: string | null | undefined): number | null {
  if (!energyLevel) return null
  return CHECKIN_ENERGY_SCORE[energyLevel] ?? null
}

/** Maps a personal-baseline z-score to a 0-100 sub-score. z is typically in
 *  [-1.5, 1.5] for the mapped range; clamped at the edges.
 *  - higher/lower-better: neutral 50 at baseline (z=0), a full 100 at ±1.5σ *in the good direction*.
 *  - closer-better (temperature): 100 at baseline (a stable temp is ideal — no fever/illness) and
 *    falling to 0 by ~1.5σ of deviation either way. (Previously it peaked at 50, which meant a
 *    perfectly-stable temperature could only ever be "neutral" and structurally capped readiness ~95.) */
function zToScore(
  z: number | null,
  direction: 'higher-better' | 'lower-better' | 'closer-better',
  nHistory: number,
): ReadinessContributor {
  if (z == null) return NEUTRAL
  if (nHistory < BASELINE_MIN_NIGHTS) return AWAITING_BASELINE
  const raw = direction === 'closer-better'
    ? 100 - Math.abs(z) * (2 * Z_POINTS_PER_UNIT)
    : 50 + (direction === 'higher-better' ? z : -z) * Z_POINTS_PER_UNIT
  return { score: Math.max(0, Math.min(100, Math.round(raw))), provisional: false, input: z, gap: null }
}

function plainScore(v: number | null): ReadinessContributor {
  if (v == null) return NEUTRAL
  return { score: Math.max(0, Math.min(100, Math.round(v))), provisional: false, input: v, gap: null }
}

/** Stamped onto `oura_daily_derived.model_versions.readiness` so a score can be attributed to the
 *  model that produced it. Bump whenever the weights, curves or z-slope change — Q-273.
 *  Rows written before 2026-08-18 carry no stamp at all. */
export const READINESS_MODEL_VERSION = 'v3:ri5:2026-08-18'

/** Recovery Index hours at which this contributor scores 100. `hoursToSettle` is measured from the
 *  overnight HR minimum to wake, so MORE hours = the heart settled earlier = better.
 *
 *  **6 → 5 on 2026-08-18 (Q-500), fitted rather than quoted.** The 6 came from Oura's public prose,
 *  which describes a metric they compute differently and which the pinned v2 spec does not define at
 *  all — it exposes `contributors.recovery_index` as a bare 1–100 integer, no hours, no curve. So it
 *  was measured instead, against the only external ground truth this app has: the 15 nights
 *  (2026-06-23 → 07-07) where Oura's OWN `recovery_index` contributor sits beside our raw inputs,
 *  before the ring re-key ended Cloud data.
 *
 *  Our estimator tracks theirs well (**r = +0.712**, beating every alternative estimator tested — see
 *  the review, and do not "fix" the argmin). What it carried was a level offset: a systematic
 *  **−10.2 points** against their contributor. The zero-bias anchor is **4.63 h**, leave-one-out
 *  4.40–5.14 across the 15 nights, with RMSE flat from 4.5 to 5.25.
 *
 *  **5, not 4.63**, deliberately: it sits on that flat floor, inside the LOO range, is a number a
 *  person can reason about, and keeps a small *negative* bias (−2.7) so the term still errs toward
 *  under-scoring — the safe direction for a recovery signal. Fitting two decimals to a 15-night
 *  sample would be false precision.
 *
 *  **Re-derive on BLE-era nights once ~15 exist.** This fit is Cloud-era, and BLE overnight HR is
 *  measurably noisier (median sample-to-sample |Δbpm| 2.0 vs 1.0 at the same density), so the anchor
 *  is conservative for current data rather than wrong. If a BLE-only refit lands well below 5, the
 *  input changed and that is a `devices` finding, not a scoring one.
 *
 *  Docs: `docs/reviews/2026-08-17-readiness-calibration.md`. */
export const RECOVERY_INDEX_OPTIMAL_HOURS = 5

/** Map Recovery-Index hours → a 0-100 sub-score with a documented monotone curve: linear from 0 at
 *  0 h to 100 at `RECOVERY_INDEX_OPTIMAL_HOURS`, clamped. This is an APPROXIMATION anchored on Oura's
 *  public "≥6 h = good recovery" statement (their exact hours→score curve isn't recovered), so it is
 *  flagged `provisional`. Null hours (no overnight HR series) → neutral, never fabricated. */
function recoveryIndexScore(hours: number | null | undefined): ReadinessContributor {
  if (hours == null || !Number.isFinite(hours)) return NEUTRAL
  const score = Math.max(0, Math.min(100, Math.round((hours / RECOVERY_INDEX_OPTIMAL_HOURS) * 100)))
  // `provisional` here means the CURVE is an approximation, not that an input is missing — so the
  // gap is null. Q-278 exists because those two senses of "provisional" used to be one field.
  return { score, provisional: true, input: hours, gap: null }
}

/**
 * The readiness composite model in serialisable form — weights, the z→score slope, the baseline
 * maturity gate and each contributor's direction. Exported so tooling (the admin day-review audit)
 * can present a score alongside the exact model that produced it without copying any of it.
 */
export const READINESS_MODEL = {
  weights: READINESS_WEIGHTS,
  zPointsPerUnit: Z_POINTS_PER_UNIT,
  baselineMinNights: BASELINE_MIN_NIGHTS,
  recoveryIndexOptimalHours: RECOVERY_INDEX_OPTIMAL_HOURS,
  modelVersion: READINESS_MODEL_VERSION,
  checkinEnergyScore: CHECKIN_ENERGY_SCORE,
  neutralScore: NEUTRAL.score,
  directions: {
    restingHeartRate: 'lower-better',
    hrvBalance: 'higher-better',
    temperature: 'closer-better',
    sleepBalance: 'higher-better',
    previousNight: 'passthrough',
    prevDayActivity: 'passthrough',
    recoveryIndex: 'hours-curve',
    activityBalance: 'passthrough',
    checkin: 'passthrough',
  },
} as const

export function computeReadinessComposite(input: ReadinessCompositeInputs): ReadinessCompositeResult {
  const contributors: ReadinessCompositeResult['contributors'] = {
    restingHeartRate: zToScore(input.rhrZ, 'lower-better', input.nHistory),
    hrvBalance:        zToScore(input.hrvZ, 'higher-better', input.nHistory),
    temperature:       zToScore(input.tempZ, 'closer-better', input.nHistory),
    sleepBalance:      zToScore(input.sleepBalanceZ, 'higher-better', input.nHistory),
    previousNight:     plainScore(input.previousNightScore),
    prevDayActivity:   plainScore(input.prevDayActivityScore),
    // Calibrated from Recovery-Index hours (anchored on Oura's public "≥6 h = good recovery"),
    // replacing the former dead NEUTRAL that made 10% of readiness a frozen 50. Flagged provisional
    // (approximation) and falls back to neutral when there's no overnight HR series.
    recoveryIndex:     recoveryIndexScore(input.recoveryIndexHours),
    activityBalance:   plainScore(input.activityBalanceScore),
    // Subjective morning check-in (mood/energy). Neutral 50 when not logged — so a perfect 100
    // requires a good check-in, but skipping it doesn't tank readiness.
    checkin:           plainScore(input.checkinScore ?? null),
  }

  const score = Math.round(
    (Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[])
      .reduce((sum, key) => sum + contributors[key].score * READINESS_WEIGHTS[key], 0)
  )

  return { score, contributors }
}

/** A contributor as it comes back out of `oura_daily_derived.readiness_contributors` (JSONB, so its
 *  shape is whatever was written on the day). Rows written before Q-501 carry no `input`. */
export interface StoredReadinessContributor {
  score: number
  provisional: boolean
  input?: number | null
}

export interface ReadinessRederivation {
  /** The composite the CURRENT model gives for the inputs stored on the row. Keys with no stored
   *  input contribute their stored score, since there is nothing better to use — `uncheckable` says
   *  how much of this number is therefore unverified. */
  score: number
  /** Stored score ≠ current model applied to the stored input. The score moved because the MODEL
   *  changed, not because the inputs did — that is the whole distinction Q-501 could not make. */
  drifted: { key: keyof typeof READINESS_WEIGHTS; stored: number; rederived: number }[]
  /** Contributors with no stored input: rows written before Q-501, which cannot be checked either
   *  way. Reported rather than silently counted as agreeing. */
  uncheckable: (keyof typeof READINESS_WEIGHTS)[]
}

/** Re-derive one persisted contributor's score from the input stored beside it, under the current
 *  model. `null` when the row carries no input at all. */
function rederiveContributor(
  key: keyof typeof READINESS_WEIGHTS,
  stored: StoredReadinessContributor,
): number | null {
  if (!('input' in stored)) return null
  const value = stored.input
  if (value == null) return NEUTRAL.score      // no input → the model's neutral, by definition
  const direction = READINESS_MODEL.directions[key]
  if (direction === 'passthrough') return plainScore(value).score
  if (direction === 'hours-curve') return recoveryIndexScore(value).score
  // A z contributor that stored an input was not baseline-cold at write time — a cold one falls back
  // to NEUTRAL, whose input is null and which returned above. So the maturity gate is satisfied.
  return zToScore(value, direction, BASELINE_MIN_NIGHTS).score
}

/**
 * Ask a persisted readiness row whether its own stored score follows from its own stored inputs.
 *
 * **This is the point of storing the input at all (Q-501).** A row used to hold `{score, provisional}`
 * and nothing else, so the only way to ask "what produced this 58?" was to read today's
 * `oura_daily_summary` and assume it had not been recomputed since — which it often had, silently.
 * With the input on the row, a disagreement here means the MODEL moved; agreement plus a disagreement
 * against a fresh recompute means the INPUTS moved. Neither was distinguishable before.
 *
 * Returns null for anything that is not a contributor map — old rows, nulls, and the pre-Q-501
 * `Record<string, number>` shape included.
 */
export function rederiveReadinessFromStored(stored: unknown): ReadinessRederivation | null {
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) return null
  const map = stored as Record<string, unknown>

  const drifted: ReadinessRederivation['drifted'] = []
  const uncheckable: ReadinessRederivation['uncheckable'] = []
  let weighted = 0
  let matched = 0

  for (const key of Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]) {
    const entry = map[key]
    if (entry == null || typeof entry !== 'object') continue
    const c = entry as StoredReadinessContributor
    if (typeof c.score !== 'number' || !Number.isFinite(c.score)) continue
    matched++

    const rederived = rederiveContributor(key, c)
    if (rederived == null) uncheckable.push(key)
    else if (rederived !== c.score) drifted.push({ key, stored: c.score, rederived })

    weighted += (rederived ?? c.score) * READINESS_WEIGHTS[key]
  }

  if (matched === 0) return null
  return { score: Math.round(weighted), drifted, uncheckable }
}
