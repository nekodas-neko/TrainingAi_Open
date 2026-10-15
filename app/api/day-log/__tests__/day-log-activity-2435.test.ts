// Issue 2435 — today's Activity score is no longer stored, so the Day screen's Move cell would be
// blank for today unless /api/day-log scores it live. A finished day still reads its stored value.
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

import { GET } from '../route'

function dayLogRepo(stored: { day: string; activityScore: number | null }[]) {
  const fx = monthFixture(TODAY, TZ)
  return {
    ...fixtureRepo(fx),
    getDayLog: vi.fn(async () => []),
    getBodyFatCalibration: vi.fn(async () => null),
    listSleepSessions: vi.fn(async () => []),
    getDerivedScoresForDay: vi.fn(async (_u: string, day: string) => {
      const row = stored.find(r => r.day === day)
      return row ? { sleepScore: 80, readinessScore: 70, activityScore: row.activityScore } : null
    }),
    listActivityLogs: vi.fn(async () => []),
  }
}

const NOW = new Date('2026-10-08T05:00:00Z') // 15:00 Brisbane
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const get = (date: string) => GET(new NextRequest(`http://localhost/api/day-log?date=${date}`)).then(r => r.json())

describe('/api/day-log Activity score (issue 2435)', () => {
  it("fills today's Move score from the live scorer when nothing is stored for today", async () => {
    repo = dayLogRepo([{ day: TODAY, activityScore: null }])
    const live = await loadActivityDay(repo as never, 'u1', TZ, TODAY)
    expect(live.result).not.toBeNull()
    const body = await get(TODAY)
    expect(body.scores.activity).toBe(live.result!.score)
    expect(body.scores.sleep).toBe(80)
  })

  it("fills today's score even when no derived row exists for today at all", async () => {
    repo = dayLogRepo([])
    const body = await get(TODAY)
    expect(body.scores.activity).not.toBeNull()
  })

  it('also accepts the slash date form for today', async () => {
    repo = dayLogRepo([])
    const body = await get(TODAY.replace(/-/g, '/'))
    expect(body.scores.activity).not.toBeNull()
  })

  it("returns a finished day's stored score as it is, without scoring it", async () => {
    repo = dayLogRepo([{ day: YESTERDAY, activityScore: 63 }])
    const before = repo.getWorkoutSessionsFrom.mock.calls.length
    const body = await get(YESTERDAY)
    expect(body.scores.activity).toBe(63)
    expect(repo.getWorkoutSessionsFrom.mock.calls.length).toBe(before)
  })

  it("falls back to today's stored value if live scoring fails", async () => {
    repo = dayLogRepo([{ day: TODAY, activityScore: 12 }])
    repo.getHrForWindow.mockRejectedValueOnce(new Error('x')) // the route's own HR read settles
    repo.getUserById.mockRejectedValue(new Error('down'))
    const body = await get(TODAY)
    expect(body.scores.activity).toBe(12)
  })
})
