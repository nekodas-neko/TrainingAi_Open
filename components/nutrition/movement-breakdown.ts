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

// BF-88 removed the re-export that used to sit here. `STEP_BASELINE` was a threshold three copy
// sites printed — *"steps count above 3,000/day"* — and there is no threshold any more: steps count
// from the first one, and the same 3,000 steps' energy is credited out of the resting base instead.
// The constant survives as `STEP_BASE_CREDIT` in the shared leaf module, but nothing on this side
// needs it: no sentence here refers to a number of steps.
//
// LB-43's reason for the re-export still holds for anything that DOES need a constant from there —
// `energy-baseline` reaches no node builtin, which is what makes it importable from a client
// component at all, and importing `daily-energy` for a number took the tab to a 500 twice.

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
