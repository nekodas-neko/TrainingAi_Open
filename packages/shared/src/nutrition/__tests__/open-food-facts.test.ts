import { describe, it, expect } from 'vitest'
import { servingSizeGrams, offProductToNutrition } from '../open-food-facts'

describe('servingSizeGrams', () => {
  it('reads a plain gram serving', () => {
    expect(servingSizeGrams('40g')).toBe(40)
    expect(servingSizeGrams('40 g')).toBe(40)
    expect(servingSizeGrams('37.5 g')).toBe(37.5)
    expect(servingSizeGrams('37,5 g')).toBe(37.5)
  })

  it('reads grams out of a described serving', () => {
    expect(servingSizeGrams('1 bar (40g)')).toBe(40)
    expect(servingSizeGrams('2 biscuits - 30 grams')).toBe(30)
  })

  it('treats a millilitre serving as the same number of grams', () => {
    expect(servingSizeGrams('250 ml')).toBe(250)
    expect(servingSizeGrams('1 glass (200ml)')).toBe(200)
  })

  // The regression this parser was tightened for: the "g" of "glass" used to match, so the serving
  // became one gram and every macro read a hundredth of its real value.
  it('does not read a unit out of a word that merely starts with it', () => {
    expect(servingSizeGrams('1 glass')).toBe(100)
    expect(servingSizeGrams('1 mug')).toBe(100)
    expect(servingSizeGrams('1 portion')).toBe(100)
  })

  it('falls back to 100 g when there is nothing to read', () => {
    expect(servingSizeGrams(undefined)).toBe(100)
    expect(servingSizeGrams('')).toBe(100)
  })
})

describe('offProductToNutrition', () => {
  it('prefers the per-serving figures when OFF supplies them', () => {
    const r = offProductToNutrition({
      product_name: 'Quaker Oats', brands: 'Quaker', serving_size: '40 g',
      nutriments: {
        'energy-kcal_serving': 150, 'energy-kcal_100g': 375,
        'proteins_serving': 5, 'carbohydrates_serving': 27, 'fat_serving': 3,
      },
    })
    expect(r).not.toBeNull()
    expect(r!.calories).toBe(150)
    expect(r!.proteinG).toBe(5)
    expect(r!.servingSizeG).toBe(40)
  })

  it('scales the per-100 g figures when there are no per-serving ones', () => {
    const r = offProductToNutrition({
      product_name: 'Rice', serving_size: '50 g',
      nutriments: { 'energy-kcal_100g': 360, 'proteins_100g': 7, 'carbohydrates_100g': 80, 'fat_100g': 1 },
    })
    expect(r!.calories).toBe(180)
    expect(r!.proteinG).toBe(3.5)
    expect(r!.carbsG).toBe(40)
  })

  // A zero-calorie ingredient poisons every total it lands in, and OFF is full of name-only entries.
  it('rejects a product with no usable energy value', () => {
    expect(offProductToNutrition({ product_name: 'Mystery', nutriments: {} })).toBeNull()
    expect(offProductToNutrition({ product_name: 'Mystery' })).toBeNull()
  })
})

// LB-15 — `offProductToNutrition` returning null is how the caller learns the barcode DID NOT
// RESOLVE, and the guard used to be `if (!(calories > 0)) return null`. `perServing` returns 0 for a
// missing field, so a genuinely calorie-free product was indistinguishable from an unknown barcode
// and the scanner reported the user's real, scannable product as "not found".
//
// Filed from LA-30's sibling sweep and marked "read from source, not reproduced" — these are the
// two fixtures its verification section asked for, plus the edges around them.
describe('offProductToNutrition — a calorie-free product is not a missing one (LB-15)', () => {
  const product = (nutriments: Record<string, number | undefined>) => ({
    product_name: 'Sparkling Water', brands: 'Test', serving_size: '250 ml', nutriments,
  })

  it('resolves a product whose energy is present and zero', () => {
    const out = offProductToNutrition(product({ 'energy-kcal_100g': 0 }))
    expect(out).not.toBeNull()
    expect(out!.calories).toBe(0)
    expect(out!.name).toBe('Sparkling Water')
  })

  it('resolves when the zero arrives per serving rather than per 100 g', () => {
    const out = offProductToNutrition(product({ 'energy-kcal_serving': 0 }))
    expect(out).not.toBeNull()
    expect(out!.calories).toBe(0)
  })

  // The behaviour the guard exists for, and it must survive the fix: OFF is full of entries that
  // are a name and nothing else.
  it('still returns null when no energy field is present at all', () => {
    expect(offProductToNutrition(product({}))).toBeNull()
    expect(offProductToNutrition(product({ proteinG: 3 } as never))).toBeNull()
  })

  it('still resolves an ordinary product with real energy', () => {
    const out = offProductToNutrition(product({ 'energy-kcal_100g': 200 }))
    expect(out).not.toBeNull()
    expect(out!.calories).toBe(500) // 200 per 100 g at a 250 ml serving
  })

  // A negative energy is corrupt rather than calorie-free. The old `> 0` test rejected it as a side
  // effect; the fix keeps that deliberately rather than dropping it along with the zero case.
  it('returns null for a negative energy', () => {
    expect(offProductToNutrition(product({ 'energy-kcal_100g': -50 }))).toBeNull()
  })
})
