import { describe, it, expect } from 'vitest'
import { fitDistance, mealFit, TOP_UP_MIN_IMPROVEMENT } from '../meal-macro-fit'
import { scaleIngredientsToTargets, dominantMacro } from '../meal-split'
import { sumIngredients } from '../scan-totals'
import type { NutritionIngredient } from '../../types/nutrition'

/**
 * `fitDistance` is the tie-breaker the meal top-up uses to decide whether an AI suggestion actually
 * helped. If it were wrong, a plausible-but-useless addition would be kept purely because it was
 * asked for.
 */

const TARGET = { calories: 618, proteinG: 38, carbsG: 83, fatG: 15 }

describe('fitDistance', () => {
  it('is zero for an exact match', () => {
    expect(fitDistance({ calories: 618, proteinG: 38, carbsG: 83, fatG: 15 }, TARGET)).toBe(0)
  })

  it('grows as the miss grows', () => {
    const near = fitDistance({ calories: 600, proteinG: 36, carbsG: 80, fatG: 14 }, TARGET)
    const far = fitDistance({ calories: 300, proteinG: 20, carbsG: 30, fatG: 5 }, TARGET)
    expect(far).toBeGreaterThan(near)
  })

  // Relative, not absolute: the same gram gap matters more against a small target.
  it('weights a miss against the size of its target', () => {
    const fatMiss = fitDistance({ calories: 618, proteinG: 38, carbsG: 83, fatG: 5 }, TARGET)
    const carbMiss = fitDistance({ calories: 618, proteinG: 38, carbsG: 73, fatG: 15 }, TARGET)
    expect(fatMiss).toBeGreaterThan(carbMiss)
  })

  // Calories are a function of the macros; counting them too would double-weight the worst miss.
  it('ignores calories', () => {
    const a = fitDistance({ calories: 618, proteinG: 38, carbsG: 83, fatG: 15 }, TARGET)
    const b = fitDistance({ calories: 1, proteinG: 38, carbsG: 83, fatG: 15 }, TARGET)
    expect(a).toBe(b)
  })
})

describe('the gap the top-up exists to close', () => {
  // The owner's real case: a protein ice cream in a carb-heavy slot. Its only carb source is milk,
  // so reaching the target needs more than the clamp allows.
  const iceCream: NutritionIngredient[] = [
    { name: 'Full cream milk', weightG: 300, caloriesPer100g: 62, proteinPer100g: 3.4, carbsPer100g: 4.4, fatPer100g: 3.4 },
    { name: 'Whey protein isolate', weightG: 60, caloriesPer100g: 383, proteinPer100g: 88, carbsPer100g: 3.3, fatPer100g: 1 },
  ]

  it('cannot reach the carb target by scaling alone', () => {
    const scaled = scaleIngredientsToTargets(iceCream, TARGET) as NutritionIngredient[]
    const fit = mealFit(sumIngredients(scaled), TARGET)
    expect(fit.carbs.status).toBe('under')
    expect(fit.allOnTarget).toBe(false)
  })

  // The mechanism, measured rather than assumed — and it is worse than "the clamp stopped it".
  // Full cream milk is 31 kcal of fat against 18 of carbohydrate per 100 g, and its protein share
  // is 22% (under PROTEIN_SHARE_THRESHOLD), so the scaler files it under FAT. The meal therefore
  // has no carb source at all: the carb group is empty, and no scale factor of any size can move
  // carbohydrate. That is why the answer has to be adding food rather than widening the clamp.
  it('has no carb source at all — the carb group is empty, so no factor can help', () => {
    expect(dominantMacro(iceCream[0])).toBe('fat')
    expect(dominantMacro(iceCream[1])).toBe('protein')
    expect(iceCream.some(i => dominantMacro(i) === 'carbs')).toBe(false)

    // Doubling the carb target changes nothing, which an unreachable-by-clamp meal would not do.
    const a = sumIngredients(scaleIngredientsToTargets(iceCream, TARGET) as NutritionIngredient[])
    const b = sumIngredients(scaleIngredientsToTargets(iceCream, { ...TARGET, carbsG: 166 }) as NutritionIngredient[])
    expect(b.carbsG).toBeCloseTo(a.carbsG, 1)
  })

  it('closes once a carb source is added, which is what the top-up asks for', () => {
    const withOats: NutritionIngredient[] = [
      ...iceCream,
      { name: 'Rolled oats', weightG: 60, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 8 },
    ]
    const before = fitDistance(sumIngredients(scaleIngredientsToTargets(iceCream, TARGET) as NutritionIngredient[]), TARGET)
    const after = fitDistance(sumIngredients(scaleIngredientsToTargets(withOats, TARGET) as NutritionIngredient[]), TARGET)
    expect(after).toBeLessThan(before)
  })

  // The guard that makes the whole feature safe. Celery IS a carb source, so it nudges the fit —
  // by 0.4%, measured. A bare "is it better?" comparison would keep it and put celery in an ice
  // cream, which is why the top-up demands a MEANINGFUL improvement rather than any improvement.
  it('a token addition improves the fit only trivially, below the acceptance threshold', () => {
    const withCelery: NutritionIngredient[] = [
      ...iceCream,
      { name: 'Celery', weightG: 40, caloriesPer100g: 14, proteinPer100g: 0.7, carbsPer100g: 3, fatPer100g: 0.2 },
    ]
    const before = fitDistance(sumIngredients(scaleIngredientsToTargets(iceCream, TARGET) as NutritionIngredient[]), TARGET)
    const after = fitDistance(sumIngredients(scaleIngredientsToTargets(withCelery, TARGET) as NutritionIngredient[]), TARGET)
    expect(after).toBeLessThan(before)                              // it does help, fractionally
    expect(after).toBeGreaterThan(before * (1 - TOP_UP_MIN_IMPROVEMENT))  // but not enough to keep
  })

  it('a real carb source clears the acceptance threshold comfortably', () => {
    const withOats: NutritionIngredient[] = [
      ...iceCream,
      { name: 'Rolled oats', weightG: 60, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 8 },
    ]
    const before = fitDistance(sumIngredients(scaleIngredientsToTargets(iceCream, TARGET) as NutritionIngredient[]), TARGET)
    const after = fitDistance(sumIngredients(scaleIngredientsToTargets(withOats, TARGET) as NutritionIngredient[]), TARGET)
    expect(after).toBeLessThan(before * (1 - TOP_UP_MIN_IMPROVEMENT))
  })
})
