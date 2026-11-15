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

// Weights recalibrated 2026-07-22 (core-cards overhaul, W-D) to sum EXACTLY 1.00 (was 0.99, so the
// old composite could never reach 100). See docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md.
//
// #2224 (TN-9, owner 2026-08-26: *"the numbers should be fully set on first open/load"*): the
// morning check-in's 0.10 is gone. While it was here, an unanswered card held 10% of readiness at a
// neutral 50 and answering it moved a score the owner had already read. The other eight are
// renormalised over the 0.90 they held, so every ratio between them is unchanged. Measured over the
// 35 days with stored contributors: mean +0.44, largest single-day move 3.84, none ≥ 5. The check-in
// still tunes the session prescription; it no longer touches this number.
const WEIGHT_WITHOUT_CHECKIN = 0.90
export const READINESS_WEIGHTS = {
  restingHeartRate: 0.15 / WEIGHT_WITHOUT_CHECKIN,
  previousNight:    0.16 / WEIGHT_WITHOUT_CHECKIN,
  hrvBalance:       0.15 / WEIGHT_WITHOUT_CHECKIN,
  temperature:      0.10 / WEIGHT_WITHOUT_CHECKIN,
  sleepBalance:     0.10 / WEIGHT_WITHOUT_CHECKIN,
  recoveryIndex:    0.09 / WEIGHT_WITHOUT_CHECKIN,
  // #3358 (v15): yesterday's activity is one input. `prevDayActivity` (0.09) was a cut-down second
  // copy of yesterday's Activity score — steps, energy and strength only, judged on today's goals —
  // beside this one, the finished score itself (0.06). The finished score takes both shares, so
  // yesterday's weight is unchanged and the other seven inputs keep theirs.
  activityBalance:  (0.09 + 0.06) / WEIGHT_WITHOUT_CHECKIN,
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
  /** Our own 0-100 PRE-taper activity score for the previous completed day (#2435). It read today's
   *  partial score until then, so a morning readiness saw a near-empty day. Since v15 (#3358) it is
   *  the composite's only activity input. */
  activityBalanceScore: number | null
  /** Nights of baseline history accrued (oura_daily_summary.n_history). */
  nHistory: number
  /** Recovery Index — hours between the overnight HR minimum and wake
   *  (lib/health/recovery-index.ts). More hours = HR settled earlier in the night = better. */
  recoveryIndexHours?: number | null
  /**
   * #2984. Oura's own `recovery_index` readiness contributor (0–100), used only when there are no
   * Recovery-Index hours. Oura sends no underlying value for it, so its sub-score is the input
   * (rule 4 on #2860) and it is scored on its own scale, not through the hours curve.
   */
  recoveryIndexContributor?: number | null
  /**
   * #2984. The nights in the normal each baseline-relative input was judged against, for an input
   * that HAS a value tonight. Normals are learned per device, so one night's inputs can sit on
   * normals of different ages: a ring HRV on 60 nights beside an Oura temperature on 2. A key listed
   * here with fewer than `BASELINE_MIN_NIGHTS` reads `awaiting_baseline` even when its z is null,
   * because the value exists and only the normal is missing. Unlisted keys fall back to `nHistory`.
   */
  baselineNights?: Partial<Record<BaselineContributorKey, number>>
  /** #2984. Which device each contributor's input came from (`oura_ble`, `oura_cloud`, …), stored
   *  on the contributor so a persisted row says what it was computed from. */
  sources?: Partial<Record<keyof typeof READINESS_WEIGHTS, string>>
}

/** The contributors scored against a personal normal. */
export type BaselineContributorKey = 'restingHeartRate' | 'hrvBalance' | 'temperature' | 'sleepBalance'

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
  /** #2984. The device the input came from, when the caller knows it. Absent on rows written before. */
  source?: string
  /**
   * #2984. Set only when the input is on someone else's scale rather than ours: `oura_contributor`
   * is Oura's 0–100 recovery-index contributor, passed through. Re-derivation reads it, because the
   * same key's hours input goes through a curve and a 0–100 value must not.
   */
  scale?: 'oura_contributor'
}

