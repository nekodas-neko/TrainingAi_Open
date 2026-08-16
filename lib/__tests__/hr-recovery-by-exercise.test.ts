import { describe, it, expect } from 'vitest'
import {
  aggregateHrRecoveryByExercise,
  formatRecoveryRate,
} from '@trainingai/shared/health/hr-recovery-by-exercise'

const set = (exerciseName: string, hrr1: number | null, adequate: boolean | null = true) =>
  ({ exerciseName, hrr1, adequate })

describe('aggregateHrRecoveryByExercise', () => {
  it('reports one median figure per exercise, in workout order', () => {
    const out = aggregateHrRecoveryByExercise([
      set('Bench', 12), set('Bench', 8), set('Bench', 10),
      set('Landmine', 28), set('Landmine', 4),
    ])
    expect(out.map(e => e.exerciseName)).toEqual(['Bench', 'Landmine'])
    expect(out[0].medianHrr1).toBe(10)
    expect(out[1].medianHrr1).toBe(16) // (28 + 4) / 2
  })

  it('uses the median so one wild set cannot carry the exercise', () => {
    const out = aggregateHrRecoveryByExercise([
      set('Bench', 10), set('Bench', 11), set('Bench', 12), set('Bench', 250),
    ])
    expect(out[0].medianHrr1).toBe(12) // (11 + 12) / 2 = 11.5 -> 12, not ~70
  })

  it('counts contributing sets against the total, so a 1-of-4 reading is visible as such', () => {
    const out = aggregateHrRecoveryByExercise([
      set('Bench', 12), set('Bench', null), set('Bench', null), set('Bench', null),
    ])
    expect(out[0].sampleCount).toBe(1)
    expect(out[0].totalSets).toBe(4)
  })

  it('omits an exercise where no set reported a reading', () => {
    const out = aggregateHrRecoveryByExercise([set('Bench', null), set('Bench', null)])
    expect(out).toEqual([])
  })

  // The bug this replaces: a set whose HR ROSE rendered as "↓-9 bpm/min ✓" — a down-arrow
  // and a green tick on a negative recovery.
  it('never calls a negative median adequate', () => {
    const out = aggregateHrRecoveryByExercise([set('Bench', -9, true), set('Bench', -5, true)])
    expect(out[0].medianHrr1).toBe(-7)
    expect(out[0].adequate).toBe(false)
  })

  it('is adequate only when every contributing set was', () => {
    expect(aggregateHrRecoveryByExercise([set('Bench', 12, true), set('Bench', 10, true)])[0].adequate).toBe(true)
    expect(aggregateHrRecoveryByExercise([set('Bench', 12, true), set('Bench', 10, false)])[0].adequate).toBe(false)
  })

  it('reports unknown, not failed, when no set carried a verdict', () => {
    expect(aggregateHrRecoveryByExercise([set('Bench', 12, null)])[0].adequate).toBeNull()
  })
})

describe('formatRecoveryRate', () => {
  it('points the arrow down for a drop and up for a rise', () => {
    expect(formatRecoveryRate(12)).toBe('↓12 bpm/min')
    expect(formatRecoveryRate(-9)).toBe('↑9 bpm/min')
  })
})
