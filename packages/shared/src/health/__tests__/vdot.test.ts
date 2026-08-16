import { describe, it, expect } from 'vitest'
import {
  vdotFromRace, pacesFromVdot, predictRaceTime, VDOT_PACE_INTENSITY,
  vo2AtVelocity, velocityAtVo2, formatPace,
} from '../vdot'

describe('VDOT (Daniels)', () => {
  it('derives VDOT from a race matching Daniels\' tables', () => {
    // Daniels: a 20:00 5K ≈ VDOT 49–50 (VDOT 50 = 19:57).
    const vdot = vdotFromRace(5000, 20 * 60)!
    expect(vdot).toBeGreaterThan(48)
    expect(vdot).toBeLessThan(51)

    // A 25:00 5K is a lower VDOT than a 20:00 5K.
    expect(vdotFromRace(5000, 25 * 60)!).toBeLessThan(vdot)
  })

  it('returns null for non-positive inputs (never throws)', () => {
    expect(vdotFromRace(0, 1200)).toBeNull()
    expect(vdotFromRace(5000, 0)).toBeNull()
    expect(vdotFromRace(-1, -1)).toBeNull()
  })

  it('vo2AtVelocity and velocityAtVo2 are inverses', () => {
    const v = 250
    expect(velocityAtVo2(vo2AtVelocity(v))).toBeCloseTo(v, 3)
  })

  it('prescribes paces that get faster from easy → repetition', () => {
    const p = pacesFromVdot(50)
    // sec/km, so a faster pace is a SMALLER number.
    expect(p.easySecPerKm).toBeGreaterThan(p.marathonSecPerKm)
    expect(p.marathonSecPerKm).toBeGreaterThan(p.thresholdSecPerKm)
    expect(p.thresholdSecPerKm).toBeGreaterThan(p.intervalSecPerKm)
    expect(p.intervalSecPerKm).toBeGreaterThan(p.repetitionSecPerKm)
  })

  it('threshold pace for VDOT 50 matches Daniels (~4:15/km)', () => {
    const t = pacesFromVdot(50).thresholdSecPerKm
    expect(t).toBeGreaterThan(250) // 4:10
    expect(t).toBeLessThan(262)    // 4:22
  })

  it('intensity fractions are ordered E<M<T<I<R', () => {
    const v = VDOT_PACE_INTENSITY
    expect(v.easy).toBeLessThan(v.marathon)
    expect(v.marathon).toBeLessThan(v.threshold)
    expect(v.threshold).toBeLessThan(v.interval)
    expect(v.interval).toBeLessThan(v.repetition)
  })

  it('predicts a slower time over a longer distance via Riegel', () => {
    // 5K in 20:00 → 10K prediction ≈ 2×2^0.06 ≈ 41:42.
    const t10k = predictRaceTime(5000, 20 * 60, 10000)!
    expect(t10k).toBeGreaterThan(2 * 20 * 60)         // slower than double
    expect(t10k).toBeLessThan(2.15 * 20 * 60)         // but within ~15%
    // Predicting the same distance returns the same time.
    expect(predictRaceTime(5000, 1200, 5000)).toBe(1200)
    expect(predictRaceTime(0, 1200, 10000)).toBeNull()
  })

  it('formats a pace as m:ss/km', () => {
    expect(formatPace(255)).toBe('4:15/km')
    expect(formatPace(300)).toBe('5:00/km')
    expect(formatPace(305)).toBe('5:05/km')
  })
})
