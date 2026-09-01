import type { FoodLogWithItem, NutritionIngredient, NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { cancelMealReminder } from '@/lib/meal-reminders'
import { invalidateNutritionWrite } from '@/lib/cache-groups'
import { resolveLocalEatenAt } from './local-eaten-at'
import { normalizeMealGroupName } from './meal-group-name'
import { DEFAULT_TZ } from '../date-utils'

/**
 * A single food entry to log. When `foodItemId` is present the item already
 * exists (e.g. picked from the library) and is not recreated; otherwise a new
 * food item is created from these fields.
 */
/**
 * How the food was identified → the `source` a `food_items` row records.
 *
 * `'search'` maps to `'ai'` only because the column has no value for an Open Food Facts text
 * lookup, and adding one is a migration. That is a wrong label this change does not fix, not a
 * chosen one — BF-70's follow-up. `'barcode'` is the value BF-70 exists to start writing: it was
 * essentially never stored, which is why BF-38 measured 3 of 221 rows carrying it.
 */
export function scanOriginToSource(
  origin: 'barcode' | 'search' | 'photo' | undefined,
  confidence: string | undefined,
): NewFoodEntry['source'] {
  if (origin === 'barcode') return 'barcode'
  if (origin === 'photo' || origin === 'search') return 'ai'
  // No origin: a hand-typed entry, or a result from a producer that predates the field. Fall back
  // to the old rule so an unknown producer behaves exactly as it did before.
  return confidence ? 'ai' : 'manual'
}

export interface NewFoodEntry {
  foodItemId?: string
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
  source: 'ai' | 'manual' | 'barcode' | 'text'
  quantityMultiplier: number
  /** BF-35's thumbnail, when the entry came from a lookup that carried one (BF-70). */
  imageDataUri?: string | null
}

function r1(n: number) { return Math.round(n * 10) / 10 }

/** Split a multi-ingredient meal into one entry per component with its own macros. */
export function ingredientsToEntries(
  ings: NutritionIngredient[],
  quantity: number,
  source: NewFoodEntry['source'] = 'ai',
): NewFoodEntry[] {
  return ings.map(ing => {
    const scale = ing.weightG / 100
    return {
      name: ing.name,
      servingSizeG: Math.round(ing.weightG),
      calories: Math.round(ing.caloriesPer100g * scale),
      proteinG: r1(ing.proteinPer100g * scale),
      carbsG: r1(ing.carbsPer100g * scale),
      fatG: r1(ing.fatPer100g * scale),
      source,
      quantityMultiplier: quantity,
    }
  })
}

// Totals that equal the sum of the individually-logged per-ingredient entries
// (see ingredientsToEntries) — the single shared source for a multi-ingredient
// preview, so it never drifts from what actually gets logged (One Formula, One
// Place). Not the same as scan-totals.ts's sumIngredients, which uses a
// sum-then-Atwater-cross-check and is the authority only for the single-item
// scan sanitisation path, not this per-ingredient preview/log path.
export function sumIngredientEntries(ings: NutritionIngredient[], quantity = 1): {
  servingSizeG: number; calories: number; proteinG: number; carbsG: number; fatG: number
} {
  return ingredientsToEntries(ings, quantity).reduce(
    (acc, e) => ({
      servingSizeG: acc.servingSizeG + e.servingSizeG,
      calories: acc.calories + e.calories,
      proteinG: r1(acc.proteinG + e.proteinG),
      carbsG:   r1(acc.carbsG   + e.carbsG),
      fatG:     r1(acc.fatG     + e.fatG),
    }),
    { servingSizeG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}

/**
 * Turn a scan result into loggable entries. Multi-ingredient meals are broken
 * into their components so each is logged (and adjustable) individually; simple
 * single foods stay as one entry.
 */
export function scanResultToEntries(result: NutritionScanResult, quantity: number): NewFoodEntry[] {
  if (result.ingredients && result.ingredients.length > 1) {
    return ingredientsToEntries(result.ingredients, quantity)
  }
  return [{
    name: result.name,
    brand: result.brand || undefined,
    servingSizeG: result.servingSizeG,
    calories: result.calories,
    proteinG: result.proteinG,
    carbsG: result.carbsG,
    fatG: result.fatG,
    fiberG: result.fiberG,
    sugarG: result.sugarG,
    sodiumMg: result.sodiumMg,
    satFatG: result.satFatG,
    source: 'ai',
    quantityMultiplier: quantity,
  }]
}

async function createFoodItem(entry: NewFoodEntry): Promise<string> {
  const res = await fetch('/api/nutrition/food-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: entry.name,
      brand: entry.brand || undefined,
      servingSizeG: entry.servingSizeG,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      fiberG: entry.fiberG,
      sugarG: entry.sugarG,
      sodiumMg: entry.sodiumMg,
      satFatG: entry.satFatG,
      source: entry.source,
      // BF-70. The fifth layer in the chain, and the one its entry did not enumerate: the route has
      // accepted and stored `imageDataUri` since BF-35, so omitting it here dropped the picture on
      // the WEB path even once the local path carried it.
      imageDataUri: entry.imageDataUri ?? undefined,
    }),
  })
  if (!res.ok) throw new Error('Failed to create food item')
  const item = await res.json()
  return item.id as string
}

