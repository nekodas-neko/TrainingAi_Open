// #3134 — the Activity score, its Steps gauge and the day audit read a day's steps the way every
// screen does: the device total plus the treadmill session's (`dayStepCount`), so a treadmill day
// scores on the steps it shows. The owner chose to keep adding treadmill steps (#3112).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
const NOW = new Date('2026-10-08T05:00:00Z') // 15:00 Brisbane

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const typed = () => repo as never

function withLogs(logs: { date: string; activityType: string; steps?: number | null }[], todaySteps = 4200) {
  const fx = monthFixture(TODAY, TZ, { todaySteps })
  fx.activityLogs = logs
  repo = fixtureRepo(fx)
}

describe('the Activity score reads the day step count (#3134)', () => {
  it("adds a treadmill session's steps to the device count", async () => {
    withLogs([{ date: YESTERDAY, activityType: 'treadmill', steps: 3500 }])
    const device = monthFixture(TODAY, TZ).metrics.find(m => m.date === YESTERDAY)!.steps!
    const day = await loadActivityDay(typed(), 'u1', TZ, YESTERDAY)
    expect(day.signals.steps).toBe(device + 3500)
  })

  it('does not add an outdoor walk, which the device already counted, or another day\'s session', async () => {
    withLogs([
      { date: YESTERDAY, activityType: 'walk', steps: 3500 },
      { date: shiftDateStr(YESTERDAY, -1), activityType: 'treadmill', steps: 3500 },
    ])
    const device = monthFixture(TODAY, TZ).metrics.find(m => m.date === YESTERDAY)!.steps!
    const day = await loadActivityDay(typed(), 'u1', TZ, YESTERDAY)
    expect(day.signals.steps).toBe(device)
  })

  it('scores a treadmill-only day on its steps', async () => {
    const fx = monthFixture(TODAY, TZ)
    fx.metrics = fx.metrics.filter(m => m.date !== YESTERDAY)
    fx.activityLogs = [{ date: YESTERDAY, activityType: 'treadmill', steps: 6000 }]
    repo = fixtureRepo(fx)
    const day = await loadActivityDay(typed(), 'u1', TZ, YESTERDAY)
    expect(day.signals.steps).toBe(6000)
  })

  it("lifts the score with the treadmill steps when the device count is below goal", async () => {
    withLogs([])
    const without = await loadActivityDay(typed(), 'u1', TZ, YESTERDAY)
    withLogs([{ date: YESTERDAY, activityType: 'treadmill', steps: 5000 }])
    const withTreadmill = await loadActivityDay(typed(), 'u1', TZ, YESTERDAY)
    expect(withTreadmill.result!.score).toBeGreaterThanOrEqual(without.result!.score)
    expect(withTreadmill.signals.steps).toBe(without.signals.steps! + 5000)
  })

  it("the page's Steps gauge shows the same count as the score", async () => {
    withLogs([{ date: TODAY, activityType: 'treadmill', steps: 2000 }], 3000)
    const page = await buildReadinessPayload('u1', TZ)
    expect(page.activitySignals!.steps).toBe(5000)
  })
})
