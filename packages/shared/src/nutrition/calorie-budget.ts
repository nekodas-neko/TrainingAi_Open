// The day's calorie budget — ONE function, read by every surface that shows one (#2071).
//
// The owner's final spec (2026-10-05):
//
//   budget = RMR − deficit + metabolic burn + movement,   never below max(RMR, 1,200)
//
//   RMR             the measured test re-scaled onto today's fat-free mass when there is one, the
//                   formula otherwise — `energy-balance-service`'s `bmr`, resolved once there.
//   metabolic burn  RMR × (SEDENTARY_MULTIPLIER − 1): the existing 20% for daily living and
//                   digestion. Not a new multiplier; the same constant the energy model uses.
//   movement        `computeActiveEnergy(...).total` — workouts, logged activities and steps. No
//                   second estimate.
//   deficit         derived from the goal, never typed: see `goalDeficitKcal` below.
//
// What it replaces. BF-152 anchored the budget to the bare resting rate plus movement, and the typed
// `calorie_goal` kept surfacing beside it as a second "budget" wherever the balance was missing
// (#2160's mismatch). Neither half had a deficit in it that came from the goal: the −200/−500 in
// `CALORIE_ADJUSTMENT_BY_GOAL` only ever reached the RECOMMENDATION, never the number on screen.
//
// Pure, dependency-light and safe for a client chunk: it imports only the leaf constants module and
// the goal recommender (already in the Nutrition tab's bundle through `calorie-balance`). Anything
// that pulls `daily-energy` would drag `node:path` into the client and 500 the tab (Q-401, LB-43).

import { SEDENTARY_MULTIPLIER } from '../health/energy-baseline'
import { CALORIE_ADJUSTMENT_BY_GOAL } from './goal-recommendation'
import { KCAL_PER_KG, CALORIE_FLOOR_KCAL } from './tdee-adaptation'
import type { FitnessGoal } from '../types/user'

/**
 * How fast each goal moves body weight, as the budget's deficit.
 *
 * `pct_bodyweight_per_week` is the owner's recomp rate: 0.3% of CURRENT weight a week, so the deficit
 * is re-derived from today's weight and shrinks as weight falls. `kcal_per_day` is a fixed daily
 * offset — positive is a deficit, negative a surplus.
 *
 * **⚠ Only recomp's value is the owner's.** `lose_weight` and `build_muscle` carry the app's EXISTING
 * offsets (`CALORIE_ADJUSTMENT_BY_GOAL`: −500 and +300), referenced rather than copied so no new
 * number is introduced here. Their real values are a `type: tuning` follow-up (#2071), not this build.
 */
export type GoalRate =
  | { kind: 'pct_bodyweight_per_week'; pct: number }
  | { kind: 'kcal_per_day'; kcal: number }

export const GOAL_RATE: Record<FitnessGoal, GoalRate> = {
  recomp:       { kind: 'pct_bodyweight_per_week', pct: 0.003 },
  // PLACEHOLDER — the existing recommender offsets, pending the tuning follow-up.
  lose_weight:  { kind: 'kcal_per_day', kcal: -CALORIE_ADJUSTMENT_BY_GOAL.lose_weight },
  build_muscle: { kind: 'kcal_per_day', kcal: -CALORIE_ADJUSTMENT_BY_GOAL.build_muscle },
  maintain:     { kind: 'kcal_per_day', kcal: 0 },
}

/** Within this many kg of the goal weight the deficit eases off linearly, reaching 0 at the goal. */
export const GOAL_EASE_BAND_KG = 2

export interface GoalDeficitInput {
  goal: FitnessGoal | null
  /** Current body weight (the latest weigh-in, the same one the RMR is computed from). */
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
 *    BELOW today's weight, a surplus needs it above, so a goal weight on the wrong side never
 *    drives the budget the wrong way.
 *  - within `GOAL_EASE_BAND_KG` of it → the full rate × (distance / band), 0 at the goal
 *
 * Unrounded on purpose: the budget rounds once, at the end, so rounding cannot compound.
 */
export function goalDeficitKcal({ goal, currentWeightKg, targetWeightKg }: GoalDeficitInput): number {
  if (goal == null) return 0
  const rate = GOAL_RATE[goal]
  if (rate == null) return 0
  if (currentWeightKg == null || !Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return 0
  if (targetWeightKg == null || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) return 0

  const full = rate.kind === 'pct_bodyweight_per_week'
    ? (rate.pct * currentWeightKg * KCAL_PER_KG) / 7
    : rate.kcal
  if (full === 0) return 0

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
  /** `computeActiveEnergy(...).total` for the day. */
  movementKcal: number
}

export interface CalorieBudget {
  rmrKcal: number
  deficitKcal: number
  metabolicBurnKcal: number
  movementKcal: number
  /** max(RMR, 1,200). */
  floorKcal: number
  /** The budget on a day with no movement: max(floor, RMR − deficit + metabolic burn). */
  stillDayKcal: number
  /** THE number. max(floor, RMR − deficit + metabolic burn + movement). */
  totalKcal: number
  /** True when the floor, not the arithmetic, set `totalKcal`. */
  floored: boolean
}

/**
 * The day's calorie budget. Every addend is returned rounded and `totalKcal` is computed from the
 * unrounded terms and rounded once, so a caller printing the chain may see it off by 1 — and the
 * provenance line therefore prints `stillDayKcal` and the movement, which do sum to the total.
 */
export function calorieBudget({ rmrKcal, deficitKcal, movementKcal }: CalorieBudgetInput): CalorieBudget {
  const rmr = Number.isFinite(rmrKcal) ? Math.max(0, rmrKcal) : 0
  const deficit = Number.isFinite(deficitKcal) ? deficitKcal : 0
  // Movement only ever ADDS: a negative total is not a measurement, it is a bug upstream.
  const movement = Number.isFinite(movementKcal) ? Math.max(0, movementKcal) : 0
  const metabolicBurn = rmr * (SEDENTARY_MULTIPLIER - 1)
  const floor = Math.max(rmr, CALORIE_FLOOR_KCAL)

  const stillDayKcal = Math.round(Math.max(floor, rmr - deficit + metabolicBurn))
  const raw = rmr - deficit + metabolicBurn + movement
  const totalKcal = Math.round(Math.max(floor, raw))
  return {
    rmrKcal: Math.round(rmr),
    deficitKcal: Math.round(deficit),
    metabolicBurnKcal: Math.round(metabolicBurn),
    movementKcal: Math.round(movement),
    floorKcal: Math.round(floor),
    stillDayKcal,
    totalKcal,
    floored: raw < floor,
  }
}
