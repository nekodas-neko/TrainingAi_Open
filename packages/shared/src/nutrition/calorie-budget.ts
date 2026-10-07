// The day's calorie budget — ONE function, read by every surface that shows one (#2071).
//
// The owner's final spec (2026-10-05), with his answers of 2026-10-07 on #2071 and #2621:
//
//   budget = RMR − deficit + daily living + movement,   never below max(RMR, 1,200)
//
//   RMR           the measured test re-scaled onto today's fat-free mass when there is one, the
//                 formula otherwise — `energy-balance-service`'s `bmr`, resolved once there.
//   daily living  RMR × (SEDENTARY_MULTIPLIER − 1), the existing 20% for daily living and
//                 digestion, LESS the energy of the first `STEP_BASE_CREDIT` (3,000) steps. The
//                 energy model has always counted those steps as part of the 20% (BF-88), and
//                 movement counts steps from the first one, so without the credit they were in the
//                 budget twice (owner, 2026-10-07: "only steps above about 3,000 a day count").
//                 The credit is the energy model's own `stepEnergyKcal(profile, STEP_BASE_CREDIT)`,
//                 computed per user in the service and passed in here — never a second constant.
//   movement      `computeActiveEnergy(...).total` — workouts, logged activities and steps. No
//                 second estimate.
//   deficit       derived from the goal and the smoothed trend weight, never typed: `goalDeficitKcal`.
//
// What it replaces. BF-152 anchored the budget to the bare resting rate plus movement, and the typed
// `calorie_goal` kept surfacing beside it as a second "budget" wherever the balance was missing
// (#2160's mismatch). Neither had a deficit in it that came from the goal: the −200/−500 in
// `CALORIE_ADJUSTMENT_BY_GOAL` only ever reached the RECOMMENDATION, never the number on screen.
//
// Pure, dependency-light and safe for a client chunk: it imports only the leaf constants module and
// `tdee-adaptation`'s constants. Anything that pulls `daily-energy` would drag `node:path` into the
// client and 500 the tab (Q-401, LB-43).

import { SEDENTARY_MULTIPLIER } from '../health/energy-baseline'
import { KCAL_PER_KG, CALORIE_FLOOR_KCAL } from './tdee-adaptation'
import type { FitnessGoal } from '../types/user'

/**
 * How fast each goal moves body weight, as a share of the TREND weight per week. Positive is a
 * deficit (losing), negative a surplus (gaining), 0 none. The deficit is re-derived from the trend
 * weight every day, so it shrinks as weight falls.
 *
 * All three rates are the owner's: recomp 0.3% (2026-10-05, #2071), cut 0.5% and bulk 0.25%
 * (2026-10-07, #2621).
 */
export const GOAL_RATE_PCT_PER_WEEK: Record<FitnessGoal, number> = {
  recomp:       0.003,
  lose_weight:  0.005,
  build_muscle: -0.0025,
  maintain:     0,
}

/** Within this many kg of the goal weight the deficit eases off linearly, reaching 0 at the goal.
 *  Applies to every goal (owner, 2026-10-07). */
export const GOAL_EASE_BAND_KG = 2

export interface GoalDeficitInput {
  goal: FitnessGoal | null
  /** The smoothed 30-day trend weight (`computeTrendWeightKg`), or the latest weigh-in when there is
   *  no trend yet — the caller resolves which. */
  currentWeightKg: number | null
  /** `users.target_weight_kg`. Null = no goal weight set. */
  targetWeightKg: number | null
}

/**
 * The deficit the goal calls for today, in kcal/day. Positive = eat below the burn, negative = a
 * surplus, 0 = none.
 *
 *  - no goal, no goal weight, or no current weight → 0
 *  - already at (or past) the goal weight → 0. "Past" is direction-aware: a deficit needs the goal
 *    BELOW the current weight, a surplus needs it above, so a goal weight on the wrong side never
 *    drives the budget the wrong way.
 *  - within `GOAL_EASE_BAND_KG` of it → the full rate × (distance / band), 0 at the goal
 *
 * Unrounded on purpose: the service rounds it once, so rounding cannot compound.
 */
