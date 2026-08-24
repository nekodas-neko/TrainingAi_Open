export interface RMStyleSet {
  pct: number
  reps: number
  useFor1rm?: boolean
}

export function mround(value: number, multiple: number): number {
  return Math.round(value / multiple) * multiple
}

// One rep ceiling for every estimation path — formulas are meaningless past this.
export const REP_CEILING = 30

// Multiplier from weight to estimated 1RM at a given rep count. Average of Epley and
// Brzycki up to 20 reps; above 20 the Brzycki term is FROZEN at its 20-rep value so the
// curve grows on Epley alone — Brzycki's 36/(37−reps) blows up toward rep 36 (order-of-
// magnitude inflation) and freezing keeps the function continuous, monotonic and total.
export function repFactor(reps: number): number {
  const epley = 1 + reps / 30
  const brzycki = 36 / (37 - Math.min(reps, 20))
  return (epley + brzycki) / 2
}

// Average of Epley and Brzycki for more consistent 1RM estimates
export function calc1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  return mround(weight * repFactor(reps), 0.25)
}

// AMRAP-adjusted 1RM: applies a rep-band scale factor to compensate for formula
// inflation at high reps (fatigue limits AMRAP sets more than strength does above ~10 reps)
export function amrapScaleFactor(reps: number): number {
  if (reps <= 5) return 1.0
  if (reps <= 8) return 0.97
  if (reps <= 12) return 0.93
  if (reps <= 20) return 0.88
  return 0.82
}

export function calcAmrap1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  return mround(calc1RM(weight, reps) * amrapScaleFactor(reps), 0.25)
}

// A progression style prescribes hitting `targetReps` at `pct`% of 1RM. Feeding that
// straight into calc1RM understates the lifter's true 1RM for every standard style
// (e.g. 60%/12reps yields ~93% of actual 1RM), so the estimate decays session over
// session even when the lifter matches the prescription exactly. This factor rescales
// calc1RM's output so that hitting the prescription exactly reproduces the previous
// 1RM, while exceeding/missing it moves the estimate up/down accordingly.
// Returns null when no style prescribes this set, rather than 1 — a real prescription can
// legitimately resolve to exactly 1 (Q-304), and the caller needs to tell "no correction applies"
// from "the correction happens to be 1" so it knows to fall back to the AMRAP band correction.
function prescriptionFactor(pct?: number, targetReps?: number): number | null {
  if (!pct || pct <= 0 || !targetReps || targetReps <= 0 || targetReps >= 37) return null
  return 1 / ((pct / 100) * repFactor(targetReps))
}

export function calculate1RM(
  weights: number[],
  reps: number[],
  style?: RMStyleSet[] | null,
): { estimated1rm: number; target80: number } {
  const indices = style?.some(s => s.useFor1rm)
    ? reps.map((_, i) => i).filter(i => style![i]?.useFor1rm)
    : reps.map((_, i) => i)
  const oneRMs = indices
    .map(i => {
      const w = weights[i] ?? weights[weights.length - 1] ?? 0
      const r = reps[i] ?? 0
      if (!(w && r) || r > REP_CEILING) return 0  // beyond the ceiling: estimation formulas break down
      // Q-304: a set with no prescribed pct/targetReps is an AMRAP set by construction, and
      // amrapScaleFactor is the correction that already exists for exactly that — it was applied
      // to bodyweight/baseline sets (amrapAverage1Rm) but not here, so an unprescribed set at
      // 13+ reps fed the estimate un-discounted. A prescribed set keeps its own rescale; the two
      // never combine (double-correcting a prescribed set would deflate the estimate instead).
      const factor = prescriptionFactor(style?.[i]?.pct, style?.[i]?.reps) ?? amrapScaleFactor(r)
      return mround(w * repFactor(r) * factor, 0.25)
    })
    .filter(v => v > 0)
  const estimated1rm = oneRMs.length > 0 ? mround(oneRMs.reduce((a, b) => a + b, 0) / oneRMs.length, 0.25) : 0
  const target80 = mround(estimated1rm * 0.8, 0.25)
  return { estimated1rm, target80 }
}

