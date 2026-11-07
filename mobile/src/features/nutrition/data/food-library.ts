import { z } from 'zod';
import { foodSchema, type Food } from './models.ts';
import { keeperFor } from './retired-foods.ts';
import { savedBarcodeFood } from './scan-response.ts';

// The phone keeps part of the food library: the 20 newest foods, plus what its saved days and
// saved meals use. The current app searches its full local copy, so Preview asks the server for the
// rest (#3651): the name search the current app runs (`GET /api/nutrition/food-items?q=`, live rows,
// newest first, 20) and a barcode read over the whole library. Neither returns a food the
// look-alike merge retired (#3652).
export const FOOD_ITEMS_PATH = '/api/nutrition/food-items';
export const librarySearchSpec = (q: string) => ({
  path: FOOD_ITEMS_PATH,
  query: { q },
  ttl: 300000,
  schema: z.array(foodSchema),
});

const matches = (food: Food, query: string) =>
  food.name.toLowerCase().includes(query.trim().toLowerCase());

/**
 * The search tab's saved foods: the phone's own matches first, then the server's that the phone
 * lacks, each live and once. `local` is `view.foods`, already live.
 */
export function librarySearch(
  local: readonly Food[],
  server: readonly Food[] | null | undefined,
  query: string,
  retired: ReadonlySet<string>,
  limit = 50,
): Food[] {
  const out = new Map<string, Food>();
  for (const food of [
    ...local.filter((f) => matches(f, query)),
    ...(server ?? []).filter((f) => matches(f, query)),
  ]) {
    const live = keeperFor(food, local, retired);
    if (live && !out.has(live.id)) out.set(live.id, live);
  }
  return [...out.values()].slice(0, limit);
}

/** The recent tab's foods, with a merged-away food replaced by its keeper or left out. */
export function recentFoods(
  foods: readonly Food[],
  library: readonly Food[],
  retired: ReadonlySet<string>,
): Food[] {
  const out = new Map<string, Food>();
  for (const food of foods) {
    const live = keeperFor(food, library, retired);
    if (live && !out.has(live.id)) out.set(live.id, live);
  }
  return [...out.values()];
}

/**
 * The saved food a scanned barcode is, before Open Food Facts is asked: the phone's live copy, else
 * the server's live library (`?barcode=`), so an old food is found rather than saved again. Null
 * when neither has it, and when the server cannot be asked, so the scan carries on to the food
 * database as before. The answer is checked against the code, which also keeps an older server
 * that ignores `barcode` (and lists its 20 newest) from resolving to the wrong food.
 */
export async function savedFoodForBarcode(
  connection: { get: (path: string, query?: Record<string, string>) => Promise<unknown> },
  local: readonly Food[],
  code: string,
  retired: ReadonlySet<string>,
): Promise<Food | null> {
  const mine = savedBarcodeFood(local as Food[], code);
  if (mine) return mine;
  let listed: Food[];
  try {
    listed = z.array(foodSchema).parse(await connection.get(FOOD_ITEMS_PATH, { barcode: code }));
  } catch {
    return null;
  }
  return listed.find((food) => food.barcode === code && !retired.has(food.id)) ?? null;
}
