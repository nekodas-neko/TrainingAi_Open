import { describe, it, expect } from 'vitest'
import { scoreAvailability, trailingBaselineZ, CORE_READINESS_INPUTS } from '@/lib/health/score-availability'
import { seedOrUpdateBaseline, baselineZ } from '@trainingai/shared/health/personal-baseline'

describe('scoreAvailability', () => {
  it('reports full and unlimited when every core signal is present', () => {
    const a = scoreAvailability({ sleep: true, hrv: true, restingHeartRate: true, temperature: true, activity: true, checkin: true })
    expect(a.confidence).toBe('full')
    expect(a.limited).toBe(false)
    expect(a.missing).toEqual([])
  })

  it('stays full when only the non-core signals are missing', () => {
    const a = scoreAvailability({ sleep: true, hrv: true, restingHeartRate: true, temperature: true })
    expect(a.confidence).toBe('full')
    expect(a.limited).toBe(false)
    expect(a.missing).toEqual(['activity', 'checkin'])
  })

  it('is partial for the typical Health Connect user — no body temperature', () => {
    const a = scoreAvailability({ sleep: true, hrv: true, restingHeartRate: true, activity: true })
    expect(a.confidence).toBe('partial')
    expect(a.limited).toBe(true)
    expect(a.missing).toContain('temperature')
    expect(a.available).toContain('hrv')
  })

  it('is minimal with one core signal or none', () => {
    expect(scoreAvailability({ sleep: true }).confidence).toBe('minimal')
    expect(scoreAvailability({}).confidence).toBe('minimal')
    expect(scoreAvailability({ activity: true, checkin: true }).confidence).toBe('minimal')
  })

  it('counts activity and check-in as available without letting them raise confidence', () => {
    const a = scoreAvailability({ sleep: true, hrv: true, activity: true, checkin: true })
    expect(a.available).toEqual(['sleep', 'hrv', 'activity', 'checkin'])
    expect(a.confidence).toBe('partial')
  })

  it('judges confidence on the four core recovery signals', () => {
    expect(CORE_READINESS_INPUTS).toEqual(['sleep', 'hrv', 'restingHeartRate', 'temperature'])
  })
})

describe('trailingBaselineZ', () => {
  const steady = (n: number) => Array.from({ length: n }, (_, i) => 50 + (i % 3) - 1)

  it('returns null without something to compare against', () => {
    expect(trailingBaselineZ([])).toBeNull()
    expect(trailingBaselineZ([55])).toBeNull()
  })

  it('matches folding the same series through the seeding updater by hand', () => {
    // `seedOrUpdateBaseline`, not the raw `updateBaseline`: BF-13 moved every fold in the app onto
    // the seeding wrapper, and the vendor port keeps its zero start because that is ecore's own
    // ground truth. Hand-folding through the port would now be testing a different function.
    const series = [...steady(8), 60]
    let b = null as Parameters<typeof baselineZ>[0] | null
    for (let i = 0; i < series.length - 1; i++) b = seedOrUpdateBaseline(b, series[i], i)
    expect(trailingBaselineZ(series, 4)).toBe(baselineZ(b!, 60))
  })

  it('scores a value above its own history positive and one below negative', () => {
    expect(trailingBaselineZ([...steady(20), 70])!).toBeGreaterThan(0)
    expect(trailingBaselineZ([...steady(20), 30])!).toBeLessThan(0)
  })

  it('refuses a cold baseline rather than returning its overconfident z', () => {
    // The maturity floor. Two samples are nowhere near enough history to score against.
    expect(trailingBaselineZ([50, 50])).toBeNull()
  })

  it('no longer has an overconfident z for the floor to catch (BF-13)', () => {
    // This assertion used to read `expect(trailingBaselineZ([50, 50], 1)).toBeGreaterThan(5)` —
    // it DEMONSTRATED the hazard, since two samples of a steady 50 folded to mean 25 / dev 3.1 and
    // a raw z of 8, which the composite would have read as a flawless resting-HR day. Seeding on
    // the first sample removes the hazard at its source: one prior sample gives mean 50 and dev 0,
    // and `baselineZ` returns null on a zero dev rather than a confident number.
    //
    // The floor above stays regardless — defence in depth, and it is what protects the samples
    // between "seeded" and "settled". This case exists so that if the seed is ever reverted, the
    // overconfident z comes back visibly here instead of hiding behind the floor.
    expect(trailingBaselineZ([50, 50], 1)).toBeNull()
  })

  it('holds out until the maturity floor is reached, then scores', () => {
    expect(trailingBaselineZ([...steady(13), 55])).toBeNull()   // 13 priors
    expect(trailingBaselineZ([...steady(14), 55])).not.toBeNull() // 14 priors
  })
})