interface LogShape {
  id: string
  userId: string
  date: string
  mealTypeId: string
  foodItemId: string
  quantityMultiplier: number
  loggedAt: string
  mealGroupId?: string | null
  mealGroupName?: string | null
}

function toWithItem(entry: NewFoodEntry, log: LogShape): FoodLogWithItem {
  const q = log.quantityMultiplier
  return {
    id: log.id,
    userId: log.userId,
    date: log.date,
    mealTypeId: log.mealTypeId,
    foodItemId: log.foodItemId,
    quantityMultiplier: q,
    loggedAt: new Date(log.loggedAt),
    // BF-97. The optimistic row carries the grouping, or the diary draws the scan flat until the
    // next read — which is the whole reported symptom, just for a few seconds.
    mealGroupId: log.mealGroupId ?? null,
    mealGroupName: log.mealGroupName ?? null,
    foodItem: {
      id: log.foodItemId,
      userId: log.userId,
      name: entry.name,
      brand: entry.brand || undefined,
      servingSizeG: entry.servingSizeG,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      fiberG: entry.fiberG || undefined,
      sugarG: entry.sugarG || undefined,
      sodiumMg: entry.sodiumMg || undefined,
      satFatG: entry.satFatG || undefined,
      source: entry.source,
      region: '',
      createdAt: new Date(log.loggedAt),
    },
    calories: Math.round(entry.calories * q),
    proteinG: r1(entry.proteinG * q),
    carbsG: r1(entry.carbsG * q),
    fatG: r1(entry.fatG * q),
  }
}

/**
 * Log one or more food entries to a meal. Each entry becomes its own food item
 * (unless it already has a `foodItemId`) and its own food log, so multi-item
 * meals appear as separate, individually-editable rows. Uses the offline-first
 * local store when available and falls back to the API otherwise. Returns the
 * optimistic log entries for immediate UI updates.
 *
 * **`groupName` is what makes a multi-item scan one diary row (BF-97).** BF-39 shipped grouping for
 * saved meals, where the name comes from the meal; a scan has no saved meal — deliberately, since
 * creating one would put a row in the user's library to satisfy a display rule — so it supplies its
 * own name and the group is minted here.
 */
