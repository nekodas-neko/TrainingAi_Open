import { describe, it, expect } from 'vitest'
import { aggregateWorkoutDay } from '../workout-density'

describe('aggregateWorkoutDay', () => {
  it('returns nulls for a rest day (no sessions)', () => {
    expect(aggregateWorkoutDay([])).toEqual({ sessionDurationMin: null, workoutDensity: null })
  })

  it('returns nulls when the only session is still in progress', () => {
    const result = aggregateWorkoutDay([
      { startedAt: new Date('2026-07-04T18:00:00Z'), completedAt: null, volumeKg: 500 },
    ])
    expect(result).toEqual({ sessionDurationMin: null, workoutDensity: null })
  })

  it('computes duration and density for one completed session', () => {
    const result = aggregateWorkoutDay([
      {
        startedAt: new Date('2026-07-04T18:00:00Z'),
        completedAt: new Date('2026-07-04T19:00:00Z'),
        volumeKg: 3000,
      },
    ])
    expect(result).toEqual({ sessionDurationMin: 60, workoutDensity: 50 })
  })

  it('sums duration and volume across multiple completed sessions the same day, skipping in-progress ones', () => {
    const result = aggregateWorkoutDay([
      {
        startedAt: new Date('2026-07-04T06:00:00Z'),
        completedAt: new Date('2026-07-04T06:30:00Z'),
        volumeKg: 1000,
      },
      {
        startedAt: new Date('2026-07-04T18:00:00Z'),
        completedAt: new Date('2026-07-04T18:30:00Z'),
        volumeKg: 500,
      },
      {
        startedAt: new Date('2026-07-04T20:00:00Z'),
        completedAt: null,
        volumeKg: 999,
      },
    ])
    expect(result).toEqual({ sessionDurationMin: 60, workoutDensity: 25 })
  })

  it('returns null density when duration rounds to 0 minutes', () => {
    const result = aggregateWorkoutDay([
      {
        startedAt: new Date('2026-07-04T18:00:00.000Z'),
        completedAt: new Date('2026-07-04T18:00:00.200Z'),
        volumeKg: 100,
      },
    ])
    expect(result).toEqual({ sessionDurationMin: 0, workoutDensity: null })
  })
})
