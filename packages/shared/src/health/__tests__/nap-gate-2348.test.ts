// #2348 — the nap gate, against the owner's own rows from the proposal (production, read 2026-10-06).
import { describe, it, expect } from 'vitest'
import { isDaytimeStart, napGateReference, napGateVerdict, NAP_GATE_MIN_NIGHTS } from '../nap-gate'

const TZ = 'Australia/Brisbane'
// A Brisbane wall-clock time on a given date, as an instant (Brisbane is UTC+10, no DST).
const at = (date: string, hh: number, mm = 0) => new Date(Date.parse(`${date}T00:00:00Z`) + ((hh - 10) * 60 + mm) * 60_000)

// Personal reference: the owner's p90 night HR is 68 and p10 night HRV 33.6. Twenty nights whose
// order statistics land there.
const nights = Array.from({ length: 20 }, (_, i) => ({
  sleepStart: at(`2026-09-${String(i + 1).padStart(2, '0')}`, 22, 30),
  durationHours: 7.5,
  avgHeartRate: [58, 59, 60, 60, 61, 61, 62, 62, 63, 63, 63, 64, 64, 65, 65, 66, 67, 68, 68, 70][i],
  averageHrvMs: [30, 33, 34, 40, 45, 48, 50, 52, 54, 55, 55, 56, 58, 60, 62, 64, 66, 68, 70, 75][i],
  lowestHeartRate: 54,
}))

describe('isDaytimeStart', () => {
  it('is 04:00 inclusive to 20:00 exclusive, local', () => {
    expect(isDaytimeStart(at('2026-09-10', 3, 59), TZ)).toBe(false)
    expect(isDaytimeStart(at('2026-09-10', 4, 0), TZ)).toBe(true)
    expect(isDaytimeStart(at('2026-09-10', 19, 59), TZ)).toBe(true)
    expect(isDaytimeStart(at('2026-09-10', 20, 0), TZ)).toBe(false)
  })
})

describe('napGateReference', () => {
  it('learns the p90 HR and p10 HRV from the nights only', () => {
    const desk = { sleepStart: at('2026-09-15', 13), durationHours: 2, avgHeartRate: 87, averageHrvMs: 16.5 }
    const ref = napGateReference([...nights, desk], TZ)
    expect(ref.kind).toBe('personal')
    if (ref.kind !== 'personal') return
    expect(ref.nights).toBe(20)
    expect(ref.hrMax).toBeCloseTo(68, 0)
    expect(ref.hrvMin).toBeCloseTo(33.9, 1)
  })

  it(`falls back to the population default under ${NAP_GATE_MIN_NIGHTS} nights`, () => {
    const ref = napGateReference(nights.slice(0, NAP_GATE_MIN_NIGHTS - 1), TZ)
    expect(ref).toEqual({ kind: 'population', nights: NAP_GATE_MIN_NIGHTS - 1, restingHr: 54 })
  })

  it('ignores a 0 h night', () => {
    const ref = napGateReference(nights.map(n => ({ ...n, durationHours: 0 })), TZ)
    expect(ref).toEqual({ kind: 'population', nights: 0, restingHr: null })
  })
})

describe('napGateVerdict — the owner\'s daytime rows (proposal table)', () => {
  const ref = napGateReference(nights, TZ)
  const row = (date: string, hh: number, durationHours: number, avgHeartRate: number | null, averageHrvMs: number | null) =>
    napGateVerdict({ sleepStart: at(date, hh), durationHours, avgHeartRate, averageHrvMs }, ref, TZ)

  it('keeps the one the issue called a genuine sleep (09-18, HR 64, HRV 56)', () => {
    expect(row('2026-09-18', 13, 4.08, 64, 56)).toEqual({ keep: true, reason: 'nap' })
  })

  it('drops the ones it called a desk (09-15 HR 87 / HRV 16.5, 10-02 HR 84)', () => {
    expect(row('2026-09-15', 13, 1, 87, 16.5).keep).toBe(false)
    expect(row('2026-10-02', 13, 1, 84, null)).toEqual({ keep: false, reason: 'hr_above_nights' })
  })

  it('drops the long desk windows that competed with the night (08-27, 09-23)', () => {
    expect(row('2026-08-27', 11, 4.75, 74, 26.5).keep).toBe(false)
    expect(row('2026-09-23', 11, 6.17, 73, 24.5).keep).toBe(false)
  })

  it('drops a window under the HRV floor even at a low HR', () => {
    expect(row('2026-09-20', 14, 1, 66, 25)).toEqual({ keep: false, reason: 'hrv_below_nights' })
  })

  it('drops a 0 h window: the stager found no sleep in it', () => {
    expect(row('2026-08-09', 14, 0, 60, 50)).toEqual({ keep: false, reason: 'no_sleep' })
  })

  it('never gates a night, however it looks', () => {
    expect(napGateVerdict({ sleepStart: at('2026-09-10', 23), durationHours: 0, avgHeartRate: 90, averageHrvMs: 10 }, ref, TZ))
      .toEqual({ keep: true, reason: 'night' })
  })
})

describe('napGateVerdict — population default', () => {
  const ref = napGateReference(nights.slice(0, 3), TZ) // resting HR 54 → bar 64
  const v = (durationHours: number, avgHeartRate: number | null) =>
    napGateVerdict({ sleepStart: at('2026-09-18', 14), durationHours, avgHeartRate, averageHrvMs: null }, ref, TZ)

  it('keeps 20 min or more at resting HR + 10 or below', () => {
    expect(v(1 / 3, 64)).toEqual({ keep: true, reason: 'nap' })
  })
  it('drops under 20 min, or above resting HR + 10', () => {
    expect(v(0.25, 55)).toEqual({ keep: false, reason: 'too_short' })
    expect(v(1, 65)).toEqual({ keep: false, reason: 'hr_above_nights' })
  })
})
