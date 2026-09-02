import type { FoodLogWithItem, SavedMeal, SavedMealItem } from '@trainingai/shared/types/nutrition'
import { cancelMealReminder } from '@/lib/meal-reminders'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateNutritionWrite } from '@/lib/cache-groups'
import { oneServingItems } from './saved-meal-ingredients'
import { resolveLocalEatenAt } from './local-eaten-at'
import { DEFAULT_TZ } from '../date-utils'

function r1(n: number) { return Math.round(n * 10) / 10 }

// Builds an optimistic FoodLogWithItem for one saved-meal component so the UI can
// append it immediately (mirrors log-food.ts's toWithItem). The item's macros are
// scaled by its per-item quantity multiplier.
export function savedMealItemToWithItem(
  item: SavedMealItem,
  log: { id: string; date: string; mealTypeId: string; loggedAt: string; savedMealId?: string | null; mealGroupId?: string | null },
  /** LB-49. How much of the meal was eaten. Defaults to a whole serving, so every existing caller
   *  is unchanged. It belongs here rather than only at the write sites because this builds the
   *  OPTIMISTIC row: scale the stored multiplier and not this one and the diary shows a single
   *  serving while the database holds one and a half. */
  scale = 1,
): FoodLogWithItem {
  const q = item.quantityMultiplier * scale
  const fi = item.foodItem
  return {
    id: log.id,
    userId: fi.userId,
    date: log.date,
    mealTypeId: log.mealTypeId,
    foodItemId: item.foodItemId,
    // BF-39. Carried onto the optimistic row so the caller can group it immediately — a refetch to
    // learn the grouping would blank the optimistic state, which is what this shape exists to avoid.
    savedMealId: log.savedMealId ?? null,
    mealGroupId: log.mealGroupId ?? null,
    quantityMultiplier: q,
    loggedAt: new Date(log.loggedAt),
    foodItem: fi,
    calories: Math.round(fi.calories * q),
    proteinG: r1(fi.proteinG * q),
    carbsG: r1(fi.carbsG * q),
    fatG: r1(fi.fatG * q),
  }
}

