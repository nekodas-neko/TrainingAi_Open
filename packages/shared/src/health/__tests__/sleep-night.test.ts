import { describe, it, expect } from 'vitest'
import {
  isNightWindow, groupSleepPeriods, nightForDate, nightSessions, aggregateNight,
  MAX_INTRA_NIGHT_GAP_HOURS,
  ALWAYS_NIGHT_MIN_HOURS,
} from '@trainingai/shared/health/sleep-night'

const TZ = 'Australia/Brisbane' // UTC+10, no DST
/** Brisbane local time on `day` of July 2026, as a UTC instant. */
const bne = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 6, day, h - 10, m))
const w = (start: Date, end: Date, dur?: number) => ({
  sleepStart: start, sleepEnd: end,
  durationHours: dur ?? (end.getTime() - start.getTime()) / 3_600_000,
  date: '', deepSleepHours: null, remSleepHours: null, lightSleepHours: null, awakHours: 0,
  efficiency: null, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null,
  lowestHeartRate: null, restlessPeriods: null, respiratoryRate: null, timeInBedHours: null,
})

describe('night vs nap classification', () => {
  // Every one of these is a real production window; the naps are the ones that used to win.
  it.each([
    ['night 22:00 → 06:00', bne(20, 22), bne(21, 6), true],
    ['night 20:52 → 06:47 (early bed)', bne(26, 20, 52), bne(27, 6, 47), true],
    ['night 23:18 → 05:53 (late bed)', bne(24, 23, 18), bne(25, 5, 53), true],
    ['evening nap 20:33 → 21:14', bne(20, 20, 33), bne(20, 21, 14), false],
    ['evening nap 17:32 → 19:06', bne(21, 17, 32), bne(21, 19, 6), false],
    ['morning nap 09:31 → 10:57', bne(16, 9, 31), bne(16, 10, 57), false],
    ['the 0-sleep artefact 16:40 → 17:25', bne(26, 16, 40), bne(26, 17, 25), false],
  ])('%s', (_label, start, end, expected) => {
    expect(isNightWindow(w(start, end), TZ)).toBe(expected)
  })
})

describe('grouping', () => {
  // Shape taken from the one genuine fragmented night in production (2026-05-29, 2.53 h + 4.02 h
  // split by a 105-minute wake-up). Dates here are July only because the local helper builds July.
  it('reassembles a genuinely fragmented night across a 105-minute gap', () => {
    const a = w(bne(28, 22, 6), bne(29, 0, 38), 2.53)
    const b = w(bne(29, 2, 23), bne(29, 6, 24), 4.02)
    const { nights, naps } = groupSleepPeriods([a, b], TZ)
    expect(naps).toHaveLength(0)
    expect(nights).toHaveLength(1)
    expect(nights[0].windows).toHaveLength(2)
    expect(nights[0].gapHours[0]).toBeCloseTo(1.75, 2)
    expect(nights[0].date).toBe('2026-07-29')
  })

  it('does NOT merge an evening nap into the night, despite a SHORTER gap than the fragmented night', () => {
    // 2026-06-29 production: nap ends 21:14, night starts 22:21 — 67 min, less than the 105 min above.
    const nap = w(bne(20, 20, 33), bne(20, 21, 14), 0.19)
    const night = w(bne(20, 22, 21), bne(21, 7, 35), 8.48)
    const { nights, naps } = groupSleepPeriods([nap, night], TZ)
    expect(naps).toHaveLength(1)
    expect(nights).toHaveLength(1)
    expect(nights[0].windows).toHaveLength(1)
    expect(nights[0].windows[0].durationHours).toBe(8.48)
  })

  it('starts a new night when the gap exceeds the intra-night limit', () => {
    const a = w(bne(20, 22), bne(21, 0, 30), 2.5)
    const b = w(bne(21, 0, 30 + MAX_INTRA_NIGHT_GAP_HOURS * 60 + 30), bne(21, 8), 3)
    expect(groupSleepPeriods([a, b], TZ).nights.length).toBeGreaterThan(1)
  })
})

describe('nightForDate — the F-1 / Q-1 regression', () => {
  it('picks the 7.00 h night over the later 0-sleep artefact on 2026-07-26', () => {
    const night = w(bne(25, 21, 54), bne(26, 5, 19), 7.0)
    const artefact = w(bne(26, 16, 40), bne(26, 17, 25), 0.0)
    const picked = nightForDate([night, artefact], '2026-07-26', TZ)
    expect(picked!.windows).toHaveLength(1)
    expect(picked!.windows[0].durationHours).toBe(7.0)
  })

  it('picks the 7.86 h night over the 0.33 h nap on 2026-07-07 (the original Sleep-Score-of-5 bug)', () => {
    const night = w(bne(6, 22, 16), bne(7, 7, 2), 7.86)
    const nap = w(bne(7, 10, 44), bne(7, 11, 3), 0.33)
    expect(nightForDate([night, nap], '2026-07-07', TZ)!.windows[0].durationHours).toBe(7.86)
  })

  it('nightSessions drops naps entirely and returns one session per night, oldest first', () => {
    const out = nightSessions([
      w(bne(25, 21, 54), bne(26, 5, 19), 7.0),
      w(bne(26, 16, 40), bne(26, 17, 25), 0.0),
      w(bne(26, 20, 52), bne(27, 6, 47), 9.33),
    ], TZ)
    expect(out.map(s => s.date)).toEqual(['2026-07-26', '2026-07-27'])
  })
})