export interface ReadinessCompositeResult {
  score: number // 0-100, weighted composite
  contributors: Record<keyof typeof READINESS_WEIGHTS, ReadinessContributor>
}

const NEUTRAL: ReadinessContributor = { score: 50, provisional: true, input: null, gap: 'no_input' }
/** The input exists; the personal baseline is not mature enough to score it yet (Q-278). Same score
 *  and same `provisional` as NEUTRAL — only the reason differs, which is the whole point. */
const AWAITING_BASELINE: ReadinessContributor = { score: 50, provisional: true, input: null, gap: 'awaiting_baseline' }

/**
 * #3778 (owner, 15 Nov, direction A): **a reading exactly at the person's own baseline scores 75**,
 * not 50, on the three contributors judged higher- or lower-is-better against a normal (resting HR,
 * HRV balance, sleep balance).
 *
 * At 50, half of all ordinary days scored under 50 on each of those three by definition, and the
 * composite of an ordinary recovered day landed in the low-to-mid 50s, the bottom edge of Moderate:
 * production reached High on 1 of 36 days. Moving the centre fixes where an ordinary day lands
 * without inventing a new model.
 *
 * **The maths is kept: the TN-60 shape is unchanged in σ, only its two halves are rescaled.** The old
 * curve (linear ±0.9σ, algebraic tails, see `compressTails`) is computed first, on its own 0–100
 * scale centred at 50. Its upper half (50→100) is then squeezed into 75→100 and its lower half
 * (0→50) stretched over 0→75. So:
 * - every σ value keeps its ordering and the knees stay at ±0.9σ;
 * - the top still bends toward 100 without reaching it (+1.5σ → 95, +3σ → 98, rounding to 100
 *   needs ~8σ), so great days do not pile onto a rail;
 * - the bottom still reaches low scores (−1.5σ → 15, −3σ → 7), so a genuinely poor night is Low.
 *
 * The price, stated so nobody rediscovers it: above baseline each σ is worth half the points it was
 * (16.7 instead of 33.3 in the linear region), below baseline one and a half times as many (50).
 * That asymmetry is what "centre at 75 on a 0–100 scale" means; a symmetric slope would either rail
 * at 100 by +0.75σ or never get below 25.
 *
 * Temperature is untouched: it is closer-is-better and already scores 100 at baseline. The pass-
 * through inputs (sleep score, yesterday's activity) and the recovery index have no baseline to be
 * at, so they are untouched too.
 *
 * Decisions that read the composite were re-anchored in the same change so the same days are told
 * to rest: `readiness-decision-thresholds.ts`.
 */
export const READINESS_BASELINE_CENTRE = 75

/** A centred contributor with no input, or a normal too young to score it, stands at the centre — the
 *  same "assume an ordinary night" it stood at when the centre was 50. Left at 50 it would read 25
 *  points below an ordinary night for the 14 nights every new device or algorithm version spends
 *  learning its normal (#2984, #3601). */
const NEUTRAL_CENTRED: ReadinessContributor = { ...NEUTRAL, score: READINESS_BASELINE_CENTRE }
const AWAITING_BASELINE_CENTRED: ReadinessContributor = { ...AWAITING_BASELINE, score: READINESS_BASELINE_CENTRE }

/**
 * The inverse of the #3778 re-centring: a centred sub-score (resting HR, HRV balance, sleep balance)
 * read back on the 50-centred scale it had before. **Only for a port whose fixed cuts were written
 * against that scale** — the stress-resilience model bands a "sleep recovery" figure built from these
 * sub-scores at fixed Oura-model cuts, and the owner moved readiness, not resilience. Never for display.
 */
export function preCentreSubScore(score: number): number {
  const c = READINESS_BASELINE_CENTRE
  return score >= c ? 50 + (score - c) * (50 / (100 - c)) : 50 - (c - score) * (50 / c)
}

/** Moves a score on the old 50-centred scale onto the 75-centred one: the upper half squeezed into
 *  75–100, the lower half stretched over 0–75. Monotone, and fixed at 0, 50→75 and 100. */
function recentre(score50: number): number {
  const c = READINESS_BASELINE_CENTRE
  return score50 >= 50
    ? c + (score50 - 50) * ((100 - c) / 50)
    : c - (50 - score50) * (c / 50)
}

