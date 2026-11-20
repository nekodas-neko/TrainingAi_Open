import { describe, expect, it } from 'vitest'
import { sharedIngredientToEntry } from '../shared-meal-entry'

/**
 * The per-ingredient arithmetic both apps use when they copy a shared meal into the copier's own
 * library (a scanned label in the current app, a friend's meal in Preview, #2218). It lives here once;
 * the current app's round-trip test exercises it through the whole scan path.
 */
describe('sharedIngredientToEntry', () => {
  it('stores per 100 g and carries the weight in the multiplier', () => {
    const { item, quantityMultiplier } = sharedIngredientToEntry({
      name: 'Beef mince', weightG: 600, calories: 1302, proteinG: 120.6, carbsG: 0, fatG: 91.2,
    })
    expect(item).toMatchObject({ name: 'Beef mince', servingSizeG: 100, calories: 217, source: 'manual' })
    expect(item.proteinG).toBeCloseTo(20.1, 1)
    expect(item.fatG).toBeCloseTo(15.2, 1)
    expect(quantityMultiplier).toBe(6)
  })

  it('keeps a zero-weight ingredient as one serving so its macros stay in the total', () => {
    const { item, quantityMultiplier } = sharedIngredientToEntry({
      name: 'Basil', weightG: 0, calories: 2, proteinG: 0.2, carbsG: 0.2, fatG: 0,
    })
    expect(item).toMatchObject({ servingSizeG: 100, calories: 2, proteinG: 0.2 })
    expect(quantityMultiplier).toBe(1)
  })

  it('floors a sub-gram multiplier at the saved-meal minimum', () => {
    expect(sharedIngredientToEntry({
      name: 'Salt', weightG: 1, calories: 0, proteinG: 0, carbsG: 0, fatG: 0,
    }).quantityMultiplier).toBe(0.01)
  })

  it('gives the same totals back to within the per-100 g rounding', () => {
    const ing = { name: 'Rice', weightG: 237, calories: 308, proteinG: 6.4, carbsG: 67.9, fatG: 0.7 }
    const { item, quantityMultiplier: q } = sharedIngredientToEntry(ing)
    expect(item.calories * q / ing.calories).toBeGreaterThan(0.99)
    expect(item.calories * q / ing.calories).toBeLessThan(1.01)
    expect(Math.abs(item.carbsG * q - ing.carbsG)).toBeLessThan(0.5)
  })
})
