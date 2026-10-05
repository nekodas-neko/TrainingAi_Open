import type { MealPlan, MealPlanDayType, MealPlanVariant } from '@trainingai/shared/types/nutrition'

/**
 * Which variant of a meal plan applies today. A plan with no split has one 'all' variant; a split
 * plan is keyed off `isTrainingDay` (LA-184), falling to 'rest' when that is unknown and to the first
 * variant when the shape is unexpected, so a card renders something rather than nothing.
 *
 * Shared so the plan card and BF-203a's estimator can never disagree about which meals today holds.
 * An estimator must not rely on the fallback, though: see `variantForEstimates`.
 */
export function pickPlanVariant(plan: MealPlan, isTrainingDay?: boolean): MealPlanVariant {
  const byType = (t: MealPlanDayType) => plan.variants.find(v => v.dayType === t)
  return (
    byType('all')
    ?? (isTrainingDay ? byType('training') : byType('rest'))
    ?? plan.variants[0]
  )
}

/**
 * BF-203a. The variant to estimate against, or null when it cannot be known. A split plan with an
 * unknown day type falls back to 'rest' for display, which is harmless to LOOK at and wrong to COUNT:
 * an estimate would add a rest day's meals to a training day. So the estimator declines instead.
 */
export function variantForEstimates(plan: MealPlan, isTrainingDay: boolean | undefined): MealPlanVariant | null {
  const split = plan.variants.some(v => v.dayType !== 'all')
  if (split && isTrainingDay === undefined) return null
  return pickPlanVariant(plan, isTrainingDay) ?? null
}
