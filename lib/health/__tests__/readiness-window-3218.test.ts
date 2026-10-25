// #3218: readiness and the night-temperature loader read one 28-day window, built on the local date
// string. The old payload form (`midnight − N×86400000`) lands a day off around a clock change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shiftDateStr, toAestDay, dateStrMidnightInTz, todayInTz } from '@trainingai/shared/date-utils'

const repo = {
  listBodyMetrics: vi.fn(async () => [] as unknown[]),
  listSleepSessions: vi.fn(async () => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async () => [] as unknown[]),
  getOuraDaily: vi.fn(async () => [] as unknown[]),
  getActiveProgram: vi.fn(async () => null as unknown),
  listProgramPhases: vi.fn(async () => [] as unknown[]),
  countSessionsSinceStart: vi.fn(async () => 0),
  getHrForWindow: vi.fn(async () => [] as unknown[]),
  getOuraDailySummary: vi.fn(async () => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async () => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async () => null),
  getMoodLog: vi.fn(async () => null),
  getUserById: vi.fn(async () => ({ timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async () => ({ stepsGoal: null })),
  getOuraCloudSwitchDay: vi.fn(async () => null as string | null),
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { readinessWindowStarts } from '@/lib/health/readiness-night-inputs'
import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { loadNightTemperature } from '@/lib/health/night-temperature'

/** The expression the payload used before #3218. */
const oldBack = (todayIso: string, tz: string, days: number) =>
  toAestDay(new Date(dateStrMidnightInTz(todayIso, tz).getTime() - days * 86_400_000), tz)

describe('readinessWindowStarts', () => {
  it('equals the old expression in Brisbane (no daylight saving) for a year of dates', () => {
    let day = '2026-01-01'
    for (let i = 0; i < 365; i++, day = shiftDateStr(day, 1)) {
      const w = readinessWindowStarts(day)
      expect(w.from28dIso).toBe(oldBack(day, 'Australia/Brisbane', 28))
      expect(w.from7dIso).toBe(oldBack(day, 'Australia/Brisbane', 7))
    }
  })

  it('gives the calendar date 28 days back across Sydney spring-forward (first Sunday of October)', () => {
    // 2026-10-04 is the clock change; 2026-10-25 reaches back across it.
    expect(readinessWindowStarts('2026-10-25').from28dIso).toBe('2026-09-27')
    expect(oldBack('2026-10-25', 'Australia/Sydney', 28)).toBe('2026-09-26')
  })

  it('gives the calendar date 7 days back across Sydney spring-forward', () => {
    expect(readinessWindowStarts('2026-10-08').from7dIso).toBe('2026-10-01')
    expect(oldBack('2026-10-08', 'Australia/Sydney', 7)).toBe('2026-09-30')
  })

  it('gives the calendar date 28 days back across New York spring-forward (March)', () => {
    // 2026-03-08 is the clock change; 2026-04-05 reaches back to it.
    expect(readinessWindowStarts('2026-04-05').from28dIso).toBe('2026-03-08')
    expect(oldBack('2026-04-05', 'America/New_York', 28)).toBe('2026-03-07')
  })

  it('stays on the calendar date across New York fall-back (November)', () => {
    expect(readinessWindowStarts('2026-11-29').from28dIso).toBe('2026-11-01')
  })
})

describe('payload and loader read the same window', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    Object.values(repo).forEach(f => 'mockClear' in f && f.mockClear())
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ['Australia/Sydney', '2026-10-25T02:00:00Z'], // Sydney 2026-10-25 13:00
    ['America/New_York', '2026-04-05T16:00:00Z'], // 2026-04-05 12:00
    ['Australia/Brisbane', '2026-10-21T02:00:00Z'],
  ])('%s', async (tz, now) => {
    vi.setSystemTime(new Date(now))
    await buildReadinessPayload('u1', tz)
    // The HR profile and the Activity finalise make listBodyMetrics reads of their own, so take the
    // date from the clock and look for the payload's window among the calls.
    const todayIso = todayInTz(tz)
    const expected = shiftDateStr(todayIso, -28)
    const payloadCalls = (repo.listBodyMetrics.mock.calls as unknown as string[][]).map(c => c[1])

    repo.listBodyMetrics.mockClear()
    await loadNightTemperature(repo as never, 'u1', todayIso, tz)
    const [, loaderFrom] = (repo.listBodyMetrics.mock.calls as unknown as string[][])[0]

    expect(loaderFrom).toBe(expected)
    expect(payloadCalls).toContain(loaderFrom)
    expect(readinessWindowStarts(todayIso).from28dIso).toBe(loaderFrom)
    // getWorkoutSessionsFrom shares the window start, at that day's local midnight.
    // (The Activity finalise reads sessions too, from its own days, so look for the payload's call.)
    expect(repo.getWorkoutSessionsFrom.mock.calls).toContainEqual(['u1', dateStrMidnightInTz(expected, tz)])
  })
})