// Points added per z-unit around the neutral 50. Recalibrated 2026-07-22 (W-D): 50/1.5 ≈ 33.3, so a
// contributor reaches a full 100 at +1.5σ (a realistically-great day) rather than the former +2.5σ
// (which needed a 2.5-sigma day on every axis at once — statistically unreachable, capping readiness
// ~86 even on a perfect day). Our own approximation; Oura's real curve isn't public.
export const Z_POINTS_PER_UNIT = 50 / 1.5

/**
 * Points reserved at each end of the 0-100 range for the compressive tail (TN-60).
 *
 * **The hard clip was where the information went.** `Z_POINTS_PER_UNIT` puts the floor and ceiling
 * at z = ±1.5, and measured over 69 days `hrvBalance` — the largest single source of movement in
 * readiness at 22.8% of it — sat on a rail on **26 of them (38%)**. The z values scoring 0 spanned
 * **−1.63 to −4.37**: a 2.7σ range rendered as one number, so a mildly low HRV night and the worst
 * night in the record were the same score.
 *
 * Owner decision 2026-09-22 (option 1 of three): keep the linear region, replace the clip with a
 * curve that keeps *ordering* as it saturates. Width chosen by the owner 2026-09-23, from the
 * measurement below rather than from the entry — which assumed this needed no constant at all.
 *
 * **Why 20 and not 5: the band is paid for out of the linear region, and integer rounding decides
 * whether the tail is worth having.** Scoring the seven worst measured days:
 *
 * | band | linear kept to | worst days separated | still railed |
 * |---|---|---|---|
 * | 5 | z = 1.35 | 3 of 7 | 3 |
 * | 10 | z = 1.20 | 4 of 7 | 0 |
 * | **20** | **z = 0.90** | **6 of 7** | **0** |
 * | 30 | z = 0.60 | 7 of 7 | 0 |
 *
 * Today's hard clip separates **1 of 7**. Days below z = 0.90 are unchanged to the point.
 */
export const TAIL_BAND_POINTS = 20

/**
 * Linear through the middle, algebraic tails at both ends — the TN-60 shape.
 *
 * Takes a score already in linear points, so one implementation covers `higher-better`,
 * `lower-better` and the double-slope `closer-better` without a second formula to keep in step.
 *
 * **Algebraic (`1/(1+x)`), not exponential.** An exponential tail is the obvious smooth saturation
 * and it fails at the one job this has: it decays fast enough that after rounding to an integer the
 * extreme days re-tie. At a 5-point band an exponential separates 2 of the 7 worst measured days
 * and leaves 8 values pinned at a rail; the algebraic one separates 3 with none pinned, and the gap
 * widens with the band. Measured against those days, not reasoned about.
 *
 * Value and first derivative both match the linear region at the knee, so there is no kink, and the
 * rail is approached without being reached — rounding to an integer 100 would need roughly 23σ past
 * the knee.
 */
function compressTails(raw: number): number {
  return compressHighTail(compressLowTail(raw))
}

/** The top half of `compressTails`: a score above `100 - TAIL_BAND_POINTS` bends toward 100 without
 *  reaching it. Untouched below the knee. */
function compressHighTail(raw: number): number {
  const W = TAIL_BAND_POINTS
  return raw > 100 - W ? 100 - W / (1 + (raw - (100 - W)) / W) : raw
}

/** The bottom half: a score below `TAIL_BAND_POINTS` bends toward 0 without reaching it. Untouched
 *  above the knee. */
function compressLowTail(raw: number): number {
  const W = TAIL_BAND_POINTS
  return raw < W ? W / (1 + (W - raw) / W) : raw
}

/** Maps a personal-baseline z-score to a 0-100 sub-score. Linear through the middle; past the knee
 *  the tails compress, so extreme days keep their ordering instead of collapsing onto 0/100 (TN-60).
 *  - higher/lower-better: 75 at baseline (z=0) since #3778, approaching 100 beyond ~+1.5σ *in the good
 *    direction* and falling toward 0 beyond ~−1.5σ (see `baselineContributorCurve`).
 *  - closer-better (temperature): 100 at baseline (a stable temp is ideal — no fever/illness) and
 *    falling to 0 by ~1.5σ of deviation either way. (Previously it peaked at 50, which meant a
 *    perfectly-stable temperature could only ever be "neutral" and structurally capped readiness ~95.) */
