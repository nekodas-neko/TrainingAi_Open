/**
 * The bounds on a stored goal or nutrition target — declared once, for every surface that writes one.
 *
 * RV-41. These lived inline in two route schemas, and the Coach's patch schema restated them as a
 * single shared `max(100_000)` for all seven fields. Restating is what let them drift: measured
 * 2026-09-03, `PUT /api/nutrition/targets {"calories":26000}` answered `400 expected number to be
 * <=20000` while the same value through `/api/coach/apply` stored 26,000. The widest gap was 50× —
 * the macro fields, bounded at 2,000 g on the form and 100,000 g for the model.
 *
 * That mattered because the patch schema's own comment named the case it did not catch: *"'set my
 * calories to 26000' should be refused by the schema rather than survive to a confirmation card that
 * looks legitimate."* It survived, and the card read "Calories 0 kcal → 26,000 kcal".
 *
 * `int` is part of the bound, not a separate concern: `stepsGoal` is integral on the user route and
 * was declared without it in the patch schema, so `8000.5` was a clean 400 on one path and a 500 on
 * the other.
 *
 * **The numbers here are the user routes' own, unchanged.** The direction of the fix is the Coach
 * down to the form's bounds, never the form up to the Coach's — these are what the owner's screens
 * have enforced all along. A bound that should genuinely differ for the Coach is an owner decision
 * with a written reason, not a default.
 */
import { z } from 'zod'

export interface GoalBound {
  readonly min: number
  readonly max: number
  /** Whole numbers only — a fractional value is a client fault, not a roundable input. */
  readonly int?: true
}

export const GOAL_BOUNDS = {
  // `nutrition_targets` — PUT /api/nutrition/targets
  calories:    { min: 0, max: 20_000 },
  proteinG:    { min: 0, max: 2_000 },
  carbsG:      { min: 0, max: 2_000 },
  fatG:        { min: 0, max: 2_000 },
  fiberG:      { min: 0, max: 500 },
  // `user_goals` — PATCH /api/user/goals
  stepsGoal:   { min: 0, max: 200_000, int: true },
  calorieGoal: { min: 0, max: 30_000 },
  waterGoalMl: { min: 0, max: 20_000 },
} as const satisfies Record<string, GoalBound>

export type GoalBoundField = keyof typeof GOAL_BOUNDS

/**
 * The Zod number for a bounded goal field. Every surface that writes one of these builds its schema
 * from here, so a bound cannot be enforced on one path and not another — which is the whole of
 * RV-41.
 */
export function goalBoundSchema(field: GoalBoundField) {
  const b: GoalBound = GOAL_BOUNDS[field]
  // Each branch carries its own `.min`/`.max` rather than chaining onto a shared base. That reads
  // as duplication and is not: `check-numeric-bounds.js` matches per LINE, so a bound applied one
  // statement later is invisible to it — and a rule that cannot see this file's bounds would stop
  // seeing the next file's too.
  return b.int
    ? z.number().int().min(b.min).max(b.max)
    : z.number().min(b.min).max(b.max)
}
