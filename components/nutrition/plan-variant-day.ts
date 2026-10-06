import type { MealPlan } from '@trainingai/shared/types/nutrition'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import { trainingDayForDate } from '@trainingai/shared/workout/day-type'

/**
 * Whether a plan has training/rest variants at all (LA-184).
 *
 * A plan built without a split carries one `'all'` variant, and `pickVariant` short-circuits on it
 * — so the day type is only ever a question for a split plan, and asking it otherwise costs a
 * decision nothing reads.
 */
export function isSplitPlan(plan: MealPlan | null): boolean {
  return plan?.variants.some(v => v.dayType !== 'all') ?? false
}

/**
 * Is `logDate` a training day, for choosing a split plan's variant? `undefined` means **unknown**,
 * and `pickVariant` shows the rest variant for it, as it always has.
 *
 * LA-184 answered today only, because `getNextSession` takes no date. LB-195 adds PAST dates from
 * workout history, which is a fact rather than a projection; a future date stays unknown. The rule
 * itself lives beside the schedule logic in `@trainingai/shared/workout/day-type`, not here — this
 * is the nutrition card's call into it.
 */
export function trainingDayForPlanDate(
  logDate: string,
  today: string,
  rec: NextSessionRecommendation | null,
  trainedDays: Record<string, string[]> | null = null,
): boolean | undefined {
  return trainingDayForDate({ date: logDate, today, todayRecommendation: rec, trainedDays })
}