describe('aggregateNight', () => {
  it('leaves a single-window night untouched apart from restamping its wake day', () => {
    // `date: 'stale'` stands in for the production rows whose stored date disagrees with wake time.
    const only = { ...w(bne(20, 22), bne(21, 6), 7.5), date: 'stale', efficiency: 94, restlessPeriods: 3 }
    const period = groupSleepPeriods([only], TZ).nights[0]
    expect(aggregateNight(period)).toEqual({ ...only, date: '2026-07-21' })
  })

  it('sums sleep, spans time-in-bed across the gap, and charges the gap to efficiency', () => {
    const a = { ...w(bne(28, 22, 6), bne(29, 0, 38), 2.53), deepSleepHours: 0.4, awakHours: 0.1, avgHeartRate: 60, averageHrvMs: 40, lowestHeartRate: 58, restlessPeriods: 1 }
    const b = { ...w(bne(29, 2, 23), bne(29, 6, 24), 4.02), deepSleepHours: 0.6, awakHours: 0.2, avgHeartRate: 70, averageHrvMs: 50, lowestHeartRate: 55, restlessPeriods: 2 }
    const agg = aggregateNight(groupSleepPeriods([a, b], TZ).nights[0])

    expect(agg.durationHours).toBeCloseTo(6.55, 2)
    expect(agg.sleepStart).toEqual(a.sleepStart)
    expect(agg.sleepEnd).toEqual(b.sleepEnd)
    expect(agg.timeInBedHours).toBeCloseTo(8.3, 1)          // 22:06 → 06:24
    expect(agg.efficiency).toBe(79)                          // 6.55 / 8.3 — the gap costs it
    expect(agg.deepSleepHours).toBeCloseTo(1.0, 5)
    expect(agg.awakHours).toBeCloseTo(0.1 + 0.2 + 1.75, 2)   // own awake time + the wake-up gap
    expect(agg.restlessPeriods).toBe(4)                      // 1 + 2 + one gap = one awakening
    expect(agg.lowestHeartRate).toBe(55)                     // the true minimum across the night
    // Duration-weighted, so the longer 4.02 h half dominates the 2.53 h one.
    expect(agg.avgHeartRate!).toBeCloseTo((60 * 2.53 + 70 * 4.02) / 6.55, 3)
    expect(agg.averageHrvMs!).toBeCloseTo((40 * 2.53 + 50 * 4.02) / 6.55, 3)
  })
})

describe('long sleep is night sleep wherever it sat', () => {
  it('treats an 8 h daytime sleep as a night, so a shift worker still gets scored', () => {
    // 11:00 → 19:00 Brisbane: midpoint 15:00, nowhere near the night band.
    const shift = w(bne(20, 11), bne(20, 19), 8)
    expect(isNightWindow(shift, TZ)).toBe(true)
    expect(groupSleepPeriods([shift], TZ).naps).toHaveLength(0)
  })

  it('still calls the longest real nap a nap — the escape hatch is well clear of them', () => {
    // Longest nap in the production history is 1.42 h.
    expect(isNightWindow(w(bne(10, 17, 34), bne(10, 19, 25), 1.42), TZ)).toBe(false)
  })
})

describe('degenerate rows (Q-10)', () => {
  const at = (iso: string) => new Date(iso)
  // Brisbane is UTC+10, so 12:00Z is 22:00 local — inside the night band.
  const night = (startZ: string, endZ: string, durationHours: number | null) => ({
    date: '2026-07-21', sleepStart: at(startZ), sleepEnd: at(endZ), durationHours,
  })

  it('drops a zero-duration row so it cannot become the most recent night', () => {
    const real = night('2026-07-20T12:00:00Z', '2026-07-20T19:30:00Z', 7.5)
    // A later, separate zero-duration row — the shape that nulls previousNight in readiness.
    const dead = night('2026-07-21T12:00:00Z', '2026-07-21T12:00:00Z', 0)
    const nights = nightSessions([real, dead])
    expect(nights).toHaveLength(1)
    expect(nights[0].durationHours).toBe(7.5)
  })

  it('drops a null-duration row too', () => {
    const real = night('2026-07-20T12:00:00Z', '2026-07-20T19:30:00Z', 7.5)
    const dead = night('2026-07-21T12:00:00Z', '2026-07-21T13:00:00Z', null)
    expect(nightSessions([real, dead])).toHaveLength(1)
  })

  // The distinction that matters: short is not degenerate. groupSleepPeriods merges short windows
  // into fragmented nights on purpose, and computeSleepScore scores a 15-minute session fine.
  it('keeps a short but real window, and still merges it into its night', () => {
    const first  = night('2026-07-20T12:00:00Z', '2026-07-20T16:00:00Z', 4)
    const brief  = night('2026-07-20T16:30:00Z', '2026-07-20T16:45:00Z', 0.25)  // 15 min
    const nights = nightSessions([first, brief])
    expect(nights).toHaveLength(1)
    expect(nights[0].durationHours).toBeCloseTo(4.25, 3)
  })

  it('leaves a night alone when nothing is degenerate', () => {
    const only = night('2026-07-20T12:00:00Z', '2026-07-20T19:30:00Z', 7.5)
    expect(nightSessions([only])).toHaveLength(1)
  })

  it('returns nothing when every row is degenerate', () => {
    expect(nightSessions([night('2026-07-20T12:00:00Z', '2026-07-20T12:00:00Z', 0)])).toHaveLength(0)
  })
})
