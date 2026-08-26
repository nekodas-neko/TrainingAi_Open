import { describe, it, expect } from 'vitest'
import type { NutritionIngredient, SavedMeal, SavedMealItem } from '@trainingai/shared/types/nutrition'
import { perServing } from '@trainingai/shared/nutrition/scan-totals'
import { ingredientToEntry } from '@trainingai/shared/nutrition/log-plan-meal'
import { oneServingItems } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { recipeBuilderPatch } from '../recipe-import'

/**
 * Importing a recipe must divide it ONCE (BF-11c).
 *
 * `/api/nutrition/scan` already applies `perServing` before it answers, so a page stating "makes 12"
 * comes back as one slice rather than the loaf. The builder therefore saves the import with
 * `servings: 1`. Setting `servings: 12` on top — which is what BF-11c's own entry asked for, written
 * when it was believed the route returned the whole batch — makes `oneServingItems` divide a second
 * time and logs a twelfth of a slice.
 *
 * This is pinned as a test rather than a comment because the two divides live in different files
 * and neither one is wrong on its own. The failure is silent: a plausible-looking number, twelve
 * times too small.
 */

const YIELD = 12

/** A loaf: one ingredient, 1,200 g of it, 163 kcal per 100 g ≈ 1,956 kcal for the batch. */
const LOAF: NutritionIngredient[] = [
  { name: 'Banana bread', weightG: 1200, caloriesPer100g: 163, proteinPer100g: 4, carbsPer100g: 28, fatPer100g: 5 },
]

/** What the route hands the client: the batch, already divided by the stated yield. */
const asScanned = perServing(LOAF, YIELD)

function savedMealFrom(ingredients: NutritionIngredient[], servings: number): SavedMeal {
  const items = ingredients.map((ing, i) => {
    const entry = ingredientToEntry(ing)
    return {
      id: `item-${i}`,
      savedMealId: 'meal',
      foodItemId: `food-${i}`,
      quantityMultiplier: Math.max(0.01, entry.quantityMultiplier),
    } as SavedMealItem
  })
  return { id: 'meal', name: 'Banana bread', servings, items } as SavedMeal
}

describe('a recipe import is divided once, not twice', () => {
  it('the route has already divided, so what arrives is one serving', () => {
    // 1200 g / 12 = 100 g. If this ever stops holding, the builder's `servings: 1` stops being right.
    expect(asScanned[0].weightG).toBe(100)
  })

  it('saved at servings: 1, logging it takes the slice the scan described', () => {
    const meal = savedMealFrom(asScanned, 1)
    // 100 g stored per 100 g ⇒ a multiplier of exactly 1.
    expect(oneServingItems(meal)[0].quantityMultiplier).toBeCloseTo(1, 5)
  })

  it('saved at servings: 12 — the encoding the entry asked for — logs a twelfth of a slice', () => {
    const wrong = savedMealFrom(asScanned, YIELD)
    expect(oneServingItems(wrong)[0].quantityMultiplier).toBeCloseTo(1 / YIELD, 5)
    // Stated as the ratio rather than the value, because the point is the factor, not the number.
    const right = oneServingItems(savedMealFrom(asScanned, 1))[0].quantityMultiplier
    expect(right / oneServingItems(wrong)[0].quantityMultiplier).toBeCloseTo(YIELD, 5)
  })

  it('the builder never adopts the stated yield as its batch size', () => {
    // The guard on the real code path: this is the decision `importRecipe` makes, and re-adding
    // `setMealServings(recipeYield)` is what this exists to catch.
    expect(recipeBuilderPatch({ name: 'Banana bread', recipeYield: YIELD }, '').servings).toBe(1)
    expect(recipeBuilderPatch({ name: 'Banana bread', recipeYield: null }, '').servings).toBe(1)
  })

  it('only an unstated yield raises the prompt', () => {
    expect(recipeBuilderPatch({ name: 'x', recipeYield: null }, '').unstatedYield).toBe(true)
    expect(recipeBuilderPatch({ name: 'x', recipeYield: YIELD }, '').unstatedYield).toBe(false)
    // A yield of 1 is a stated yield: the page said it serves one, and nothing needs asking.
    expect(recipeBuilderPatch({ name: 'x', recipeYield: 1 }, '').unstatedYield).toBe(false)
  })

  it('a link pasted into a meal you have already named does not rename it', () => {
    expect(recipeBuilderPatch({ name: 'Site name', recipeYield: 4 }, 'My loaf').name).toBe('My loaf')
    expect(recipeBuilderPatch({ name: 'Site name', recipeYield: 4 }, '   ').name).toBe('Site name')
  })

  it('an unstated yield is NOT divided by the route, so those ingredients are the whole batch', () => {
    // `recipeYield: null` makes the route's divisor 1, and `perServing` returns its input untouched.
    expect(perServing(LOAF, 1)[0].weightG).toBe(1200)
    // Which is why the builder prompts instead of saving it as one portion: left at servings: 1 this
    // meal logs the entire loaf.
    const meal = savedMealFrom(perServing(LOAF, 1), 1)
    expect(oneServingItems(meal)[0].quantityMultiplier).toBeCloseTo(12, 5)
  })
})
