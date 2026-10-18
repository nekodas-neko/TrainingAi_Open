/**
 * #2985 — Body Battery after the switch to the Oura API.
 *
 * - Oura's readiness and sleep scores never anchor the day; without our own it is the default.
 * - Where the dHRV stress series is absent, Oura's `stress_high` drives the stress drain, from the
 *   switch day on; an earlier day never reads it.
 * - The Oura API has no per-minute skin temperature: with only the ring's last night-time readings,
 *   the temperature baseline is "not enough data" and the dHRV series is not built on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ modelCalls: 0 }))

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/health/daytime-stress', async (orig) => ({
  ...(await orig<typeof import('@/lib/health/daytime-stress')>()),
  buildDaytimeStressSeriesFromModel: () => { h.modelCalls++; return [] },
}))

import { computeBodyBatteryDay } from '../body-battery-day'
import type { WorkoutRepository } from '@/lib/data/repository'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-18'
const t0 = new Date('2026-10-17T21:00:00Z') // 07:00 Brisbane on DATE, the first reading
const until = new Date('2026-10-18T07:00:00Z') // 17:00 Brisbane

function stubRepo(opts: { switchDay: string | null; ouraDaily?: Record<string, unknown>; temp?: { tsMs: number; valueC: number }[] }) {
  const hr = Array.from({ length: 60 }, (_, i) => ({ timestamp: new Date(t0.getTime() + i * 600_000), bpm: 62 }))
  const methods: Record<string, unknown> = {
    getOuraDaily: async () => (opts.ouraDaily ? [{ date: DATE, ...opts.ouraDaily }] : []),
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ date: DATE, restingHeartRate: 58, hrvMs: 55 }],
    listSleepSessions: async () => [],
    getHrForWindow: async () => hr,
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => opts.switchDay,
    getOuraDaytimeSignals: async () => ({ temp: opts.temp ?? [], met: [] }),
    getBodyBatteryHistory: async () => [],
    getDaytimeHrvModel: async () => ({ fitted: true }),
  }
  return methods as unknown as WorkoutRepository
}

const run = (opts: Parameters<typeof stubRepo>[0], date = DATE) => computeBodyBatteryDay({
  repo: stubRepo(opts), userId: 'u', tz: TZ, date, until, computeReadinessIfMissing: false,
})

beforeEach(() => { h.modelCalls = 0 })

describe('Body Battery after the switch to the Oura API (#2985)', () => {
  it('never anchors on Oura\'s readiness or sleep score', async () => {
    const { response, snapshot } = await run({ switchDay: DATE, ouraDaily: { readinessScore: 90, sleepScore: 85 } })
    expect(response.anchorSource).toBe('default')
    expect(response.anchor).toBe(50)
    expect(snapshot.anchorSource).toBe('default')
  })

  it('drains on Oura\'s stress_high where there is no dHRV series, spread over the waking day', async () => {
    const quiet = await run({ switchDay: DATE, ouraDaily: { stressHigh: 0 } })
    const { response } = await run({ switchDay: DATE, ouraDaily: { stressHigh: 3_600 } })
    expect(response.stress).toMatchObject({ current: null, draining: false, series: [], highMinutes: 60 })
    // About STRESS_DRAIN_RATE (0.02) per high-stress minute, never more.
    expect(response.stress!.extraDrained).toBeGreaterThan(0.5)
    expect(response.stress!.extraDrained).toBeLessThanOrEqual(1.2)
    expect(response.current).toBeLessThanOrEqual(quiet.response.current)
    expect(response.availability).toEqual([{ metric: 'daytimeStress', state: 'present', gap: null, degradedInputs: [] }])
  })

  it('a day before the switch never reads Oura\'s stress_high', async () => {
    const { response } = await run({ switchDay: '2026-10-19', ouraDaily: { stressHigh: 3_600 } })
    expect(response.stress).toBeNull()
    const none = await run({ switchDay: null, ouraDaily: { stressHigh: 3_600 } })
    expect(none.response.stress).toBeNull()
  })

  it('a temperature baseline from night-time readings alone is not enough data', async () => {
    // The ring's last readings, from 00:00 to 00:15 local, before it stopped.
    const night = Array.from({ length: 15 }, (_, i) => ({ tsMs: Date.parse('2026-10-17T14:00:00Z') + i * 60_000, valueC: 35 }))
    await run({ switchDay: DATE, temp: night })
    expect(h.modelCalls).toBe(0)
    // A reading from the waking day is enough, as before the switch.
    await run({ switchDay: DATE, temp: [...night, { tsMs: t0.getTime() + 3_600_000, valueC: 33 }] })
    expect(h.modelCalls).toBe(1)
  })
})
