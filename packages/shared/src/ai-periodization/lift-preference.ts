/**
 * A lift's stored preference (#3896 step 4): the one reader that makes a plan honour what the person
 * chose for one lift, in every session it appears in (D1), until they change it (D2).
 *
 * The row lives in `exercise_preferences` (#3996). This module is pure: it turns a row into a bounded
 * preference and applies it to a prescribed exercise. Every path that produces a prescription calls it:
 *   - the AI path, after the model's answer is parsed (`generate-prescription.ts`, through
 *     `lift-preference-plan.ts`, which adds the per-role effort rule);
 *   - the rules fallback (`buildProgramAsWrittenPrescription`), the same way;
 *   - the static-style path (`buildWorkoutExercises`): `automatic` phase programs, and an `ai_dynamic`
 *     lift the AI plan is not driving.
 * The model is told the rep range in the prompt so its plan reads coherently, but nothing it answers
 * gates anything here: the clamp in code is what guarantees the range.
 *
 * The table's CHECKs refuse nonsense; the bounds here are applied again in code (`liftPreferenceFromRow`
 * and each apply step), so a row written by a future writer with a bug still cannot push a plan
 * outside what the engine already allows. Each bound is a named constant below.
 *
 * Deload and baseline sessions are left exactly as today: a preference does not apply in them, and a
 * one-shot is neither applied nor consumed by them (design §3a, "Deload and baseline weeks are excluded").
 */
import { expectedRpe, pctForExpectedRpe } from './expected-rpe'
import { prescribedBar, weightStepFor } from '../workout/load-rounding'
import type { ExerciseLog, SetLog } from '../types/log'
import { roleCeiling } from './role-plausibility'
import { roleFloor } from './time-budget'
import { PCT_HARD_FLOOR } from './autoregulation'
import type { AppliedLiftPreference } from '../types/ai-periodization'

/** The table's own CHECK limits on a rep range (`exercise_preferences_rep_range_check`). */
export const PREFERENCE_REP_FLOOR = 1
export const PREFERENCE_REP_CEILING = 30
/** A preferred rest is held to what a prescription may carry (`PrescriptionSchema.rest_sec`). */
export const PREFERENCE_REST_MIN_SEC = 30
export const PREFERENCE_REST_MAX_SEC = 600
/** No preference ever prescribes a working set above 100 % of the basis. */
export const PREFERENCE_PCT_CEILING = 100

export type LoadStep = 'lighter' | 'heavier'

/** The columns of an `exercise_preferences` row this reader uses. */
export interface LiftPreferenceRow {
  repMin: number | null
  repMax: number | null
  restSec: number | null
  nextLoadStep: string | null
  setsDelta: number | null
  oneShotSetAt: Date | null
  /** #3890: the saved weekly check-in for the week being planned answered "Heavy" for this lift. Only
   *  present when the read was asked about a week (`checkinWeekStart`). */
  checkinHeld?: boolean
}

/**
 * #3890 (decision 8, "Heavy holds the lift by itself"): the lift is held for the week the check-in
 * applies to. A ceiling, never a floor: no prescribed set of the lift is heavier than `barKg`, the bar
 * the person last used for it (`lastSessionBarKg`). Null `barKg` (never logged, or the last log was a
 * deload) holds nothing. Sets and reps are not changed by it.
 */
export interface CheckinHold {
  /** The local Monday of the week the check-in applies to (`applies_week_start`). */
  weekStart: string
  barKg: number | null
}

export interface LiftOneShot {
  loadStep: LoadStep | null
  setsDelta: -1 | 1 | null
  /** When the one-shot was written, on the database clock. A log consumes it only by presenting this exact value. */
  setAt: Date
}

/** A bounded preference. Absent (null) means the program as written. */
export interface LiftPreference {
  repRange: { min: number; max: number } | null
  restSec: number | null
  oneShot: LiftOneShot | null
  /** #3890: present only for a lift the week's check-in holds. Absent: every rule as before. */
  checkinHold?: CheckinHold
}

/** What a plan applied, stored on the prescribed exercise (`AiPrescriptionExercise.liftPreference`). */
export type { AppliedLiftPreference }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/**
 * The row, bounded. Anything outside the table's CHECKs is dropped field by field rather than
 * clamped into something the person did not choose: a rep range needs both ends, integers,
 * 1 <= min <= max <= 30; a rest is an integer, held to 30-600 s; a one-shot needs a known step or a
 * ±1 and a valid time. Null when nothing usable is left.
 */
