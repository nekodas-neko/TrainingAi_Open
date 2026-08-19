/**
 * Where today's calorie budget came from, split into the part that is always there and the part you
 * earned by moving.
 *
 * Q-401. The owner's model, in their words: *"i want the lowest number that assumes no
 * exercise/movement — and only has BMR essentially. then we adjust/increase that number [by]
 * activity."* So `base` is the budget on a zero-movement day — resting burn plus the goal's delta,
 * which is negative for a deficit and positive for a surplus — and `earned` is today's measured
 * movement. Their sum is the budget the zone bar judges you against.
 *
 * **A `.ts` file rather than living in `calorie-zone-bar.tsx`**, for one blunt reason: both vitest
 * projects are `environment: 'node'` and cannot parse JSX, so arithmetic that sits in a `.tsx`
 * cannot be asserted at all. Two surfaces render this number — the Nutrition tab and Home's
 * nutrition card — and a second, unasserted copy of a calorie figure is exactly what produced
 * Q-401: two budgets on one screen, 274 kcal apart, both labelled "left".
 *
 * **Its better long-term home is `packages/shared/src/nutrition/calorie-balance.ts`**, beside
 * `computeCalorieBalance` whose output it reads. It is here because that file is Lane A's and Lane
 * A owns the other half of Q-401 (retiring `ACTIVITY_MULTIPLIERS` as a second TDEE model) in the
 * same directory — moving it there now would collide with work already assigned. Move it when that
 * lands.
 */
export function budgetProvenance(
  { restingBaseKcal, activeKcal, targetNetKcal }:
  { restingBaseKcal: number; activeKcal: number; targetNetKcal: number },
): { base: number; earned: number; total: number } {
  const base = Math.round(restingBaseKcal + targetNetKcal)
  const earned = Math.round(activeKcal)
  return { base, earned, total: base + earned }
}
