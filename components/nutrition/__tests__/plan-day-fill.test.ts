import { describe, it, expect } from 'vitest'
import { fillableMeals, hourFromTzDatetime, planMealHour } from '../plan-day-fill'
import type { MealPlanMeal, MealType } from '@trainingai/shared/types/nutrition'

const BREAKFAST: MealType = {
  id: 'mt-b', userId: 'u', name: 'Breakfast', emoji: '', sortOrder: 0,
  timeStartHour: 6, timeEndHour: 11, remindersEnabled: false, required: false, createdAt: new Date(),
}
const DINNER: MealType = { ...BREAKFAST, id: 'mt-d', name: 'Dinner', sortOrder: 2, timeStartHour: 18, timeEndHour: 22 }
const TYPES = [BREAKFAST, DINNER]

function meal(over: Partial<MealPlanMeal> & { id: string; position: number }): MealPlanMeal {
  return {
    variantId: 'v', mealTypeId: null, savedMealId: null, name: 'Meal', notes: null,
    targetCalories: 500, targetProteinG: 30, targetCarbsG: 50, targetFatG: 15,
    ingredients: [{ name: 'Oats', weightG: 80, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 66, fatPer100g: 7 }],
    suggestedTime: null, ...over,
  }
}

const BASE = {
  mealTypes: TYPES,
  today: '2026-08-31',
  nowHour: 12,
  loggedPositions: new Set<number>(),
  declinedMealIds: new Set<string>(),
}

describe('planMealHour', () => {
  it('prefers the meal\'s own suggested time', () => {
    expect(planMealHour(meal({ id: 'a', position: 1, suggestedTime: '07:30', mealTypeId: 'mt-d' }), TYPES)).toBe(7)
  })

  it('falls back to the bucket\'s start hour', () => {
    expect(planMealHour(meal({ id: 'a', position: 1, mealTypeId: 'mt-d' }), TYPES)).toBe(18)
  })

  it('is null when the plan carries neither', () => {
    expect(planMealHour(meal({ id: 'a', position: 1 }), TYPES)).toBeNull()
  })

  it('is null for a bucket the user has since deleted', () => {
    expect(planMealHour(meal({ id: 'a', position: 1, mealTypeId: 'gone' }), TYPES)).toBeNull()
  })

  it('rejects a malformed or out-of-range time rather than trusting it', () => {
    expect(planMealHour(meal({ id: 'a', position: 1, suggestedTime: 'lunchtime' }), TYPES)).toBeNull()
    expect(planMealHour(meal({ id: 'a', position: 1, suggestedTime: '31:00' }), TYPES)).toBeNull()
  })
})

describe('fillableMeals — today is bounded by the clock', () => {
  const breakfast = meal({ id: 'b', position: 1, suggestedTime: '07:00' })
  const dinner = meal({ id: 'd', position: 2, suggestedTime: '19:00' })

  it('offers only the meals whose time has come', () => {
    const out = fillableMeals({ ...BASE, meals: [breakfast, dinner], selectedDate: '2026-08-31' })
    expect(out.map(m => m.id)).toEqual(['b'])
  })

  it('offers a meal exactly on its hour', () => {
    const out = fillableMeals({ ...BASE, nowHour: 19, meals: [breakfast, dinner], selectedDate: '2026-08-31' })
    expect(out.map(m => m.id)).toEqual(['b', 'd'])
  })

  it('offers nothing before the first meal of the day', () => {
    expect(fillableMeals({ ...BASE, nowHour: 5, meals: [breakfast, dinner], selectedDate: '2026-08-31' })).toEqual([])
  })

  it('does not offer a meal whose time cannot be resolved', () => {
    const untimed = meal({ id: 'u', position: 3 })
    const out = fillableMeals({ ...BASE, meals: [breakfast, untimed], selectedDate: '2026-08-31' })
    expect(out.map(m => m.id)).toEqual(['b'])
  })
})

describe('fillableMeals — other days', () => {
  const breakfast = meal({ id: 'b', position: 1, suggestedTime: '07:00' })
  const dinner = meal({ id: 'd', position: 2, suggestedTime: '19:00' })

  it('offers every meal on a past day, whatever the hour is now', () => {
    const out = fillableMeals({ ...BASE, nowHour: 5, meals: [breakfast, dinner], selectedDate: '2026-08-30' })
    expect(out.map(m => m.id)).toEqual(['b', 'd'])
  })

  it('offers an untimed meal on a past day, where the day itself is the evidence', () => {
    const untimed = meal({ id: 'u', position: 3 })
    const out = fillableMeals({ ...BASE, meals: [untimed], selectedDate: '2026-08-30' })
    expect(out.map(m => m.id)).toEqual(['u'])
  })

  it('offers nothing on a future day', () => {
    expect(fillableMeals({ ...BASE, nowHour: 23, meals: [breakfast, dinner], selectedDate: '2026-09-01' })).toEqual([])
  })
})

describe('fillableMeals — what is already answered is never re-offered', () => {
  const breakfast = meal({ id: 'b', position: 1, suggestedTime: '07:00' })
  const lunch = meal({ id: 'l', position: 2, suggestedTime: '12:00' })

  it('skips a meal already logged', () => {
    const out = fillableMeals({
      ...BASE, meals: [breakfast, lunch], selectedDate: '2026-08-31', loggedPositions: new Set([1]),
    })
    expect(out.map(m => m.id)).toEqual(['l'])
  })

  it('skips a meal the user declined', () => {
    const out = fillableMeals({
      ...BASE, meals: [breakfast, lunch], selectedDate: '2026-08-31', declinedMealIds: new Set(['l']),
    })
    expect(out.map(m => m.id)).toEqual(['b'])
  })

  it('skips a meal with no ingredients to write', () => {
    const empty = meal({ id: 'e', position: 3, suggestedTime: '08:00', ingredients: [] })
    const out = fillableMeals({ ...BASE, meals: [breakfast, empty], selectedDate: '2026-08-31' })
    expect(out.map(m => m.id)).toEqual(['b'])
  })

  it('returns empty rather than a button with nothing to do', () => {
    const out = fillableMeals({
      ...BASE, meals: [breakfast], selectedDate: '2026-08-31', loggedPositions: new Set([1]),
    })
    expect(out).toEqual([])
  })

  it('keeps plan order, so the log reads as the day was eaten', () => {
    const out = fillableMeals({ ...BASE, nowHour: 23, meals: [lunch, breakfast], selectedDate: '2026-08-30' })
    expect(out.map(m => m.id)).toEqual(['l', 'b'])
  })
})

describe('hourFromTzDatetime', () => {
  it('reads the hour out of the user-timezone datetime', () => {
    expect(hourFromTzDatetime('2026/08/31 19:04')).toBe(19)
    expect(hourFromTzDatetime('2026/08/31 00:30')).toBe(0)
  })

  it('returns null rather than NaN on a shape it does not recognise', () => {
    // NaN would compare false against every hour, so every meal would read as not-yet-due — a
    // button that has quietly stopped working rather than one that reports a problem.
    expect(hourFromTzDatetime('2026-08-31T19:04')).toBeNull()
    expect(hourFromTzDatetime('')).toBeNull()
    expect(hourFromTzDatetime('2026/08/31 99:00')).toBeNull()
  })
})
