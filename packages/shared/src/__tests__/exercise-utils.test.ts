import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../exercise-utils'

describe('fuzzyScore', () => {
  it('returns 1 for exact match (case-insensitive)', () => {
    expect(fuzzyScore('Barbell Squat', 'barbell squat')).toBe(1)
  })

  it('returns 0.8 for substring match', () => {
    expect(fuzzyScore('squat', 'Barbell Squat')).toBe(0.8)
  })

  it('returns 0.8 when query contains target', () => {
    expect(fuzzyScore('Barbell Squat', 'squat')).toBe(0.8)
  })

  it('returns high score for overlapping words', () => {
    expect(fuzzyScore('DB Bench Press', 'Dumbbell Bench Press')).toBeGreaterThan(0.3)
  })

  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'Barbell Squat')).toBe(0)
  })

  it('returns low score for unrelated exercises', () => {
    expect(fuzzyScore('Bicep Curl', 'Barbell Squat')).toBeLessThan(0.3)
  })
})