export function liftPreferenceFromRow(row: LiftPreferenceRow | null | undefined): LiftPreference | null {
  if (!row) return null
  const repRange = isInt(row.repMin) && isInt(row.repMax)
    && row.repMin >= PREFERENCE_REP_FLOOR && row.repMin <= row.repMax && row.repMax <= PREFERENCE_REP_CEILING
    ? { min: row.repMin, max: row.repMax }
    : null
  const restSec = isInt(row.restSec) && row.restSec >= 0
    ? Math.min(PREFERENCE_REST_MAX_SEC, Math.max(PREFERENCE_REST_MIN_SEC, row.restSec))
    : null
  const loadStep: LoadStep | null = row.nextLoadStep === 'lighter' || row.nextLoadStep === 'heavier' ? row.nextLoadStep : null
  const setsDelta: -1 | 1 | null = row.setsDelta === 1 || row.setsDelta === -1 ? row.setsDelta : null
  const setAt = row.oneShotSetAt instanceof Date && !Number.isNaN(row.oneShotSetAt.getTime()) ? row.oneShotSetAt : null
  const oneShot = setAt && (loadStep || setsDelta) ? { loadStep, setsDelta, setAt } : null
  if (!repRange && restSec == null && !oneShot) return null
  return { repRange, restSec, oneShot }
}

/** Whether a session may carry a preference at all. A deload or a baseline is excluded. */
export function preferenceAppliesIn(ctx: { deload: boolean; baseline: boolean }): boolean {
  return !ctx.deload && !ctx.baseline
}

/**
 * Is the one-shot due on this prescription, and what does it do. Due whenever one is stored and the
 * session is neither a deload nor a baseline; it stays due until a log of a plan that carried it
 * consumes it (`consumeLiftOneShot`) or it expires (`ONE_SHOT_TTL_DAYS`).
 */
export function oneShotDue(pref: LiftPreference | null | undefined, ctx: { deload: boolean; baseline: boolean }): LiftOneShot | null {
  if (!pref?.oneShot || !preferenceAppliesIn(ctx)) return null
  return pref.oneShot
}

/**
 * Whether a finished log may consume the lift's one-shot at all. The log must be new (a re-push of a
 * log already stored consumes nothing, so a retry after a newer one-shot was set cannot take the
 * newer one) and must not be a deload or baseline log, which never carried the one-shot.
 */
export function logMayConsumeOneShot(args: { isNewLog: boolean; deloaded: boolean; baseline: boolean }): boolean {
  return args.isNewLog && !args.deloaded && !args.baseline
}

/**
 * How long a one-shot stays applicable. Past this it is not applied and the reader clears it, so a
 * lift that was skipped, or a workout that was abandoned, cannot carry a "lighter next time" for weeks.
 * Read in one place: `listExercisePreferences` (lib/data/postgres/slices/exercise-preferences.ts), on
 * the database clock.
 */
export const ONE_SHOT_TTL_DAYS = 14

/** The rep band autoregulation and the session read judge a lift against: the person's range when
 *  they chose one, otherwise the role's default. Without this the two would "correct" the
 *  preference back toward the phase default. */
export function preferredRepBand<B extends { repMin: number; repMax: number }>(
  pref: LiftPreference | null | undefined, band: B,
): B {
  return pref?.repRange ? { ...band, repMin: pref.repRange.min, repMax: pref.repRange.max } : band
}

export function clampReps(reps: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, reps))
}

/**
 * One plate step on a percentage prescription (D5). The bar a pct gives is `prescribedBar`, rounded up
 * to the equipment's step (`weightStepFor`), so the step is applied to that bar and turned back into the
 * pct that gives exactly it: the midpoint below the target bar, which `prescribedBar` rounds up onto
 * the target. The pct is kept at 0.5 % precision when that still lands on the target bar, else 0.1 %.
 *
 * Returns null (the step is not applied) when there is no basis, or the step would not move the bar:
 * lighter at the bar's minimum, or heavier past `capPct`.
 */
