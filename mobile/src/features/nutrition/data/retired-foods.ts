import { lookAlikeFactor, lookAlikeKey } from '@trainingai/shared/nutrition/food-merge';
import { quantityMultiplierInRange } from '@trainingai/shared/nutrition/quantity-bounds';
import { z } from 'zod';
import { foodSchema, type Food } from './models.ts';

/**
 * #3476. `/api/nutrition/food-items/retired`: the foods the look-alike merge (#2417) retired since
 * the cursor, and fresh copies of their keepers. The food list route returns live foods only and
 * stops at 20, so without this a merged-away duplicate stays in the phone's library for good and a
 * keeper never shows the barcode or picture the merge gave it.
 */
export const RETIRED_FOODS_PATH = '/api/nutrition/food-items/retired';
export const retiredFoodsSchema = z.object({
  retired: z.array(z.object({ id: z.string() }).passthrough()),
  keepers: z.array(foodSchema),
  at: z.string(),
});
export type RetiredFoods = z.infer<typeof retiredFoodsSchema>;

/**
 * The library after a refresh: the merged-away foods dropped, then the list route's answer and the
 * keepers laid over it by id. A keeper's new barcode or picture replaces the copy the phone had.
 */
export function refreshedLibrary(
  foods: Food[],
  listed: Food[],
  retired: RetiredFoods | null,
): Food[] {
  const gone = new Set(retired?.retired.map((row) => row.id) ?? []);
  const fresh = [...listed, ...(retired?.keepers ?? [])].filter((food) => !gone.has(food.id));
  return [
    ...new Map(
      [...foods.filter((food) => !gone.has(food.id)), ...fresh].map((food) => [food.id, food]),
    ).values(),
  ];
}

/**
 * #3652. The retired ids the phone remembers after a refresh: what it knew, plus what the merge
 * retired since, less any food the server now lists live again (as the current app forgets a
 * retired id a pull carries live, #3468). `previous` is undefined on a phone that never kept the
 * list; that phone re-reads retirements from the beginning (`retiredFoodsSince`).
 */
export function retiredIdsAfter(
  previous: readonly string[] | undefined,
  listed: readonly Food[],
  retired: RetiredFoods | null,
): string[] {
  const live = new Set([...listed, ...(retired?.keepers ?? [])].map((food) => food.id));
  return [
    ...new Set([...(previous ?? []), ...(retired?.retired.map((row) => row.id) ?? [])]),
  ].filter((id) => !live.has(id));
}

/** The cursor for the next retired-foods read: from the beginning until the ids are kept. */
export function retiredFoodsSince(data: {
  foodsRetiredAt: string | null;
  retiredFoodIds?: readonly string[];
}): string | null {
  return data.retiredFoodIds === undefined ? null : data.foodsRetiredAt;
}

/**
 * #3652. The food to offer or log in place of `food`: itself while it is live, else the live
 * library food that shares its look-alike key (the keeper the merge re-pointed it to), else null.
 * A saved day or a saved meal read before the merge still carries the retired copy; this is what
 * keeps that copy out of search, recents, the barcode check and new logs.
 */
export function keeperFor<T extends Pick<Food, 'id' | 'name' | 'brand'>>(
  food: T,
  library: readonly T[],
  retired: ReadonlySet<string>,
): T | null {
  if (!retired.has(food.id)) return food;
  const key = lookAlikeKey(food);
  return library.find((other) => !retired.has(other.id) && lookAlikeKey(other) === key) ?? null;
}

/** Every food in `foods` as `keeperFor` resolves it against `foods` itself, once each, in order. */
export function liveCatalog<T extends Pick<Food, 'id' | 'name' | 'brand'>>(
  foods: readonly T[],
  retired: ReadonlySet<string>,
): T[] {
  if (!retired.size) return foods.slice();
  const out = new Map<string, T>();
  for (const food of foods) {
    const live = keeperFor(food, foods, retired);
    if (live && !out.has(live.id)) out.set(live.id, live);
  }
  return [...out.values()];
}

/** The remembered retired ids as a set. */
export function retiredFoodIdsOf(data: { retiredFoodIds?: readonly string[] }): ReadonlySet<string> {
  return new Set(data.retiredFoodIds ?? []);
}

/**
 * #3652. A saved meal's items with any merged-away food moved to its keeper, in the same grams
 * (`lookAlikeFactor`, the merge's own rule), so editing or re-saving a meal read before the merge
 * does not write the retired id back. An item with no keeper on the phone, or whose moved quantity
 * would leave the allowed range, is left as it was.
 */
export function keeperItems<I extends { foodItemId: string; quantityMultiplier: number; foodItem: Food }>(
  items: readonly I[],
  library: readonly Food[],
  retired: ReadonlySet<string>,
): { foodItemId: string; quantityMultiplier: number }[] {
  return items.map((item) => {
    const keeper = retired.has(item.foodItemId)
      ? keeperFor({ ...item.foodItem, id: item.foodItemId }, library, retired)
      : null;
    const moved = keeper ? item.quantityMultiplier * lookAlikeFactor(item.foodItem, keeper) : 0;
    return keeper && quantityMultiplierInRange(moved)
      ? { foodItemId: keeper.id, quantityMultiplier: moved }
      : { foodItemId: item.foodItemId, quantityMultiplier: item.quantityMultiplier };
  });
}
