import type { FoodItem, NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { getLocalStore } from '@/lib/local-store'

/**
 * LB-158 — resolving a scanned barcode, the user's own library first.
 *
 * Both scanners (`capture-actions.tsx` and `ingredient-picker.tsx`) went straight to
 * `/api/nutrition/barcode`, so re-scanning a tin already in the library was another Open Food
 * Facts round trip — and offline it was nothing at all, on a screen whose whole point is that it
 * works offline. The library could not answer because `food_items.barcode` never reached the
 * device; it now does, and this is the read that uses it.
 *
 * Shared rather than written twice: the two callers already handled `unavailable`/`notFound`
 * differently from each other in ways that were about presentation, and the sibling-surface rule
 * is what this file is. `error` is separate from `unavailable` for the reason the route draws
 * that line — a database that is down is not a product that does not exist.
 */
export type BarcodeLookup =
  | {
      kind: 'found'
      result: NutritionScanResult
      /**
       * The stored row, when the answer came from the library. A caller that would otherwise
       * create a food item should reuse this one instead: the id is what its logs already point
       * at, and re-creating would lean on BF-38's duplicate check to undo the duplicate.
       */
      localItem: FoodItem | null
    }
  | { kind: 'notFound' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

/** A saved food rendered as though the lookup had just returned it. */
export function foodItemToScanResult(item: FoodItem): NutritionScanResult {
  return {
    name: item.name,
    brand: item.brand,
    servingSizeG: item.servingSizeG,
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
    fiberG: item.fiberG,
    sugarG: item.sugarG,
    sodiumMg: item.sodiumMg,
    satFatG: item.satFatG,
    // The numbers are the ones the user already accepted and may have corrected by hand, so this
    // is the most confident answer there is — more so than the lookup that first supplied them.
    confidence: 'high',
    notes: 'From your saved foods',
    origin: 'barcode',
    barcode: item.barcode,
    // No picture: the local read drops `image_data_uri` on purpose (LA-36), and the stored row
    // keeps whichever one it was created with either way.
    imageDataUri: null,
  }
}

export async function lookupBarcode(code: string, userId?: string): Promise<BarcodeLookup> {
  const store = userId ? getLocalStore(userId) : null
  if (store) {
    const saved = await store.getFoodItemByBarcode(code)
    if (saved) return { kind: 'found', result: foodItemToScanResult(saved), localItem: saved }
  }

  try {
    const res = await fetch(`/api/nutrition/barcode?code=${encodeURIComponent(code)}`)
    const data = await res.json()
    if (data.unavailable) return { kind: 'unavailable' }
    if (!res.ok) return data.notFound ? { kind: 'notFound' } : { kind: 'error' }
    if (data.notFound) return { kind: 'notFound' }
    return { kind: 'found', result: data as NutritionScanResult, localItem: null }
  } catch {
    // Offline, or the request never completed. Not `unavailable`, which means the food database
    // answered and said it was struggling — this one is us.
    return { kind: 'error' }
  }
}
