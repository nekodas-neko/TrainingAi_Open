import { describe, it, expect } from 'vitest'
import { resolveFitnessSnapshot } from '../fitness-snapshot'

describe('resolveFitnessSnapshot', () => {
  it('uses measured baseline values when present', () => {
    const s = resolveFitnessSnapshot({
      age: 35, restingHr: 50,
      baseline: { vo2max: 52, maxHr: 188, thresholdHr: 168, weeklyBaseMinutes: 120 },
    })
    expect(s.source).toBe('baseline')
    expect(s.maxHr).toBe(188)
    expect(s.thresholdHr).toBe(168)
    expect(s.vo2max).toBe(52)
    expect(s.weeklyBaseMinutes).toBe(120)
  })

  it('falls back to age-based max HR and a base-minutes floor when no baseline', () => {
    const s = resolveFitnessSnapshot({ age: 40, restingHr: 55, baseline: null })
    expect(s.source).toBe('age-estimate')
    expect(s.maxHr).toBe(180)            // 220 - 40
    expect(s.thresholdHr).toBeNull()
    expect(s.vo2max).toBeNull()
    expect(s.weeklyBaseMinutes).toBe(60) // conservative starting floor
  })

  it('uses the 190 HR fallback when age is unknown and floors resting HR', () => {
    const s = resolveFitnessSnapshot({ age: null, restingHr: null, baseline: null })
    expect(s.maxHr).toBe(190)
    expect(s.restingHr).toBe(60)         // resting-HR fallback
  })
})
