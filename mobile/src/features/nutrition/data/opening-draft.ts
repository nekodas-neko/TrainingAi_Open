/**
 * The saved food-logger draft, moved to the meal group and tab the logger was opened for (#2123).
 * Null when the draft already matches. Both fields land in one patch so neither overwrites the other.
 */
export function openingDraft<T extends { mealTypeId: string; tab: string }>(
  saved: T,
  open: { mealTypeId?: string; tab?: T['tab'] },
): T | null {
  const mealTypeId = open.mealTypeId && open.mealTypeId !== saved.mealTypeId ? open.mealTypeId : null;
  const tab = open.tab && open.tab !== saved.tab ? open.tab : null;
  if (!mealTypeId && !tab) return null;
  return { ...saved, ...(mealTypeId ? { mealTypeId } : {}), ...(tab ? { tab } : {}) };
}