export type BaselineDirection = 'higher-better' | 'lower-better' | 'closer-better'

/**
 * THE readiness curve for a baseline-relative contributor: z (standard deviations from the person's
 * own normal) → an unrounded 0–100 sub-score. The one definition; the composite, the re-derivation of
 * stored rows and the tests all read it.
 *
 * | z (good direction) | −3 | −1.5 | −0.9 | −0.5 | 0 | +0.5 | +0.9 | +1.5 | +3 |
 * |---|---|---|---|---|---|---|---|---|---|
 * | before #3778 | 4.4 | 10 | 20 | 33.3 | 50 | 66.7 | 80 | 90 | 95.6 |
 * | from #3778 (v18) | 6.7 | 15 | 30 | 50 | 75 | 83.3 | 90 | 95 | 97.8 |
 *
 * Temperature (closer-better) is the same before and after: 100 at baseline, falling either way.
 */
export function baselineContributorCurve(z: number, direction: BaselineDirection): number {
  if (direction === 'closer-better') {
    // Closer-better compresses only the BAD end (#2359). Its good end is z = 0, a single point that
    // cannot be exceeded, so there is no rail up there for a tail to stop extreme days piling onto: the
    // compression just pulled "exactly at baseline" down to 90 (raw 100 bends to 100 − 20/2) and cost
    // readiness about 1.1 points on every day with a normal temperature. The bad end, where a fever
    // pushes the raw score toward 0, keeps the TN-60 shape so extreme days stay ordered.
    return compressLowTail(100 - Math.abs(z) * (2 * Z_POINTS_PER_UNIT))
  }
  const raw = 50 + (direction === 'higher-better' ? z : -z) * Z_POINTS_PER_UNIT
  return recentre(compressTails(raw))
}

/** The sub-score a baseline-relative contributor falls back to with no input or a cold normal: the
 *  centre for the two centred directions, the plain neutral 50 for temperature (unchanged by #3778). */
export function baselineFallbackScore(direction: BaselineDirection): number {
  return direction === 'closer-better' ? NEUTRAL.score : READINESS_BASELINE_CENTRE
}

function zToScore(
  z: number | null,
  direction: BaselineDirection,
  nHistory: number,
  /** #2984: a value exists tonight, so a cold normal is `awaiting_baseline` even without a z. */
  valuePresent = false,
): ReadinessContributor {
  const centred = direction !== 'closer-better'
  const neutral = centred ? NEUTRAL_CENTRED : NEUTRAL
  if (z == null && !valuePresent) return neutral
  if (nHistory < BASELINE_MIN_NIGHTS) return centred ? AWAITING_BASELINE_CENTRED : AWAITING_BASELINE
  if (z == null) return neutral
  const shaped = baselineContributorCurve(z, direction)
  return { score: Math.max(0, Math.min(100, Math.round(shaped))), provisional: false, input: z, gap: null }
}

function plainScore(v: number | null): ReadinessContributor {
  if (v == null) return NEUTRAL
  return { score: Math.max(0, Math.min(100, Math.round(v))), provisional: false, input: v, gap: null }
}

