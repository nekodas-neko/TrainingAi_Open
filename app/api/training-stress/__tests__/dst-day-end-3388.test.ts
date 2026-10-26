// #3388 (item 6): the day's end was `dayStart + 86_400_000`, an hour off on a daylight-saving day. It is
// the next local midnight, so Sydney's 23-hour and 25-hour days are windowed exactly.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Sydney'
const HOUR = 3_600_000

const windows = vi.hoisted(() => ({ daytime: [] as Date[][], kcal: [] as Date[][] }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Sydney' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    listBodyMetrics: async () => [],
    getUserById: async () => ({ dateOfBirth: '1993-06-15', sex: 'male', heightCm: 180 }),
    getOuraDaytimeSignals: async (_u: string, from: Date, to: Date) => {
      windows.daytime.push([from, to])
      return { met: [], temp: [], still: [], motion: [] }
    },
    getOuraCloudActivitySeries: async () => [],
    listSleepSessions: async () => [],
    listActivityLogs: async () => [],
    getHealthConnectIntervals: async (_u: string, _t: string, from: Date, to: Date) => {
      windows.kcal.push([from, to])
      return []
    },
    upsertOuraDailyDerived: async () => undefined,
  }),
}))

import { GET } from '../route'

beforeEach(() => {
  windows.daytime.length = 0
  windows.kcal.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
})

const cases: [string, string, number][] = [
  ['a 23-hour day (clocks go forward)', '2026-10-04', 23],
  ['a 25-hour day (clocks go back)', '2027-04-04', 25],
  ['an ordinary 24-hour day', '2026-10-10', 24],
]

describe('/api/training-stress day window (#3388)', () => {
  for (const [name, day, hours] of cases) {
    it(`ends ${name} at the next local midnight`, async () => {
      vi.setSystemTime(new Date(`${shiftDateStr(day, 3)}T02:00:00Z`)) // a finished day
      await GET(new Request(`http://x/api/training-stress?date=${day}`))
      const [from, to] = windows.daytime[0]
      expect(from.getTime()).toBe(dateStrMidnightInTz(day, TZ).getTime())
      expect(to.getTime()).toBe(dateStrMidnightInTz(shiftDateStr(day, 1), TZ).getTime())
      expect((to.getTime() - from.getTime()) / HOUR).toBe(hours)
      // The movement reads end where the day does.
      expect(windows.kcal.length).toBeGreaterThan(0)
      for (const [, kcalTo] of windows.kcal) expect(kcalTo.getTime()).toBe(to.getTime())
    })
  }
})
