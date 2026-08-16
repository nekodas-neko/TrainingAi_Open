// Nutrition logging adherence — the fraction of days in a window where the
// user logged every one of their "required" meal types (e.g. Breakfast,
// Lunch, Dinner, but not an optional Evening Snack). A day with zero required
// meal types configured has no adherence signal at all — return null.
export function computeAdherenceRatio(
  days: string[],
  requiredMealTypeCount: number,
  requiredMealTypesLoggedByDay: Map<string, number>,
): number | null {
  if (requiredMealTypeCount === 0 || days.length === 0) return null
  const adherentDays = days.filter(
    d => (requiredMealTypesLoggedByDay.get(d) ?? 0) >= requiredMealTypeCount,
  ).length
  return adherentDays / days.length
}