export async function logFoodEntries(
  entries: NewFoodEntry[],
  date: string,
  mealTypeId: string,
  userId?: string,
  tz: string = DEFAULT_TZ,
  groupName?: string | null,
): Promise<FoodLogWithItem[]> {
  const store = userId ? getLocalStore(userId) : null
  const now = new Date().toISOString()
  const optimistic: FoodLogWithItem[] = []

  // A group of one buys nothing — `groupDiaryEntries` collapses it back to a plain row — so a
  // single entry mints no id, and neither does a batch with nothing to head it with. Minting only
  // alongside a name is what keeps the diary's own rule true: it never has to head a group it
  // cannot name.
  const mealGroupName = entries.length > 1 ? normalizeMealGroupName(groupName) : null
  const mealGroupId = mealGroupName ? crypto.randomUUID() : null

  if (store) {
    try {
      // When the food was EATEN, which is not when this ran if the user is back-filling a day
      // (Q-413). `now` stays the write clock — `updated_at` is a sync cursor and must keep meaning
      // "when this row changed".
      const eatenAt = await resolveLocalEatenAt(store, mealTypeId, date, new Date(now), tz)
      // Mint the food-item id client-side instead of awaiting the create POST —
      // offline, that POST throws and the whole log is lost (SYNC-O2). The item
      // is created server-side via its own outbox mutation, queued before the
      // food_logs mutation so the push order matches the FK dependency.
      const resolved = entries.map(entry => ({
        entry,
        foodItemId: entry.foodItemId ?? crypto.randomUUID(),
        isNew: !entry.foodItemId,
      }))
      for (const { entry, foodItemId, isNew } of resolved) {
        // Mirror the item locally so the offline read path can render this log
        // (name + macros) without a server round-trip.
        await store.upsertFoodItem({
          id: foodItemId, name: entry.name, brand: entry.brand ?? null,
          servingSizeG: entry.servingSizeG, calories: entry.calories,
          proteinG: entry.proteinG, carbsG: entry.carbsG, fatG: entry.fatG,
          fiberG: entry.fiberG ?? null, sugarG: entry.sugarG ?? null,
          sodiumMg: entry.sodiumMg ?? null, satFatG: entry.satFatG ?? null,
          // BF-35/BF-70. A barcode or search lookup carries a thumbnail; a typed entry does not,
          // and absent stays absent rather than becoming a placeholder written into the row.
          source: entry.source, imageDataUri: entry.imageDataUri ?? null, updatedAt: now,
        })
        if (isNew) {
          await store.queueMutation({
            userId: userId!,
            domain: 'food_items',
            date,
            payload: {
              id: foodItemId, name: entry.name, brand: entry.brand,
              servingSizeG: entry.servingSizeG, calories: entry.calories,
              proteinG: entry.proteinG, carbsG: entry.carbsG, fatG: entry.fatG,
              fiberG: entry.fiberG, sugarG: entry.sugarG,
              sodiumMg: entry.sodiumMg, satFatG: entry.satFatG, source: entry.source,
            },
          })
        }
        const logId = crypto.randomUUID()
        await store.upsertFoodLog({
          id: logId, date, mealTypeId, foodItemId,
          mealGroupId, mealGroupName,
          quantityMultiplier: entry.quantityMultiplier,
          loggedAt: eatenAt, updatedAt: now, deletedAt: null, syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'food_logs',
          date,
          // The outbox payload carries every field the web route accepts, per the offline-sync rule
          // — a field added to the route and not to this payload is a field the APK cannot write.
          payload: { id: logId, mealTypeId, foodItemId, quantityMultiplier: entry.quantityMultiplier, loggedAt: eatenAt, mealGroupId, mealGroupName },
        })
        optimistic.push(toWithItem(entry, { id: logId, userId: userId!, date, mealTypeId, foodItemId, quantityMultiplier: entry.quantityMultiplier, loggedAt: eatenAt, mealGroupId, mealGroupName }))
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

  // Web fallback: serial fetches with rollback on failure. Resolves food-item
  // ids via the create POST (dev-DB/web-only path — has no offline requirement).
  const resolved = await Promise.all(entries.map(async (entry) => ({
    entry,
    foodItemId: entry.foodItemId ?? (await createFoodItem(entry)),
  })))
  const createdIds: string[] = []
  try {
    for (const { entry, foodItemId } of resolved) {
      const res = await fetch('/api/nutrition/food-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mealTypeId, foodItemId, quantityMultiplier: entry.quantityMultiplier, mealGroupId, mealGroupName }),
      })
      if (!res.ok) throw new Error('Failed to log item')
      const log = await res.json()
      createdIds.push(log.id)
      optimistic.push(toWithItem(entry, {
        id: log.id, userId: log.userId ?? '', date, mealTypeId, foodItemId,
        quantityMultiplier: log.quantityMultiplier ?? entry.quantityMultiplier,
        loggedAt: log.loggedAt ?? now,
        mealGroupId, mealGroupName,
      }))
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
