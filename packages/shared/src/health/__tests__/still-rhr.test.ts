import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'
import { stillDaytimeRhr, CLOUD_HR_COVER_MS, MET_MINUTE_MS, STILL_RHR_MIN_COVERAGE_MIN } from '../still-rhr'

// Fixtures sit at local midday of a day in a zone that is neither Brisbane nor UTC, so a window
// built from a fixed UTC offset instead of the zone's own midnight would put them on another day.
const TZ = 'America/Los_Angeles'
const DAY = '2026-07-14'
const dayStartMs = dateStrMidnightInTz(DAY, TZ).getTime()
const dayEndMs = dateStrMidnightInTz(shiftDateStr(DAY, 1), TZ).getTime()
const MIDDAY = dayStartMs + 12 * 3600_000

/** `n` consecutive minutes from `from`, each with a MET reading and one HR reading in its middle. */
function minutes(from: number, n: number, met: number, bpm: (i: number) => number) {
  return {
    met: Array.from({ length: n }, (_, i) => ({ tsMs: from + i * MET_MINUTE_MS, value: met })),
    hr: Array.from({ length: n }, (_, i) => ({ tsMs: from + i * MET_MINUTE_MS + 20_000, bpm: bpm(i) })),
  }
}
const base = { sleepWindows: [], dayStartMs, dayEndMs }

describe('stillDaytimeRhr, a reading per minute', () => {
  it('is the median HR of the still minutes, with how many minutes stand behind it', () => {
    const still = minutes(MIDDAY, 90, 1.0, i => (i < 45 ? 58 : 62))
    expect(stillDaytimeRhr({ ...base, ...still })).toEqual({ bpm: 60, coverageMin: 90 })
  })

  it('drops active minutes, so a walk does not lift the value', () => {
    const still = minutes(MIDDAY, 70, 1.0, () => 60)
    const walk = minutes(MIDDAY + 70 * MET_MINUTE_MS, 30, 3.0, () => 125)
    const r = stillDaytimeRhr({ ...base, met: [...still.met, ...walk.met], hr: [...still.hr, ...walk.hr] })
    expect(r).toEqual({ bpm: 60, coverageMin: 70 })
  })

  it('does not count a minute nothing measured movement for', () => {
    const still = minutes(MIDDAY, 70, 1.0, () => 60)
    const unmeasured = { hr: Array.from({ length: 40 }, (_, i) => ({ tsMs: MIDDAY + 3 * 3600_000 + i * MET_MINUTE_MS, bpm: 45 })) }
    expect(stillDaytimeRhr({ ...base, met: still.met, hr: [...still.hr, ...unmeasured.hr] })).toEqual({ bpm: 60, coverageMin: 70 })
  })

  it('leaves out recorded sleep', () => {
    const awake = minutes(MIDDAY, 70, 1.0, () => 62)
    const asleep = minutes(MIDDAY + 70 * MET_MINUTE_MS, 60, 1.0, () => 50)
    const r = stillDaytimeRhr({
      ...base, met: [...awake.met, ...asleep.met], hr: [...awake.hr, ...asleep.hr],
      sleepWindows: [{ startMs: MIDDAY + 70 * MET_MINUTE_MS, endMs: MIDDAY + 130 * MET_MINUTE_MS }],
    })
    expect(r).toEqual({ bpm: 62, coverageMin: 70 })
  })

  it('is null, never 0 or a thin median, below the coverage floor', () => {
    expect(stillDaytimeRhr({ ...base, ...minutes(MIDDAY, STILL_RHR_MIN_COVERAGE_MIN - 1, 1.0, () => 60) })).toBeNull()
    expect(stillDaytimeRhr({ ...base, ...minutes(MIDDAY, STILL_RHR_MIN_COVERAGE_MIN, 1.0, () => 60) }))
      .toEqual({ bpm: 60, coverageMin: STILL_RHR_MIN_COVERAGE_MIN })
  })

  it('counts minutes, not readings: many readings in a few minutes stay thin', () => {
    const m = minutes(MIDDAY, 10, 1.0, () => 60)
    const crowd = Array.from({ length: 500 }, (_, i) => ({ tsMs: MIDDAY + (i % 10) * MET_MINUTE_MS + 10_000, bpm: 60 }))
    expect(stillDaytimeRhr({ ...base, met: m.met, hr: crowd })).toBeNull()
  })

  it('is null with no MET at all, and ignores readings outside the plausible band', () => {
    expect(stillDaytimeRhr({ ...base, met: [], hr: [{ tsMs: MIDDAY, bpm: 60 }] })).toBeNull()
    expect(stillDaytimeRhr({ ...base, ...minutes(MIDDAY, 80, 1.0, () => 250) })).toBeNull()
  })

  it('reads only the local day: minutes the next local day are not this day', () => {
    // 23:30 local to 01:30 local the next day. In LA the day ends at UTC 07:00, not at UTC midnight.
    const late = minutes(dayEndMs - 30 * MET_MINUTE_MS, 120, 1.0, i => (i < 30 ? 70 : 52))
    expect(stillDaytimeRhr({ ...base, ...late }, 30)).toEqual({ bpm: 70, coverageMin: 30 })
  })
})

describe('stillDaytimeRhr, a reading every 5 minutes (Oura Cloud)', () => {
  const cloud = { ...base, hrCoverMs: CLOUD_HR_COVER_MS }
  const metOver = (from: number, n: number, value: number) =>
    Array.from({ length: n }, (_, i) => ({ tsMs: from + i * MET_MINUTE_MS, value }))
  const hrEvery5 = (from: number, n: number, bpm: number) =>
    Array.from({ length: n }, (_, i) => ({ tsMs: from + i * CLOUD_HR_COVER_MS, bpm }))

  it('a reading stands for its 5 minutes, so the floor is 12 readings, not 60', () => {
    const met = metOver(MIDDAY - 30 * MET_MINUTE_MS, 200, 1.0)
    expect(stillDaytimeRhr({ ...cloud, met, hr: hrEvery5(MIDDAY, 12, 61) })).toEqual({ bpm: 61, coverageMin: 60 })
    expect(stillDaytimeRhr({ ...cloud, met, hr: hrEvery5(MIDDAY, 11, 61) })).toBeNull()
  })

  it('drops a reading whose 5 minutes include a walk, whole', () => {
    const met = [...metOver(MIDDAY - 30 * MET_MINUTE_MS, 130, 1.0), ...metOver(MIDDAY + 100 * MET_MINUTE_MS, 1, 3.0)]
      .sort((a, b) => a.tsMs - b.tsMs)
    // 20 readings at 60 bpm from MIDDAY every 5 minutes; the one at +100 min spans the active minute.
    const hr = hrEvery5(MIDDAY, 21, 60)
    const r = stillDaytimeRhr({ ...cloud, met, hr })
    expect(r).toEqual({ bpm: 60, coverageMin: 100 })
  })

  it('drops a reading with an unmeasured minute (the ring was off) rather than assuming stillness', () => {
    const met = [...metOver(MIDDAY, 60, 1.0), ...metOver(MIDDAY + 63 * MET_MINUTE_MS, 60, 1.0)]
    // The reading at +60 min covers +58..+62, of which +60..+62 have no MET.
    const r = stillDaytimeRhr({ ...cloud, met, hr: hrEvery5(MIDDAY + 2 * MET_MINUTE_MS, 24, 64) })
    expect(r!.coverageMin % 5).toBe(0)
    expect(r!.coverageMin).toBeLessThan(120)
  })
})
