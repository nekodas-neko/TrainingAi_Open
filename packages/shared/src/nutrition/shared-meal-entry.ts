import type { SharedMealIngredient } from './label-payload'
import { QUANTITY_MULTIPLIER_MIN } from './quantity-bounds'

/**
 * A shared ingredient as the food the copy mints. Hand-entered (`'manual'`), so the sanitiser keeps
 * the values as given rather than repairing them as it would a scan.
 */
export interface SharedIngredientFood {
  name: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  source: 'manual'
}

/**
 * One shared ingredient as a per-100 g food item plus the multiplier that restores its weight.
 *
 * Lives here, once, for both apps: the current app's scan copy (`saveSharedMealToLibrary`) and
 * Preview's copy of a friend's meal both call it, so the arithmetic cannot drift between them. It
 * is the part that can be wrong in a way nothing visible catches: a copied meal whose macros are
 * off by a factor of the ingredient's weight still renders, still logs, and is simply untrue.
 *
 * Per-100 g is the basis every other food item is stored on, and it is what lets the duplicate
 * check find the chicken breast already in the copier's library instead of minting a second row.
 */
export function sharedIngredientToEntry(ing: SharedMealIngredient): {
  item: SharedIngredientFood
  quantityMultiplier: number
} {
  // A weight of zero cannot be normalised, and the encoder can emit one: `weightG` is rounded, so a
  // sub-gram garnish arrives as 0. Storing it as a single 1× serving keeps its macros — which is
  // what the totals depend on — rather than dividing by zero and writing NaN into the library.
  if (ing.weightG <= 0) {
    return {
      item: {
        name: ing.name, servingSizeG: 100, source: 'manual',
        calories: Math.round(ing.calories), proteinG: ing.proteinG, carbsG: ing.carbsG, fatG: ing.fatG,
      },
      quantityMultiplier: 1,
    }
  }
  const per100 = (v: number) => Math.round((v / ing.weightG) * 100 * 10) / 10
  return {
    item: {
      name: ing.name,
      servingSizeG: 100,
      calories: Math.round((ing.calories / ing.weightG) * 100),
      proteinG: per100(ing.proteinG),
      carbsG: per100(ing.carbsG),
      fatG: per100(ing.fatG),
      source: 'manual',
    },
    // The saved-meal schema floors a multiplier at 0.01, and a 0.5 g pinch rounds to 0.00 two
    // decimals in — which would drop it from the meal entirely.
    quantityMultiplier: Math.max(QUANTITY_MULTIPLIER_MIN, Math.round((ing.weightG / 100) * 100) / 100),
  }
}
