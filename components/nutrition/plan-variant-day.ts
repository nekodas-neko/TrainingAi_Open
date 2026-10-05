import type { MealPlan } from '@trainingai/shared/types/nutrition'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'

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
 * Is `logDate` a training day? `undefined` means **unknown**, and that is a third answer rather
 * than a soft `false` (LA-184).
 *
 * `MealPlanSection` took `isTrainingDay?: boolean` from the day it was written and **no caller ever
 * passed it**, so a split plan showed its REST variant every day, training days included. This is
 * the caller.
 *
 * ⚠ **It can only answer for TODAY, and that is a property of the data rather than a shortcut
 * taken here.** `getNextSession(userId, timezone?)` has no date parameter — the whole recommendation
 * is about today — and the `next-session` cache key is `cachedFetchToday` for the same reason. The
 * owner's schedule makes this structural rather than incidental: measured in production
 * 2026-09-30, **all five of his programs are `type: 'rotation'` with `rest_after_n: 3` and ZERO
 * `schedule_days` rows**, so there is no weekly day-of-week map to read and a rotation's day type
 * for an arbitrary date depends on workout history the client does not hold. Answering per-date is
 * therefore a server change, filed as `LB-195`.
 *
 * ⚠ **`isRestDay: false` is NOT the same as "training day", and treating it as one was the trap.**
 * With no active program `getNextSession` returns `{ isRestDay: false, reason: 'No active program
 * configured' }` and no `session` — a claim about nothing. Only a recommendation that names a
 * session says today is a training day.
 */
export function trainingDayForPlanDate(
  logDate: string,
  today: string,
  rec: NextSessionRecommendation | null,
): boolean | undefined {
  if (logDate !== today || rec == null) return undefined
  if (rec.isRestDay) return false
  return rec.session != null ? true : undefined
}
