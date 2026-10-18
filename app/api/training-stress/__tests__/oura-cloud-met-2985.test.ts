// #2985 (#2981): after the switch to the Oura API the ring sends no MET, and Oura's series is rung 1.
// A day with only Oura's MET must score Training Stress instead of failing the MET gate, and a
// non-wear stretch must stay missing. Driven through the real handler with a repository double.
import { describe, it, expect, vi } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DAY = '2026-10-18'
const midnight = dateStrMidnightInTz(DAY, TZ).getTime()
const at = (h: number, m = 0) => midnight + (h * 60 + m) * 60_000

// A resting day at 1.2 MET with an hour's walk at 3.5 from 12:00 local.
const metDay = (startMs: number) => ({
  interval: 60,
  items: Array.from({ length: 1440 }, (_, i) => {
    const t = startMs + i * 60_000
    return t >= at(12) && t < at(13) ? 3.5 : 1.2
  }),
  timestamp: new Date(startMs).toISOString(),
})
// The ring was off for the two hours from 16:00: 24 non-wear slots in Oura's class string.
const classDay = '1'.repeat(144) + '0'.repeat(24) + '1'.repeat(120)

const upsert = vi.fn(async (..._a: unknown[]) => undefined)
const cloudActivity = vi.fn(async (..._a: unknown[]) => [
  { date: '2026-10-17', met: metDay(at(-20)), class5Min: '1'.repeat(288) },
  { date: DAY, met: metDay(at(4)), class5Min: classDay },
])
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: TZ } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: async () => [{ day: DAY, readinessSource: 'ble-derived', readinessScore: 70 }],
    getOuraDailySummary: async () => [{ nHistory: 60 }],
    listBodyMetrics: async () => [{ date: '2026-10-01', weightKg: 70 }, { date: DAY, restingHeartRate: 55 }],
    getUserById: async () => ({ dateOfBirth: '1993-06-15', sex: 'male', heightCm: 180 }),
    // No ring after the switch.
    getOuraDaytimeSignals: async () => ({ met: [], temp: [], still: [], motion: [] }),
    getOuraCloudActivitySeries: (...a: unknown[]) => cloudActivity(...a),
    listSleepSessions: async () => [],
    listActivityLogs: async () => [],
    getHealthConnectIntervals: async () => [],
    upsertOuraDailyDerived: (...a: unknown[]) => upsert(...a),
  }),
}))

import { GET } from '../route'

// A finished day, so the span is the whole of it.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))

describe('/api/training-stress on a day with only Oura\'s MET (#2985)', () => {
  it('scores the day from Oura\'s series, with the non-wear stretch missing', async () => {
    const res = await GET(new Request(`http://x/api/training-stress?date=${DAY}`))
    const body = await res.json()
    // Its own day and the day before: Oura's day starts at 4 a.m.
    expect(cloudActivity).toHaveBeenCalledWith('u-1', '2026-10-17', DAY)
    expect(body.metMix).toEqual({ provided: 1440 - 120, derived: 0, estimated: 0, missing: 120 })
    // Past both MET gates: the floors and the 20% empty-share cap. What answers next is the scorer,
    // whose fitted constants are vendor files this environment may not hold, so it is `ok` with
    // them and `scorer_no_output` without, never `insufficient_met`.
    expect(body.status === 'ok' ? 'ok' : body.reason).toMatch(/^(ok|scorer_no_output)$/)
    expect(body.residualShare).toBeLessThan(0.2)
    expect(upsert).toHaveBeenCalledWith('u-1', DAY, expect.objectContaining({ trainingLoadGridLen: 1440, trainingLoadValidMin: 1320 }))
  })
})
