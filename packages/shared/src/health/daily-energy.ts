/**
 * Daily active-energy for the Energy Budget — how much movement to add back on top of the
 * resting base. One consistent basis (net-of-rest kcal via the shared `estWorkoutKcal` MET/Schofield
 * estimator) across strength workouts, logged activities (walk/run/cycle/…) and passive steps, so
 * nothing is double-counted.
 *
 * ── Why a sedentary base ──────────────────────────────────────────────────────────────────────
 * A budget target of BMR × an activity multiplier (1.375 "light" … 1.9 "very active") ALREADY bakes
 * a whole day's movement into the number. Adding measured exercise on top of that double-counts. So
 * the budget bases on BMR × 1.2 (sedentary = BMR + thermic effect of food + incidental NEAT) and adds
 * measured movement ABOVE that explicitly — the standard "sedentary base + eat back exercise" model.
 * Multipliers: Mifflin-St Jeor activity factors (sedentary 1.2). METs: Compendium of Physical
 * Activities (Ainsworth et al.), pinned in `energy-expenditure-features.json`. `estWorkoutKcal`
 * subtracts a 1.5-MET resting baseline, so every term here is net active energy above rest —
 * consistent with the sedentary base.
 */
import { estWorkoutKcal, intensityFromRpe, type Intensity, type Sex } from '@trainingai/shared/health/workout-energy'

// Defined in a dependency-free leaf module and re-exported here, so a caller that needs only the
// number does not pull in this file's `workout-energy` → `oura-models` → `node:path` chain. Every
// existing import of `SEDENTARY_MULTIPLIER` from this module keeps working.
export { SEDENTARY_MULTIPLIER } from './energy-baseline'

/** Steps assumed already covered by the sedentary base (a desk-job day's incidental stepping). Only
 *  steps above this count as extra movement, so we don't double-count the baseline against BMR×1.2. */
export const STEP_BASELINE = 3000

/** Walking cadence for turning a step count into minutes. Tudor-Locke: ~100 steps/min ≈ the
 *  moderate-intensity walking threshold, which matches the walking MET (4.3) used below. */
export const WALKING_CADENCE_SPM = 100

/** Steps per km for converting a logged outdoor activity's distance to a step-equivalent (~0.77 m
 *  stride). Used only to REMOVE steps already attributed to logged walks/runs from the passive total. */
export const STEPS_PER_KM = 1300

const MAX_PLAUSIBLE_SESSION_MIN = 240

// App activityType string → Oura MET-table id (`energy-expenditure-features.json` activity_type_dict).
const ACTIVITY_TYPE_TO_OURA_ID: Record<string, number> = {
  walk: 14, run: 12, treadmill: 14, hike: 21, cycle: 5, swim: 13,
  row: 11, elliptical: 7, hiit: 30, yoga: 15, stretch: 49,
}
const DEFAULT_ACTIVITY_OURA_ID = 79 // "cardiovascular exercise" (MET 6.0) — generic fallback

export function ouraIdForActivityType(activityType: string | null | undefined): number {
  if (!activityType) return DEFAULT_ACTIVITY_OURA_ID
  return ACTIVITY_TYPE_TO_OURA_ID[activityType.toLowerCase()] ?? DEFAULT_ACTIVITY_OURA_ID
}

// Typical speeds (km/h) to estimate a logged activity's DURATION when only distance was recorded.
const TYPICAL_SPEED_KMH: Record<string, number> = {
  walk: 5, run: 9, treadmill: 6, hike: 4, cycle: 18, swim: 3, row: 8, elliptical: 8,
}
// activityTypes whose steps land in the phone pedometer (outdoor, foot-based) — subtract their
// step-equivalent from the passive total so a logged outdoor walk/run isn't counted twice.
const PEDOMETER_ACTIVITY_TYPES = new Set(['walk', 'run', 'hike'])

export interface EnergyProfile {
  ageYears: number | null
  weightKg: number | null
  sex: Sex | null
}

export interface ActiveEnergyInput {
  profile: EnergyProfile
  /**
   * Completed strength sessions today (duration in minutes).
   *
   * `id` is optional so existing callers are unchanged; pass it to get the per-session breakdown
   * back. `rpe` is the session's stored `session_rpe` (Q-419) — omit it and the session is estimated
   * at `moderate`, exactly as before.
   */
  strengthSessions: { durationMin: number; id?: string; rpe?: number | null }[]
  /** Today's logged activities. */
  activities: { activityType: string; durationMin?: number | null; distanceKm?: number | null }[]
  /** Phone-pedometer steps today (body_metrics), excluding treadmill/logged-indoor steps. */
  pedometerSteps: number | null
}

