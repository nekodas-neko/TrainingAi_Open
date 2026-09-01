/**
 * How the "earned from movement" figure is explained under the calorie bar (BF-87).
 *
 * The owner asked *"is basic steps being counted towards calorie burn? It says I've done 1000 but
 * not sure if that's counting towards nutrition."* — with **STEPS 1,196 Today** on screen beside
 * *"1,365 base — nothing earned from movement yet today"*. Both were true. Only steps above the
 * baseline earn calories, because the sedentary base is already BMR × 1.2 and a desk day's
 * incidental stepping sits inside that multiplier. The card gave the honest answer and not the
 * reason, so the reason had to be asked for.
 */

/**
 * The step threshold, **mirrored** from `STEP_BASELINE` in
 * `packages/shared/src/health/daily-energy.ts` rather than imported — and that is a deliberate
 * exception to the one-formula rule, not an oversight.
 *
 * Importing it pulls `daily-energy` → `workout-energy` → `lib/oura-models/constants`, which reads
 * `node:fs/promises`. No client component has ever imported `daily-energy`; the first one to try
 * (this file) took the whole Nutrition tab to a 500 with *"the chunking context does not support
 * external modules"*. The value is needed for **display copy**, so paying a server-only dependency
 * to render a number is the wrong trade.
 *
 * **It cannot drift.** `__tests__/movement-breakdown.test.ts` imports the shared constant — tests
 * run in node, where the chain is harmless — and fails if the two disagree. **LB-43** proposes
 * splitting the constant into a leaf module so this mirror can be deleted; that is Lane A's, since
 * it edits `packages/shared/**`.
 */
export const STEP_BASELINE = 3_000

export interface MovementParts {
  workoutKcal: number
  activityKcal: number
  stepsKcal: number
}

/**
 * The addends that actually contributed, in a fixed order.
 *
 * **No rounding here, deliberately.** `computeActiveEnergy` rounds all three parts before returning
 * them and sets `total` to their sum, and `activeKcal` is that total — so the parts are already
 * integers that add up to the figure printed beside them. Apportioning them again would be
 * arithmetic guarding a case the producer cannot produce, which is what this repo means by not
 * handling scenarios that cannot happen. The test pins that guarantee against the real
 * `computeActiveEnergy` rather than trusting this comment.
 */
export function movementParts(parts: MovementParts): { label: string; kcal: number }[] {
  return [
    { label: 'workouts', kcal: parts.workoutKcal },
    { label: 'activity', kcal: parts.activityKcal },
    { label: 'steps', kcal: parts.stepsKcal },
  ].filter(p => p.kcal > 0)
}

/** `"320 workouts · 227 steps"` — empty when nothing was earned. */
export function movementSummary(parts: MovementParts): string {
  return movementParts(parts)
    .map(p => `${p.kcal.toLocaleString()} ${p.label}`)
    .join(' · ')
}
