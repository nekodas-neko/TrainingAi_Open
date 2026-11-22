// #3749. The bundled USDA table, the resolver that reads it, and the badge computed from it.
import { describe, it, expect } from 'vitest'
import { FDC_SR_LEGACY, FDC_SR_LEGACY_ROWS } from '../food-reference/fdc-sr-legacy'
import {
  resolveIngredientDensity, applyReferenceDensities, confidenceFromMatches, confidenceAfterSanitise,
  referenceRowFor, TRUSTED_SAVED_FOOD_SOURCES, type SavedFoodForDensity,
} from '../food-reference/resolve'
import { text } from '../food-item-identity'
import { sanitiseNutrition, sumIngredients } from '../scan-totals'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

describe('the bundled table', () => {
  it('names its dataset and release', () => {
    expect(FDC_SR_LEGACY.name).toBe('USDA FoodData Central, SR Legacy')
    expect(FDC_SR_LEGACY.release).toBe('2018-04')
    expect(FDC_SR_LEGACY.licence).toMatch(/public domain/i)
  })

  it('has between 150 and 300 rows', () => {
    expect(FDC_SR_LEGACY_ROWS.length).toBeGreaterThanOrEqual(150)
    expect(FDC_SR_LEGACY_ROWS.length).toBeLessThanOrEqual(300)
  })

  it.each(FDC_SR_LEGACY_ROWS.map(r => [r.names[0], r] as const))('%s carries a source id and sane values', (_n, r) => {
    expect(Number.isInteger(r.fdcId) && r.fdcId > 0).toBe(true)
    expect(r.description.length).toBeGreaterThan(0)
    expect(r.kcal).toBeGreaterThanOrEqual(0)
    expect(r.kcal).toBeLessThanOrEqual(900)
    for (const g of [r.proteinG, r.carbsG, r.fatG]) {
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(100)
    }
    expect(r.proteinG + r.carbsG + r.fatG).toBeLessThanOrEqual(100.5)
    // Energy agrees with its own macros by 4/4/9 within 15 kcal or 25%, whichever is wider. USDA's
    // factors are food-specific, so leafy vegetables sit up to ~29% out on a few kcal; anything
    // beyond this (cocoa powder, mostly fibre, was 90% out) is a row code would contradict.
    const atwater = r.proteinG * 4 + r.carbsG * 4 + r.fatG * 9
    expect(Math.abs(r.kcal - atwater)).toBeLessThanOrEqual(Math.max(15, r.kcal * 0.25))
  })

  it('has one unique, already-folded set of names, each pointing at exactly one row', () => {
    const all = FDC_SR_LEGACY_ROWS.flatMap(r => r.names)
    expect(all.every(n => n === text(n) && n.length > 0)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(FDC_SR_LEGACY_ROWS.map(r => r.fdcId)).size).toBe(FDC_SR_LEGACY_ROWS.length)
  })

  it('gives a food whose numbers depend on its state no bare name', () => {
    for (const bare of ['rice', 'white rice', 'chicken breast', 'pasta', 'quinoa', 'salmon', 'potato', 'lentils', 'black beans', 'chickpeas']) {
      expect(referenceRowFor(bare), bare).toBeNull()
    }
    expect(referenceRowFor('white rice, cooked')?.kcal).toBeLessThan(200)
    expect(referenceRowFor('white rice, uncooked')?.kcal).toBeGreaterThan(300)
  })
})

const saved = (over: Partial<SavedFoodForDensity>): SavedFoodForDensity => ({
  id: 'food-1', name: 'Rolled oats', source: 'barcode', servingSizeG: 40,
  calories: 150, proteinG: 5, carbsG: 25, fatG: 3, ...over,
})

