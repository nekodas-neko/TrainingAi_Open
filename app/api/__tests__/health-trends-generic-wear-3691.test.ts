// #3691 item 2: the Body tab's Wear Time trend reads the generic `DailyWear` shape (and the
// temperature line the generic `DailyTemperatureDeviation`) a connector maps, never Oura's field
// names. The connector's mapping is replaced here by one that knows nothing of `oura_daily`'s
// columns, so a route still reading `nonWearTimeSec` or `temperatureDeviation` off the row shows nothing.
import { describe, it, expect, vi } from 'vitest'

const TZ = 'Australia/Brisbane'
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const today = todayInTz(TZ)
const yesterday = shiftDateStr(today, -1)

vi.mock('@/lib/oura/cloud/readiness-signals-map', () => ({
  ouraDailyWear: (rows: { date: string; offWristSec: number }[]) => rows.map(r => ({ date: r.date, nonWearSec: r.offWristSec, source: 'some_source' })),
  ouraTemperatureDeviations: (rows: { date: string; skinDevC: number }[]) => rows.map(r => ({ date: r.date, deviationC: r.skinDevC, source: 'some_source' })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => [{ date: yesterday, offWristSec: 7_200, skinDevC: 0.25 }],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listActivityLogs: async () => [],
  }),
}))

import { GET } from '@/app/api/health/trends/route'

describe('Health trends read the generic wear and temperature shapes (#3691)', () => {
  it('worn hours and the deviation come from the connector\'s shapes', async () => {
    const res = await GET()
    const { trends } = await res.json() as { trends: { date: string; wornHours: number | null; temperatureDeviation: number | null }[] }
    const day = trends.find(t => t.date === yesterday)!
    expect(day.wornHours).toBe(22)
    expect(day.temperatureDeviation).toBe(0.25)
    expect(trends.find(t => t.date === today)!.wornHours).toBeNull()
  })
})
