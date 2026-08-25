// BF-11g — the planner searches the saved-meal library before asking the AI. The ranking is the
// part worth pinning: it is pure, and behind an AI call it would be untestable.
import { describe, it, expect } from 'vitest'
import { selectLibraryMeals, slotMealTypeIds, type LibraryMeal, type LibrarySlot } from '../library-match'

const ing = (name: string, weightG: number, p: number, c: number, f: number) => ({
  name, weightG,
  caloriesPer100g: p * 4 + c * 4 + f * 9,
  proteinPer100g: p, carbsPer100g: c, fatPer100g: f,
})

/** A meal with a source for each macro, so the per-group scaler has something to move. */
const meal = (id: string, mealTypeIds: string[] = []): LibraryMeal => ({
  id, name: id, mealTypeIds,
  ingredients: [
    ing('chicken', 150, 30, 0, 4),
    ing('rice', 200, 3, 28, 1),
    ing('oil', 10, 0, 0, 100),
  ],
})

const slot = (index: number, timeMinutes: number, t: Partial<LibrarySlot['target']> = {}): LibrarySlot => ({
  index, timeMinutes,
  target: { calories: 600, proteinG: 45, carbsG: 60, fatG: 18, ...t },
})

const TYPES = [
  { id: 'breakfast', timeStartHour: 5, timeEndHour: 11 },
  { id: 'lunch', timeStartHour: 11, timeEndHour: 15 },
  { id: 'dinner', timeStartHour: 17, timeEndHour: 22 },
  { id: 'overnight', timeStartHour: 22, timeEndHour: 5 },
]

describe('slotMealTypeIds', () => {
  it('finds the window a slot falls in', () => {
    expect(slotMealTypeIds(8 * 60, TYPES)).toEqual(['breakfast'])
    expect(slotMealTypeIds(19 * 60, TYPES)).toEqual(['dinner'])
  })

  it('handles a window that wraps midnight', () => {
    expect(slotMealTypeIds(23 * 60, TYPES)).toEqual(['overnight'])
    expect(slotMealTypeIds(2 * 60, TYPES)).toEqual(['overnight'])
    expect(slotMealTypeIds(12 * 60, TYPES)).toEqual(['lunch'])
  })

  it('returns every window that contains the time, not just the first', () => {
    const overlapping = [...TYPES, { id: 'post-workout', timeStartHour: 17, timeEndHour: 19 }]
    expect(slotMealTypeIds(18 * 60, overlapping).sort()).toEqual(['dinner', 'post-workout'])
  })

  it('is empty when no window contains it, which leaves only untagged meals eligible', () => {
    expect(slotMealTypeIds(16 * 60, TYPES)).toEqual([])
  })
})

describe('selectLibraryMeals (BF-11g)', () => {
  it('fills a slot from the library when a meal fits', () => {
    const picks = selectLibraryMeals([slot(0, 12 * 60)], [meal('a')], TYPES)
    expect(picks).toHaveLength(1)
    expect(picks[0].slotIndex).toBe(0)
    expect(picks[0].meal.id).toBe('a')
    expect(picks[0].matchReason).toMatch(/from your library/i)
  })

  // The failure mode this feature creates: the "genuinely DIFFERENT food" instruction constrains
  // the model, and a library search never reaches the model.
  it('never uses the same meal twice in a day', () => {
    const picks = selectLibraryMeals([slot(0, 12 * 60), slot(1, 19 * 60)], [meal('a')], TYPES)
    expect(picks).toHaveLength(1)
    expect(picks[0].slotIndex).toBe(0)
  })

  it('fills several slots from several meals', () => {
    const picks = selectLibraryMeals(
      [slot(0, 12 * 60), slot(1, 19 * 60)], [meal('a'), meal('b')], TYPES)
    expect(picks.map(p => p.meal.id)).toEqual(['a', 'b'])
  })

  it('respects the slot meal type, and untagged meals suit any slot', () => {
    const lunchOnly = meal('lunchy', ['lunch'])
    const untagged = meal('anytime')
    // A dinner slot cannot take the lunch-tagged meal, so it takes the untagged one.
    const picks = selectLibraryMeals([slot(0, 19 * 60)], [lunchOnly, untagged], TYPES)
    expect(picks.map(p => p.meal.id)).toEqual(['anytime'])
  })

  it('takes a tagged meal when the slot matches its tag', () => {
    const picks = selectLibraryMeals([slot(0, 12 * 60)], [meal('lunchy', ['lunch'])], TYPES)
    expect(picks.map(p => p.meal.id)).toEqual(['lunchy'])
  })

  // The whole point of judging the PORTIONED meal: a half-size meal of the right shape is a good
  // match, because portioning is what happens to it next.
  it('takes a meal that is the wrong size but the right shape', () => {
    const half: LibraryMeal = {
      id: 'small', name: 'small', mealTypeIds: [],
      ingredients: [ing('chicken', 75, 30, 0, 4), ing('rice', 100, 3, 28, 1), ing('oil', 5, 0, 0, 100)],
    }
    expect(selectLibraryMeals([slot(0, 12 * 60)], [half], TYPES).map(p => p.meal.id)).toEqual(['small'])
  })

  // And the inverse, which is what stops the gate being decoration: a meal with no fat source
  // cannot reach a fat target however it is portioned — the scaler moves each macro group
  // independently and has nothing to move.
  it('refuses a meal that has no source for a macro the slot needs', () => {
    const noFat: LibraryMeal = {
      id: 'nofat', name: 'nofat', mealTypeIds: [],
      ingredients: [ing('egg white', 200, 11, 1, 0), ing('rice', 200, 3, 28, 0)],
    }
    expect(selectLibraryMeals([slot(0, 12 * 60)], [noFat], TYPES)).toEqual([])
  })

  it('leaves the slot to the model when nothing fits', () => {
    const wrong: LibraryMeal = {
      id: 'wrong', name: 'wrong', mealTypeIds: [],
      ingredients: [ing('lettuce', 50, 1, 1, 0)],
    }
    expect(selectLibraryMeals([slot(0, 12 * 60)], [wrong], TYPES)).toEqual([])
  })

  it('ignores a meal with no ingredients rather than picking an empty one', () => {
    const empty: LibraryMeal = { id: 'empty', name: 'empty', mealTypeIds: [], ingredients: [] }
    expect(selectLibraryMeals([slot(0, 12 * 60)], [empty], TYPES)).toEqual([])
  })

  it('prefers the closer of two eligible meals', () => {
    const big: LibraryMeal = {
      id: 'big', name: 'big', mealTypeIds: [],
      ingredients: [ing('chicken', 400, 30, 0, 4), ing('rice', 600, 3, 28, 1), ing('oil', 40, 0, 0, 100)],
    }
    const picks = selectLibraryMeals([slot(0, 12 * 60)], [big, meal('right')], TYPES)
    expect(picks.map(p => p.meal.id)).toEqual(['right'])
  })

  it('does nothing with an empty library', () => {
    expect(selectLibraryMeals([slot(0, 12 * 60)], [], TYPES)).toEqual([])
  })
})
