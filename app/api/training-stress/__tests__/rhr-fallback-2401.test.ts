// #2401 — resting heart rate is stored per day from the night's sleep, and the route read only the
// asked day's row. One night with no recorded sleep left that day with no rate and the score gated
// as `no_profile`. It now borrows the most recent rate within a week and says which day it was.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>
const listBodyMetrics = vi.fn(async (..._a: unknown[]) => [] as Row[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: async () => [{ readinessSource: 'ble-derived', readinessScore: 70 }],
    getOuraDailySummary: async () => [{ nHistory: 30 }],
    listBodyMetrics: (...a: unknown[]) => listBodyMetrics(...a),
    getUserById: async () => ({ dateOfBirth: '1990-01-01', sex: 'male' }),
    getOuraDaytimeSignals: async () => ({ met: [], temp: [] }),
    upsertOuraDailyDerived: async () => undefined,
  }),
}))

import { GET } from '../route'

const DAY = '2026-10-05'
const ask = async () => (await GET(new Request(`http://localhost/api/training-stress?date=${DAY}`))).json()

beforeEach(() => listBodyMetrics.mockReset())

describe('/api/training-stress — resting heart rate borrowed from an earlier day (#2401)', () => {
  it('still gates as no_profile when no resting rate exists in the window', async () => {
    listBodyMetrics.mockResolvedValue([])
    const body = await ask()
    expect(body.reason).toBe('no_profile')
    expect(body.rhrFromDay).toBeUndefined()
  })

  it('gets past the profile gate with an earlier resting rate, and names the day it used', async () => {
    const earlier = shiftDateStr(DAY, -3)
    listBodyMetrics.mockResolvedValue([{ date: earlier, restingHeartRate: 52 }, { date: DAY }])
    const body = await ask()
    expect(body.reason).toBe('insufficient_met')
    expect(body.rhrFromDay).toBe(earlier)
  })

  it("does not flag a day that has its own resting rate", async () => {
    listBodyMetrics.mockResolvedValue([{ date: shiftDateStr(DAY, -3), restingHeartRate: 52 }, { date: DAY, restingHeartRate: 49 }])
    const body = await ask()
    expect(body.reason).toBe('insufficient_met')
    expect(body.rhrFromDay).toBeUndefined()
  })

  it('reads body metrics over the seven days ending on the asked day', async () => {
    listBodyMetrics.mockResolvedValue([])
    await ask()
    expect(listBodyMetrics).toHaveBeenCalledWith('u-1', shiftDateStr(DAY, -7), DAY)
  })
})