describe('resolveIngredientDensity', () => {
  it('prefers the user\'s own barcode-sourced food, per 100 g, over the table', () => {
    const d = resolveIngredientDensity('rolled oats', { savedFoods: [saved({})] })
    expect(d).toEqual({
      caloriesPer100g: 375, proteinPer100g: 12.5, carbsPer100g: 62.5, fatPer100g: 7.5,
      source: 'saved-food', ref: 'food-1',
    })
  })

  it('falls to the table when there is no saved food', () => {
    const row = referenceRowFor('rolled oats')!
    expect(resolveIngredientDensity('Rolled  Oats ')).toEqual({
      caloriesPer100g: row.kcal, proteinPer100g: row.proteinG, carbsPer100g: row.carbsG, fatPer100g: row.fatG,
      source: 'reference', ref: `fdc:${row.fdcId}`,
    })
  })

  it('returns null when neither knows the name', () => {
    expect(resolveIngredientDensity('dragon fruit smoothie bowl')).toBeNull()
    expect(resolveIngredientDensity('')).toBeNull()
  })

  it.each(['ai', 'manual', 'text', null, undefined, 'something-new'])('never uses a saved food whose source is %s', source => {
    const d = resolveIngredientDensity('rolled oats', { savedFoods: [saved({ source })] })
    expect(d?.source).toBe('reference')
  })

  it('trusts barcode rows only', () => {
    expect(TRUSTED_SAVED_FOOD_SOURCES).toEqual(['barcode'])
  })

  it('never takes a near match, from a saved food or the table', () => {
    const own = [saved({ name: 'Rolled oats, organic' })]
    expect(resolveIngredientDensity('rolled oats', { savedFoods: own })?.source).toBe('reference')
    for (const near of ['rolled oat', 'rolledoats', 'oats rolled', 'banana slices', 'bananna', 'chicken breast cooked', 'olive-oil']) {
      expect(resolveIngredientDensity(near), near).toBeNull()
    }
  })

  it('uses neither of two saved foods that share a name and disagree', () => {
    const own = [saved({ id: 'a' }), saved({ id: 'b', calories: 200 })]
    expect(resolveIngredientDensity('rolled oats', { savedFoods: own })?.source).toBe('reference')
    const agree = [saved({ id: 'a' }), saved({ id: 'b', servingSizeG: 80, calories: 300, proteinG: 10, carbsG: 50, fatG: 6 })]
    expect(resolveIngredientDensity('rolled oats', { savedFoods: agree })?.ref).toBe('a')
  })

  it('skips a saved food with no serving size', () => {
    expect(resolveIngredientDensity('rolled oats', { savedFoods: [saved({ servingSizeG: 0 })] })?.source).toBe('reference')
  })

  it('resolves only from the foods it is handed: another user\'s are never in that list', () => {
    // The caller's read is user-scoped (lib/data/postgres/__tests__/food-items-by-names.test.ts);
    // the resolver has no other source of saved foods.
    expect(resolveIngredientDensity('my secret blend', { savedFoods: [] })).toBeNull()
    expect(resolveIngredientDensity('my secret blend', { savedFoods: [saved({ name: 'My secret blend' })] })?.source).toBe('saved-food')
  })
})

const ing = (name: string, over: Partial<NutritionIngredient> = {}): NutritionIngredient => ({
  name, weightG: 100, caloriesPer100g: 999, proteinPer100g: 1, carbsPer100g: 1, fatPer100g: 1, ...over,
})

describe('applyReferenceDensities', () => {
  it('replaces matched numbers, keeps name and weight, and marks the rest estimated', () => {
    const out = applyReferenceDensities([ing('Banana', { weightG: 120 }), ing('mystery sauce')])
    expect(out.matched).toBe(1)
    expect(out.total).toBe(2)
    expect(out.ingredients[0]).toEqual({
      name: 'Banana', weightG: 120, caloriesPer100g: 89, proteinPer100g: 1.09, carbsPer100g: 22.8, fatPer100g: 0.33,
    })
    expect(out.ingredients[1]).toEqual({ ...ing('mystery sauce'), estimated: true })
  })

  it('drops a stale estimated mark when the food now matches', () => {
    expect(applyReferenceDensities([ing('banana', { estimated: true })]).ingredients[0].estimated).toBeUndefined()
  })

  it('gives the same food identical numbers whichever route asked, whatever the model said', () => {
    const fromScan = applyReferenceDensities([ing('olive oil', { caloriesPer100g: 800, fatPer100g: 90 })])
    const fromPlan = applyReferenceDensities([ing('Olive Oil', { caloriesPer100g: 884, fatPer100g: 100, weightG: 10 })])
    const per100 = (i: NutritionIngredient) => [i.caloriesPer100g, i.proteinPer100g, i.carbsPer100g, i.fatPer100g]
    expect(per100(fromScan.ingredients[0])).toEqual(per100(fromPlan.ingredients[0]))
  })
})

describe('the confidence badge', () => {
  it('is high when every ingredient matched, medium when some did, low when none did', () => {
    expect(confidenceFromMatches(3, 3)).toBe('high')
    expect(confidenceFromMatches(1, 3)).toBe('medium')
    expect(confidenceFromMatches(0, 3)).toBe('low')
    expect(confidenceFromMatches(0, 0)).toBe('low')
  })

  it('is low whenever sanitiseNutrition corrected something', () => {
    // 40 g of fat in a 10 g serving cannot be, and the sanitiser caps it.
    const wrong = sanitiseNutrition({ servingSizeG: 10, calories: 360, proteinG: 0, carbsG: 0, fatG: 40, confidence: 'high' })
    expect(confidenceAfterSanitise('high', wrong.confidence)).toBe('low')
    const fine = applyReferenceDensities([ing('banana')])
    const t = sumIngredients(fine.ingredients)
    const clean = sanitiseNutrition({ ...t, confidence: 'high' })
    expect(confidenceAfterSanitise('high', clean.confidence)).toBe('high')
  })
})
