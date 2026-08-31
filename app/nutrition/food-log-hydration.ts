import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'

/**
 * BF-72 — turning a server food-log response into the local rows the diary re-reads.
 *
 * The owner's report was *"when I add my saved meal it starts as the meal with the image, then
 * breaks into its ingredients."* That sequence is the diagnosis: the optimistic write is right, and
 * this hydration — which runs moments later and is followed immediately by
 * `getFoodLogsWithItems(today)` — was what broke it.
 *
 * **The cause is that a local upsert overwrites every column it is given.** `upsertFoodLog` writes
 * `record.savedMealId ?? null`, so a payload that simply *omits* the field stores NULL over a
 * correct value. This mapping omitted `savedMealId` and `mealGroupId`, so the screen stripped its
 * own grouping and then rendered the stripped copy. The server was never wrong — production held 11
 * rows carrying both ids, resolving to the six real meals the owner could see turn into loose
 * ingredients.
 *
 * **Extracted as a pure function rather than fixed in place**, because the defect is a *missing
 * field in an object literal* — the one shape a reviewer's eye slides over and no type error
 * catches, since every field here is optional on the way in. As a function it has a test that names
 * the columns, which is what makes the next omission fail rather than ship.
 *
 * The sibling paths were already correct and stay the reference: `log-meal.ts`'s local upsert, the
 * outbox payload, the `pushMutations` branch, and the sync engine's own `pullDelta` mapping — that
 * last one carries a BF-39 comment saying precisely why it must. This screen-level hydrate predates
 * the columns and was the site that audit did not reach.
 */
export function toLocalFoodLogs(
  server: readonly FoodLogWithItem[],
  date: string,
  nowIso: string,
) {
  return server.map(l => ({
    id: l.id,
    date,
    mealTypeId: l.mealTypeId,
    foodItemId: l.foodItemId,
    // The two fields this function exists for. `savedMealId` is WHAT was eaten; `mealGroupId` is
    // one id per logging OCCASION, and the diary groups on the second — so dropping either turns a
    // meal back into its ingredients.
    savedMealId: l.savedMealId ?? null,
    mealGroupId: l.mealGroupId ?? null,
    quantityMultiplier: l.quantityMultiplier,
    loggedAt: typeof l.loggedAt === 'string' ? l.loggedAt : new Date(l.loggedAt).toISOString(),
    updatedAt: nowIso,
    deletedAt: null,
    // Carried because `LocalFoodLog` requires it, and **not** because it decides anything:
    // `applyDelta`'s food-logs arm hardcodes `'synced'` in both its VALUES and its SET and never
    // reads this field, then gates the whole upsert on `WHERE food_logs.sync_status='synced'`. So a
    // row with a mutation still in the outbox is protected by the *stored* status regardless of what
    // is passed here. BF-72 raised this as a possible second defect; it was measured and it is inert.
    // Left as `'synced'` rather than changed, because changing an ignored value would look like a
    // fix and be none.
    syncStatus: 'synced' as const,
  }))
}

/** The `foodItems` half of the same hydrate. Unchanged by BF-72; extracted with its sibling so the
 *  two payloads stay side by side rather than one moving out of view of the other. */
export function toLocalFoodItems(server: readonly FoodLogWithItem[], nowIso: string) {
  return server.map(l => ({
    id: l.foodItemId,
    name: l.foodItem.name,
    brand: l.foodItem.brand ?? null,
    servingSizeG: l.foodItem.servingSizeG,
    calories: l.foodItem.calories,
    proteinG: l.foodItem.proteinG,
    carbsG: l.foodItem.carbsG,
    fatG: l.foodItem.fatG,
    fiberG: l.foodItem.fiberG ?? null,
    sugarG: l.foodItem.sugarG ?? null,
    sodiumMg: l.foodItem.sodiumMg ?? null,
    satFatG: l.foodItem.satFatG ?? null,
    imageDataUri: l.foodItem.imageDataUri ?? null,
    source: l.foodItem.source,
    updatedAt: nowIso,
  }))
}
