// Issue 2435 — a finished day's Activity score is stored once, over the whole day, and readiness's
// activity-balance input reads that previous completed day instead of today's partial value.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { activityFinalisedAt } from '@trainingai/shared/health/activity-day'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { staleFinishedDays } from '@trainingai/shared/health/finished-day-recheck'
import { monthFixture, fixtureRepo, type ActivityFixture } from './fixtures/activity-day-fixtures'

let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { finaliseActivityDay, ACTIVITY_FINALISE_DAYS } from '@/lib/health/activity-finalise'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
// Both sides of every comparison below are fixed: the fixture is built on TODAY and the clock is
// pinned to midday-ish local on it (15:00 Brisbane), away from either midnight.
const NOW = new Date('2026-10-08T05:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

function setup(f: ActivityFixture = monthFixture(TODAY, TZ)) {
  repo = fixtureRepo(f)
  return f
}
const activityWrites = () => repo.upsertOuraDailyDerived.mock.calls
  .filter(c => (c[2] as Record<string, unknown>).activityScore !== undefined)
  .map(c => ({ day: c[1] as string, patch: c[2] as { activityScore: number | null; activityContributors: Record<string, number | null> } }))
/** Lets the fire-and-forget finalise of older days drain. */
const drain = () => new Promise(r => setTimeout(r, 0))

describe('finaliseActivityDay', () => {
  it('scores the whole finished day, including its HR lanes, and stamps it final', async () => {
    const fx = setup()
    const day = await finaliseActivityDay(repo, 'u1', TZ, YESTERDAY)
    expect(day.signals.moveHours).not.toBeNull()
    expect(day.signals.zoneMinutes).not.toBeNull()

    const [w] = activityWrites()
    expect(w.day).toBe(YESTERDAY)
    expect(w.patch.activityScore).toBe(day.result!.score)
    expect(w.patch.activityContributors.preTaper).toBe(day.result!.preTaperScore)
    const stored = fx.derived.find(r => r.day === YESTERDAY)!
    expect(activityFinalisedAt(stored.activityContributors)!.getTime()).toBe(NOW.getTime())
  })

  it('equals the live score the payload showed in the last minute of that day', async () => {
    setup()
    // The payload as it stood at 23:59 local on YESTERDAY, scoring the day live.
    vi.setSystemTime(new Date(dateStrMidnightInTz(TODAY, TZ).getTime() - 60_000))
    const live = await buildReadinessPayload('u1', TZ)
    vi.setSystemTime(NOW)
    const final = await loadActivityDay(repo, 'u1', TZ, YESTERDAY)
    expect(final.result!.score).toBe(live.activityScore)
    expect(final.signals.moveHours).toBe(live.activitySignals!.moveHours)
  })

  it('ignores a session logged after the day ended', async () => {
    const f = monthFixture(TODAY, TZ)
    const before = await (setup(f), loadActivityDay(repo, 'u1', TZ, YESTERDAY))
    f.sessions.push({ id: 'later', startedAt: new Date(dateStrMidnightInTz(TODAY, TZ).getTime() + 8 * 3_600_000), exercises: [{ volume: 30_000 }] })
    const after = await loadActivityDay(repo, 'u1', TZ, YESTERDAY)
    expect(after.signals.sessions7d).toBe(before.signals.sessions7d)
    expect(after.result).toEqual(before.result)
  })

  it('refuses a day that has not ended, at 23:59 local, and accepts it at 00:01', async () => {
    setup()
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    await expect(finaliseActivityDay(repo, 'u1', TZ, YESTERDAY, new Date(nextMid - 60_000))).rejects.toThrow(/has not ended/)
    await expect(finaliseActivityDay(repo, 'u1', TZ, YESTERDAY, new Date(nextMid + 60_000))).resolves.toBeTruthy()
  })
})

describe('staleFinishedDays for the Activity score', () => {
  it('treats a value stamped at 23:59 as partial and one stamped at 00:01 as final', () => {
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    const at = (ms: number) => new Map([[YESTERDAY, new Date(ms)]])
    expect(staleFinishedDays(TODAY, TZ, at(nextMid - 60_000), 1)).toEqual([YESTERDAY])
    expect(staleFinishedDays(TODAY, TZ, at(nextMid + 60_000), 1)).toEqual([])
  })

  it('keys the day end to local midnight in a zone far from Brisbane', () => {
    const tz = 'Etc/GMT+5' // UTC−5: Brisbane's and this zone's "yesterday" end 15 hours apart
    const nextMid = dateStrMidnightInTz(TODAY, tz).getTime()
    const at = (ms: number) => new Map([[YESTERDAY, new Date(ms)]])
    expect(staleFinishedDays(TODAY, tz, at(nextMid - 60_000), 1)).toEqual([YESTERDAY])
    expect(staleFinishedDays(TODAY, tz, at(nextMid + 60_000), 1)).toEqual([])
  })
})

describe('the readiness payload (issue 2435)', () => {
  it("reads yesterday's finalised pre-taper score for activity balance, finalising it first", async () => {
    const fx = setup()
    const p = await buildReadinessPayload('u1', TZ)
    const final = await loadActivityDay(repo, 'u1', TZ, YESTERDAY)
    expect(p.readinessCompositeContributors).not.toBeNull()
    expect(p.readinessCompositeContributors!.activityBalance.score).toBe(Math.round(final.result!.preTaperScore))
    // Yesterday was finalised on this read, before readiness used it.
    expect(activityFinalisedAt(fx.derived.find(r => r.day === YESTERDAY)!.activityContributors)).not.toBeNull()
  })

  it("does not move with today's partial movement", async () => {
    setup(monthFixture(TODAY, TZ, { todaySteps: 300, todayKcal: 20 }))
    const quiet = await buildReadinessPayload('u1', TZ)
    setup(monthFixture(TODAY, TZ, { todaySteps: 15_000, todayKcal: 900 }))
    const busy = await buildReadinessPayload('u1', TZ)
    expect(busy.activityScore).not.toBe(quiet.activityScore)
    expect(busy.readinessCompositeContributors!.activityBalance).toEqual(quiet.readinessCompositeContributors!.activityBalance)
    expect(busy.score).toBe(quiet.score)
  })

  it('uses a stored final value as it is, without re-scoring the day', async () => {
    const f = setup()
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    f.derived.push({ day: YESTERDAY, activityScore: 41, activityContributors: { preTaper: 44, finalisedAt: nextMid + 3_600_000 } })
    const p = await buildReadinessPayload('u1', TZ)
    expect(p.readinessCompositeContributors!.activityBalance.score).toBe(44)
    await drain()
    expect(activityWrites().some(w => w.day === YESTERDAY)).toBe(false)
  })

  it('re-scores a day whose stored value was written before it ended', async () => {
    const f = setup()
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    f.derived.push({ day: YESTERDAY, activityScore: 12, activityContributors: { preTaper: 12 } })
    f.derived.push({ day: shiftDateStr(YESTERDAY, -1), activityScore: 9, activityContributors: { preTaper: 9, finalisedAt: nextMid - 86_400_000 - 60_000 } })
    await buildReadinessPayload('u1', TZ)
    await drain()
    const days = activityWrites().map(w => w.day)
    expect(days).toContain(YESTERDAY)
    expect(days).toContain(shiftDateStr(YESTERDAY, -1))
  })

  it(`finalises every unfinalised day in the ${ACTIVITY_FINALISE_DAYS}-day look-back, and never today`, async () => {
    setup()
    await buildReadinessPayload('u1', TZ)
    await drain()
    const days = new Set(activityWrites().map(w => w.day))
    const expected = Array.from({ length: ACTIVITY_FINALISE_DAYS }, (_, i) => shiftDateStr(TODAY, -(i + 1)))
    expect([...days].sort()).toEqual(expected.sort())
    expect(days.has(TODAY)).toBe(false)
  })
})
