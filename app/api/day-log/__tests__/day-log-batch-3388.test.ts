// #3388 (item 4): /api/day-log scored today's Activity serially after its batch and read the day's HR
// twice. Today's live score now runs in the batch and shares the one HR read. The output must not move.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { monthFixture, fixtureRepo } from '@/lib/health/__tests__/fixtures/activity-day-fixtures'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)

let repo: ReturnType<typeof dayLogRepo>
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: TZ } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '../route'

function dayLogRepo() {
  return {
    ...fixtureRepo(monthFixture(TODAY, TZ)),
    getDayLog: vi.fn(async () => []),
    getBodyFatCalibration: vi.fn(async () => null),
    listSleepSessions: vi.fn(async () => []),
    getDerivedScoresForDay: vi.fn(async () => ({ sleepScore: 80, readinessScore: 70, activityScore: 12 })),
    listActivityLogs: vi.fn(async () => []),
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

describe('/api/day-log reads the day once (#3388)', () => {
  it("reads today's HR once, for the trace and the live score together", async () => {
    await get(TODAY)
    expect(repo.getHrForWindow).toHaveBeenCalledTimes(1)
  })

  it("gives the same score and trace as scoring today on its own", async () => {
    const alone = await loadActivityDay(repo as never, 'u1', TZ, TODAY)
    const body = await get(TODAY)
    expect(alone.result).not.toBeNull()
    expect(body.scores).toEqual({ readiness: 70, sleep: 80, activity: alone.result!.score })
    expect(body.hr.length).toBeGreaterThan(0)
  })

  it('a finished day still reads its HR once and keeps its stored score', async () => {
    const body = await get(YESTERDAY)
    expect(repo.getHrForWindow).toHaveBeenCalledTimes(1)
    expect(body.scores.activity).toBe(12)
  })

  it("a failed HR read blanks the trace and falls back to the stored score, as before", async () => {
    repo.getHrForWindow.mockRejectedValue(new Error('down'))
    const body = await get(TODAY)
    expect(body.hr).toEqual([])
    expect(body.scores.activity).toBe(12)
  })
})
