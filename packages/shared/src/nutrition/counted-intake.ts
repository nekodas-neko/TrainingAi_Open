// #2863. "How much have I eaten today", answered once.
//
// The day's intake is the food logged plus the plan meals counted as estimated (#2122 step 8′(3)),
// and an estimate stops counting once its slot's meal type has food logged (`countedEstimates`).
// The Nutrition ring and the server's `intakeKcal` read it that way; Home's Calories tile, Goals,
// the day screen's energy caption and the food logger's "Today after logging" line summed logged
// food only, so one screen said 1,250 eaten and the next said 600. Every calorie surface, in both
// apps, now reads this.

/** One counted estimate: what `countedEstimates` returns, and `balance.estimatedMeals` on the wire. */
export interface CountedEstimateRow {
  mealTypeId: string
  kcal: number
}

/**
 * The day's intake: logged food plus the counted estimates.
 *
 * `loggedMealTypeIds` is for a caller whose logged food is newer than its estimate rows: the device
 * holding a log the server has not seen, or the logger previewing the food it is about to log. An
 * estimate whose meal type appears there is superseded and dropped, which is the same rule
 * `countedEstimates` applied when the rows were built, so passing the server's own set changes
 * nothing.
 *
 * Each half is rounded on its own and then added, so `loggedIntakeKcal + estimatedKcal` on the
 * energy-balance payload equals its `intakeKcal` exactly.
 */
export function countedIntakeKcal(input: {
  loggedKcal: number
  estimates: readonly CountedEstimateRow[]
  loggedMealTypeIds?: Iterable<string | null | undefined>
}): number {
  return Math.round(input.loggedKcal) + countedEstimateTotal(input.estimates, input.loggedMealTypeIds)
}

/** The estimate half of `countedIntakeKcal`, for a surface that names it ("incl. 650 estimated"). */
export function countedEstimateTotal(
  estimates: readonly CountedEstimateRow[],
  loggedMealTypeIds?: Iterable<string | null | undefined>,
): number {
  const logged = new Set(loggedMealTypeIds ?? [])
  return Math.round(estimates.reduce((sum, e) => (logged.has(e.mealTypeId) ? sum : sum + e.kcal), 0))
}

/**
 * `balance.estimatedMeals` from a payload that may predate it or be malformed (a cached response, or
 * the native app's loosely typed copy). Anything unreadable is no estimate: a payload that cannot
 * say which meal an estimate belongs to cannot be superseded by a log, so counting it risks the
 * double count `countedEstimates` exists to prevent.
 */
export function readEstimateRows(value: unknown): CountedEstimateRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((r): r is CountedEstimateRow =>
    r != null && typeof r === 'object'
    && typeof (r as CountedEstimateRow).mealTypeId === 'string'
    && typeof (r as CountedEstimateRow).kcal === 'number' && Number.isFinite((r as CountedEstimateRow).kcal)
    && (r as CountedEstimateRow).kcal > 0)
}
