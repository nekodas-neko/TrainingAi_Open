// #3793 ⑧: /api/day-log for today read the day's activity logs twice (once for its own steps, once
// inside today's live Activity score, with the same arguments) and the day's body metrics on their
// own although the live score reads 28 days that hold them. Both are now read once and shared. The
// output must not move, and the reads that remain must fail where they failed before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { activityDayBodyMetricsWindow, loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { monthFixture, fixtureRepo } from '@/lib/health/__tests__/fixtures/activity-day-fixtures'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)

let repo: ReturnType<typeof dayLogRepo>
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: TZ } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '../route'

const treadmill = (date: string) => ({
  id: `t-${date}`, userId: 'u1', date, activityType: 'treadmill', title: 'Treadmill',
  startTime: '12:00:00', endTime: '12:40:00', durationMin: 40, distanceKm: 4, steps: 3_500, createdAt: new Date('2026-10-01T02:00:00Z'),
})

function dayLogRepo() {
  const fx = monthFixture(TODAY, TZ)
  fx.activityLogs = [treadmill(TODAY), treadmill(YESTERDAY)] as never
  return {
    ...fixtureRepo(fx),
    getDayLog: vi.fn(async () => []),
    getBodyFatCalibration: vi.fn(async () => null),
    listSleepSessions: vi.fn(async () => []),
    getDerivedScoresForDay: vi.fn(async () => ({ sleepScore: 80, readinessScore: 70, activityScore: 12 })),
    getOuraCloudSwitchDay: vi.fn(async () => null),
  }
}

beforeEach(() => {
  repo = dayLogRepo()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T05:00:00Z')) // 15:00 Brisbane
})
afterEach(() => vi.useRealTimers())

const get = (date: string) => GET(new NextRequest(`http://localhost/api/day-log?date=${date}`)).then(r => r.json())
const callsWith = (fn: { mock: { calls: unknown[][] } }, from: string, to: string) =>
  fn.mock.calls.filter(c => c[1] === from && c[2] === to).length

describe("/api/day-log shares today's activity logs and body metrics with the live score (#3793 ⑧)", () => {
  it('reads each once for today: no more than the live score reads on its own', async () => {
    await loadActivityDay(repo as never, 'u1', TZ, TODAY)
    const scoreAlone = callsWith(repo.listBodyMetrics, ...activityDayBodyMetricsWindow(TODAY))
    repo = dayLogRepo()
    await get(TODAY)
    expect(repo.listActivityLogs).toHaveBeenCalledTimes(1)
    expect(callsWith(repo.listBodyMetrics, TODAY, TODAY)).toBe(0)
    expect(callsWith(repo.listBodyMetrics, ...activityDayBodyMetricsWindow(TODAY))).toBe(scoreAlone)
  })

  it('gives the same body, steps and score as reading them separately', async () => {
    const alone = await loadActivityDay(repo as never, 'u1', TZ, TODAY)
    const ownDay = (await repo.listBodyMetrics('u1', TODAY, TODAY))[0] as { steps?: number; weightKg?: number }
    const body = await get(TODAY)
    expect(alone.result).not.toBeNull()
    expect(body.scores.activity).toBe(alone.result!.score)
    expect(body.bodyMeta.weightKg).toBe(ownDay.weightKg ?? null)
    expect(body.bodyMeta.steps).toBe((ownDay.steps ?? 0) + 3_500) // the treadmill's steps join the device's
    expect(body.activityLogs).toEqual(JSON.parse(JSON.stringify([treadmill(TODAY)])))
  })

  it('the live score is the same with the reads passed in as without', async () => {
    const without = await loadActivityDay(repo as never, 'u1', TZ, TODAY)
    const withShared = await loadActivityDay(repo as never, 'u1', TZ, TODAY, {
      activityLogs: repo.listActivityLogs('u1', TODAY, TODAY) as never,
      bodyMetrics: repo.listBodyMetrics('u1', ...activityDayBodyMetricsWindow(TODAY)) as never,
    })
    expect(withShared).toEqual(without)
  })

  it('a finished day reads as before', async () => {
    const body = await get(YESTERDAY)
    expect(callsWith(repo.listBodyMetrics, YESTERDAY, YESTERDAY)).toBe(1)
    expect(repo.listActivityLogs).toHaveBeenCalledTimes(1)
    expect(body.scores.activity).toBe(12)
  })

  it('a failed activity-log read still fails the route, as it did', async () => {
    repo.listActivityLogs.mockRejectedValue(new Error('down'))
    await expect(get(TODAY)).rejects.toThrow('down')
  })

  it('a failed body-metrics read still blanks only the body block and the live score', async () => {
    repo.listBodyMetrics.mockRejectedValue(new Error('down'))
    const body = await get(TODAY)
    expect(body.bodyMeta).toBeNull()
    expect(body.scores.activity).toBe(12) // the stored score, as when the live score's own read failed
  })
})
