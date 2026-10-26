// #3406: a logged activity that crosses midnight got `end + 86_400_000`, an hour off across a
// daylight-saving change. Its end is the same clock time on the next local day.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Sydney'
const HOUR = 3_600_000

const seen = vi.hoisted(() => ({ activities: [] as { startMs: number; endMs: number }[] }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Sydney' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@trainingai/shared/health/met-input', async (orig) => {
  const real = await orig<typeof import('@trainingai/shared/health/met-input')>()
  return {
    ...real,
    resolveDayMetPerMinute: (input: Parameters<typeof real.resolveDayMetPerMinute>[0], ...rest: unknown[]) => {
      seen.activities = input.activities.map(({ startMs, endMs }) => ({ startMs, endMs }))
      return (real.resolveDayMetPerMinute as (...a: unknown[]) => unknown)(input, ...rest)
    },
  }
})
const activity = vi.hoisted(() => ({ date: '', startTime: '', endTime: '' }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    listBodyMetrics: async () => [],
    getUserById: async () => ({ dateOfBirth: '1993-06-15', sex: 'male', heightCm: 180 }),
    getOuraDaytimeSignals: async () => ({ met: [], temp: [], still: [], motion: [] }),
    getOuraCloudActivitySeries: async () => [],
    listSleepSessions: async () => [],
    listActivityLogs: async () => [{ ...activity, activityType: 'run', durationMin: null }],
    getHealthConnectIntervals: async () => [],
    upsertOuraDailyDerived: async () => undefined,
  }),
}))

import { GET } from '../route'

beforeEach(() => {
  seen.activities = []
  vi.useFakeTimers({ toFake: ['Date'] })
})

const cases: [string, string, string, number][] = [
  ['a 23-hour day (clocks go forward)', '2026-10-04', '2026-10-05', 2],
  ['a 25-hour day (clocks go back)', '2027-04-04', '2027-04-05', 2],
]

describe('/api/training-stress activity that crosses midnight (#3406)', () => {
  for (const [name, day, next, hours] of cases) {
    it(`ends 23:00–01:00 on ${name} at 01:00 the next local day`, async () => {
      Object.assign(activity, { date: day, startTime: '23:00', endTime: '01:00' })
      vi.setSystemTime(new Date(`${next}T22:00:00Z`)) // a finished day
      await GET(new Request(`http://x/api/training-stress?date=${day}`))
      expect(seen.activities).toHaveLength(1)
      const { startMs, endMs } = seen.activities[0]
      expect(endMs).toBe(dateStrMidnightInTz(next, TZ).getTime() + HOUR)
      // The change is at 02:00/03:00, so 23:00 → 01:00 is two real hours either way.
      expect(endMs - startMs).toBe(hours * HOUR)
    })
  }
})
