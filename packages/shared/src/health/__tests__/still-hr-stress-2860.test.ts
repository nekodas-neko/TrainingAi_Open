import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'
import { MET_MINUTE_MS } from '../still-rhr'
import {
  stillHrNormal, stillHrStressDay, stillHrStressSeries, STILL_HR_STRESS_AFTER_EXERCISE_MS, STILL_HR_STRESS_BUCKET_MS, STILL_HR_NORMAL_MIN_DAYS, STILL_HR_NORMAL_WINDOW_DAYS,
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

  it('a dense source counts once a minute, so a strap left on does not outvote the ring', () => {
    // The ring: one still reading every 5 minutes at 60 bpm. A strap: one a second for a single minute at 110.
    const met = Array.from({ length: 30 }, (_, i) => ({ tsMs: at(9) + i * MET_MINUTE_MS, value: 1.0 }))
    const ring = Array.from({ length: 5 }, (_, i) => ({ tsMs: at(9, 3 + i * 5) + 30_000, bpm: 60 }))
    const strap = Array.from({ length: 60 }, (_, i) => ({ tsMs: at(9, 14) + i * 1000, bpm: 110 }))
    const s = stillHrStressSeries({ ...base, met, hr: [...ring, ...strap], normalBpm: 60 })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ level: 0, readings: 6 })
    // And sixty readings inside one minute are one minute, not enough for a level on their own.
    expect(stillHrStressSeries({ ...base, met, hr: strap, normalBpm: 60 })).toEqual([])
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

describe('stillHrStressSeries edge cases (#3938 items 1–3)', () => {
  it('a night with no sleep record does not read calm: low still readings before the first movement are out', () => {
    // No sleep session. 45 bpm still 02:00–03:00 (sleeping), up and moving at 07:00, 60 bpm still 07:30–08:30.
    const d = join(span(at(2), 60, 1.0, 45), span(at(7), 30, 3.0, 100), span(at(7, 30), 60, 1.0, 60))
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(s.some(p => p.t < at(7))).toBe(false)
    expect(s.map(p => p.t)).toEqual([at(7, 45), at(8, 15)])
  })

  it('…and after the last movement, while an ordinary still evening stays', () => {
    // Moving 18:00–18:30, then 62 bpm on the sofa 19:00–20:00, then asleep unrecorded at 46 bpm 23:00–23:59.
    const d = join(span(at(18), 30, 3.0, 100), span(at(19), 60, 1.0, 62), span(at(23), 59, 1.0, 46))
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(s.map(p => p.t)).toEqual([at(19, 15), at(19, 45)])
  })

  it('a still reading below the normal between movements is kept: the rule is for the day\'s edges only', () => {
    const d = join(span(at(9), 10, 3.0, 100), span(at(10), 30, 1.0, 45), span(at(11), 10, 3.0, 100))
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(s.map(p => [p.t, p.level])).toEqual([[at(10, 15), 1]])
  })

  it('today draws a half hour only once it has ended', () => {
    const d = join(span(at(9, 30), 30, 1.0, 60), span(at(10), 11, 1.0, 60))
    const now = at(10, 11)
    const s = stillHrStressSeries({ ...base, ...d, normalBpm: 60, nowMs: now })
    expect(s.map(p => p.t)).toEqual([at(9, 45)])
    // Without `now` the part half hour has enough readings to be drawn, which is the bug.
    expect(stillHrStressSeries({ ...base, ...d, normalBpm: 60 }).map(p => p.t)).toEqual([at(9, 45), at(10, 15)])
  })

  it('sitting after a recorded workout is not stress: its window and 15 minutes after are out', () => {
    // A workout logged 09:00–09:40 with still MET (a strength session the ring scores as still), then
    // 85 bpm while sitting until 10:00, 61 from 10:00.
    const d = join(span(at(9), 55, 1.0, 85), span(at(9, 55), 5, 1.0, 85), span(at(10), 30, 1.0, 61))
    const exerciseWindows = [{ startMs: at(9), endMs: at(9, 40) }]
    const without = stillHrStressSeries({ ...base, ...d, normalBpm: 60 })
    expect(without.find(p => p.t === at(9, 45))?.level).toBe(-1)
    const day = stillHrStressDay({ ...base, ...d, normalBpm: 60, exerciseWindows })
    expect(STILL_HR_STRESS_AFTER_EXERCISE_MS).toBe(15 * 60_000)
    expect(day.points.map(p => p.t)).toEqual([at(10, 15)])
    // The workout's half hours count as moving for the strip.
    expect(day.moving).toEqual([{ startMs: at(9), endMs: at(10) }])
  })

  it('moving spans are the half hours with no level that held an active minute, merged', () => {
    const d = join(span(at(9), 30, 1.0, 60), span(at(9, 30), 60, 4.0, 120), span(at(10, 30), 30, 1.0, 60))
    const day = stillHrStressDay({ ...base, ...d, normalBpm: 60 })
    expect(day.points.map(p => p.t)).toEqual([at(9, 15), at(10, 45)])
    expect(day.moving).toEqual([{ startMs: at(9, 30), endMs: at(10, 30) }])
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
