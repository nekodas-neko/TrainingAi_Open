// LA-172 — a plan meal's stored type: tag → the window containing its time → the nearest window.
import { describe, it, expect } from 'vitest'
import { planMealTypeId } from '../meal-type-for-time'
import type { MealType } from '@trainingai/shared/types/nutrition'

// The owner's own hours, which have gaps (15-18, and nothing after 21).
const t = (id: string, start: number, end: number, sortOrder: number) =>
  ({ id, timeStartHour: start, timeEndHour: end, sortOrder }) as unknown as MealType
const TYPES = [t('pre', 6, 10, 0), t('post', 10, 12, 1), t('lunch', 12, 15, 2), t('dinner', 18, 21, 3)]

describe('planMealTypeId', () => {
  it('uses the window that contains the time', () => {
    expect(planMealTypeId({ suggestedTime: '07:00' }, TYPES)).toBe('pre')
    expect(planMealTypeId({ suggestedTime: '11:40' }, TYPES)).toBe('post')
    expect(planMealTypeId({ suggestedTime: '12:00' }, TYPES)).toBe('lunch') // start is inclusive
  })

  it('uses the NEAREST window in a gap, never the first bucket', () => {
    expect(planMealTypeId({ suggestedTime: '16:20' }, TYPES)).toBe('lunch')  // 81 min past lunch, 100 before dinner
    expect(planMealTypeId({ suggestedTime: '17:30' }, TYPES)).toBe('dinner') // 30 min before dinner
    expect(planMealTypeId({ suggestedTime: '21:00' }, TYPES)).toBe('dinner') // end is exclusive: 1 min past
    expect(planMealTypeId({ suggestedTime: '23:30' }, TYPES)).toBe('dinner')
    expect(planMealTypeId({ suggestedTime: '04:00' }, TYPES)).toBe('pre')
  })

  it('lets an explicit tag win, and refuses what it cannot read', () => {
    expect(planMealTypeId({ mealTypeId: 'dinner', suggestedTime: '07:00' }, TYPES)).toBe('dinner')
    expect(planMealTypeId({ suggestedTime: null }, TYPES)).toBeNull()
    expect(planMealTypeId({ suggestedTime: 'noon' }, TYPES)).toBeNull()
    expect(planMealTypeId({ suggestedTime: '07:00' }, [])).toBeNull()
  })

  // With hour windows and an exclusive end, a gap can never tie exactly; overlapping windows can.
  it('breaks a tie between two windows that both contain the time by list order', () => {
    const overlap = [t('first', 8, 13, 0), t('second', 11, 14, 1)]
    expect(planMealTypeId({ suggestedTime: '12:00' }, overlap)).toBe('first')
  })
})
