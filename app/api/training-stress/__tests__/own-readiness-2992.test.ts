// #2992 — training stress reads our own composite whatever device fed it, and judges whether that
// composite is still learning from its stored contributors, not from the ring summary. Before this,
// every day without a ring row (every Oura Cloud day since 17 Oct) gated as `readiness_learning`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const getOuraDailyDerived = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraDailySummary = vi.fn(async (..._a: unknown[]) => [] as Row[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: (...a: unknown[]) => getOuraDailyDerived(...a),
    getOuraDailySummary: (...a: unknown[]) => getOuraDailySummary(...a),
    listBodyMetrics: async () => [{ date: DAY, restingHeartRate: 52 }],
    getUserById: async () => ({ dateOfBirth: '1990-01-01', sex: 'male' }),
    getOuraDaytimeSignals: async () => ({ met: [], temp: [], still: [], motion: [] }),
    getOuraCloudActivitySeries: async () => [],
    listSleepSessions: async () => [],
    listActivityLogs: async () => [],
    getHealthConnectIntervals: async () => [],
    upsertOuraDailyDerived: async () => undefined,
  }),
}))

import { GET } from '../route'

const DAY = '2026-11-20'
const ask = async () => (await GET(new Request(`http://localhost/api/training-stress?date=${DAY}`))).json()

const contributor = (gap: 'awaiting_baseline' | null) =>
  ({ score: gap ? 50 : 64, provisional: gap != null, input: gap ? null : 0.4, gap, source: 'oura_cloud' })
const contributors = (gap: 'awaiting_baseline' | null) => ({
  restingHeartRate: contributor(gap), hrvBalance: contributor(gap), temperature: contributor(gap), sleepBalance: contributor(gap),
})

beforeEach(() => {
  getOuraDailyDerived.mockReset()
  getOuraDailySummary.mockReset()
  getOuraDailySummary.mockResolvedValue([]) // no ring summary: an Oura Cloud day
})

describe('/api/training-stress — our own readiness on an Oura-only day (#2992)', () => {
  it('an Oura-only day with our composite stored is not readiness_learning', async () => {
    getOuraDailyDerived.mockResolvedValue([{ day: DAY, readinessSource: 'generic-derived', readinessScore: 66, readinessContributors: contributors(null) }])
    const body = await ask()
    expect(body.reason).not.toBe('readiness_learning')
    expect(body.reason).not.toBe('no_readiness')
  })

  it('is still learning while the device\'s normals are', async () => {
    getOuraDailyDerived.mockResolvedValue([{ day: DAY, readinessSource: 'generic-derived', readinessScore: 55, readinessContributors: contributors('awaiting_baseline') }])
    expect((await ask()).reason).toBe('readiness_learning')
  })

  it('keeps the ring-summary rule for a row whose contributors cannot say', async () => {
    getOuraDailyDerived.mockResolvedValue([{ day: DAY, readinessSource: 'ble-derived', readinessScore: 70, readinessContributors: null }])
    getOuraDailySummary.mockResolvedValue([{ nHistory: 30 }])
    expect((await ask()).reason).not.toBe('readiness_learning')
    getOuraDailySummary.mockResolvedValue([{ nHistory: 3 }])
    expect((await ask()).reason).toBe('readiness_learning')
  })

  it('reads only the asked day', async () => {
    getOuraDailyDerived.mockResolvedValue([])
    await ask()
    expect(getOuraDailyDerived).toHaveBeenCalledWith('u-1', DAY, DAY)
  })
})
