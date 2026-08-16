import { describe, it, expect } from 'vitest'
import { summarizePeriod } from '../period-comparison'
import type { WorkoutSession } from '@trainingai/shared/types'

function ws(startedAt: string, volume: number): WorkoutSession {
  return {
    id: 'x', userId: 'u', sessionName: 'Push', startedAt: new Date(startedAt),
    exercises: [{ exerciseName: 'Bench', volume, sets: [], muscleGroups: [], loggedAt: new Date(startedAt) }],
    isEarlyDeload: false, wasOverride: false,
  } as unknown as WorkoutSession
}

describe('summarizePeriod', () => {
  it('sums session count and volume within the given window', () => {
    const sessions = [ws('2026-06-01T10:00:00Z', 100), ws('2026-06-15T10:00:00Z', 200)]
    const result = summarizePeriod(sessions, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result.sessionCount).toBe(2)
    expect(result.totalVolumeKg).toBe(300)
  })

  it('excludes sessions outside the window', () => {
    const sessions = [ws('2026-05-01T10:00:00Z', 100), ws('2026-06-15T10:00:00Z', 200)]
    const result = summarizePeriod(sessions, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result.sessionCount).toBe(1)
    expect(result.totalVolumeKg).toBe(200)
  })

  it('returns zeros for an empty window', () => {
    const result = summarizePeriod([], new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result).toEqual({ sessionCount: 0, totalVolumeKg: 0 })
  })
})
