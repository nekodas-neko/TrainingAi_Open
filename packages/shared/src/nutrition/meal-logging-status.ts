export type MealLoggingStatus = 'not_recorded' | 'recorded' | 'skipped'

export function mealLoggingStatus(
  mealTypeId: string,
  recordedMealTypeIds: readonly string[],
  skippedMealTypeIds: readonly string[],
): MealLoggingStatus {
  if (recordedMealTypeIds.includes(mealTypeId)) return 'recorded'
  return skippedMealTypeIds.includes(mealTypeId) ? 'skipped' : 'not_recorded'
}

export function mealLoggingComplete(
  mealTypeIds: readonly string[],
  recordedMealTypeIds: readonly string[],
  skippedMealTypeIds: readonly string[],
): boolean {
  return (
    mealTypeIds.length > 0 &&
    mealTypeIds.every(
      (id) => mealLoggingStatus(id, recordedMealTypeIds, skippedMealTypeIds) !== 'not_recorded',
    )
  )
}

export function unrecordedMealEstimatesAllowed(tracking: readonly unknown[]): boolean {
  return tracking.length === 0
}
