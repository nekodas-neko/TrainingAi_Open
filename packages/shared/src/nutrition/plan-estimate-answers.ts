// BF-203a / #3650. Which `estimated` plan-meal answers a device writes for today, as the payload it
// queues. The current app's plan card (`app/nutrition/use-plan-meal-logging.ts`) and TrainingAi
// Preview's (`mobile/src/features/meal-plans/data/plan-estimates.ts`) both call this, so the two
// apps assume the same meals at the same macros. Pure: the caller resolves today, the user-local
// hour and whether today is a training day, and does the write.

import type { MealPlan, MealType } from '@trainingai/shared/types/nutrition'
import { dueForEstimate, estimateSlotsFor } from './meal-estimate'
import { variantForEstimates } from './plan-variant'

export interface PlanEstimateAnswer {
  planMealId: string
  answer: 'estimated'
  estCalories: number
  estProteinG: number
  estCarbsG: number
  estFatG: number
  estBiasKcal: number
  estBasis: 'planA'
}

/**
 * The estimates owed now: plan meals whose slot is over with nothing of their meal type logged and
 * no answer given. Empty for a split plan whose day type is unknown (`variantForEstimates`), as an
 * estimate there would count the wrong day's meals.
 */
export function planEstimateAnswers(input: {
  plan: MealPlan | null | undefined
  isTrainingDay: boolean | undefined
  mealTypes: readonly MealType[]
  loggedMealTypeIds: ReadonlySet<string>
  answeredPlanMealIds: ReadonlySet<string>
  /** Hour in the user's timezone, fractional allowed. */
  localHour: number
}): PlanEstimateAnswer[] {
  if (!input.plan) return []
  const variant = variantForEstimates(input.plan, input.isTrainingDay)
  if (!variant) return []
  const slots = estimateSlotsFor(variant.meals, input.mealTypes)
  if (slots.length === 0) return []
  return dueForEstimate({
    slots,
    loggedMealTypeIds: input.loggedMealTypeIds,
    answeredPlanMealIds: input.answeredPlanMealIds,
    localHour: input.localHour,
    biasKcal: 0,
  }).map(e => ({
    planMealId: e.planMealId,
    answer: 'estimated',
    estCalories: e.calories,
    estProteinG: e.proteinG,
    estCarbsG: e.carbsG,
    estFatG: e.fatG,
    estBiasKcal: e.biasKcal,
    estBasis: 'planA',
  }))
}
