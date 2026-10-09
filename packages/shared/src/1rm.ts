export interface RMStyleSet {
  pct: number
  reps: number
  useFor1rm?: boolean
  /**
   * Issue 2200: the bar the app actually put up for this set, after plate rounding
   * (`set_logs.planned_weight_kg`), and the 1RM it was computed from. When both are present and
   * consistent with `pct`, the set is scored against the bar's real share of that 1RM rather than
   * the planned percentage. See {@link withPrescribedBars}.
   */
  barKg?: number | null
  basisKg?: number | null
}

export function mround(value: number, multiple: number): number {
  return Math.round(value / multiple) * multiple
}

// One rep ceiling for every estimation path — formulas are meaningless past this. A set above it
// is COUNTED AT the ceiling on every path (issue 2193 (c)); it used to be dropped on one path
// (calculate1RM) and clamped on the others, so the same 32-rep set was worth 0 or a full set
// depending on which estimator read it.
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
  return mround(weight * repFactor(Math.min(reps, REP_CEILING)), 0.25)
}

/**
 * AMRAP discount: compensates for formula inflation at high reps (fatigue limits an all-out set
 * more than strength does above ~10 reps).
 *
 * Issue 2193 (a), owner-signed 2026-10-06: a straight line between the same anchors
 * (5: 1.00, 8: 0.97, 12: 0.93, 20: 0.88, 30: 0.82) instead of steps at 5/8/12/20. The steps
 * made one more rep LOWER the estimate across each boundary (at 80 kg: 8→9 reps −1.0 kg,
 * 12→13 −2.25, 20→21 −7.75); 3,252 such inversions across 5–250 kg. The line keeps every anchor
 * value, so a set ON an anchor scores as before, and the product with `repFactor` never falls
 * as reps rise, up to the ceiling.
 */
const AMRAP_ANCHORS: readonly (readonly [reps: number, factor: number])[] = [
  [5, 1.0], [8, 0.97], [12, 0.93], [20, 0.88], [REP_CEILING, 0.82],
]

export function amrapScaleFactor(reps: number): number {
  const [firstReps, firstFactor] = AMRAP_ANCHORS[0]
  if (reps <= firstReps) return firstFactor
  for (let i = 1; i < AMRAP_ANCHORS.length; i++) {
    const [r1, f1] = AMRAP_ANCHORS[i]
    if (reps <= r1) {
      const [r0, f0] = AMRAP_ANCHORS[i - 1]
      return f0 + (f1 - f0) * (reps - r0) / (r1 - r0)
    }
  }
  return AMRAP_ANCHORS[AMRAP_ANCHORS.length - 1][1]
}

// Rounded ONCE (issue 2193 (a)): it used to round `calc1RM` to 0.25 and then round the discounted
// value again, which on its own could cost one extra rep its gain.
export function calcAmrap1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  const r = Math.min(reps, REP_CEILING)
  return mround(weight * repFactor(r) * amrapScaleFactor(r), 0.25)
}

/**
 * The most the app's plate rounding can add to a prescribed bar: the barbell step, two 1.25 kg
 * plates (`BARBELL_WEIGHT_STEP_KG` in components/workout/utils.ts; other equipment rounds to 1.25).
 * `mroundStepUp` also floors every bar at 5 kg and caps it at 250.
 */
export const MAX_BAR_ROUNDING_KG = 2.5
const MIN_BAR_KG = 5
const MAX_BAR_KG = 250

/**
 * The bar's real share of the 1RM it was prescribed from, in percent, or null when this set has no
 * usable bar (issue 2200).
 *
 * A bar is used only when rounding `basisKg × pct` up to the plate grid could have produced it.
 * A bar that belongs to a different basis or a different percentage (a stale value, an edited
 * payload) therefore cannot rescale the estimate: that set falls back to the planned percentage,
 * the arithmetic every set used before issue 2200.
 */
function barSharePct(set: RMStyleSet): number | null {
  const { pct, barKg, basisKg } = set
  if (barKg == null || basisKg == null) return null
  if (!Number.isFinite(barKg) || !Number.isFinite(basisKg) || barKg <= 0 || basisKg <= 0) return null
  const raw = basisKg * pct / 100
  const eps = 1e-6
  const roundedUp = barKg >= raw - eps && (barKg - raw <= MAX_BAR_ROUNDING_KG + eps || barKg <= MIN_BAR_KG + eps)
  const capped = barKg >= MAX_BAR_KG - eps && raw > MAX_BAR_KG
  if (!roundedUp && !capped) return null
  return barKg / basisKg * 100
}

