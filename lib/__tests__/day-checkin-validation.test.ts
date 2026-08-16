import { describe, it, expect } from 'vitest'
import { DayCheckinScalesSchema } from '@trainingai/shared/validation/day-checkin'

describe('DayCheckinScalesSchema', () => {
  it('accepts in-range scale values', () => {
    const r = DayCheckinScalesSchema.safeParse({ physicalTiredness: 3, mentalDrain: 1, restingSoreness: 5 })
    expect(r.success).toBe(true)
  })
  it('accepts nulls and omissions (partial upserts)', () => {
    expect(DayCheckinScalesSchema.safeParse({}).success).toBe(true)
    expect(DayCheckinScalesSchema.safeParse({ physicalTiredness: null }).success).toBe(true)
  })
  it('rejects an out-of-range scale value', () => {
    expect(DayCheckinScalesSchema.safeParse({ hydration: 6 }).success).toBe(false)
    expect(DayCheckinScalesSchema.safeParse({ lateHeavyMeal: 0 }).success).toBe(false)
    expect(DayCheckinScalesSchema.safeParse({ wakeMood: 2.5 }).success).toBe(false)
    expect(DayCheckinScalesSchema.safeParse({ motivation: 42 }).success).toBe(false)
  })
  it('ignores unrelated payload fields (soreMuscles, journal, phase, workoutSessionId)', () => {
    const r = DayCheckinScalesSchema.safeParse({
      physicalTiredness: 3,
      soreMuscles: ['quads'],
      journal: 'felt good',
      phase: 'evening',
    })
    expect(r.success).toBe(true)
  })
})
