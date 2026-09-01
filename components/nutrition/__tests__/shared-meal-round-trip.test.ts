import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createFoodItemMock, saveMealToLibraryMock } = vi.hoisted(() => ({
  createFoodItemMock: vi.fn(),
  saveMealToLibraryMock: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('@trainingai/shared/nutrition/create-food-item', () => ({ createFoodItem: createFoodItemMock }))
vi.mock('../save-meal', () => ({ saveMealToLibrary: saveMealToLibraryMock }))

import { encodeSharedMeal, decodeSharedMeal } from '@trainingai/shared/nutrition/label-payload'
import type { SharedMeal, SharedMealIngredient } from '@trainingai/shared/nutrition/label-payload'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { saveSharedMealToLibrary, sharedIngredientToEntry, sharedMealTotals } from '../save-shared-meal'

function food(name: string, servingSizeG: number, calories: number, p: number, c: number, f: number) {
  return { id: `f-${name}`, name, servingSizeG, calories, proteinG: p, carbsG: c, fatG: f, source: 'manual' }
}

/** A four-ingredient batch, deliberately with fractional macros and a repeated food. */
function meal(): SavedMeal {
  return {
    id: 'm1', name: 'Beef Pasta Bake', servings: 4,
    items: [
      { quantityMultiplier: 6, foodItem: food('Beef mince', 100, 217, 20.1, 0, 15.2) },
      { quantityMultiplier: 3.5, foodItem: food('Pasta', 100, 351, 12.4, 71.3, 1.5) },
      { quantityMultiplier: 2, foodItem: food('Passata', 100, 34, 1.5, 6.2, 0.2) },
      { quantityMultiplier: 1.2, foodItem: food('Cheddar', 100, 402, 24.9, 1.3, 33.1) },
    ],
  } as unknown as SavedMeal
}

/**
 * BF-57 — a label handed to someone else has to arrive as the same meal.
 *
 * The chain is long and every link rounds: `encodeSharedMeal` rounds grams and calories to whole
 * numbers and macros to one decimal, `decodeSharedMeal` parses that back, and
 * `saveSharedMealToLibrary` then divides by weight to store per-100 g items and multiplies the
 * weight back in as a quantity. **Each step is individually plausible and the composition is where
 * a factor-of-a-weight error hides** — a scanned meal with wrong macros still renders, still logs,
 * and is simply untrue, which is the shape of defect that survives a manual check.
 */
describe('shared meal round trip', () => {
  beforeEach(() => {
    createFoodItemMock.mockReset()
    saveMealToLibraryMock.mockClear()
    // The real one dedups and writes; here it only has to hand back an id, since what is under test
    // is the numbers handed TO it.
    createFoodItemMock.mockImplementation((input: { name: string }) =>
      Promise.resolve({ id: `new-${input.name}`, ...input }))
  })

  it('reproduces the recipe totals through encode, decode and save', async () => {
    const original = meal()
    const shared = decodeSharedMeal(encodeSharedMeal(original).text)
    expect(shared).not.toBeNull()
    await saveSharedMealToLibrary(shared!, 'u1', 'Australia/Brisbane')

    const items = saveMealToLibraryMock.mock.calls[0][0].items as { quantityMultiplier: number }[]
    const created = createFoodItemMock.mock.calls.map(c => c[0])
    const totals = created.reduce((a, it, i) => {
      const q = items[i].quantityMultiplier
      return {
        calories: a.calories + it.calories * q,
        proteinG: a.proteinG + it.proteinG * q,
        carbsG: a.carbsG + it.carbsG * q,
        fatG: a.fatG + it.fatG * q,
      }
    }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    // Against the recipe as the ENCODER saw it, not against the source meal: the encoder's rounding
    // is the contract a printed label can keep, and holding the copy to un-rounded source numbers
    // would be asserting something no label can deliver.
    const want = shared!.ingredients.reduce((a, i) => ({
      calories: a.calories + i.calories, proteinG: a.proteinG + i.proteinG,
      carbsG: a.carbsG + i.carbsG, fatG: a.fatG + i.fatG,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    // 1% — the per-100 g conversion rounds calories to whole and macros to 0.1 before the weight is
    // multiplied back, so a 600 g ingredient can drift by a few kcal. A tighter bound would be
    // asserting the rounding rather than the meal.
    expect(totals.calories).toBeCloseTo(want.calories, -1)
    expect(totals.calories / want.calories).toBeGreaterThan(0.99)
    expect(totals.calories / want.calories).toBeLessThan(1.01)
    for (const k of ['proteinG', 'carbsG', 'fatG'] as const) {
      expect(totals[k] / want[k], k).toBeGreaterThan(0.99)
      expect(totals[k] / want[k], k).toBeLessThan(1.01)
    }
  })

  it('keeps the batch size, so a copy is the same number of portions', async () => {
    const shared = decodeSharedMeal(encodeSharedMeal(meal()).text)!
    await saveSharedMealToLibrary(shared, 'u1', 'Australia/Brisbane')
    // Dropping this would halve or double every portion the scanner logs from the meal afterwards,
    // silently and forever — `logMealItems` divides by it on every log.
    expect(saveMealToLibraryMock.mock.calls[0][0].servings).toBe(4)
    expect(saveMealToLibraryMock.mock.calls[0][0].name).toBe('Beef Pasta Bake')
  })

  it('never sends an empty tag array, which would clear tags rather than leave them', async () => {
    const shared = decodeSharedMeal(encodeSharedMeal(meal()).text)!
    await saveSharedMealToLibrary(shared, 'u1', 'Australia/Brisbane')
    // `[]` means "clear them" and `undefined` means "leave them alone" — the distinction BF-11e
    // built into the route, the outbox replay and the local table.
    expect(saveMealToLibraryMock.mock.calls[0][0].mealTypeIds).toBeUndefined()
    expect(saveMealToLibraryMock.mock.calls[0][0].isUpdate).toBe(false)
  })

  it('stores ingredients per 100 g, which is what lets the scanner’s library dedupe them', () => {
    // 600 g of mince at 1302 kcal is 217 per 100 g at ×6. Storing it as a 600 g serving would read
    // correctly and then scale wrongly the moment anyone edited the meal — and would mint a second
    // row for a food the scanner already has.
    const { item, quantityMultiplier } = sharedIngredientToEntry({
      name: 'Beef mince', weightG: 600, calories: 1302, proteinG: 120.6, carbsG: 0, fatG: 91.2,
    })
    expect(item.servingSizeG).toBe(100)
    expect(item.calories).toBe(217)
    expect(item.proteinG).toBeCloseTo(20.1, 1)
    expect(quantityMultiplier).toBe(6)
  })

  it('survives a zero-weight ingredient rather than writing NaN', () => {
    // `weightG` is rounded on the way into the payload, so a sub-gram garnish arrives as 0 and the
    // per-100 g division is a divide by zero. Keeping its macros as one serving keeps the totals,
    // which is the whole guarantee.
    const { item, quantityMultiplier } = sharedIngredientToEntry({
      name: 'Basil', weightG: 0, calories: 2, proteinG: 0.2, carbsG: 0.2, fatG: 0,
    })
    expect(Number.isFinite(item.calories)).toBe(true)
    expect(item.calories).toBe(2)
    expect(quantityMultiplier).toBe(1)
  })

  it('floors a sub-gram multiplier at the schema minimum instead of rounding it away', () => {
    const { quantityMultiplier } = sharedIngredientToEntry({
      name: 'Salt', weightG: 1, calories: 0, proteinG: 0, carbsG: 0, fatG: 0,
    })
    expect(quantityMultiplier).toBe(0.01)
  })

  it('refuses a payload with nothing in it', async () => {
    await expect(saveSharedMealToLibrary(
      { name: 'Empty', servings: 1, ingredients: [], rolled: 0 }, 'u1', 'Australia/Brisbane',
    )).rejects.toThrow()
  })
})

describe('sharedMealTotals — the figures the duplicate check compares (LB-34)', () => {
  const ing = (over: Partial<SharedMealIngredient> = {}): SharedMealIngredient =>
    ({ name: 'Oats', weightG: 100, calories: 380, proteinG: 13, carbsG: 66, fatG: 7, ...over })

  it('sums the whole recipe, not one serving', () => {
    // `servings` is carried by the payload and must NOT divide these: `SavedMeal.totals` is the
    // whole recipe, and that is what these get compared against.
    const shared: SharedMeal = {
      name: 'Batch', servings: 4, rolled: 0,
      ingredients: [ing(), ing({ name: 'Rice', calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 })],
    }
    expect(sharedMealTotals(shared)).toEqual({ calories: 510, proteinG: 15.7, carbsG: 94, fatG: 7.3 })
  })

  it('is unaffected by servings', () => {
    const base: SharedMeal = { name: 'X', servings: 1, rolled: 0, ingredients: [ing()] }
    expect(sharedMealTotals(base)).toEqual(sharedMealTotals({ ...base, servings: 8 }))
  })

  it('rounds calories whole and macros to 1dp, as a saved meal stores them', () => {
    const shared: SharedMeal = {
      name: 'X', servings: 1, rolled: 0,
      ingredients: [ing({ calories: 100.4, proteinG: 1.26, carbsG: 2.24, fatG: 0.05 })],
    }
    expect(sharedMealTotals(shared)).toEqual({ calories: 100, proteinG: 1.3, carbsG: 2.2, fatG: 0.1 })
  })

  it('treats an unparseable macro as zero rather than poisoning the total with NaN', () => {
    // NaN compares false against everything, so a duplicate would never be found and the bug this
    // exists to fix would be silently back.
    const shared = {
      name: 'X', servings: 1, rolled: 0,
      ingredients: [{ name: 'Odd', weightG: 50, calories: undefined, proteinG: 5, carbsG: 5, fatG: 1 }],
    } as unknown as SharedMeal
    expect(sharedMealTotals(shared)).toEqual({ calories: 0, proteinG: 5, carbsG: 5, fatG: 1 })
  })

  it('is zero for an empty list rather than throwing', () => {
    expect(sharedMealTotals({ name: 'X', servings: 1, rolled: 0, ingredients: [] }))
      .toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
  })
})