// Live per-set running estimate: the same calculate1RM the app saves, fed the
// sets logged so far, so the widget's number matches the summary exactly. If a
// useFor1rm-subset style hasn't logged a qualifying set yet (estimate is 0),
// fall back to averaging all logged sets so a number always shows from set 1.
export function runningEstimate1RM(
  weights: number[],
  reps: number[],
  style?: RMStyleSet[] | null,
): number {
  const primary = calculate1RM(weights, reps, style).estimated1rm
  if (primary > 0) return primary
  const flat = style?.map(s => ({ pct: s.pct, reps: s.reps }))
  return calculate1RM(weights, reps, flat).estimated1rm
}

export type OneRmTrend = 'up' | 'even' | 'down' | 'none'

// Classify a live projection against the previous 1RM. ±0.5 kg counts as even so
// the colour doesn't flicker on a near-match.
export function oneRmTrendStatus(projected: number, previous: number | null): OneRmTrend {
  if (previous == null || previous <= 0) return 'none'
  const diff = projected - previous
  if (diff > 0.5) return 'up'
  if (diff < -0.5) return 'down'
  return 'even'
}

// Fixed reference weight for bodyweight exercises. Stands in for the lifter's real
// (fluctuating) body weight so the 1RM primitives yield a number driven by reps +
// added load only. Internal — never displayed as kg.
export const BW_REF = 100

export type OneRmExerciseType = 'weighted' | 'bodyweight'

export interface OneRmSetInput { weightKg: number; reps: number }

export interface OneRmEstimateOpts {
  exerciseType: OneRmExerciseType
  style?: RMStyleSet[] | null
  bwRef?: number
  isBaseline?: boolean
  targetPct?: number
  // A deliberately submaximal set (deload) must never feed the estimate, but a style whose
  // sets are ALL useFor1rm:false is ambiguous on its own — some progression styles (e.g.
  // "General") mean that as "no per-set preference, use them all", not "exclude everything"
  // (calculate1RM's/amrapAverage1Rm's own fallback). `deloaded` is the unambiguous signal:
  // when true, skip estimation entirely rather than let a deload's suppressed-pct sets run
  // through either formula as if they were genuine working sets (Q-115).
  deloaded?: boolean
}

export interface OneRmEstimate { estimated1rm: number; target80: number; targetPct: number }

// Baseline weeks and all bodyweight sets: per-set AMRAP-scaled estimates, averaged.
// Same useFor1rm subset rule and per-set mround as calculate1RM.
function amrapAverage1Rm(weights: number[], reps: number[], style?: RMStyleSet[] | null): number {
  const flagged = style?.some(s => s.useFor1rm)
  const indices = reps.map((_, i) => i).filter(i => !flagged || style![i]?.useFor1rm)
  const perSet = indices
    .map(i => {
      const w = weights[i] ?? 0
      const r = Math.min(reps[i] ?? 0, REP_CEILING)
      return w > 0 && r > 0 ? calcAmrap1RM(w, r) : 0
    })
    .filter(v => v > 0)
  return perSet.length ? mround(perSet.reduce((a, b) => a + b, 0) / perSet.length, 0.25) : 0
}

function styleTargetPct(style?: RMStyleSet[] | null): number | null {
  if (!style?.length) return null
  const flagged = style.filter(s => s.useFor1rm && s.pct > 0)
  const pool = flagged.length ? flagged : style.filter(s => s.pct > 0)
  return pool.length ? Math.max(...pool.map(s => s.pct)) : null
}

