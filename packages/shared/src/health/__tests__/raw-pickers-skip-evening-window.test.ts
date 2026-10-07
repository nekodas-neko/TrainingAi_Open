// #2487 — the raw-session pickers still took a short evening window as a date's night.
//
// #2456 gave the aggregated pickers (`canonicalNightForDate`, `canonicalLatestNight`) the rule that
// a night-band window under ALWAYS_NIGHT_MIN_HOURS sitting on the evening of its own wake date is no
// date's night. The raw pickers in the same file did not have it, and the BLE rollup resolves each
// date's night through `nightPeriodsByDate`, so a date whose only night-band window was a one-hour
// evening bout got that bout written to `oura_daily_summary`. The rule is now applied inside
// `nightPeriodsByDate`, so both families answer the same question the same way.
import { describe, it, expect } from 'vitest'
import {
  ALWAYS_NIGHT_MIN_HOURS,
  aggregateNight,
  canonicalLatestNight,
  canonicalNightForDate,
  groupSleepPeriods,
  latestNight,
  nightForDate,
  nightPeriodsByDate,
  nightSessions,
  totalSleepHours,
  type SleepWindow,
} from '../sleep-night'

const TZ = 'Australia/Brisbane'
const D = '2026-08-31'
const PREV = '2026-08-30'
/** A Brisbane wall-clock time (UTC+10, no DST) on `day`; hours past 24 roll into the next day. */
const bne = (day: string, h: number) => new Date(Date.parse(`${day}T00:00:00Z`) + (h - 10) * 3_600_000)
const win = (startDay: string, startH: number, endDay: string, endH: number, durationHours: number) => ({
  date: endDay,
  sleepStart: bne(startDay, startH),
  sleepEnd: bne(endDay, endH),
  durationHours,
})

const PREV_NIGHT = win('2026-08-29', 22, PREV, 6, 7.8)
const NIGHT = win(PREV, 22.5, D, 6.5, 7.5)
const EVENING_BOUT = win(D, 21.5, D, 22.5, 1)
const byDate = (sessions: SleepWindow[]) => nightPeriodsByDate(groupSleepPeriods(sessions, TZ).nights, TZ)

describe('nightPeriodsByDate', () => {
  it('gives a date whose only night-band window is a short evening bout no night', () => {
    // The premise: the classifier still calls the bout night and dates it to D.
    expect(groupSleepPeriods([EVENING_BOUT], TZ).nights.map(n => n.date)).toEqual([D])
    expect(byDate([EVENING_BOUT]).has(D)).toBe(false)
  })

  it('skips a fragmented evening period whose windows add up to under four hours', () => {
    const a = win(D, 21, D, 22, 1)
    const b = win(D, 22.5, D, 23.8, 1.3)
    const { nights } = groupSleepPeriods([a, b], TZ)
    expect(nights).toHaveLength(1)
    expect(nights[0].windows).toHaveLength(2)
    expect(byDate([a, b]).has(D)).toBe(false)
  })

  it('keeps an evening main sleep of ALWAYS_NIGHT_MIN_HOURS or more (edge case 13)', () => {
    const shiftSleep = win(D, 18.5, D, 23.5, ALWAYS_NIGHT_MIN_HOURS)
    expect(totalSleepHours(byDate([shiftSleep]).get(D)!)).toBe(ALWAYS_NIGHT_MIN_HOURS)
  })

  it('keeps the morning night on a date that also carries an evening bout, in either order', () => {
    for (const order of [[NIGHT, EVENING_BOUT], [EVENING_BOUT, NIGHT]]) {
      const picked = byDate(order).get(D)
      expect(picked?.windows).toEqual([NIGHT])
    }
  })

  it('prefers a short morning night over a longer short evening period', () => {
    const shortMorning = win(D, 2, D, 4, 2)
    const evening = win(D, 20.5, D, 23.5, 3)
    expect(byDate([shortMorning, evening]).get(D)?.windows).toEqual([shortMorning])
  })

  it('leaves an ordinary night and one ending past midnight unchanged', () => {
    const late = win(D, 23.5, '2026-09-01', 0.5, 1)
    const m = byDate([PREV_NIGHT, NIGHT, late])
    expect([...m.keys()].sort()).toEqual([PREV, D, '2026-09-01'])
  })

  it('agrees with canonicalNightForDate on every date — one rule, two shapes', () => {
    const fixtures = [
      [EVENING_BOUT],
      [NIGHT, EVENING_BOUT],
      [PREV_NIGHT, EVENING_BOUT],
      [win(D, 18.5, D, 23.5, 4.5)],
      [win(D, 2, D, 4, 2), win(D, 20.5, D, 23.5, 3)],
    ]
    for (const sessions of fixtures) {
      const aggregated = nightSessions(sessions, TZ)
      const raw = byDate(sessions)
      for (const date of new Set(aggregated.map(n => n.date))) {
        const viaRaw = raw.get(date)
        const viaAggregated = canonicalNightForDate(aggregated, date, TZ)
        expect(viaRaw ? aggregateNight(viaRaw).durationHours : null).toBe(viaAggregated?.durationHours ?? null)
      }
    }
  })
})

describe('nightForDate and latestNight', () => {
  it('nightForDate returns null for a date with only a short evening bout', () => {
    expect(nightForDate([PREV_NIGHT, EVENING_BOUT], D, TZ)).toBeNull()
    expect(nightForDate([PREV_NIGHT, EVENING_BOUT], PREV, TZ)?.windows).toEqual([PREV_NIGHT])
  })

  it('latestNight passes over a latest date holding only a short evening bout, as canonicalLatestNight does', () => {
    const sessions = [PREV_NIGHT, EVENING_BOUT]
    expect(latestNight(sessions, TZ)?.date).toBe(PREV)
    expect(canonicalLatestNight(nightSessions(sessions, TZ), TZ)?.date).toBe(PREV)
  })
})