export function pctOnePlateStep(
  pct: number, basisKg: number | null | undefined, equipment: string[] | null | undefined, step: LoadStep, capPct: number,
): number | null {
  if (!(typeof basisKg === 'number' && basisKg > 0) || !(pct > 0)) return null
  const plate = weightStepFor(equipment)
  const bar = prescribedBar(basisKg, pct, equipment)
  if (bar == null) return null
  const target = bar + (step === 'heavier' ? plate : -plate)
  const exact = ((target - plate / 2) / basisKg) * 100
  const candidates = [Math.round(exact * 2) / 2, Math.round(exact * 10) / 10]
  for (const c of candidates) {
    const next = step === 'heavier' ? Math.min(c, capPct, PREFERENCE_PCT_CEILING) : Math.max(c, PCT_HARD_FLOOR)
    if (next > 0 && prescribedBar(basisKg, next, equipment) === target) return next
  }
  return null
}

/** The ±1 set, held to the role's floor (2) and its ceiling for the phase (`roleCeiling`). Null when the
 *  bound leaves the count where it was, and also when it would put the count on the wrong side of it:
 *  "one fewer" never adds a set (1 with -1 clamps up to the floor of 2) and "one more" never removes
 *  one (a count already above the ceiling clamps down). A null result is "no change", and the caller
 *  records nothing as applied. A count never reaches 0. */
export function setsWithDelta(sets: number, delta: -1 | 1, role: string, phaseSetsMax?: number | null): number | null {
  const next = Math.min(roleCeiling(role, phaseSetsMax), Math.max(roleFloor(role), sets + delta))
  if (next < 1) return null
  return delta < 0 ? (next < sets ? next : null) : (next > sets ? next : null)
}

/**
 * #3890: the heaviest working weight among logged sets: the largest `weightKg` of a set that carries a
 * weight and at least one rep. A set with a zero or missing weight (bodyweight, an unlogged row) or no
 * reps (nothing was lifted) is ignored. Null when no set qualifies.
 */
export function heaviestLoggedWeightKg(sets: readonly Pick<SetLog, 'weightKg' | 'reps'>[] | null | undefined): number | null {
  let best: number | null = null
  for (const s of sets ?? []) {
    const w = s?.weightKg
    if (typeof w !== 'number' || !(w > 0) || !(typeof s.reps === 'number' && s.reps > 0)) continue
    if (best == null || w > best) best = w
  }
  return best
}

/**
 * #3890: the "last bar" the check-in's hold caps a lift at: the HEAVIEST working weight logged in the
 * lift's most recent session (`getLastExerciseLogsBatch`), by `heaviestLoggedWeightKg`. The hold is a
 * ceiling on what was lifted last time, so it may only take off load above that: a pyramid or a
 * back-off session is capped at its top set, never cut to its lightest. Null when there is no such set,
 * and when that log was a deload (its estimate is stored as 0: a deload's bar is not a working weight,
 * so it holds nothing).
 */
export function lastSessionBarKg(log: Pick<ExerciseLog, 'sets' | 'estimated1rm'> | null | undefined): number | null {
  if (!log || !((log.estimated1rm ?? 0) > 0)) return null
  return heaviestLoggedWeightKg(log.sets)
}

/** #3890: whether the check-in's hold caps this lift: a held lift with a last bar, carrying a load. */
export function checkinHoldBar(pref: LiftPreference | null | undefined, ctx: { bodyweight: boolean }): number | null {
  const bar = pref?.checkinHold?.barKg
  return !ctx.bodyweight && typeof bar === 'number' && bar > 0 ? bar : null
}

/**
 * #3890: `pct`, lowered only as far as needed so its bar (`prescribedBar`, rounded up to the plate step)
 * is no heavier than `barKg`. A pct whose bar is already at or under it is returned as it is: the hold is
 * a ceiling, never a floor. The new pct lands on the heaviest plate-step bar at or under `barKg`, at
 * 0.5 % precision when that still gives it, else 0.1 %, else the exact quotient. With no basis there is
 * no bar to compare and the pct is returned as it is; so is one the ceiling cannot express (a bar under
 * the smallest the rounding allows).
 */