// Single entry point for saved 1RM estimates — the log path, the edit (PATCH) path and the
// client preview must all produce the same number for the same sets.
export function estimateOneRm(sets: OneRmSetInput[], opts: OneRmEstimateOpts): OneRmEstimate {
  const { exerciseType, style, bwRef = BW_REF, isBaseline = false, deloaded = false } = opts
  const targetPct = opts.targetPct ?? styleTargetPct(style) ?? 80
  if (deloaded) return { estimated1rm: 0, target80: 0, targetPct }
  const weights = sets.map(s => (exerciseType === 'bodyweight' ? Math.max(1, bwRef + s.weightKg) : s.weightKg))
  const reps = sets.map(s => s.reps)

  let estimated1rm: number
  if (exerciseType === 'bodyweight' || isBaseline) {
    estimated1rm = amrapAverage1Rm(weights, reps, style)
  } else {
    estimated1rm = calculate1RM(weights, reps, style).estimated1rm
  }
  return { estimated1rm, target80: mround(estimated1rm * targetPct / 100, 0.25), targetPct }
}

// Display-only best-single-set 1RM estimate. PRs (and every prescription) deliberately
// store the session AVERAGE from estimateOneRm — self-regulating, and the v1.72.0
// last-set-push builds on it (a +1-rep gain scales with 1/set-count, so progression speed
// is coupled to programmed set volume — keep this in mind when tuning autoregulation
// thresholds). This function is for a future "best set ever proved ~X kg" display and is
// NEVER written to personal_records or any stored estimate.
export function bestSetOneRm(sets: OneRmSetInput[], opts: Pick<OneRmEstimateOpts, 'exerciseType' | 'bwRef'>): number {
  const { exerciseType, bwRef = BW_REF } = opts
  let best = 0
  for (const s of sets) {
    const r = Math.min(s.reps, REP_CEILING)
    if (r <= 0) continue
    if (exerciseType === 'bodyweight') {
      const w = Math.max(1, bwRef + s.weightKg)
      best = Math.max(best, calcAmrap1RM(w, r))
    } else {
      if (s.weightKg <= 0) continue
      best = Math.max(best, calc1RM(s.weightKg, r))
    }
  }
  return best
}

// Largest integer rep count R (1..REP_CEILING) whose reference-weight (+ addedKg) 1RM does
// not exceed oneRm. Pass addedKg for a weighted-variation 1RM so the inversion happens at
// the load it was actually earned on, not bare bodyweight — inverting a 1RM proven on
// weighted pull-ups at bare bodyweight prescribes inflated rep targets. The +0.5 tolerance
// absorbs the 0.25 rounding in stored estimates. Returns 0 when there is no estimate.
export function repMaxFromOneRm(oneRm: number, addedKg = 0): number {
  if (oneRm <= 0) return 0
  const ref = Math.max(1, BW_REF + addedKg)
  let best = 1
  for (let r = 1; r <= REP_CEILING; r++) {
    if (calc1RM(ref, r) <= oneRm + 0.5) best = r
    else break
  }
  return best
}

// ── Display basis: bodyweight strength is measured in REPS, never kilograms ──
//
// A bodyweight `estimated1rm` is BW_REF-relative, so it is a pure monotone function of reps and
// added load — it is an internal index, not a weight the lifter ever moved. Rendering it as kg is
// what let a change of the BW_REF constant read as a +40% strength gain (audit finding Q-12), and
// it is meaningless to the user besides. Every surface that shows a stored 1RM resolves its unit
// here rather than hardcoding "kg".

export type OneRmUnit = 'kg' | 'RM'

export function isBodyweightType(exerciseType?: string | null): boolean {
  return exerciseType === 'bodyweight'
}

export function oneRmUnit(exerciseType?: string | null): OneRmUnit {
  return isBodyweightType(exerciseType) ? 'RM' : 'kg'
}

/** What "strength" is called for this exercise — a card/column heading. */
export function oneRmLabel(exerciseType?: string | null): string {
  return isBodyweightType(exerciseType) ? 'Rep Max' : 'Estimated 1RM'
}

export interface OneRmDisplay {
  /** The number to render: reps for bodyweight, kilograms otherwise. */
  value: number
  unit: OneRmUnit
  /** `value` and `unit` joined, e.g. `6 RM` or `92.5 kg`. */
  text: string
}

/**
 * Render a stored `estimated1rm` in the unit that means something for this exercise. Pass
 * `addedKg` for a weighted variation of a bodyweight movement so the rep-max inversion happens at
 * the load it was actually earned on (see {@link repMaxFromOneRm}).
 */
