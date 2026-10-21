// #3220: the resting-HR (28 d) and observed-HR (90 d) windows start at a local midnight found by
// shifting the date string. The old form (`midnight − N×86400000`) lands a day off around a clock
// change in a daylight-saving zone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WorkoutRepository } from '@/lib/data/repository'
import { shiftDateStr, toAestDay, dateStrMidnightInTz, todayInTz } from '../../date-utils'
import { resolveHrProfile } from '../hr-profile'

/** What resolveHrProfile passes its repo for a given tz and clock. */
async function windows(tz: string, now: string) {
  vi.setSystemTime(new Date(now))
  const listBodyMetrics = vi.fn(async () => [] as unknown[])
  const getObservedHrProfile = vi.fn(async () => ({ isReliable: false, max: null, sampleCount: 0 }))
  const repo = {
    getUserById: async () => ({ dateOfBirth: '1990-01-01' }),
    listBodyMetrics, getObservedHrProfile,
    listFitnessTests: async () => [],
  } as unknown as WorkoutRepository
  await resolveHrProfile(repo, 'u', tz)
  return {
    todayIso: todayInTz(tz),
    from28dIso: (listBodyMetrics.mock.calls as unknown as string[][])[0][1],
    observedFrom: (getObservedHrProfile.mock.calls as unknown as Date[][])[0][1],
  }
}

/** The expression the resolver used before #3220. */
const oldBack = (todayIso: string, tz: string, days: number) =>
  new Date(dateStrMidnightInTz(todayIso, tz).getTime() - days * 86_400_000)

describe('resolveHrProfile windows', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  it('equals the old expression in Brisbane (no daylight saving) for a year of dates', async () => {
    let day = '2026-01-01'
    for (let i = 0; i < 365; i++, day = shiftDateStr(day, 1)) {
      const w = await windows('Australia/Brisbane', `${day}T02:00:00Z`) // Brisbane 12:00
      expect(w.todayIso).toBe(day)
      expect(w.from28dIso).toBe(toAestDay(oldBack(day, 'Australia/Brisbane', 28), 'Australia/Brisbane'))
      expect(w.observedFrom.getTime()).toBe(oldBack(day, 'Australia/Brisbane', 90).getTime())
    }
  })

  it('starts the resting window on the calendar date across New York spring-forward', async () => {
    const w = await windows('America/New_York', '2026-04-05T16:00:00Z') // 2026-04-05 12:00
    expect(w.from28dIso).toBe('2026-03-08')
    expect(toAestDay(oldBack('2026-04-05', 'America/New_York', 28), 'America/New_York')).toBe('2026-03-07')
  })

  it('starts the resting window on the calendar date across Sydney spring-forward', async () => {
    const w = await windows('Australia/Sydney', '2026-10-25T02:00:00Z') // 2026-10-25 13:00
    expect(w.from28dIso).toBe('2026-09-27')
    expect(toAestDay(oldBack('2026-10-25', 'Australia/Sydney', 28), 'Australia/Sydney')).toBe('2026-09-26')
  })

  it('starts the observed window at a local midnight across Sydney spring-forward', async () => {
    const w = await windows('Australia/Sydney', '2026-10-25T02:00:00Z')
    // 90 days back is 2026-07-27, before the change, so local midnight there is UTC+10.
    expect(w.observedFrom.toISOString()).toBe('2026-07-26T14:00:00.000Z')
    expect(toAestDay(w.observedFrom, 'Australia/Sydney')).toBe('2026-07-27')
    // 90 days back landing on the change day itself (2026-10-04, clocks go forward at 02:00):
    const near = await windows('Australia/Sydney', '2027-01-02T02:00:00Z') // 2027-01-02 13:00, 90 d back = 2026-10-04
    expect(toAestDay(near.observedFrom, 'Australia/Sydney')).toBe('2026-10-04')
    expect(near.observedFrom.toISOString()).toBe('2026-10-03T14:00:00.000Z')
  })

  it('starts the observed window on the calendar date across New York spring-forward', async () => {
    const w = await windows('America/New_York', '2026-06-06T16:00:00Z') // 90 d back = 2026-03-08
    expect(toAestDay(w.observedFrom, 'America/New_York')).toBe('2026-03-08')
    expect(toAestDay(oldBack('2026-06-06', 'America/New_York', 90), 'America/New_York')).toBe('2026-03-07')
  })
})
