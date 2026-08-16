import { describe, it, expect } from 'vitest'
import { mealTypeForHour } from '../log-plan-meal'
import type { MealType } from '../../types/nutrition'

function mt(name: string, start: number, end: number): MealType {
  return {
    id: name, userId: 'u', name, emoji: '🍽️', sortOrder: 0,
    timeStartHour: start, timeEndHour: end,
    remindersEnabled: false, required: false, createdAt: new Date(),
  }
}

const TYPES = [mt('breakfast', 5, 11), mt('lunch', 11, 15), mt('dinner', 17, 22)]

describe('mealTypeForHour', () => {
  it('picks the bucket the hour falls in', () => {
    expect(mealTypeForHour(TYPES, 7)).toBe('breakfast')
    expect(mealTypeForHour(TYPES, 12)).toBe('lunch')
    expect(mealTypeForHour(TYPES, 19)).toBe('dinner')
  })

  it('is inclusive of the start hour and exclusive of the end', () => {
    expect(mealTypeForHour(TYPES, 5)).toBe('breakfast')
    expect(mealTypeForHour(TYPES, 11)).toBe('lunch')
  })

  // A gap in the user's configured hours must not lose a log — 16:00 belongs to nothing here.
  it('falls back to the first bucket rather than refusing', () => {
    expect(mealTypeForHour(TYPES, 16)).toBe('breakfast')
    expect(mealTypeForHour(TYPES, 3)).toBe('breakfast')
  })

  it('returns null only when there are no buckets at all', () => {
    expect(mealTypeForHour([], 12)).toBeNull()
  })
})
