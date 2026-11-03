/**
 * #3075 stage 3 — Body Battery's wake anchor is when sleep ended, where the night has a hypnogram.
 * A night without one keeps the bed window's end, as every ring-era night does.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/health/daytime-stress', async (orig) => ({
  ...(await orig<typeof import('@/lib/health/daytime-stress')>()),
  buildDaytimeStressSeriesFromModel: () => [],
}))

import { computeBodyBatteryDay } from '../body-battery-day'
import type { WorkoutRepository } from '@/lib/data/repository'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-18'
const BED_START = new Date('2026-10-17T12:00:00Z') // 22:00 Brisbane
const BED_END = new Date('2026-10-17T20:00:00Z')   // 06:00 Brisbane
const REAL_WAKE = new Date('2026-10-17T19:30:00Z') // 05:30, when the last non-awake epoch ended
const until = new Date('2026-10-18T07:00:00Z')     // 17:00 Brisbane

function run(over: Record<string, unknown>) {
  const hr = Array.from({ length: 60 }, (_, i) => ({ timestamp: new Date(Date.parse('2026-10-17T21:00:00Z') + i * 600_000), bpm: 62 }))
  const repo = {
    getOuraDaily: async () => [], getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ date: DATE, restingHeartRate: 58, hrvMs: 55 }],
    listSleepSessions: async () => [{
      id: 's1', userId: 'u', date: DATE, sleepStart: BED_START, sleepEnd: BED_END, durationHours: 7.2, createdAt: BED_END,
      ouraId: 'sl-1', ...over,
    }],
    getHrForWindow: async () => hr, getUserById: async () => null, getOuraCloudSwitchDay: async () => '2026-10-17',
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }), getBodyBatteryHistory: async () => [],
    getDaytimeHrvModel: async () => ({ fitted: true }),
  } as unknown as WorkoutRepository
  return computeBodyBatteryDay({ repo, userId: 'u', tz: TZ, date: DATE, until, computeReadinessIfMissing: false })
}

describe('Body Battery wake anchor (#3075 stage 3)', () => {
  it('an Oura Cloud night with a final wake anchors on it, not on the bed window\'s end', async () => {
    const { response } = await run({ finalWakeAt: REAL_WAKE })
    expect(response.wakeTime).toBe(REAL_WAKE.getTime())
  })

  it('a night without one keeps the bed window\'s end', async () => {
    const { response } = await run({})
    expect(response.wakeTime).toBe(BED_END.getTime())
  })
})