export interface ActiveEnergyResult {
  workoutKcal: number
  activityKcal: number
  stepsKcal: number
  total: number
  /**
   * The addends of `workoutKcal`, per strength session that supplied an `id` (Q-391).
   *
   * **The point of returning them from here rather than recomputing per session elsewhere** is that
   * a per-session figure and the day total then cannot disagree — these ARE the terms that were
   * summed. `energy-summary.ts` already records why that matters: the day screen's Energy section
   * deliberately reads its `workoutKcal` from this same route *"because the day screen disagreeing
   * with Nutrition about how much was burned is worse than either being slightly off"*. A second
   * estimate computed in `/api/day-log` off its own profile inputs would reintroduce exactly that.
   *
   * A session filtered out by the plausibility guard is absent rather than zero — it contributed
   * nothing to the total, and zero would read as "measured, and it was nothing".
   */
  workoutKcalBySession: { id: string; kcal: number }[]
}

/** Duration (min) for a logged activity: use the recorded duration, else estimate from distance. */
function activityDurationMin(a: { activityType: string; durationMin?: number | null; distanceKm?: number | null }): number | null {
  if (a.durationMin != null && a.durationMin > 0) return Math.min(a.durationMin, MAX_PLAUSIBLE_SESSION_MIN)
  if (a.distanceKm != null && a.distanceKm > 0) {
    const speed = TYPICAL_SPEED_KMH[a.activityType.toLowerCase()] ?? 6
    return Math.min((a.distanceKm / speed) * 60, MAX_PLAUSIBLE_SESSION_MIN)
  }
  return null
}

/**
 * Net active energy (kcal) to add to the budget's burned side today. All terms are net-of-rest and
 * mutually exclusive: strength (no pedometer steps), logged activities (by MET), and passive steps
 * above the sedentary baseline with logged-outdoor steps removed. Returns zeros when the profile is
 * incomplete (the estimator needs age/weight/sex) — the caller then simply adds nothing.
 */
export function computeActiveEnergy(input: ActiveEnergyInput): ActiveEnergyResult {
  const { ageYears, weightKg, sex } = input.profile
  const zero = { workoutKcal: 0, activityKcal: 0, stepsKcal: 0, total: 0, workoutKcalBySession: [] }
  if (ageYears == null || weightKg == null || sex == null) return zero

  const est = (activityId: number, durationMin: number, intensity: Intensity = 'moderate') =>
    estWorkoutKcal({ durationMin, ageYears, weightKg, sex, activityId, intensity }) ?? 0

  // Strength — activity 8, at the intensity the user's own RPE implies (Q-419).
  //
  // **This was hardcoded to 'moderate' while the done screen used `intensityFromRpe(rpe)` for the
  // same session**, so tapping an RPE changed the number on that screen and then changed nothing
  // anywhere else — the day's ENERGY row, Nutrition's earned calories and the Home budget all
  // reverted to moderate. The tap looked load-bearing and was not.
  //
  // `intensityFromRpe` returns 'moderate' for a null RPE, so an unrated session is unchanged and no
  // history without a rating moves.
  let workoutKcal = 0
  const workoutKcalBySession: { id: string; kcal: number }[] = []
  for (const s of input.strengthSessions) {
    if (s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MIN) {
      const kcal = est(8, s.durationMin, intensityFromRpe(s.rpe))
      workoutKcal += kcal
      if (s.id != null) workoutKcalBySession.push({ id: s.id, kcal })
    }
  }

  // Logged activities — MET by type over their duration.
  let activityKcal = 0
  for (const a of input.activities) {
    const dur = activityDurationMin(a)
    if (dur != null && dur > 0) activityKcal += est(ouraIdForActivityType(a.activityType), dur)
  }

  // Passive steps — above the sedentary baseline, minus steps already inside logged outdoor activities.
  let stepsKcal = 0
  const ped = input.pedometerSteps ?? 0
  if (ped > 0) {
    const loggedOutdoorSteps = input.activities
      .filter(a => PEDOMETER_ACTIVITY_TYPES.has(a.activityType.toLowerCase()) && a.distanceKm != null && a.distanceKm > 0)
      .reduce((sum, a) => sum + a.distanceKm! * STEPS_PER_KM, 0)
    const netSteps = Math.max(0, ped - STEP_BASELINE - loggedOutdoorSteps)
    if (netSteps > 0) stepsKcal = est(14, netSteps / WALKING_CADENCE_SPM)
  }

  const round = (n: number) => Math.round(n)
  workoutKcal = round(workoutKcal); activityKcal = round(activityKcal); stepsKcal = round(stepsKcal)
  // `workoutKcalBySession` is deliberately NOT rounded here, while `workoutKcal` is. Rounding each
  // addend and rounding their sum are different numbers, and a card showing 120 + 130 under a total
  // of 251 is the failure this breakdown exists to avoid. Returned exact, the parts sum to the
  // pre-rounding total by construction — the same additions in the same order — and how to display
  // them is the renderer's decision.
  return { workoutKcal, activityKcal, stepsKcal, total: workoutKcal + activityKcal + stepsKcal, workoutKcalBySession }
}
