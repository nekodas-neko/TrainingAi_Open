import type { MealPlanMeal } from '@trainingai/shared/types/nutrition'

/**
 * Q-187's second half: what the *remaining* planned meals should be, given what was actually eaten.
 *
 * The owner: *"then as you input your actuall food it can recalculate food based on the macros left.
 * I.e if you eat too much during lunch it will cut some portions for other meals or vice versa."*
 * Answered with the gate cleared on 2026-09-01 — *"Happy to spread or take it out of next meal …
 * but if choosing one then spread is fine"* — so this spreads across every remaining meal.
 *
 * Three decisions are held here rather than at the call site, because each is a way this feature
 * makes the plan worse than a static one if it goes the other way.
 *
 * 1. **Read time, never stored.** The plan stays what the owner chose; only the display changes.
 *    A stored rewrite loses the original plan, and it would be Lane A's. Deleting this module
 *    restores today's behaviour exactly.
 * 2. **Spread, not next-meal-only.** Taking a 700 kcal lunch overshoot entirely out of dinner is
 *    the honest arithmetic and produces an absurd dinner, which gets ignored. Spreading makes
 *    several meals slightly wrong, which gets followed.
 * 3. **A floor, and a sentence when it binds.** Below `MEAL_FLOOR_KCAL` a meal stops being a meal.
 *    A meal that would fall under it is left **as planned** and named in the note — printing
 *    *"eat 180 kcal for dinner"* is how a plan gets ignored once and then always.
 *
 * **This does not touch what is logged.** The prefill's whole property is that nothing enters
 * `food_logs` unconfirmed; a re-scale changes what is *suggested*. Mixing the two reintroduces the
 * illegal state the prefill exists to prevent.
 */

/** Below this a meal stops being a meal, so it is left as planned rather than scaled down to it. */
export const MEAL_FLOOR_KCAL = 250

export interface DayTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface RescaleInput {
  /** The active variant's meals, in plan order. */
  meals: MealPlanMeal[]
  /** The variant's own targets for the day. */
  target: DayTotals
  /** What has actually been eaten. Absent on a day with no logs — which is not the same as zero. */
  eaten: DayTotals | undefined
  loggedPositions: Set<number>
  declinedMealIds: Set<string>
  /**
   * Whether the day on screen is today. A past day is over — re-scaling it would suggest food for
   * meals that have already happened or not — and a future day has nothing eaten to scale against.
   */
  isToday: boolean
}

export interface RescaledMeal {
  position: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface RescaleResult {
  /** Only the meals whose numbers actually changed. A meal absent here renders as planned. */
  byPosition: Map<number, RescaledMeal>
  /** How many remaining meals were left as planned because scaling would breach the floor. */
  flooredCount: number
  /** One sentence for the card, or null when the plan is simply on track. */
  note: string | null
}

/**
 * The meals a re-scale acts on: everything not yet logged and not declined.
 *
 * **This is deliberately NOT `fillableMeals`, and the difference is the opposite of what Q-187's
 * entry assumed.** That helper answers *which meals are due enough to log now* — on today it keeps
 * meals whose hour has already **come** (`hour <= nowHour`), because logging food you have not eaten
 * is the thing it exists to prevent. A re-scale wants the complement: what you have **left** to eat.
 * Hour does not enter it at all — a lunch you skipped past is still food you might have, and
 * removing it from the day's remaining budget would silently hand its calories to dinner.
 */
export function remainingMeals(
  meals: MealPlanMeal[],
  loggedPositions: Set<number>,
  declinedMealIds: Set<string>,
): MealPlanMeal[] {
  return meals.filter(m => !loggedPositions.has(m.position) && !declinedMealIds.has(m.id))
}

/**
 * Null when there is nothing to say — no logs yet, not today, nothing left to eat, or a plan whose
 * remaining meals carry no calories. A card that renders an adjustment of zero is noise.
 */
export function rescaleRemaining(input: RescaleInput): RescaleResult | null {
  const { meals, target, eaten, loggedPositions, declinedMealIds, isToday } = input
  if (!isToday || eaten == null) return null

  const remaining = remainingMeals(meals, loggedPositions, declinedMealIds)
  if (remaining.length === 0) return null

  const plannedRemaining = remaining.reduce((sum, m) => sum + m.targetCalories, 0)
  if (plannedRemaining <= 0) return null

  const budgetRemaining = target.calories - eaten.calories

  // Negative would scale every macro through zero and out the other side. Clamped, so the floor
  // below is what decides the over-budget case rather than a sign flip nobody would read.
  const factor = Math.max(0, budgetRemaining) / plannedRemaining

  const byPosition = new Map<number, RescaledMeal>()
  let flooredCount = 0
  for (const meal of remaining) {
    const calories = Math.round(meal.targetCalories * factor)
    if (calories < MEAL_FLOOR_KCAL) {
      flooredCount += 1
      continue
    }
    byPosition.set(meal.position, {
      position: meal.position,
      calories,
      // The same factor, so the meal keeps the macro split the plan chose for it. Scaling the
      // macros independently against their own remaining budgets would let a day that went over on
      // fat alone quietly rewrite every meal's shape.
      proteinG: Math.round(meal.targetProteinG * factor),
      carbsG: Math.round(meal.targetCarbsG * factor),
      fatG: Math.round(meal.targetFatG * factor),
    })
  }

  return { byPosition, flooredCount, note: buildNote(budgetRemaining, flooredCount, remaining.length) }
}

/**
 * The sentence, or null when there is nothing worth saying.
 *
 * It names the shortfall in kilocalories rather than a percentage: "over by 340" is a number you can
 * act on at dinner, and "at 118% of target" is not.
 */
function buildNote(budgetRemaining: number, flooredCount: number, remainingCount: number): string | null {
  const mealWord = (n: number) => (n === 1 ? 'meal' : 'meals')

  if (budgetRemaining <= 0) {
    return `You're ${Math.abs(Math.round(budgetRemaining)).toLocaleString()} kcal past today's target, so the ${remainingCount === 1 ? 'last meal is' : `remaining ${remainingCount} meals are`} left as planned.`
  }
  if (flooredCount > 0) {
    return flooredCount === remainingCount
      ? `Only ${Math.round(budgetRemaining).toLocaleString()} kcal left, which is under a meal — the remaining ${mealWord(remainingCount)} ${remainingCount === 1 ? 'is' : 'are'} left as planned.`
      : `${flooredCount} of the remaining ${remainingCount} meals would drop below ${MEAL_FLOOR_KCAL} kcal, so ${flooredCount === 1 ? 'it is' : 'they are'} left as planned.`
  }
  return null
}
