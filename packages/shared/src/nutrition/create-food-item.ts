import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { findDuplicateFoodItem } from '@trainingai/shared/nutrition/food-item-identity'
import { todayInTz } from '@trainingai/shared/date-utils'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateFoodItems } from '@/lib/cache-groups'

/**
 * Creating a food item, offline-first.
 *
 * This exists because the meal builder had three of these — add by hand, an Open Food Facts hit,
 * and the AI estimate — and all three were a bare `POST /api/nutrition/food-items` whose response
 * went straight into React state. That left three gaps at once: the item never reached the local
 * store (so the local-first search in the same file could not find it), it never queued an outbox
 * mutation (so it could not be created offline at all), and nothing invalidated
 * `nutrition-food-items-all`, so the Food Library sheet kept serving a list without it.
 *
 * `logFoodEntries` already had the right shape for this — mint the id on the client, write locally,
 * queue the mutation — so this is that shape extracted rather than a fourth invention.
 *
 * **The sanitiser runs here on purpose.** `POST /api/nutrition/food-items` applies
 * `sanitiseNutrition` server-side, so a client that stored its own unsanitised copy would hold
 * different numbers from the server for the same id until the next pull. Running the same shared
 * function first means the two agree by construction.
 */
export interface NewFoodItem {
  name: string
  brand?: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
  source: FoodItem['source']
}

export async function createFoodItem(input: NewFoodItem, userId?: string): Promise<FoodItem> {
  const s = sanitiseNutrition({
    calories: input.calories, proteinG: input.proteinG, carbsG: input.carbsG, fatG: input.fatG,
    servingSizeG: input.servingSizeG, fiberG: input.fiberG, sugarG: input.sugarG,
    sodiumMg: input.sodiumMg, satFatG: input.satFatG,
  })

  const item: FoodItem = {
    id: crypto.randomUUID(),
    userId: userId ?? '',
    name: input.name,
    brand: input.brand,
    servingSizeG: s.servingSizeG ?? 100,
    calories: Math.round(s.calories ?? 0),
    proteinG: s.proteinG ?? 0,
    carbsG: s.carbsG ?? 0,
    fatG: s.fatG ?? 0,
    fiberG: s.fiberG,
    sugarG: s.sugarG,
    sodiumMg: s.sodiumMg,
    satFatG: s.satFatG,
    source: input.source,
    region: 'AU',
    // BF-35. Present when the scan came from a barcode/search lookup whose Open Food Facts product
    // carried a thumbnail. Never blocks the save: `fetchOffThumbDataUri` returns null on every
    // failure path, so absent is the ordinary case and the placeholder tile covers it.
    imageDataUri: s.imageDataUri ?? null,
    createdAt: new Date(),
  }

  const store = userId ? getLocalStore(userId) : null

  // BF-38. The device de-duplicates HERE, before anything is written or queued — and that is the
  // whole point. The caller logs against the id this returns and `logFoodEntries` queues a
  // `food_logs` mutation carrying it, so the server cannot substitute a different id later without
  // leaving that log pointing at a row it never created (`food_logs.food_item_id` is ON DELETE
  // RESTRICT). Catching it on this side means the duplicate never enters the outbox at all, which
  // is why `createFoodItem` in the Postgres slice leaves `reuseExisting` off for the push branch.
  // The web fallback below has no local store and no queued log, so its half of the check runs
  // server-side in `POST /api/nutrition/food-items`.
  //
  // The candidate is `item` rather than `input`: the rounding it carries is what actually gets
  // stored, and comparing pre-rounding values against stored ones is how a check like this misses.
  if (store) {
    const existing = findDuplicateFoodItem(item, await store.findFoodItemsByCalories(item.calories))
    // No local write, no mutation, no invalidation — nothing changed, so nothing to tell anyone.
    if (existing) return existing
  }

  const body = {
    id: item.id, name: item.name, brand: item.brand,
    servingSizeG: item.servingSizeG, calories: item.calories,
    proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
    fiberG: item.fiberG, sugarG: item.sugarG, sodiumMg: item.sodiumMg, satFatG: item.satFatG,
    source: item.source,
    // Rides the outbox payload too — the offline rule is that adding a route field means updating
    // the local table, the queued payload, the push branch and the pull mapping in ONE change.
    imageDataUri: item.imageDataUri ?? null,
  }

  if (store && userId) {
    const now = new Date().toISOString()
    await store.upsertFoodItem({
      id: item.id, name: item.name, brand: item.brand ?? null,
      servingSizeG: item.servingSizeG, calories: item.calories,
      proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
      fiberG: item.fiberG ?? null, sugarG: item.sugarG ?? null,
      sodiumMg: item.sodiumMg ?? null, satFatG: item.satFatG ?? null,
      source: item.source, imageDataUri: item.imageDataUri ?? null, updatedAt: now,
    })
    // Same domain and same client-minted id as logFoodEntries' branch, so a replay lands in place
    // rather than duplicating.
    // todayInTz(), never the ISO string's date part — that is UTC, and it is yesterday in
    // Brisbane until 10am every day.
    await store.queueMutation({ userId, domain: 'food_items', date: todayInTz(), payload: body })
    await invalidateFoodItems()
    pushThenRevalidate(userId, invalidateFoodItems)
    return item
  }

  // Web fallback (no local store): online-only, and a pure pass-through — no defaults or
  // derivations the device path lacks, so it cannot drift from it.
  const res = await fetch('/api/nutrition/food-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Could not create that food')
  const created = await res.json() as FoodItem
  await invalidateFoodItems()
  return created
}
