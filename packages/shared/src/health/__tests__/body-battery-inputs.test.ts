import { describe, it, expect } from 'vitest'
import {
  resolveBatteryHrMax,
  batteryConfidence,
  MIN_PEAK_DAYS,
  MIN_HR_RESERVE_BPM,
  MIN_SAMPLES_PER_WAKING_HOUR,
  MIN_WAKING_MINUTES_TO_JUDGE,
} from '../body-battery-inputs'

const peaks = (n: number, v: number) => Array.from({ length: n }, () => v)

describe('resolveBatteryHrMax', () => {
  it('falls back to the age estimate until there are enough days', () => {
    const r = resolveBatteryHrMax(peaks(MIN_PEAK_DAYS - 1, 168), 190, 62)
    expect(r).toMatchObject({ hrMax: 190, source: 'estimated', peakDays: MIN_PEAK_DAYS - 1 })
  })

  it('takes the observed peak once there are enough days — the production case', () => {
    // 36 days, peak 168, age estimate 190, resting 62: the measured shape of this user's data.
    const r = resolveBatteryHrMax([...peaks(35, 120), 168], 190, 62)
    expect(r).toMatchObject({ hrMax: 168, source: 'observed', observedPeak: 168, peakDays: 36 })
  })

  it('lowers the ceiling below the age estimate — the whole point of this function', () => {
    // resolveMaxHr (observed-hr.ts) would return 190 here. Reserve needs the opposite answer:
    // an inflated max is what stopped drain from ever triggering.
    const { hrMax } = resolveBatteryHrMax(peaks(30, 168), 190, 62)
    expect(hrMax).toBe(168)
    expect(hrMax).toBeLessThan(190)
  })

  it('never lets a quiet spell collapse the reserve', () => {
    // Every day a low peak — without the floor the reserve would be 8 bpm and a desk-sitting
    // heart rate would read as maximal effort.
    const r = resolveBatteryHrMax(peaks(30, 70), 190, 62)
    expect(r.hrMax).toBe(62 + MIN_HR_RESERVE_BPM)
    expect(r.observedPeak).toBe(70)
  })

  it('ignores nulls and non-finite peaks rather than counting them as days', () => {
    const r = resolveBatteryHrMax([...peaks(10, 150), null, undefined, NaN, 0], 190, 60)
    expect(r.peakDays).toBe(10)
    expect(r.source).toBe('estimated')
  })

  it('is driven by the highest day, not the average — one hard session sets the range', () => {
    const flat = resolveBatteryHrMax(peaks(30, 130), 190, 60)
    const withSession = resolveBatteryHrMax([...peaks(29, 130), 175], 190, 60)
    expect(flat.hrMax).toBe(130)
    expect(withSession.hrMax).toBe(175)
  })
})

describe('batteryConfidence', () => {
  it('holds off any verdict in the first hour awake', () => {
    // 2 samples 30 minutes in is 4/hour — under the threshold, but far too early to judge.
    const c = batteryConfidence(2, 30)
    expect(c.sufficient).toBe(true)
    expect(c.samplesPerHour).toBeLessThan(MIN_SAMPLES_PER_WAKING_HOUR)
  })

  it('flags the measured failure case: a full waking day under 100 samples', () => {
    // Seven of 36 production days looked like this; the battery moved 8 points across the whole
    // day and the card rendered it as confidently as a 2,541-sample day.
    expect(batteryConfidence(90, 16 * 60).sufficient).toBe(false)
    expect(batteryConfidence(0, 16 * 60).sufficient).toBe(false)
  })

  it('passes a normally-sampled day', () => {
    expect(batteryConfidence(537, 16 * 60).sufficient).toBe(true)
    expect(batteryConfidence(2541, 16 * 60).sufficient).toBe(true)
  })

  it('flags the borderline morning that slipped through at the old threshold', () => {
    // The owner's first day on v5: 30 readings over 4.3 waking hours = 6.9/h, battery moved 3
    // points. It passed at 6/h. This is the case that moved the threshold to 8.
    const c = batteryConfidence(30, 4.3 * 60)
    expect(c.samplesPerHour).toBeCloseTo(7, 0)
    expect(c.sufficient).toBe(false)
  })

  it('is a rate, not a count — the same count differs by time of day', () => {
    // 40 samples is plenty two hours in and far too few at the end of the day.
    expect(batteryConfidence(40, 2 * 60).sufficient).toBe(true)
    expect(batteryConfidence(40, 16 * 60).sufficient).toBe(false)
  })

  it('sits exactly on the threshold at the boundary', () => {
    const mins = MIN_WAKING_MINUTES_TO_JUDGE
    const exact = (MIN_SAMPLES_PER_WAKING_HOUR * mins) / 60
    expect(batteryConfidence(exact, mins).sufficient).toBe(true)
    expect(batteryConfidence(exact - 1, mins).sufficient).toBe(false)
  })

  it('does not divide by zero before waking', () => {
    const c = batteryConfidence(0, 0)
    expect(c.samplesPerHour).toBe(0)
    // This expectation was `true` until LA-63 and was changed deliberately, once. The case it
    // names is division, and that half is unchanged; the `sufficient` line was incidental to it
    // and was the only assertion anywhere holding the zero-sample grace window in place.
    expect(c.sufficient).toBe(false)
  })

  // LA-63. The grace window is for an unreadable RATE, and zero readings is not one — it is the
  // same nothing after sixteen hours as after twenty minutes. Gating it on elapsed time re-opened
  // RV-38 (`Good / Steady / 50` with no `Limited data` badge on an account that has never worn
  // anything) for the first hour of every day, and made the E2E spec guarding RV-38 fail between
  // 00:00 and 01:00 Brisbane and pass the rest of the day — the Q-356 clock-dependence shape.
  describe('zero samples is never sufficient, however early in the day it is', () => {
    it('refuses the verdict inside the grace window, where it used to grant one', () => {
      expect(batteryConfidence(0, 20).sufficient).toBe(false)
      expect(batteryConfidence(0, MIN_WAKING_MINUTES_TO_JUDGE - 1).sufficient).toBe(false)
    })

    it('is the same answer on both sides of the boundary, which is the point', () => {
      // The defect was an answer that CHANGED at 60 minutes on unchanged data. Reading the
      // boundary from the constant keeps this true if the window ever moves.
      const inside = batteryConfidence(0, MIN_WAKING_MINUTES_TO_JUDGE - 1).sufficient
      const outside = batteryConfidence(0, MIN_WAKING_MINUTES_TO_JUDGE).sufficient
      expect(inside).toBe(outside)
      expect(inside).toBe(false)
    })

    it('still grants grace to a sparse rate, which is what the window is for', () => {
      // One reading 20 minutes in is 3/hour — under the threshold, and far too early to hold
      // against it. Narrowing the exclusion to exactly zero is what keeps this case intact.
      const c = batteryConfidence(1, 20)
      expect(c.samplesPerHour).toBeLessThan(MIN_SAMPLES_PER_WAKING_HOUR)
      expect(c.sufficient).toBe(true)
    })
  })
})
