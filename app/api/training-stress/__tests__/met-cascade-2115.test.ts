// #2115 v4 (owner, 2026-10-06): the route feeds the model `MET/min` from every route that has a
// minute, not only the ring's own MET. Pinned through the real handler with a repository double:
// a past day (so the span is the whole day), readiness and profile present so the MET gate is the one
// asked, and four sources: a few ring bins, the ring's sleep-motion frames, a sleep record, Health
// Connect active calories with a weight, and Health Connect steps fast enough to read as walking.
import { describe, it, expect, vi } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DAY = '2026-10-04'
const midnight = dateStrMidnightInTz(DAY, TZ).getTime()
const at = (h: number, m = 0) => midnight + (h * 60 + m) * 60_000

const upsert = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: TZ } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: async () => [{ day: DAY, readinessSource: 'ble-derived', readinessScore: 70 }],
    getOuraDailySummary: async () => [{ nHistory: 60 }],
    listBodyMetrics: async () => [{ date: '2026-09-20', weightKg: 70 }, { date: DAY, restingHeartRate: 55 }],
    getUserById: async () => ({ dateOfBirth: '1993-06-15', sex: 'male' }),
    getOuraCloudActivitySeries: async () => [],
    getOuraDaytimeSignals: async () => ({
      temp: [],
      // One 0x50 event of three bins ending 12:02.
      met: [1.4, 1.6, 1.8].map(value => ({ tsMs: at(12, 2), value })),
      // Sleep-motion frames at 23:00 and 23:01.
      still: [at(23, 0) + 5_000, at(23, 1) + 5_000],
      // #2781: two motion events, at 14:00:30 and 14:01:30, so minutes 14:00, 14:01 and 14:02 fill.
      motion: [{ tsMs: at(14, 0) + 30_000, lowIntensity: 30 }, { tsMs: at(14, 1) + 30_000, lowIntensity: 30 }],
    }),
    // The night ending this morning: 22:00 the evening before to 06:00.
    listSleepSessions: async () => [{ sleepStart: new Date(at(-2)), sleepEnd: new Date(at(6)), ouraId: 'ble:1' }],
    listActivityLogs: async () => [],
    getHealthConnectIntervals: async (_u: unknown, kind: string) => kind === 'active_kcal'
      // 08:00-08:10, 24.5 kcal: 2.45 a minute at 70 kg is 3 MET.
      ? [{ kind, recordId: 'k1', startAt: new Date(at(8)), endAt: new Date(at(8, 10)), value: 24.5, dataOrigin: 'com.watch', deviceType: null }]
      // 17:00-17:30, 3000 steps: 100 steps/min.
      : [{ kind, recordId: 's1', startAt: new Date(at(17)), endAt: new Date(at(17, 30)), value: 3000, dataOrigin: 'com.watch', deviceType: null }],
    upsertOuraDailyDerived: (...a: unknown[]) => upsert(...a),
  }),
}))

import { GET } from '../route'

describe('/api/training-stress reads MET/min through the cascade (#2115 v4)', () => {
  it('counts every route\'s minutes, and leaves the rest missing', async () => {
    const res = await GET(new Request(`http://x/api/training-stress?date=${DAY}`))
    const body = await res.json()
    // Ring MET 3, active calories 10 (rung 1, "provided"); sleep 360 (00:00-06:00) + still 2 +
    // motion 3 + cadence 30 (rung 2, "derived"); the remaining 1440 - 408 minutes nothing measured.
    expect(body.metMix).toEqual({ provided: 13, derived: 395, estimated: 0, missing: 1032 })
    expect(body.metGridLen).toBe(1440)
    // A day this empty is not scored, and it is the MET gate that says so, with the share.
    expect(body).toMatchObject({ status: 'gated', reason: 'insufficient_met' })
    // 12:00-24:00 holds 3 ring + 3 motion + 2 still + 30 cadence minutes: almost all of it is empty.
    expect(body.residualShare).toBeGreaterThan(0.9)
  })
})
