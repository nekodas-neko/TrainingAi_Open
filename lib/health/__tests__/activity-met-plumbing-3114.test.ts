// Issue 3114 — Oura's per-minute MET decides the move lane through the one Activity scorer, so the
// stored (finalised) score, the live score and the day audit all see it. A MET read that fails on a
// finished day must leave the day un-finalised: a swallowed failure would be stored as final.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { activityFinalisedAt } from '@trainingai/shared/health/activity-day'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { monthFixture, fixtureRepo, type ActivityFixture } from './fixtures/activity-day-fixtures'

let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { finaliseActivityDay } from '@/lib/health/activity-finalise'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
// Both sides are fixed: the fixture is built on TODAY and the clock sits at 15:00 Brisbane on it.
const NOW = new Date('2026-10-08T05:00:00Z')

beforeEach(() => {
  reportServerError.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const typedRepo = () => repo as unknown as Parameters<typeof finaliseActivityDay>[0]

/** A day of per-minute MET from local midnight: `moving` hours at 3.0, `edge` hours at 1.79, the rest 1.0. */
function metDay(date: string, moving: number[], edge: number[] = [], wornFrom = 6, wornTo = 22): ActivityFixture['cloudActivity'] extends (infer R)[] | undefined ? R : never {
  const items = Array.from({ length: 1440 }, (_, i) => {
    const h = Math.floor(i / 60)
    if (h < wornFrom || h >= wornTo) return null
    return moving.includes(h) ? 3 : edge.includes(h) ? 1.79 : 1
  })
  return { date, met: { interval: 60, items, timestamp: new Date(dateStrMidnightInTz(date, TZ)).toISOString() }, class5Min: null }
}

/** Heart rate is gone, so only MET can say a move happened. */
function metOnly(): ActivityFixture {
  const f = monthFixture(TODAY, TZ)
  f.hr = []
  f.cloudActivity = [metDay(YESTERDAY, [7, 11], [9]), metDay(TODAY, [7], [9])]
  return f
}

describe('MET reaches the one scorer (#3114)', () => {
  it('scores a finished day from MET alone: moved at 1.8 or more, not at 1.79', async () => {
    repo = fixtureRepo(metOnly())
    const day = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(day.signals.moveHours).toBe(2) // hours 7 and 11; hour 9 sits at 1.79
    expect(day.signals.moveHoursGoal).not.toBeNull()
  })

  it('leaves the move lane empty when there is neither heart rate nor MET', async () => {
    const f = monthFixture(TODAY, TZ)
    f.hr = []
    repo = fixtureRepo(f)
    const day = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(day.signals.moveHours).toBeNull()
  })

  it('stores the MET-derived value when the payload finalises yesterday, and shows it live for today', async () => {
    const fx = metOnly()
    repo = fixtureRepo(fx)
    const payload = await buildReadinessPayload('u1', TZ)

    const stored = fx.derived.find(r => r.day === YESTERDAY)!
    expect(activityFinalisedAt(stored.activityContributors)).not.toBeNull()
    const final = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(final.signals.moveHours).toBe(2)
    expect(stored.activityScore).toBe(final.result!.score)

    // Today is live: hour 7 moved, the hour that has not arrived yet stays in the goal.
    expect(payload.activitySignals!.moveHours).toBe(1)
    expect(payload.activityGoals!.moveHoursGoal).not.toBeNull()
  })

  it('drops a finished day’s non-wear waking hours from the goal, but not hours that have not arrived today', async () => {
    const f = metOnly()
    f.cloudActivity = [metDay(YESTERDAY, [7], [], 6, 12), metDay(TODAY, [7], [], 6, 9)]
    repo = fixtureRepo(f)
    const over = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    const live = await buildReadinessPayload('u1', TZ)
    // Yesterday: only the six worn hours stay in the goal. Today: the hours after the last worn one stay in.
    expect(over.signals.moveHoursGoal).toBeLessThan(live.activityGoals!.moveHoursGoal!)
  })
})

describe('a MET read that fails (#3114)', () => {
  it('throws from the finalise, so a finished day is never scored without it', async () => {
    const f = metOnly()
    f.cloudActivityFails = true
    repo = fixtureRepo(f)
    await expect(finaliseActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)).rejects.toThrow(/oura_cloud_daily read failed/)
    expect(repo.upsertOuraDailyDerived).not.toHaveBeenCalled()
  })

  it('leaves yesterday un-finalised through a payload read, reports it, and still serves today', async () => {
    const f = metOnly()
    f.cloudActivityFails = true
    repo = fixtureRepo(f)
    const payload = await buildReadinessPayload('u1', TZ)

    const stored = f.derived.find(r => r.day === YESTERDAY)
    expect(stored == null || activityFinalisedAt(stored.activityContributors) == null).toBe(true)
    expect(repo.upsertOuraDailyDerived.mock.calls.some(c => (c[2] as Record<string, unknown>).activityScore !== undefined)).toBe(false)
    expect(reportServerError).toHaveBeenCalled()
    // Today's live read keeps its catch: no MET, no HR, so no move lane, but the payload is served.
    expect(payload.activitySignals).toBeTruthy()
    expect(payload.activitySignals!.moveHours).toBeNull()
  })

  it('still scores today through the loader (the day log), losing only the move lane', async () => {
    const f = metOnly()
    f.cloudActivityFails = true
    repo = fixtureRepo(f)
    const today = await loadActivityDay(typedRepo(), 'u1', TZ, TODAY)
    expect(today.result).toBeTruthy()
    expect(today.signals.moveHours).toBeNull()
    await expect(loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)).rejects.toThrow(/oura_cloud_daily read failed/)
  })
})