// Logs every component of a saved meal as its own food log. Uses the offline-first
// local store when available and falls back to the API otherwise. Returns the
// optimistic log entries for immediate UI updates (mirrors logFoodEntries) so the
// caller can append them without a refetch that would blank the optimistic state.
export async function logMealItems(
  meal: SavedMeal,
  date: string,
  mealTypeId: string,
  userId?: string,
  tz: string = DEFAULT_TZ,
  /** LB-49. How much of the meal was actually eaten — 1.5 for a serving and a half. Applied at
   *  WRITE time to each item's multiplier; the factor is never stored. Defaults to 1, so this is
   *  byte-identical to the previous behaviour until a caller passes one. */
  scale = 1,
): Promise<FoodLogWithItem[]> {
  const store = userId ? getLocalStore(userId) : null
  const optimistic: FoodLogWithItem[] = []

  // BF-39. One id per CALL, shared by every ingredient it writes — that is what makes the diary
  // able to draw one row for one meal. Deliberately not the saved meal's id: logging the same meal
  // twice on one day must produce two groups, or the second serving disappears into the first.
  const mealGroupId = crypto.randomUUID()

  if (store) {
    try {
      const now = new Date().toISOString()
      // See logFoodEntries: `loggedAt` is when it was eaten, `updatedAt` is when the row changed.
      const eatenAt = await resolveLocalEatenAt(store, mealTypeId, date, new Date(now), tz)
      for (const item of oneServingItems(meal)) {
        // Mirror the item locally first — same as the single-food path — so
        // getFoodLogsWithItems' local JOIN doesn't drop this row when the item
        // isn't already cached (the original food-disappearing mechanism).
        const fi = item.foodItem
        await store.upsertFoodItem({
          id: item.foodItemId, name: fi.name, brand: fi.brand ?? null,
          servingSizeG: fi.servingSizeG, calories: fi.calories,
          proteinG: fi.proteinG, carbsG: fi.carbsG, fatG: fi.fatG,
          fiberG: fi.fiberG ?? null, sugarG: fi.sugarG ?? null,
          sodiumMg: fi.sodiumMg ?? null, satFatG: fi.satFatG ?? null,
          // BF-35. The saved meal's stored items carry whatever picture they were created with.
          source: fi.source, imageDataUri: fi.imageDataUri ?? null, updatedAt: now,
        })
        const logId = crypto.randomUUID()
        await store.upsertFoodLog({
          id: logId, date, mealTypeId, foodItemId: item.foodItemId,
          savedMealId: meal.id, mealGroupId,
          quantityMultiplier: item.quantityMultiplier * scale,
          loggedAt: eatenAt, updatedAt: now, deletedAt: null, syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'food_logs',
          date,
          // The payload carries both, or the rows reach the server ungrouped and every other
          // device sees loose ingredients — the offline rule is that a new column lands on the
          // local table, the queued payload, the push branch and the pull mapping together.
          payload: {
            id: logId, mealTypeId, foodItemId: item.foodItemId,
            savedMealId: meal.id, mealGroupId,
            // LB-49 — the SCALED amount, because the factor itself is deliberately not stored.
            // The rows are point-in-time snapshots (this function copies the definition's
            // multipliers rather than referencing them), so a meal-level factor every reader had
            // to remember to apply would put a second multiplier in the system. The cost, stated
            // rather than discovered: "I ate 1.5x" is not recoverable afterwards — only the scaled
            // per-item amounts are.
            quantityMultiplier: item.quantityMultiplier * scale, loggedAt: eatenAt,
          },
        })
        optimistic.push(savedMealItemToWithItem(item, { id: logId, date, mealTypeId, loggedAt: eatenAt, savedMealId: meal.id, mealGroupId }, scale))
      }
      await cancelMealReminder(mealTypeId)
      // Twice, deliberately: now so this device's screens repaint at once (and because offline
      // this is the only one that will ever fire), and again once the server has the write —
      // otherwise the refetch this triggers re-caches the pre-log figures. See pushThenRevalidate.
      await invalidateNutritionWrite()
      pushThenRevalidate(userId!, invalidateNutritionWrite)
      return optimistic
    } catch (sqliteErr) {
      console.error('Food log SQLite write failed, falling back to API:', sqliteErr)
    }
  }

  // Web fallback, reached only when the local store is unavailable (the K4 `isLocalStoreDead`
  // state) or its write threw. Rollback on failure, as before.
  //
  // BF-12: these used to be a `for` loop of sequential `await fetch`es — one blocking round trip
  // per ingredient, which is the pattern CLAUDE.md names outright ("never `await` POSTs serially
  // in a loop … batch into one request or `Promise.all`"). Production timestamps for the owner's
  // report showed a three-item meal's rows landing ~0.4s apart, confirming the chain was real.
  // They now go out together, so the wall clock is one round trip rather than N.
  const createdIds: string[] = []
  try {
    const settled = await Promise.allSettled(
      oneServingItems(meal).map(async item => {
        const res = await fetch('/api/nutrition/food-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date, mealTypeId, foodItemId: item.foodItemId,
            savedMealId: meal.id, mealGroupId,
            quantityMultiplier: item.quantityMultiplier * scale,
          }),
        })
        if (!res.ok) throw new Error('Failed to log item')
        return { item, log: await res.json() as { id: string; loggedAt?: string } }
      }),
    )

    // `allSettled`, not `all`, and the ids are recorded BEFORE rethrowing: `Promise.all` rejects on
    // the first failure without reporting which siblings succeeded, so a partial failure would
    // strand rows the rollback cannot see — invisible to the user until they appear as duplicates
    // on the next tap. Serially this could not happen; making the writes concurrent is what makes
    // the distinction load-bearing.
    for (const r of settled) if (r.status === 'fulfilled') createdIds.push(r.value.log.id)
    const rejected = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (rejected) {
      throw rejected.reason instanceof Error ? rejected.reason : new Error('Failed to log item')
    }

    // Ordered by `oneServingItems`, not by completion — `allSettled` preserves input order, and the
    // caller appends these straight onto the visible list.
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue
      const { item, log } = r.value
      optimistic.push(savedMealItemToWithItem(item, {
        id: log.id, date, mealTypeId, loggedAt: log.loggedAt ?? new Date().toISOString(),
        savedMealId: meal.id, mealGroupId,
      }, scale))
    }
    await cancelMealReminder(mealTypeId)
    await invalidateNutritionWrite()
    return optimistic
  } catch (err) {
    await Promise.all(createdIds.map(id =>
      fetch(`/api/nutrition/food-logs/${id}`, { method: 'DELETE' }).catch(() => {})
    ))
    throw err
  }
}
