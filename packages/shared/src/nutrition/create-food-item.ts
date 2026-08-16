import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { todayInTz } from '@trainingai/shared/date-utils'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
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
    createdAt: new Date(),
  }

  const store = userId ? getLocalStore(userId) : null
  const body = {
    id: item.id, name: item.name, brand: item.brand,
    servingSizeG: item.servingSizeG, calories: item.calories,
    proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
    fiberG: item.fiberG, sugarG: item.sugarG, sodiumMg: item.sodiumMg, satFatG: item.satFatG,
    source: item.source,
  }

  if (store && userId) {
    const now = new Date().toISOString()
    await store.upsertFoodItem({
      id: item.id, name: item.name, brand: item.brand ?? null,
      servingSizeG: item.servingSizeG, calories: item.calories,
      proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
      fiberG: item.fiberG ?? null, sugarG: item.sugarG ?? null,
      sodiumMg: item.sodiumMg ?? null, satFatG: item.satFatG ?? null,
      source: item.source, updatedAt: now,
    })
    // Same domain and same client-minted id as logFoodEntries' branch, so a replay lands in place
    // rather than duplicating.
    // todayInTz(), never the ISO string's date part — that is UTC, and it is yesterday in
    // Brisbane until 10am every day.
    await store.queueMutation({ userId, domain: 'food_items', date: todayInTz(), payload: body })
    await invalidateFoodItems()
    pushMutations(userId).catch(() => {})
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