// A progression style prescribes hitting `targetReps` at `pct`% of 1RM. Feeding that
// straight into calc1RM understates the lifter's true 1RM for every standard style
// (e.g. 60%/12reps yields ~93% of actual 1RM), so the estimate decays session over
// session even when the lifter matches the prescription exactly. This factor rescales
// calc1RM's output so that hitting the prescription exactly reproduces the previous
// 1RM, while exceeding/missing it moves the estimate up/down accordingly.
//
// Issue 2200 (owner-signed 2026-10-06): "the prescription" is the bar the app actually loaded, not
// the percentage it started from. The bar is `mroundStepUp(basis × pct/100, step)`, a CEILING round,
// so dividing by the planned pct credited every exactly-hit set with the round-up: 27.5 × 10
// prescribed at 70.5 % of 36.5 stored 39.0 (+6.8 %). Against the bar's real share (27.5 / 36.5 =
// 75.3 %) the same set stores 36.5. More weight or more reps than prescribed still raise it, fewer
// still lower it. A set with no stored bar (every row before #2445, an override with no
// prescription) keeps the planned percentage.
//
// Returns null when no style prescribes this set, rather than 1 — a real prescription can
// legitimately resolve to exactly 1 (Q-304), and the caller needs to tell "no correction applies"
// from "the correction happens to be 1".
function prescriptionFactor(set: RMStyleSet | undefined): number | null {
  if (!set) return null
  const { pct, reps: targetReps } = set
  if (!pct || pct <= 0 || !targetReps || targetReps <= 0 || targetReps >= 37) return null
  const share = barSharePct(set) ?? pct
  return 1 / ((share / 100) * repFactor(targetReps))
}

/**
 * Attach the prescribed bars, and the 1RM they came from, to a style so the estimate scores each
 * set against the bar it was given (issue 2200). `bars[i]` is set i's `set_logs.planned_weight_kg`,
 * null where no style percentage set a bar. With no basis or no bar the style comes back as it was,
 * and every set keeps the planned-percentage arithmetic.
 */
