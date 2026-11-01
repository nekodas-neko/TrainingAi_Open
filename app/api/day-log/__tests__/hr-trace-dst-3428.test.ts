// #3428: the Day screen's HR trace plotted minutes ELAPSED from midnight and dropped rows past 1440, so
// a 25-hour day lost its last hour and every point after the change sat an hour off on either DST day.
// `hr[].minute` is now the clock-face minute.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { monthFixture, fixtureRepo } from '@/lib/health/__tests__/fixtures/activity-day-fixtures'

const TZ = 'Australia/Sydney'
const HOUR = 3_600_000

let repo: ReturnType<typeof dayLogRepo>
let hrRows: { timestamp: Date; bpm: number; source: string }[] = []
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: TZ } }) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET } from '../route'

function dayLogRepo() {
  return {
    ...fixtureRepo(monthFixture('2026-10-20', TZ)),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      hrRows.filter(r => r.timestamp >= from && r.timestamp < to)),
    getDayLog: vi.fn(async () => []),
    getBodyFatCalibration: vi.fn(async () => null),
    listSleepSessions: vi.fn(async () => []),
    getDerivedScoresForDay: vi.fn(async () => null),
    listActivityLogs: vi.fn(async () => []),
    getOuraCloudSwitchDay: vi.fn(async () => null),
  }
}

beforeEach(() => {
  repo = dayLogRepo()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-05-01T02:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const hrAt = (day: string, elapsedHours: number, bpm: number) =>
  ({ timestamp: new Date(dateStrMidnightInTz(day, TZ).getTime() + elapsedHours * HOUR + 10 * 60_000), bpm, source: 'ring' })
const trace = (date: string) =>
  GET(new NextRequest(`http://localhost/api/day-log?date=${date}`)).then(r => r.json()).then(b => b.hr as { minute: number; bpm: number }[])

describe('/api/day-log HR trace on a daylight-saving day (#3428)', () => {
  it('keeps the last local hour of a 25-hour day (2027-04-04)', async () => {
    // 24 h after midnight is 23:10 on the clock (the 2:00 hour happened twice), elapsed minute 1450.
    hrRows = [hrAt('2027-04-04', 1, 60), hrAt('2027-04-04', 24, 90)]
    expect(await trace('2027-04-04')).toEqual([{ minute: 60, bpm: 60 }, { minute: 1380, bpm: 90 }])
  })

  it('folds the repeated hour of a 25-hour day into one bucket', async () => {
    // 02:10 on the clock twice: elapsed 2.17 h and 3.17 h.
    hrRows = [hrAt('2027-04-04', 2, 60), hrAt('2027-04-04', 3, 80)]
    const hr = await trace('2027-04-04')
    expect(hr).toEqual([{ minute: 120, bpm: 70 }])
  })

  it('puts every point after the change on its clock hour on a 23-hour day (2026-10-04)', async () => {
    // 1.17 h after midnight is 01:10 (before the change); 2.17 h after is 03:10 (the clock skipped 02:00).
    hrRows = [hrAt('2026-10-04', 1, 60), hrAt('2026-10-04', 2, 75)]
    const hr = await trace('2026-10-04')
    expect(hr).toEqual([{ minute: 60, bpm: 60 }, { minute: 180, bpm: 75 }])
  })

  it('leaves an ordinary day as it was', async () => {
    hrRows = [hrAt('2026-10-10', 5, 55)]
    expect(await trace('2026-10-10')).toEqual([{ minute: 300, bpm: 55 }])
  })
})
