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
