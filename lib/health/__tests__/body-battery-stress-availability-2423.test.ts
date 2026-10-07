/**
 * issue 2423 — Body Battery reports why it has no daytime-stress series.
 *
 * `stress` is null whenever the day has no series, and the card rendered nothing for it. The
 * response now carries the same `availability` entry the readiness payload uses for the metric, so
 * the strip's empty state is one `scoreGapText` call and not a second opinion. The builder is driven
 * with a stub repository: what is under test is the entry, not the walk.
 */
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ series: [] as Array<{ t: number; stressLevel: number }> }))

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/health/daytime-stress', async (orig) => ({
  ...(await orig<typeof import('@/lib/health/daytime-stress')>()),
  buildDaytimeStressSeriesFromModel: () => h.series,
}))

import { computeBodyBatteryDay } from '../body-battery-day'
import type { WorkoutRepository } from '@/lib/data/repository'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-06'

function stubRepo(withModelInputs: boolean) {
  const t0 = new Date('2026-10-05T21:00:00Z') // 07:00 Brisbane on DATE
  const hr = Array.from({ length: 40 }, (_, i) => ({ timestamp: new Date(t0.getTime() + i * 600_000), bpm: 62 }))
  const methods: Record<string, unknown> = {
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => (withModelInputs ? [{ restingHeartRate: 58, hrvMs: 55 }] : []),
    listSleepSessions: async () => [],
    getHrForWindow: async () => hr,
    getUserById: async () => null,
    getOuraDaytimeSignals: async () => ({
      temp: withModelInputs ? [{ valueC: 33, ts: t0 }] : [], met: [],
    }),
    getBodyBatteryHistory: async () => [],
    getDaytimeHrvModel: async () => (withModelInputs ? { fitted: true } : null),
  }
  return methods as unknown as WorkoutRepository
}

const run = (withModelInputs: boolean) => computeBodyBatteryDay({
  repo: stubRepo(withModelInputs), userId: 'u', tz: TZ, date: DATE,
  until: new Date('2026-10-06T06:00:00Z'), computeReadinessIfMissing: false,
})

describe('Body Battery reports daytime-stress availability (issue 2423)', () => {
  it('a day with no stress series is absent, with a reason the strip can print', async () => {
    h.series = []
    const { response } = await run(false)
    expect(response.stress).toBeNull()
    expect(response.availability).toEqual([
      { metric: 'daytimeStress', state: 'absent', gap: 'no_input', degradedInputs: [] },
    ])
  })

  it('a day with a series is present, and carries no gap to explain', async () => {
    h.series = [{ t: Date.parse('2026-10-05T23:00:00Z'), stressLevel: -0.3 }, { t: Date.parse('2026-10-06T00:00:00Z'), stressLevel: -0.1 }]
    const { response } = await run(true)
    expect(response.stress).not.toBeNull()
    expect(response.availability).toEqual([
      { metric: 'daytimeStress', state: 'present', gap: null, degradedInputs: [] },
    ])
  })
})
