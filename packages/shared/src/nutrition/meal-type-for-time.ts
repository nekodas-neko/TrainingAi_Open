import type { MealType } from '@trainingai/shared/types/nutrition'

// Pure: no store, no network. Imported by the client's plan-meal logging and by the server's
// plan-meal writes (LA-172), so both decide a meal's bucket by one rule.

/**
 * Which meal bucket a time of day falls in.
 *
 * Shared because the saved-meals sheet decides this the same way, and two copies would drift the
 * moment someone edits their meal-type hours. Falls back to the first bucket rather than refusing —
 * a gap in the user's configured hours should not lose a log.
 */
export function mealTypeForHour(mealTypes: MealType[], hour: number): string | null {
  return mealTypes.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)?.id
    ?? mealTypes[0]?.id
    ?? null
}

/**
 * LA-172. The meal type a plan meal should be STORED with: an explicit tag wins; otherwise the type
 * whose hours contain its `suggestedTime`; otherwise the type whose hours are NEAREST to it.
 *
 * Nearest, not "none" and not "the first bucket": the owner's answer was *"give it a type by its
 * time"*, and real meal-type hours have gaps (his run 6-10, 10-12, 12-15, 18-21, so a 16:20 or 21:00
 * meal is in none). The first bucket would file a 21:00 snack under breakfast. The nearest window is
 * the closest reading of the time, and the stored value stays visible and correctable, so a wrong
 * one is fixable rather than silent.
 *
 * Distance is in minutes to the window's edge (its end is exclusive, so 21:00 is one minute past a
 * window ending at 21). A tie goes to list order, `sort_order` then `created_at`, the order the
 * backfill migration uses too. No meal types, or no parseable time, → null.
 */
export function planMealTypeId(
  meal: { mealTypeId?: string | null; suggestedTime?: string | null },
  mealTypes: MealType[],
): string | null {
  if (meal.mealTypeId) return meal.mealTypeId
  const m = /^(\d{1,2}):(\d{2})/.exec(meal.suggestedTime ?? '')
  if (!m) return null
  const minute = Number(m[1]) * 60 + Number(m[2])
  if (!(minute >= 0 && minute < 1440)) return null
  let best: { id: string; d: number } | null = null
  for (const t of mealTypes) {
    const startMin = t.timeStartHour * 60
    const endMin = t.timeEndHour * 60
    const d = minute < startMin ? startMin - minute : minute >= endMin ? minute - endMin + 1 : 0
    if (!best || d < best.d) best = { id: t.id, d }
  }
  return best?.id ?? null
}