export function withPrescribedBars<T extends RMStyleSet>(
  style: T[] | null | undefined,
  bars: readonly (number | null | undefined)[] | null | undefined,
  basisKg: number | null | undefined,
): T[] | null {
  if (!style) return null
  if (!bars?.length || basisKg == null || !Number.isFinite(basisKg) || basisKg <= 0) return style
  return style.map((s, i) => {
    const bar = bars[i]
    return bar != null && Number.isFinite(bar) && bar > 0 ? { ...s, barKg: bar, basisKg } : s
  })
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
      // Issue 2193 (c): a set above the ceiling counts AT the ceiling, as it already did in
      // amrapAverage1Rm and bestSetOneRm. It used to be dropped here, so 31 reps scored nothing.
      const r = Math.min(reps[i] ?? 0, REP_CEILING)
      if (!(w && r)) return 0
      // Issue 2357 (owner-signed 2026-10-06): a working set from a slot with no prescription (no
      // style, or a set past the style's length) uses the plain rep-factor estimate. Q-304 had given
      // it the AMRAP discount on the premise that an unprescribed set is all-out; it is not — those
      // are chosen working sets — so the discount understated each one by about 3 %. The discount
      // stays where a set really is all-out: baseline tests and bodyweight sets (amrapAverage1Rm).
      // A prescribed set keeps its own rescale.
      const factor = prescriptionFactor(style?.[i]) ?? 1
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
  const flat = style?.map(s => ({ pct: s.pct, reps: s.reps, barKg: s.barKg, basisKg: s.basisKg }))
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
/**
 * Whether this exercise's 1RM estimate must be suppressed as deload work.
 *
 * TN-74: this predicate had two copies — here and in `components/workout-screen.tsx`, which
 * computes the estimate the DEVICE stores when a set is logged offline. They agreed, which is
 * why nothing had broken; they are one function now because of what they decide. The estimate
 * this gates is the field `estimated_1rm > 0 IS the deload test` keys off, so a drift between
 * the two copies would not show up as a wrong number on a screen — it would show up as an
 * offline-logged exercise disagreeing with the server about whether a deload happened at all.
 *
 * `isBaseline` is the carve-out both copies already had: a baseline test is a genuine max-effort
 * attempt even inside an otherwise-active deload window.
 */
export function isDeloadedForEstimate(a: {
  exerciseDeloaded?: boolean
  isAnyDeload: boolean
  isBaseline: boolean
}): boolean {
  return a.exerciseDeloaded === true || (a.isAnyDeload && !a.isBaseline);
}

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
// not exceed oneRm.
//
// **Kept, and deliberately NOT the one the display helpers call (BF-164).** This inverts the
// unscaled `calc1RM`, which is right for exactly one caller: `exercise-stats-sheet.tsx` builds its
// comparison table with `calc1RM` too, so that pair is self-consistent. Everything that inverts a
// STORED estimate wants `bodyweightRepMax`, because stored bodyweight estimates go through
// `calcAmrap1RM`. Do not "unify" the two — they answer different questions. Pass addedKg for a weighted-variation 1RM so the inversion happens at
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

/**
 * The rep count a STORED bodyweight estimate came from (BF-149).
 *
 * `repMaxFromOneRm` above inverts `calc1RM`, which is correct for the stats sheet — that screen
 * builds its comparison table with `calc1RM` too, so the pair is self-consistent. It is the wrong
 * inverse for a stored estimate: `estimateOneRm` routes every bodyweight set through
 * `amrapAverage1Rm`, which applies `amrapScaleFactor` on top of `calc1RM`. Inverting the unscaled
 * formula therefore reports fewer reps than were performed, by exactly the discount — measured on
 * the owner's account, 11 logged reps stored 128 and displayed as **8 RM**.
 *
 * **Nearest match, and a full scan, because the forward map is not injective.** Since issue 2193 (a)
 * the AMRAP discount is a straight line between its anchors, so `calcAmrap1RM` never falls as reps
 * rise (it used to dip across each step: 8 reps gave 121.75 and 9 gave 120.25). Above 20 reps the
 * discount and the rep factor nearly cancel, so neighbouring counts can still round to the same
 * stored value. Scanning for the closest value round-trips 28 of the 30 rep counts at the reference
 * weight; 27 and 30 read back as 26 and 29, a collision no inverse can separate. Below 20 reps,
 * every count round-trips (the old 5-vs-6 collision is gone). That is why the display prefers the
 * logged reps (`bodyweightRepMax`).
 */
/**
 * The rep max to SHOW for a bodyweight exercise: the reps actually performed when they are known,
 * and only otherwise the number recovered by inverting a stored 1RM estimate.
 *
 * BF-151. The card used to invert unconditionally. That is lossy: before issue 2193 (a) 5 and 6
 * reps stored the identical 1RM (the 1.0 → 0.97 step cancelled the extra rep), and above 20 reps
 * neighbouring counts can still share a stored value, so `repMaxFromAmrapOneRm` can only return the
 * lower of a tie. `exercise_logs.avg_reps` holds the real figure.
 *
 * It lives here rather than in the card for the reason Q-401 records: both vitest projects run in a
 * `node` environment and cannot parse JSX, so arithmetic inside a `.tsx` cannot be asserted at all —
 * which is how two budgets ended up on one screen 274 kcal apart, both labelled "left".
 *
 * The inverse is kept, not deleted: a seed-derived basis and a historical series both reach here
 * with no reps to hand.
 */
export function bodyweightRepMax(
  { storedReps, oneRm, addedKg = 0 }:
  { storedReps?: number | null; oneRm?: number | null; addedKg?: number },
): number | null {
  if (typeof storedReps === 'number' && Number.isFinite(storedReps) && storedReps > 0) {
    return Math.round(storedReps)
  }
  if (typeof oneRm !== 'number' || !Number.isFinite(oneRm) || oneRm <= 0) return null
  return repMaxFromAmrapOneRm(oneRm, addedKg)
}

/**
 * How a bodyweight or baseline estimate was encoded BEFORE issue 2193 (a): the stepped discount,
 * applied to an already-rounded `calc1RM`. Every bodyweight estimate stored until that release
 * carries this encoding, and the owner ruled past 1RMs are not rewritten, so the inverse below must
 * still read them: against the smooth map alone, 11 logged reps (stored 128) would read back as 10
 * and 25 as 19. **Read-only**: nothing computes a new estimate with it.
 */
function legacySteppedAmrap1RM(weight: number, reps: number): number {
  const r = Math.min(reps, REP_CEILING)
  const f = r <= 5 ? 1.0 : r <= 8 ? 0.97 : r <= 12 ? 0.93 : r <= 20 ? 0.88 : 0.82
  return mround(calc1RM(weight, r) * f, 0.25)
}

export function repMaxFromAmrapOneRm(oneRm: number, addedKg = 0): number {
  if (oneRm <= 0) return 0
  const ref = Math.max(1, BW_REF + addedKg)
  let best = 0
  let bestDistance = Infinity
  for (let r = 1; r <= REP_CEILING; r++) {
    // Nearest under either encoding (see legacySteppedAmrap1RM). The legacy map never sits above
    // the current one, so a value stored under the CURRENT map always reads back exactly; a legacy
    // value that happens to equal a lower rep count's current value reads as that lower count.
    const distance = Math.min(
      Math.abs(calcAmrap1RM(ref, r) - oneRm),
      Math.abs(legacySteppedAmrap1RM(ref, r) - oneRm),
    )
    // Strictly-less keeps the LOWEST rep count of a tie, which is the honest reading of a
    // collision: it is the claim the stored number actually supports.
    if (distance < bestDistance) { bestDistance = distance; best = r }
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
 * the load it was actually earned on (see {@link bodyweightRepMax}).
 *
 * **BF-164: through `bodyweightRepMax`, never `repMaxFromOneRm`.** This and its three siblings
 * below inverted the UNSCALED `calc1RM`, while `estimateOneRm` stores every bodyweight set through
 * `calcAmrap1RM` — so a stored 128 read back as **8 RM** on a set of **11**, and the ready screen
 * printed "Last: 11 reps" four lines above "REP MAX 8 RM". BF-149 fixed one screen by changing that
 * screen; the four helpers here are what the other seven surfaces actually import.
 */
export function displayOneRm(
  oneRm: number,
  exerciseType?: string | null,
  addedKg = 0,
): OneRmDisplay {
  if (isBodyweightType(exerciseType)) {
    const reps = bodyweightRepMax({ oneRm, addedKg }) ?? 0
    return { value: reps, unit: 'RM', text: `${reps} RM` }
  }
  const kg = mround(oneRm, 0.25)
  return { value: kg, unit: 'kg', text: `${kg} kg` }
}

/**
 * The share of a kilogram 1RM that a loaded bar actually is, to one decimal — `27.5 / 36.5` →
 * `75.3`. #2378: a prescribed 70.5 % rounds UP to the plate grid, so printing the prescription
 * beside the rounded bar told the lifter the set was 5 points lighter than it was. Returns `null`
 * when there is no load or no usable 1RM. **Kilogram 1RMs only** — a bodyweight `estimated1rm` is a
 * `BW_REF` index, and a share of it is meaningless.
 */
export function barShareOfOneRm(weightKg: number | null | undefined, oneRm: number | null | undefined): number | null {
  if (weightKg == null || oneRm == null) return null
  if (!Number.isFinite(weightKg) || !Number.isFinite(oneRm) || weightKg <= 0 || oneRm <= 0) return null
  return Math.round((weightKg / oneRm) * 1000) / 10
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
    ? (bodyweightRepMax({ oneRm: current, addedKg }) ?? 0) - (bodyweightRepMax({ oneRm: previous, addedKg }) ?? 0)
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
  return values.map(v => bodyweightRepMax({ oneRm: v, addedKg }) ?? 0)
}

// Rescales a STATIC progression style's reps for a bodyweight exercise from its
// per-set pct targets and the lifter's rep-max (via bodyweightRepMax — BF-164; it
// used to invert the UNSCALED calc1RM, which understated every prescribed rep count
// by the amrap discount, ~8 reps where the lifter had logged 11).
// Only ever call this for the static base-style path — an AI
// Dynamic Periodization prescription (prescriptionStyleForExercise,
// lib/ai-periodization/apply-prescription.ts) already decides bodyweight-appropriate
// reps directly from its own signals; re-deriving them here a second time silently
// discards the AI's decision (the bug this function's extraction fixes — see
// docs/superpowers/plans/2026-07-05-bodyweight-reps-ai-prescription-override.md).
export function rescaleBodyweightReps<T extends RMStyleSet>(style: T[], basis: number): T[] {
  const repMax = bodyweightRepMax({ oneRm: basis }) ?? 0
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
  return resolveWorkingBasisWithSource(input).kg
}

/**
 * The same resolution, plus WHICH input won.
 *
 * BF-151. A caller that wants the reps behind the basis needs to know the basis came from a logged
 * set at all: a `seed` is a number the user typed in the builder and a `pr` is an older program's
 * best, and neither has reps to report. Reporting the last log's reps beside a seed-derived 1RM
 * would pair two numbers from different places and read as one measurement.
 *
 * `resolveWorkingBasis` delegates here so the usable-value predicate exists once — the whole point
 * of that function being the single definition for every weight path.
 */
export function resolveWorkingBasisWithSource(input: {
  lastNonDeload1rm?: number | null
  seedEstimate?: number | null
  allTimePr1rm?: number | null
}): { kg: number | null; source: 'last_real' | 'seed' | 'pr' | null } {
  const usable = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0

  if (usable(input.lastNonDeload1rm)) return { kg: input.lastNonDeload1rm, source: 'last_real' }

  const seed = usable(input.seedEstimate) ? input.seedEstimate : null
  const pr = usable(input.allTimePr1rm) ? input.allTimePr1rm : null
  if (seed == null && pr == null) return { kg: null, source: null }

  // Ties go to `seed`, matching `Math.max`'s result either way: the kg is identical, and naming the
  // user's own number is the more honest provenance when both say the same thing.
  const kg = Math.max(seed ?? -Infinity, pr ?? -Infinity)
  return { kg, source: seed != null && seed >= (pr ?? -Infinity) ? 'seed' : 'pr' }
}