export function displayOneRm(
  oneRm: number,
  exerciseType?: string | null,
  addedKg = 0,
): OneRmDisplay {
  if (isBodyweightType(exerciseType)) {
    const reps = repMaxFromOneRm(oneRm, addedKg)
    return { value: reps, unit: 'RM', text: `${reps} RM` }
  }
  const kg = mround(oneRm, 0.25)
  return { value: kg, unit: 'kg', text: `${kg} kg` }
}

/**
 * Signed change between two stored 1RMs, in display units. For bodyweight this is a whole number
 * of reps, so a change smaller than one rep reports 0 rather than a fractional kg figure that has
 * no meaning — which is the point of the whole rep basis.
 */
export function displayOneRmDelta(
  current: number,
  previous: number | null | undefined,
  exerciseType?: string | null,
  addedKg = 0,
): { value: number; unit: OneRmUnit; text: string } | null {
  if (previous == null || previous <= 0) return null
  const unit = oneRmUnit(exerciseType)
  const diff = isBodyweightType(exerciseType)
    ? repMaxFromOneRm(current, addedKg) - repMaxFromOneRm(previous, addedKg)
    : Math.round((current - previous) * 100) / 100
  const sign = diff > 0 ? '+' : ''
  const text = unit === 'RM'
    ? `${sign}${diff} rep${Math.abs(diff) === 1 ? '' : 's'}`
    : `${sign}${diff.toFixed(2)} kg`
  return { value: diff, unit, text }
}

/**
 * One personal record as a phrase — "Barbell Bench Press 96kg est. 1RM" / "Pull-Up 6 RM".
 * Shared by the daily and weekly digests so the two can't drift, and so a bodyweight record is
 * never announced as a weight (finding Q-19).
 */
export function describePersonalRecord(
  exerciseName: string,
  oneRm: number,
  exerciseType?: string | null,
): string {
  return isBodyweightType(exerciseType)
    ? `${exerciseName} ${displayOneRm(oneRm, exerciseType).text}`
    : `${exerciseName} ${Math.round(oneRm)}kg est. 1RM`
}

/**
 * The single "biggest" personal record out of a set — the one a recap headlines.
 *
 * **Stored 1RMs are not all in the same unit**, so a plain `max` is wrong. A bodyweight record's
 * `estimated1rm` is a {@link BW_REF}-relative index; a weighted one is kilograms. Comparing them
 * ranks a 6-rep pull-up (118) above a real 96 kg bench press, which is how a year recap came to
 * headline "Hanging Leg Raise, 128 kg" (found 2026-08-03 against production).
 *
 * So: rank the weighted records against each other in kilograms, and fall back to the best
 * bodyweight record only when there are no weighted ones at all — a bodyweight-only trainee still
 * gets a headline, and no comparison ever crosses the two bases. Render the result with
 * {@link displayOneRm} or {@link describePersonalRecord}; the caller must not assume kilograms.
 */
export function pickHeadlinePersonalRecord<T extends { estimated1rm: number; exerciseType?: string | null }>(
  records: readonly T[],
): T | null {
  const best = (rows: readonly T[]): T | null =>
    rows.length > 0 ? rows.reduce((max, r) => (r.estimated1rm > max.estimated1rm ? r : max)) : null
  return best(records.filter(r => !isBodyweightType(r.exerciseType))) ?? best(records)
}

/** A 1RM history series converted to display units, for sparklines and trend charts. */
export function displayOneRmSeries(
  values: number[],
  exerciseType?: string | null,
  addedKg = 0,
): number[] {
  if (!isBodyweightType(exerciseType)) return values
  return values.map(v => repMaxFromOneRm(v, addedKg))
}