/** Stamped onto `oura_daily_derived.model_versions.readiness` so a score can be attributed to the
 *  model that produced it. Bump whenever the weights, curves or z-slope change — Q-273.
 *  Rows written before 2026-08-18 carry no stamp at all.
 *  v6: a baseline under 64 nights old warms its deviation up instead of climbing from zero (#2159),
 *  which changes every z built from a young baseline. A mature ring baseline scores identically.
 *  v7: a temperature at baseline scores 100, not 90 (#2359) — the closer-better contributor no longer
 *  compresses its good end, which lifts every day with |tempZ| under 0.3 (raw above the 80 knee) by up to
 *  ~1.1 points on the 0-100 scale.
 *  v8: each night input is chosen per field (the ring's summary where it has the field, else the
 *  generic value for the same night) and judged against a normal learned from its own device; the
 *  recovery index takes Oura's own contributor where no hours exist (#2984). A full ring night with
 *  no Oura data scores as v7.
 *  v9: every baseline z is in standard deviations, √(π/2) × the fold's mean absolute deviation, where
 *  it used to divide by the deviation itself (#2158). Every baseline contributor's z shrinks by ~0.8, so
 *  `Z_POINTS_PER_UNIT`'s ±1.5 knee now means ±1.5σ. The illness radar reads the same z.
 *  v10: the activity-balance input is the previous completed day's finalised Activity score, not
 *  today's partial one (#2435). The weights are unchanged; the input means something else.
 *  v11: the night's HRV input is the median of Oura's 5-minute series, not Oura's per-night average
 *  (#3075 stage 1a). The definition changes under the same `oura_cloud` label, so the HRV normal mixes
 *  averages and medians until the Oura Cloud backfill from 17 Oct has rewritten those nights.
 *  v12 was reserved for the #3358 proposal and is left unused; that change shipped as v15.
 *  v13: on an Oura Cloud night with a usable heart-rate series, the recovery index is scored from hours we
 *  compute from that series (the hours curve), not from Oura's 0-100 contributor (#3075 stage 2). The ring's
 *  hours still win where tonight's ring summary has them; a night with no usable series keeps the contributor.
 *  v14: the Sleep Score behind the sleep term reads when sleep began and ended on an Oura Cloud night with a
 *  usable hypnogram, not the bed window (#3075 stage 3). Same readiness inputs, so a night moves only through that term.
 *  v15: yesterday's activity is one input, the previous completed day's finalised Activity score, at the
 *  0.15 the two activity inputs held between them (#3358). The cut-down `prevDayActivity` copy is gone, so a
 *  day moves by 0.10 × (finished − copy) before rounding. Stored rows keep their `prevDayActivity` key and
 *  their v14 stamp. Also v15: a night whose HRV is the source's own nightly average, not a series median,
 *  is marked (#3376); it scores exactly as before.
 *  v16: #3075 stages 4 and 5, from any source that sends them. The Sleep Score behind the sleep term takes a
 *  restlessness penalty from the source's movement series; a night the source says it recorded incompletely
 *  reads as partial (no sleep score, no hours in the sleep-balance normal), as the owner's mark does; and each
 *  per-night normal is learned from one (source, algorithm version), so a source that changes its algorithm
 *  starts its normals again. A night with none of the three is scored exactly as under v15.
 *  v17: #3601, the rest of stage 5. The payload's displayed HRV and resting-HR baselines and 7-day means (and
 *  the fallback score and early-deload check that read them) are of the newest reading's (source, algorithm
 *  version), the version read from the same night's sleep. One version per source scores exactly as v16;
 *  stored rows keep their v16 stamp.
 *  v18: a reading at baseline scores 75, not 50, on resting HR, HRV balance and sleep balance, and those
 *  three fall back to 75 when unscored (#3778, `READINESS_BASELINE_CENTRE`). Each σ keeps its ordering;
 *  an ordinary day's composite rises by about 11 points (0.44 × 25) and a day with those three far off
 *  baseline barely moves. Stored rows are not rewritten and keep their v17 (or older) stamp.
 */
export const READINESS_MODEL_VERSION = 'v18:baseline-centre-75:2026-11-15'

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

/** #2984. Oura's 0–100 `recovery_index` contributor, passed through on its own scale. Provisional for
 *  the same reason the hours curve is: it is not scored against the person's own normal. */
function recoveryIndexContributorScore(v: number | null | undefined): ReadinessContributor {
  if (v == null || !Number.isFinite(v)) return NEUTRAL
  return { score: Math.max(0, Math.min(100, Math.round(v))), provisional: true, input: v, gap: null, scale: 'oura_contributor' }
}

/**
 * The readiness composite model in serialisable form — weights, the z→score slope, the baseline
 * maturity gate and each contributor's direction. Exported so tooling (the admin day-review audit)
 * can present a score alongside the exact model that produced it without copying any of it.
 */
