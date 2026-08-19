import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { reconcileDailyMacros, carbsFromRemainder } from '@trainingai/shared/nutrition/goal-recommendation'
import {
  splitMacrosAcrossMeals, minutesToTime, MEAL_COUNT_MIN, MEAL_COUNT_MAX,
} from '@trainingai/shared/nutrition/meal-split'
import type { MealPlanDayType } from '@trainingai/shared/types/nutrition'
import type { MealPlanVariantInput } from '@/lib/data/postgres/slices/meal-plans'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Meal counts and a reorder.
const MAX_BODY_BYTES = 32 * 1024

/**
 * Change a saved plan's shape: how many meals it splits into, when training sits, and whether it
 * still runs against the calorie target it was built for.
 *
 * No AI involved. All three of these are pure redistribution through `splitMacrosAcrossMeals` —
 * the same function the generator used — so the answer is deterministic and instant. Meal names
 * carry over by position; slots beyond the old count are named plainly, and the client says so
 * rather than implying new food was invented.
 */

const PatchSchema = z.object({
  mealsPerDay: z.number().int().min(MEAL_COUNT_MIN).max(MEAL_COUNT_MAX).optional(),
  trainingTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  /** Re-anchor the plan on the user's current calorie target, which the calibration keeps moving. */
  retarget: z.boolean().optional(),
  /**
   * New meal order, as the OLD positions listed in the order they should now appear.
   * `[2, 0, 1]` means "the third meal now comes first".
   *
   * Reordering belongs here rather than in a route of its own because moving a meal is not a
   * relabel: `splitMacrosAcrossMeals` weights carbs toward the meals bracketing training and fat
   * away from the pre-workout one, so a meal that moves gets a different target and needs the same
   * re-split this route already does.
   */
  order: z.array(z.number().int().min(0).max(MEAL_COUNT_MAX - 1)).max(MEAL_COUNT_MAX).optional(),
})

/** Carbohydrate difference between a training day and a rest day — matches the generate route. */
const REST_DAY_CARB_REDUCTION = 0.15

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  let raw: unknown
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const input = parsed.data

  const repo = await getRepository()
  const plan = await repo.getMealPlan(id, userId)
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mealsPerDay = input.mealsPerDay ?? plan.mealsPerDay

  // A reorder has to be a permutation of the slots that exist. Anything else would duplicate one
  // meal and silently drop another.
  if (input.order) {
    const expected = [...Array(mealsPerDay).keys()]
    const got = [...input.order].sort((a, b) => a - b)
    if (got.length !== expected.length || got.some((v, i) => v !== expected[i])) {
      return NextResponse.json(
        { error: 'Order must list each existing meal exactly once.' },
        { status: 400 },
      )
    }
  }
  const trainingTime = input.trainingTime !== undefined ? input.trainingTime : plan.trainingTime

  let daily = {
    calories: plan.targetCalories,
    proteinG: plan.targetProteinG,
    carbsG: plan.targetCarbsG,
    fatG: plan.targetFatG,
  }
  if (input.retarget) {
    const tz = session.user?.timezone ?? DEFAULT_TZ
    const [balance, targets] = await Promise.all([
      computeEnergyBalance(repo, userId, tz, todayInTz(tz)),
      repo.getNutritionTargets(userId),
    ])
    // Same precedence as the generator: the saved target wins, the calibration fills the gap. This
    // route never derives a third number.
    const calories = targets?.calories ?? balance.target.recommendedKcal
    if (calories == null) {
      return NextResponse.json(
        { error: 'No calorie target to update to — set one in Nutrition first.' },
        { status: 400 },
      )
    }
    const proteinG = targets?.proteinG ?? Math.round(calories * 0.3 / 4)
    const fatG = targets?.fatG ?? Math.round(calories * 0.25 / 9)
    // Same reconciliation the generator applies — saved macros need not sum to the calorie goal.
    const reconciled = reconcileDailyMacros(calories, {
      proteinG, fatG, carbsG: targets?.carbsG ?? carbsFromRemainder(calories, proteinG, fatG),
    })
    daily = { calories, ...reconciled }
  }

  // Keep whichever day types the plan already has — changing the split is a rebuild, not a reshape.
  const dayTypes: MealPlanDayType[] = plan.variants.length > 0
    ? plan.variants.map(v => v.dayType)
    : ['all']

  // Names come from the plan's own first variant, by position, so a reshape preserves the food the
  // user accepted. A slot that did not exist before has no name to carry over.
  const existingNames = plan.variants[0]?.meals ?? []

  const variants: MealPlanVariantInput[] = dayTypes.map(dayType => {
    const carbShift = dayType === 'rest' ? Math.round(daily.carbsG * REST_DAY_CARB_REDUCTION) : 0
    const carbsG = daily.carbsG - carbShift
    const calories = daily.calories - carbShift * 4
    const slots = splitMacrosAcrossMeals(
      { calories, proteinG: daily.proteinG, carbsG, fatG: daily.fatG },
      mealsPerDay,
      { trainingTime: dayType === 'rest' ? null : trainingTime },
    )
    return {
      dayType,
      targetCalories: calories,
      targetProteinG: daily.proteinG,
      targetCarbsG: carbsG,
      targetFatG: daily.fatG,
      meals: slots.map((slot, i) => {
        // With an order, slot i takes whatever was at order[i]; without one, position is identity.
        const from = input.order ? input.order[i] : i
        const carried = existingNames.find(m => m.position === from)
        return {
          position: i,
          name: carried?.name ?? `Meal ${i + 1}`,
          notes: carried?.notes ?? null,
          savedMealId: carried?.savedMealId ?? null,
          mealTypeId: carried?.mealTypeId ?? null,
          // The food survives a reshape; only the numbers move. Portions are NOT rescaled here —
          // the new target is shown against the unchanged ingredients so the user can see what the
          // reshape asked of each meal, same as everywhere else drift is surfaced not hidden.
          ingredients: carried?.ingredients ?? [],
          suggestedTime: minutesToTime(slot.timeMinutes),
          targetCalories: slot.calories,
          targetProteinG: slot.proteinG,
          targetCarbsG: slot.carbsG,
          targetFatG: slot.fatG,
        }
      }),
    }
  })

  const updated = await repo.replaceMealPlanStructure(id, userId, {
    mealsPerDay,
    trainingTime,
    targetCalories: daily.calories,
    targetProteinG: daily.proteinG,
    targetCarbsG: daily.carbsG,
    targetFatG: daily.fatG,
    variants,
  })
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    plan: updated,
    // The client needs to know which slots are placeholders so it can say so plainly.
    unnamedPositions: variants[0].meals
      .filter(m => !existingNames.some(e => e.position === m.position))
      .map(m => m.position),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