// Rescales a STATIC progression style's reps for a bodyweight exercise from its
// per-set pct targets and the lifter's rep-max (inverted from their bodyweight 1RM
// via repMaxFromOneRm). Only ever call this for the static base-style path — an AI
// Dynamic Periodization prescription (prescriptionStyleForExercise,
// lib/ai-periodization/apply-prescription.ts) already decides bodyweight-appropriate
// reps directly from its own signals; re-deriving them here a second time silently
// discards the AI's decision (the bug this function's extraction fixes — see
// docs/superpowers/plans/2026-07-05-bodyweight-reps-ai-prescription-override.md).
export function rescaleBodyweightReps<T extends RMStyleSet>(style: T[], basis: number): T[] {
  const repMax = repMaxFromOneRm(basis)
  if (repMax <= 0) return style
  return style.map(s => ({ ...s, reps: Math.max(1, Math.floor((s.pct / 100) * repMax)) }))
}

// Decides whether a bodyweight exercise's progression style needs the rep-max rescale.
// Gate on aiStyleApplied (per-exercise: did the AI actually prescribe THIS exercise),
// never the session-level aiDrivesLoad — a bodyweight exercise the AI dropped from its
// response falls back to the static style and must still be rescaled, or it serves raw,
// un-rescaled static reps (the regression docs/superpowers/plans/
// 2026-07-05-bodyweight-reps-dropped-exercise-regression.md fixes).
export function resolveBodyweightStyle<T extends RMStyleSet>(params: {
  bwType: string
  style: T[] | null
  isBaselinePhase: boolean
  aiStyleApplied: boolean
  basis: number
}): T[] | null {
  const { bwType, style, isBaselinePhase, aiStyleApplied, basis } = params
  if (bwType === 'bodyweight' && style && !isBaselinePhase && !aiStyleApplied) {
    return rescaleBodyweightReps(style, basis)
  }
  return style
}

/**
 * The 1RM a prescription should be computed from — one definition for every weight path.
 *
 * There were three copies of this idea and they disagreed. `session-data.ts` set
 * `estimated1rm` from the last log alone, `next-session/prescription` took
 * `max(lastLog, PR)`, and the bodyweight rep basis took a third. So the done-screen
 * "next workout" preview and the session it previews could show different weights for the
 * same exercise, and a user-entered starting 1RM reached neither — the workout screen fell
 * through to a hardcoded 60 kg, which is why the builder's "pre-seed working weights" copy
 * was never true.
 *
 * **The last real session wins outright (Q-202, owner decision 2026-08-12).** This used to
 * return `max(lastLog, seed, allTimePr)`, so that an easy day could never lower targets. The
 * cost of that protection was that a *deliberate, sustained* reduction could never lower them
 * either: the all-time PR is permanent and always won the max, so no number of consecutive
 * lighter sessions moved the prescribed weight. The owner lowered their weights to work on
 * form and the app kept prescribing from a lift months old.
 *
 * The trade-off was put to them explicitly and accepted: one tired or interrupted session now
 * lowers the next prescription. A smoothed variant (best of the last ~3) was offered and
 * declined — do not reintroduce it without asking.
 *
 * `seedEstimate` and `allTimePr1rm` are now reached only when there is no real logged session
 * at all, which is the case they were always genuinely needed for.
 *
 * Returns null when there is nothing to go on. Deliberately never a fallback constant: an
 * empty weight field the user fills in is honest, a fabricated 60 kg is not.
 */
export function resolveWorkingBasis(input: {
  /** The 1RM from this exercise's most recent NON-DELOAD log — the one that now sets the
   *  target. Deload logs are excluded at the query, not here: `estimateOneRm` already stores
   *  `estimated1rm: 0` for a deliberately submaximal effort, so a deload row carries no usable
   *  number to begin with. */
  lastNonDeload1rm?: number | null
  /** A starting 1RM the user typed in the builder (`exercise_estimates`). */
  seedEstimate?: number | null
  /** The earned all-time best. No longer competes with the last session — kept as a fallback
   *  for an exercise that has a PR from an older program but no recent real log. */
  allTimePr1rm?: number | null
}): number | null {
  const usable = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0

  if (usable(input.lastNonDeload1rm)) return input.lastNonDeload1rm

  const fallbacks = [input.seedEstimate, input.allTimePr1rm].filter(usable)
  return fallbacks.length ? Math.max(...fallbacks) : null
}
