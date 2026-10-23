import { plural } from '@trainingai/shared/format/plural';

type Searchable = { name: string; items: readonly { foodItem: { name: string } }[] };

// Same match as the current app's My Foods filter: the meal's name or any ingredient's.
export function filterMeals<M extends Searchable>(meals: readonly M[], query: string): M[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return meals.slice();
  return meals.filter(
    (meal) =>
      meal.name.toLowerCase().includes(needle) ||
      meal.items.some((item) => item.foodItem.name.toLowerCase().includes(needle)),
  );
}

export function mealCountLine(count: number) {
  return plural(count, 'item', 'items');
}

// Preview has no swipe tray: a meal's label, edit and delete are inside the meal.
export const MEAL_LIST_FOOTNOTE =
  'Meal calories are per portion. Open a meal for label, edit and delete.';

export const MEAL_TAG_CAP = 4;

export function mealTags<T extends { id: string }>(
  mealTypes: readonly T[],
  mealTypeIds: readonly string[],
) {
  const tagged = mealTypes.filter((mt) => mealTypeIds.includes(mt.id));
  return { shown: tagged.slice(0, MEAL_TAG_CAP), extra: Math.max(0, tagged.length - MEAL_TAG_CAP) };
}
