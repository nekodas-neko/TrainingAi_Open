import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'
import { MET_MINUTE_MS } from '../still-rhr'
import {
  stillHrNormal, stillHrStressSeries, STILL_HR_STRESS_BUCKET_MS, STILL_HR_NORMAL_MIN_DAYS, STILL_HR_NORMAL_WINDOW_DAYS,
} from '../still-hr-stress'

// A zone that is neither Brisbane nor UTC, so buckets anchored to a fixed offset would misplace them.
const TZ = 'America/Los_Angeles'
const DAY = '2026-10-20'
const dayStartMs = dateStrMidnightInTz(DAY, TZ).getTime()
const dayEndMs = dateStrMidnightInTz(shiftDateStr(DAY, 1), TZ).getTime()
const at = (h: number, m = 0) => dayStartMs + (h * 60 + m) * MET_MINUTE_MS

/** MET every minute over `[fromMs, fromMs + n min)` and heart rate every 2 minutes, mid-minute. */
function span(fromMs: number, n: number, met: number, bpm: number) {
  return {
    met: Array.from({ length: n }, (_, i) => ({ tsMs: fromMs + i * MET_MINUTE_MS, value: met })),
    hr: Array.from({ length: Math.floor(n / 2) }, (_, i) => ({ tsMs: fromMs + i * 2 * MET_MINUTE_MS + 30_000, bpm })),
  }
}
function join(...parts: { met: { tsMs: number; value: number }[]; hr: { tsMs: number; bpm: number }[] }[]) {
  return { met: parts.flatMap(p => p.met), hr: parts.flatMap(p => p.hr) }
}
const base = { sleepWindows: [] as { startMs: number; endMs: number }[], dayStartMs, dayEndMs }

describe('stillHrStressSeries (#2860 F1)', () => {
  it('sets each still half hour against the normal: above it is stressed (negative), below it calm', () => {
    const d = join(span(at(9), 30, 1.0, 60), span(at(10), 30, 1.0, 70), span(at(11), 30, 1.0, 55))
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(s.map(p => p.t)).toEqual([at(9, 15), at(10, 15), at(11, 15)])
    expect(s.map(p => p.level)).toEqual([0, -1, 0.5])
    expect(s.every(p => p.readings >= 3)).toBe(true)
  })

  it('leaves out active minutes and the minutes just after them, so a walk is not read as stress', () => {
    const d = join(span(at(9), 30, 4.0, 120), span(at(9, 30), 30, 1.0, 61))
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(s).toHaveLength(1)
    expect(s[0].t).toBe(at(9, 45))
    expect(s[0].level).toBeCloseTo(-0.1, 6)
  })

  it('leaves out sleep, and a half hour with too few still readings gets no level (never 0)', () => {
    const d = join(span(at(1), 60, 1.0, 50), span(at(14), 4, 1.0, 60))
    const s = stillHrStressSeries({ ...base, ...d, sleepWindows: [{ startMs: at(0), endMs: at(6) }], normalBpm: 60 })
    expect(s).toEqual([])
  })

  it('a reading counts only when the five minutes around it were measured', () => {
    // MET only every other minute: no reading has its whole span measured.
    const met = Array.from({ length: 30 }, (_, i) => ({ tsMs: at(9) + i * 2 * MET_MINUTE_MS, value: 1.0 }))
    const hr = Array.from({ length: 30 }, (_, i) => ({ tsMs: at(9) + i * 2 * MET_MINUTE_MS + 30_000, bpm: 70 }))
    expect(stillHrStressSeries({ ...base, met, hr, normalBpm: 60 })).toEqual([])
  })

  it('draws nothing without a normal', () => {
    const d = span(at(9), 30, 1.0, 60)
    expect(stillHrStressSeries({ ...base, ...d, normalBpm: Number.NaN })).toEqual([])
    expect(stillHrStressSeries({ ...base, ...d, normalBpm: 0 })).toEqual([])
  })

  it('buckets are half hours from local midnight', () => {
    expect(STILL_HR_STRESS_BUCKET_MS).toBe(30 * 60_000)
  })
})

describe('stillHrNormal (#2860 F1)', () => {
  it('is the median of the last fortnight of prior days, skipping days with no value', () => {
    const days = [80, 80, 80, ...Array.from({ length: STILL_HR_NORMAL_WINDOW_DAYS }, (_, i) => (i % 2 ? 58 : 60)), null]
    expect(stillHrNormal(days)).toBe(59)
  })

  it('needs a few days before it says anything', () => {
    expect(stillHrNormal(Array.from({ length: STILL_HR_NORMAL_MIN_DAYS - 1 }, () => 60))).toBeNull()
    expect(stillHrNormal([null, undefined, 60, 61, 62])).toBe(61)
  })
})