export function goalDeficitKcal({ goal, currentWeightKg, targetWeightKg }: GoalDeficitInput): number {
  if (goal == null) return 0
  const pct = GOAL_RATE_PCT_PER_WEEK[goal]
  if (pct == null || pct === 0) return 0
  if (currentWeightKg == null || !Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return 0
  if (targetWeightKg == null || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) return 0

  const full = (pct * currentWeightKg * KCAL_PER_KG) / 7

  // Distance still to travel, in the direction this goal moves weight. ≤ 0 = at or past the goal.
  const remainingKg = full > 0 ? currentWeightKg - targetWeightKg : targetWeightKg - currentWeightKg
  if (remainingKg <= 0) return 0
  const ease = Math.min(1, remainingKg / GOAL_EASE_BAND_KG)
  return full * ease
}

export interface CalorieBudgetInput {
  /** The resting rate: measured RMR (re-scaled) when there is one, the formula otherwise. */
  rmrKcal: number
  /** `goalDeficitKcal(...)`. Positive = deficit. */
  deficitKcal: number
  /** `computeActiveEnergy(...).total` for the day — steps counted from the first one. */
  movementKcal: number
  /** `stepEnergyKcal(profile, STEP_BASE_CREDIT)` — the first 3,000 steps' energy, which the 20%
   *  already covers. Absent/0 only for a caller that cannot compute it (an incomplete profile). */
  stepCreditKcal?: number | null
}

export interface CalorieBudget {
  rmrKcal: number
  deficitKcal: number
  /** RMR × 0.2, before the step credit. */
  metabolicBurnKcal: number
  stepCreditKcal: number
  /** What the line on screen calls "daily living": metabolic burn − step credit. */
  dailyLivingKcal: number
  movementKcal: number
  /** max(RMR, 1,200). */
  floorKcal: number
  /** The budget with no movement at all: max(floor, RMR − deficit + daily living). */
  stillDayKcal: number
  /** THE number. max(floor, RMR − deficit + daily living + movement). */
  totalKcal: number
  /** True when the floor, not the arithmetic, set `totalKcal`. */
  floored: boolean
  /** True when the floor set `stillDayKcal`. */
  stillDayFloored: boolean
}

/**
 * The day's calorie budget. `totalKcal` is computed from the unrounded terms and rounded once. The
 * provenance line prints `stillDayKcal` and what movement added, which sum to the total exactly.
 */
export function calorieBudget(
  { rmrKcal, deficitKcal, movementKcal, stepCreditKcal }: CalorieBudgetInput,
): CalorieBudget {
  const rmr = Number.isFinite(rmrKcal) ? Math.max(0, rmrKcal) : 0
  const deficit = Number.isFinite(deficitKcal) ? deficitKcal : 0
  // Movement only ever ADDS: a negative total is not a measurement, it is a bug upstream.
  const movement = Number.isFinite(movementKcal) ? Math.max(0, movementKcal) : 0
  const credit = typeof stepCreditKcal === 'number' && Number.isFinite(stepCreditKcal)
    ? Math.max(0, stepCreditKcal) : 0
  const metabolicBurn = rmr * (SEDENTARY_MULTIPLIER - 1)
  // #2071 (a). The one line the owner's movement answer changed: the first 3,000 steps come out of
  // the 20% because movement already counts them.
  const dailyLiving = metabolicBurn - credit
  const floor = Math.max(rmr, CALORIE_FLOOR_KCAL)

  const stillDayRaw = rmr - deficit + dailyLiving
  const stillDayKcal = Math.round(Math.max(floor, stillDayRaw))
  const raw = stillDayRaw + movement
  const totalKcal = Math.round(Math.max(floor, raw))
  return {
    rmrKcal: Math.round(rmr),
    deficitKcal: Math.round(deficit),
    metabolicBurnKcal: Math.round(metabolicBurn),
    stepCreditKcal: Math.round(credit),
    dailyLivingKcal: Math.round(dailyLiving),
    movementKcal: Math.round(movement),
    floorKcal: Math.round(floor),
    stillDayKcal,
    totalKcal,
    floored: raw < floor,
    stillDayFloored: stillDayRaw < floor,
  }
}
