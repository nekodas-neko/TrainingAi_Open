import { repFactor } from '@trainingai/shared/1rm'
import type { RpeSource } from '@trainingai/shared/workout/rpe-source'

// Reps-aware expected RPE, used by RPE autoregulation.
//
// RPE depends on BOTH the load and the reps performed — 70% for 3 reps is easy, 70% for 12
// reps is near-failure. The old %-only bucket model couldn't tell those apart. Here we invert
// the 1RM formula: at a given %1RM the reps-to-failure is `maxRepsAtPct`, so the reps-in-reserve
// on a set is `maxReps − reps` and the expected RPE is `10 − RIR`.
//
// This ties directly to the same `repFactor` curve the 1RM math uses, so the two stay
// consistent, and it makes an AMRAP set (reps ≈ maxReps) expect an RPE near 10 — which is why
// a hard last set produces a delta ≈ 0 rather than a false "too hard" flag.

// Reps to failure at a given %1RM — the inverse of repFactor. repFactor is monotonic in reps,
// so we scan integer reps and linearly interpolate for a smooth (fractional) result.
export function maxRepsAtPct(pct: number): number {
  if (pct >= 100) return 1
  if (pct <= 0) return 30
  const target = 100 / pct // = repFactor(reps) at failure
  let prev = repFactor(1)
  if (target <= prev) return 1
  for (let r = 2; r <= 30; r++) {
    const cur = repFactor(r)
    if (cur >= target) {
      // linear interpolation between (r-1, prev) and (r, cur)
      return r - 1 + (target - prev) / (cur - prev)
    }
    prev = cur
  }
  return 30
}

// The slider the owner reports RPE on. `expectedRpe` clamps to it so the two are comparable;
// `isExpectedRpeRepresentable` is how a caller finds out whether that clamp bound.
export const EXPECTED_RPE_MIN = 5
export const EXPECTED_RPE_MAX = 10

// The model's unclamped expectation, `10 − RIR`. Goes arbitrarily negative on light accessory
// work — at 50% a 10-rep set has ~20 reps in reserve — which is exactly what the clamp hides.
// Null when the inputs cannot support an expectation at all.
export function rawExpectedRpe(pct: number, reps: number): number | null {
  if (!(pct > 0) || !(reps > 0)) return null
  return 10 - Math.max(0, maxRepsAtPct(pct) - reps)
}

// Whether `expectedRpe` is reporting the model's expectation rather than the clamp floor.
// A floor-clamped set carries no autoregulation signal: the model cannot state what it expected,
// so the gap to the reported RPE measures the clamp and not the athlete (Q-514 — those sets ran a
// +1.89 mean delta against −0.34 for every other set, and produced 64% of all back-off triggers).
export function isExpectedRpeRepresentable(pct: number, reps: number): boolean {
  const raw = rawExpectedRpe(pct, reps)
  return raw != null && raw >= EXPECTED_RPE_MIN
}

// Expected RPE for performing `reps` at `pct`% of 1RM. Clamped to the 5–10 slider range.
export function expectedRpe(pct: number, reps: number): number {
  const raw = rawExpectedRpe(pct, reps)
  if (raw == null) return 7
  return Math.min(EXPECTED_RPE_MAX, Math.max(EXPECTED_RPE_MIN, raw))
}

// Inverse of expectedRpe: the %1RM at which performing `reps` reps yields ~targetRpe.
// expectedRpe(pct, reps) = 10 − (maxRepsAtPct(pct) − reps); solving for pct at a target
// RPE gives maxReps = reps + (10 − targetRpe), and at failure repFactor(maxReps) = 100/pct.
// Same repFactor curve as expectedRpe/the 1RM math, so the two can never drift.
export function pctForExpectedRpe(targetRpe: number, reps: number): number {
  const clampedRpe = Math.min(EXPECTED_RPE_MAX, Math.max(EXPECTED_RPE_MIN, targetRpe))
  const rir = 10 - clampedRpe
  const maxReps = Math.max(1, reps + rir)
  const pct = 100 / repFactor(maxReps)
  return Math.round(pct * 2) / 2 // 0.5 precision, matching the codebase's pct rounding
}

// The values the RPE picker offers (`components/workout/rpe-strip.tsx`).
export const RPE_PICKER_MIN = 6
export const RPE_PICKER_MAX = 10