export const READINESS_MODEL = {
  weights: READINESS_WEIGHTS,
  zPointsPerUnit: Z_POINTS_PER_UNIT,
  tailBandPoints: TAIL_BAND_POINTS,
  baselineMinNights: BASELINE_MIN_NIGHTS,
  recoveryIndexOptimalHours: RECOVERY_INDEX_OPTIMAL_HOURS,
  modelVersion: READINESS_MODEL_VERSION,
  neutralScore: NEUTRAL.score,
  /** #3778: what resting HR, HRV balance and sleep balance score at baseline, and fall back to. */
  baselineCentre: READINESS_BASELINE_CENTRE,
  directions: {
    restingHeartRate: 'lower-better',
    hrvBalance: 'higher-better',
    temperature: 'closer-better',
    sleepBalance: 'higher-better',
    previousNight: 'passthrough',
    recoveryIndex: 'hours-curve',
    activityBalance: 'passthrough',
  },
} as const

export function computeReadinessComposite(input: ReadinessCompositeInputs): ReadinessCompositeResult {
  const nights = input.baselineNights ?? {}
  const baseline = (key: BaselineContributorKey, z: number | null, direction: BaselineDirection) =>
    nights[key] != null ? zToScore(z, direction, nights[key]!, true) : zToScore(z, direction, input.nHistory)
  const contributors: ReadinessCompositeResult['contributors'] = {
    restingHeartRate: baseline('restingHeartRate', input.rhrZ, 'lower-better'),
    hrvBalance:        baseline('hrvBalance', input.hrvZ, 'higher-better'),
    temperature:       baseline('temperature', input.tempZ, 'closer-better'),
    sleepBalance:      baseline('sleepBalance', input.sleepBalanceZ, 'higher-better'),
    previousNight:     plainScore(input.previousNightScore),
    // Calibrated from Recovery-Index hours (anchored on Oura's public "≥6 h = good recovery"),
    // replacing the former dead NEUTRAL that made 10% of readiness a frozen 50. Flagged provisional
    // (approximation) and falls back to neutral when there's no overnight HR series.
    // #2984: Oura's own contributor stands in only where there are no hours to put through the curve.
    recoveryIndex:     input.recoveryIndexHours != null && Number.isFinite(input.recoveryIndexHours)
      ? recoveryIndexScore(input.recoveryIndexHours)
      : recoveryIndexContributorScore(input.recoveryIndexContributor),
    activityBalance:   plainScore(input.activityBalanceScore),
  }
  for (const [key, source] of Object.entries(input.sources ?? {}) as [keyof typeof READINESS_WEIGHTS, string | undefined][]) {
    if (source && contributors[key].gap !== 'no_input') contributors[key] = { ...contributors[key], source }
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
  scale?: string
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
  /**
   * Contributor keys ABSENT from the stored map entirely — a different thing from `uncheckable`,
   * which is a key that is present but carries no input (TN-49).
   *
   * These used to be skipped, which dropped their WEIGHT from the sum and made `score` come out
   * low by roughly `weight × 50` — indistinguishable, from outside, from a real disagreement.
   * Measured on production 2026-09-18: seven rows (2026-07-16 → 07-22) stored eight of the then
   * nine contributors, missing `checkin` (weight 0.10), and read 4 to 6 points below their stored
   * score for that reason alone. `checkin` has since left the model (#2224), so those rows now hold
   * every current key; the rule stands for the next one that goes missing.
   *
   * The opposite case is not reported: a stored key the current model no longer has (every row
   * written before #2224 carries `checkin`) is ignored, and `score` is what the current model gives.
   * That is a model change, which `model_versions.readiness` on the row already records.
   *
   * A missing key now contributes the model's own neutral (75 for the three centred keys since #3778, 50 for the rest), which is what
   * `computeReadinessComposite` uses for a contributor with no input — so `score` is the closest
   * the stored row can support. It is still an ASSUMPTION, which is why the key is reported: a
   * caller must not claim a row reproduces cleanly while this is non-empty.
   */
  missing: (keyof typeof READINESS_WEIGHTS)[]
}

function isBaselineDirection(d: (typeof READINESS_MODEL.directions)[keyof typeof READINESS_WEIGHTS]): d is BaselineDirection {
  return d === 'higher-better' || d === 'lower-better' || d === 'closer-better'
}

/** Re-derive one persisted contributor's score from the input stored beside it, under the current
 *  model. `null` when the row carries no input at all. */
function rederiveContributor(
  key: keyof typeof READINESS_WEIGHTS,
  stored: StoredReadinessContributor,
): number | null {
  if (!('input' in stored)) return null
  const value = stored.input
  const direction = READINESS_MODEL.directions[key]
  // No input → the model's neutral, by definition — which for the centred three is the centre (#3778).
  if (value == null) return isBaselineDirection(direction) ? baselineFallbackScore(direction) : NEUTRAL.score
  if (direction === 'passthrough') return plainScore(value).score
  if (stored.scale === 'oura_contributor') return recoveryIndexContributorScore(value).score
  if (direction === 'hours-curve') return recoveryIndexScore(value).score
  // A z contributor that stored an input was not baseline-cold at write time — a cold one falls back
  // to NEUTRAL, whose input is null and which returned above. So the maturity gate is satisfied.
  return zToScore(value, direction, BASELINE_MIN_NIGHTS).score
}

/**
 * #2992. Whether a STORED composite is still learning its normals, read from its own contributors.
 *
 * Training stress used to ask the ring summary (`n_history < BASELINE_MIN_NIGHTS`), which reads as
 * "learning" on every day without a ring row: every Oura Cloud day since the 17 Oct switch. Since
 * normals are per device (#2984), the stored contributors are the record of whether the baseline
 * inputs that fed this score were judged against a mature normal.
 *
 * Learning when no baseline-relative contributor was scored and at least one was waiting on its
 * normal. Returns `null` when the row cannot say (no contributor map, or one written before
 * contributors carried a `gap`), so the caller keeps its older rule for those rows.
 */
export function storedReadinessLearning(stored: unknown): boolean | null {
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) return null
  const map = stored as Record<string, unknown>
  const keys: BaselineContributorKey[] = ['restingHeartRate', 'hrvBalance', 'temperature', 'sleepBalance']
  let scored = 0
  let awaiting = 0
  for (const key of keys) {
    const c = map[key]
    if (c == null || typeof c !== 'object' || !('gap' in c)) return null
    const gap = (c as { gap: unknown }).gap
    if (gap === null) scored++
    else if (gap === 'awaiting_baseline') awaiting++
  }
  return scored === 0 && awaiting > 0
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
  const missing: ReadinessRederivation['missing'] = []
  let weighted = 0
  let matched = 0

  for (const key of Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]) {
    const entry = map[key]

    // TN-49 — a key that is ABSENT carries the model's NEUTRAL rather than being skipped. Skipping
    // dropped its WEIGHT from a sum defined to total 1, so the result came out low by about
    // `weight × 50` and read as a disagreement the row did not have.
    if (entry === undefined) {
      missing.push(key)
      const direction = READINESS_MODEL.directions[key]
      weighted += (isBaselineDirection(direction) ? baselineFallbackScore(direction) : NEUTRAL.score) * READINESS_WEIGHTS[key]
      continue
    }

    // A key that is PRESENT but unusable is deliberately NOT treated the same way, and the asymmetry
    // is the point. An absent key has no score, so standing the model's own neutral in for it
    // reproduces what the composite did; a present key with a corrupt score is a value we cannot
    // read, and inventing 50 for it would be asserting something the row does not say. This path is
    // unchanged and stays skipped, which means it keeps the low-by-`weight × score` trap above —
    // accepted, because no production row has ever been in this state, and the alternative is
    // changing a behaviour an existing test pins on purpose.
    const c = entry != null && typeof entry === 'object' ? entry as StoredReadinessContributor : null
    if (c == null || typeof c.score !== 'number' || !Number.isFinite(c.score)) continue
    matched++

    const rederived = rederiveContributor(key, c)
    if (rederived == null) uncheckable.push(key)
    else if (rederived !== c.score) drifted.push({ key, stored: c.score, rederived })

    weighted += (rederived ?? c.score) * READINESS_WEIGHTS[key]
  }

  if (matched === 0) return null
  return { score: Math.round(weighted), drifted, uncheckable, missing }
}
