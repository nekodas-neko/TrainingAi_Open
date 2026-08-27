import { describe, it, expect } from 'vitest'
import { libraryMealForSlot, usedSavedMealIds } from '../library-swap'
import type { DraftMeal } from '../meal-plan-draft'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

const DINNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BREAKFAST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TYPES = [
  { id: BREAKFAST, timeStartHour: 6, timeEndHour: 10 },
  { id: DINNER, timeStartHour: 17, timeEndHour: 21 },
]

/**
 * A saved meal with a source for each macro, so the per-group scaler has something to move.
 *
 * A single-ingredient fixture cannot pass `mealFit` at all — three macros cannot be hit
 * independently by scaling one food — so it would test the gate rather than the matching. The
 * shape here mirrors `library-match.test.ts`'s own fixture for that reason.
 */
function item(id: string, name: string, servingG: number, p: number, c: number, f: number) {
  return {
    id: `${id}-${name}`, savedMealId: id, quantityMultiplier: 1,
    foodItem: {
      id: `${id}-${name}-f`, userId: 'u1', name, servingSizeG: servingG,
      calories: p * 4 + c * 4 + f * 9, proteinG: p, carbsG: c, fatG: f, source: 'manual',
    },
  }
}

function meal(id: string, name: string, mealTypeIds: string[]): SavedMeal {
  return {
    id, userId: 'u1', name, servings: 1, imageDataUri: null,
    createdAt: new Date(), mealTypeIds,
    items: [
      item(id, 'chicken', 150, 45, 0, 6),
      item(id, 'rice', 200, 6, 56, 2),
      item(id, 'oil', 10, 0, 0, 10),
    ],
  } as unknown as SavedMeal
}

function slot(overrides: Partial<DraftMeal> = {}): DraftMeal {
  return {
    position: 2, name: 'Meal 3', notes: null, ingredients: [], actual: null,
    suggestedTime: '18:30', timingRole: null,
    targetCalories: 700, targetProteinG: 50, targetCarbsG: 70, targetFatG: 20,
    ...overrides,
  }
}

describe('libraryMealForSlot — the generator\'s own matcher, run for one slot', () => {
  it('returns nothing when the library is empty', () => {
    expect(libraryMealForSlot(slot(), [], TYPES, [])).toBeNull()
  })

  it('refuses a slot whose time cannot be parsed rather than guessing one', () => {
    expect(libraryMealForSlot(slot({ suggestedTime: 'later' }), [meal('m1', 'Steak', [])], TYPES, [])).toBeNull()
  })

  it('will not return the meal already in the slot — a swap that changes nothing reads as broken', () => {
    const m = meal('m1', 'Steak', [])
    expect(libraryMealForSlot(slot({ savedMealId: 'm1' }), [m], TYPES, [])).toBeNull()
  })

  it('will not return a meal already used elsewhere in the day', () => {
    const m = meal('m1', 'Steak', [])
    expect(libraryMealForSlot(slot(), [m], TYPES, ['m1'])).toBeNull()
  })

  it('respects the slot\'s meal type: a breakfast-tagged meal is not offered at dinner', () => {
    const breakfastOnly = meal('m1', 'Porridge', [BREAKFAST])
    expect(libraryMealForSlot(slot(), [breakfastOnly], TYPES, [])).toBeNull()
  })

  it('offers an untagged meal at any time — untagged means every slot, not none', () => {
    const anytime = meal('m1', 'Chicken and rice', [])
    const got = libraryMealForSlot(slot(), [anytime], TYPES, [])
    expect(got?.meal.id).toBe('m1')
    expect(got?.matchReason).toBeTruthy()
  })

  it('offers a dinner-tagged meal at dinner', () => {
    const dinner = meal('m1', 'Steak and potato', [DINNER])
    expect(libraryMealForSlot(slot(), [dinner], TYPES, [])?.meal.id).toBe('m1')
  })
})

describe('usedSavedMealIds', () => {
  it('collects only the slots that hold a saved meal', () => {
    expect(usedSavedMealIds([
      slot({ position: 0, savedMealId: 'a' }),
      slot({ position: 1 }),
      slot({ position: 2, savedMealId: 'b' }),
    ])).toEqual(['a', 'b'])
  })
})