/**
 * #2253 (owner, 2026-10-06): the value the RPE picker opens on — the engine's own expectation for
 * the set as planned, rounded onto the picker. One formula: the pre-fill used to be `floor(pct/10)`
 * (`defaultRpeFromPct`, deleted), which ran 0.71 below `expectedRpe`, so every untouched set read
 * back as "felt easy" and produced all six phantom "+reps / +set" pushes in the replay. With no %
 * (bodyweight, or an exercise with no style) there is no expectation to state, and it opens on 7.
 */
export function expectedRpePrefill(pct: number | undefined | null, plannedReps: number | undefined | null): number {
  if (pct == null || plannedReps == null) return 7
  return Math.min(RPE_PICKER_MAX, Math.max(RPE_PICKER_MIN, Math.round(expectedRpe(pct, plannedReps))))
}

export interface RpeTrendInputSet {
  rpe: number | null; intensityPct: number | null; reps: number
  /** #2253: `expected` is the untouched pre-fill and reads as "went as planned"; `rated` and a
   *  pre-#2450 null are read as reported. */
  rpeSource?: RpeSource | null
}

/** The RPE a set counts as: the reported value, or the expectation itself when the lifter left the
 *  pre-fill alone (#2253: "assume it's correctly predicted if nothing is said"). */
const reportedOrExpected = (s: RpeTrendInputSet & { rpe: number; intensityPct: number }): number =>
  s.rpeSource === 'expected' ? expectedRpe(s.intensityPct, s.reps) : s.rpe

// Program-wide RPE trend used by the emergency-deload safety net. Reps-aware like
// expectedRpe, so an honest AMRAP set reads as on-target rather than a false "too hard".
// An untouched set counts as delta 0 rather than being left out (#2253): the owner taps only when a
// set was harder than planned, so a rated-only mean would be biased upward toward the 2.0 trigger.
export function rpeTrendFromSets(sets: RpeTrendInputSet[]): { avgActual: number; avgExpected: number; delta: number } | null {
  const rated = sets.filter((s): s is RpeTrendInputSet & { rpe: number; intensityPct: number } =>
    s.rpe != null && s.intensityPct != null)
  if (rated.length < 3) return null
  const avgActual = rated.reduce((sum, s) => sum + reportedOrExpected(s), 0) / rated.length
  const avgExpected = rated.reduce((sum, s) => sum + expectedRpe(s.intensityPct, s.reps), 0) / rated.length
  return { avgActual, avgExpected, delta: avgActual - avgExpected }
}

export interface RpeDeltaInputSet extends RpeTrendInputSet { exerciseName: string }

/** #2253: the fewest RATED sets an exercise needs before its delta moves next week's plan. Was 3
 *  over every set; untouched sets now carry no information, so the count is of ratings only. */
export const RPE_DELTA_MIN_RATED_SETS = 2

// Per-exercise mean autoregulation delta (reported RPE − expected), the input to the back-off and
// push arms. Sets whose expectation the model cannot state are dropped rather than neutralised —
// see `isExpectedRpeRepresentable`. An exercise left with fewer than `minSets` usable sets is
// omitted entirely, which is why the caller gets a Map rather than a value per exercise.
// #2253: only a rating the lifter gave moves the plan. An untouched pre-fill (`expected`) is left
// out, not averaged in as a zero: averaging it in is what diluted the owner's hard-set taps so a
// load cut never came. A pre-#2450 row (null source) still counts, as it did; the engine reads the
// last three sessions, so those age out within about a week.
export function perExerciseRpeDelta(sets: RpeDeltaInputSet[], minSets = RPE_DELTA_MIN_RATED_SETS): Map<string, number> {
  const byExercise = new Map<string, number[]>()
  for (const sl of sets) {
    if (sl.rpe == null || sl.intensityPct == null) continue
    if (sl.rpeSource === 'expected') continue
    if (!isExpectedRpeRepresentable(sl.intensityPct, sl.reps)) continue
    const arr = byExercise.get(sl.exerciseName) ?? []
    arr.push(sl.rpe - expectedRpe(sl.intensityPct, sl.reps))
    byExercise.set(sl.exerciseName, arr)
  }
  const out = new Map<string, number>()
  for (const [name, deltas] of byExercise) {
    if (deltas.length >= minSets) out.set(name, deltas.reduce((a, b) => a + b, 0) / deltas.length)
  }
  return out
}
