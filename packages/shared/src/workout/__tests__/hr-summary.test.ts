import { describe, it, expect } from 'vitest'
import { summariseWorkoutHr } from '../hr-summary'
import type { HrReading, SetHrStats } from '../hr-analysis'

const reading = (bpm: number, source?: string | null): HrReading & { source?: string | null } =>
  ({ timestamp: new Date(0), bpm, source })

const setStat = (hrr1: number | null): Pick<SetHrStats, 'hrr1'> => ({ hrr1 })

describe('summariseWorkoutHr', () => {
  it('computes avg (rounded), peak, best HRR1, and passes HRV through', () => {
    const out = summariseWorkoutHr(
      [reading(120, 'chest_strap'), reading(150, 'chest_strap'), reading(139, 'chest_strap')],
      [setStat(18), setStat(31), setStat(null)],
      44,
    )
    expect(out.avgBpm).toBe(136) // (120+150+139)/3 = 136.33 → 136
    expect(out.peakBpm).toBe(150)
    expect(out.hrr1Best).toBe(31) // best (largest) recovery across sets
    expect(out.workoutHrvMs).toBe(44)
    expect(out.readingsCount).toBe(3)
    expect(out.source).toBe('chest_strap')
  })

  it('returns all-null scalars for a workout with no HR readings', () => {
    // No readings ⇒ analyseHrRecovery yields null hrr1 per set (recovery is derived from readings).
    const out = summariseWorkoutHr([], [setStat(null)], null)
    expect(out).toEqual({
      avgBpm: null, peakBpm: null, hrr1Best: null, workoutHrvMs: null, readingsCount: 0, source: null,
    })
  })

  it('labels mixed strap + ring readings as "mixed", single-source by its name', () => {
    expect(summariseWorkoutHr([reading(100, 'ble')], [], null).source).toBe('ble')
    expect(summariseWorkoutHr([reading(100, 'chest_strap'), reading(101, 'ble')], [], null).source).toBe('mixed')
    expect(summariseWorkoutHr([reading(100, null), reading(101, undefined)], [], null).source).toBe(null)
  })

  it('null HRR1 across every set yields null best (no false 0)', () => {
    expect(summariseWorkoutHr([reading(130)], [setStat(null), setStat(null)], null).hrr1Best).toBe(null)
  })
})