export function pctUnderBar(pct: number, basisKg: number | null | undefined, equipment: string[] | null | undefined, barKg: number): number {
  if (!(typeof basisKg === 'number' && basisKg > 0) || !(pct > 0)) return pct
  const now = prescribedBar(basisKg, pct, equipment)
  if (now == null || now <= barKg) return pct
  const plate = weightStepFor(equipment)
  const target = Math.floor(barKg / plate + 1e-9) * plate
  if (!(target > 0)) return pct
  const mid = ((target - plate / 2) / basisKg) * 100
  const candidates = [Math.round(mid * 2) / 2, Math.round(mid * 10) / 10, Math.floor((target / basisKg) * 1000) / 10]
  for (const c of candidates) {
    if (c > 0 && c < pct && (prescribedBar(basisKg, c, equipment) ?? Infinity) <= barKg) return c
  }
  return pct
}

/**
 * The record of what a plan applied, corrected for a rest the time budget then changed. The budget
 * wins over a preferred rest (it is the time the person has), so a row whose final rest is not the
 * preferred one must not say it used it: the record drops `restSec`, and the whole record when that
 * was all it held. Used where a plan is stored after the budget stage (generation and the re-fit).
 */
export function appliedAfterBudgetRest(applied: AppliedLiftPreference | undefined, finalRestSec: number): AppliedLiftPreference | undefined {
  if (!applied || applied.restSec == null || applied.restSec === finalRestSec) return applied
  const { restSec: _dropped, ...rest } = applied
  return Object.keys(rest).length > 0 ? rest : undefined
}

/** Per-set shape the static path works on (a progression style's sets). */
interface StyleLikeSet { pct: number; reps: number; restSec: number }

/**
 * The static-style path (`buildWorkoutExercises`): an `automatic` program's phase style, or an
 * `ai_dynamic` lift the AI plan is not driving. There is no AI phase zone here, so the load at the new
 * reps keeps the effort the program wrote for that set (D4's "target effort at those reps", with the
 * written set as the target): `pctForExpectedRpe(expectedRpe(set pct, set reps), new reps)`, never
 * heavier than the set as written and never under the 40 % floor. A bodyweight lift keeps its reps
 * clamp, rest and set count; it has no load to move.
 */
export function applyLiftPreferenceToStyle<T extends StyleLikeSet>(
  style: T[],
  pref: LiftPreference,
  ctx: { role: string; bodyweight: boolean; basisKg: number | null; equipment?: string[] | null },
): { style: T[]; applied: AppliedLiftPreference } | null {
  if (style.length === 0) return null
  const applied: AppliedLiftPreference = {}
  let out = style.map(s => ({ ...s }))
  if (pref.repRange) {
    const range = pref.repRange
    let changed = false
    out = out.map(s => {
      const reps = clampReps(s.reps, range)
      if (reps === s.reps) return s
      changed = true
      if (ctx.bodyweight) return { ...s, reps }
      const pct = Math.min(s.pct, Math.max(PCT_HARD_FLOOR, pctForExpectedRpe(expectedRpe(s.pct, s.reps), reps)))
      return { ...s, reps, pct }
    })
    if (changed) applied.repRange = range
  }
  if (pref.restSec != null && out.some(s => s.restSec !== pref.restSec)) {
    out = out.map(s => ({ ...s, restSec: pref.restSec! }))
    applied.restSec = pref.restSec
  }
  const shot = pref.oneShot
  if (shot?.loadStep && !ctx.bodyweight) {
    const stepped = out.map(s => pctOnePlateStep(s.pct, ctx.basisKg, ctx.equipment, shot.loadStep!, PREFERENCE_PCT_CEILING))
    if (stepped.every(p => p != null)) {
      out = out.map((s, i) => ({ ...s, pct: stepped[i]! }))
      applied.loadStep = shot.loadStep
    }
  }
  if (shot?.setsDelta) {
    const next = setsWithDelta(out.length, shot.setsDelta, ctx.role)
    if (next != null) {
      out = next > out.length ? [...out, { ...out[out.length - 1] }] : out.slice(0, next)
      applied.setsDelta = shot.setsDelta
    }
  }
  if (applied.loadStep || applied.setsDelta) applied.oneShotSetAt = shot!.setAt.toISOString()
  // #3890: the week's check-in hold, last: a ceiling on every set's bar, after everything above.
  const holdBar = checkinHoldBar(pref, ctx)
  let held = false
  if (holdBar != null) {
    out = out.map(s => {
      const pct = pctUnderBar(s.pct, ctx.basisKg, ctx.equipment, holdBar)
      if (pct === s.pct) return s
      held = true
      return { ...s, pct }
    })
  }
  return Object.keys(applied).length > 0 || held ? { style: out, applied } : null
}
