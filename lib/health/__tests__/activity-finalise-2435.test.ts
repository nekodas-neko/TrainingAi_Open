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
const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { finaliseActivityDay, ACTIVITY_FINALISE_DAYS, ACTIVITY_FINAL_GRACE_HOURS } from '@/lib/health/activity-finalise'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
// Both sides of every comparison below are fixed: the fixture is built on TODAY and the clock is
// pinned to midday-ish local on it (15:00 Brisbane), away from either midnight.
const NOW = new Date('2026-10-08T05:00:00Z')

beforeEach(() => {
  reportServerError.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

/** The fixture answers every read the finalise makes; it is not a full repository, so it is cast. */
const typedRepo = () => repo as unknown as Parameters<typeof finaliseActivityDay>[0]

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
    const day = await finaliseActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
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
    const final = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(final.result!.score).toBe(live.activityScore)
    expect(final.signals.moveHours).toBe(live.activitySignals!.moveHours)
  })

  it('ignores a session logged after the day ended', async () => {
    const f = monthFixture(TODAY, TZ)
    const before = await (setup(f), loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY))
    f.sessions.push({ id: 'later', startedAt: new Date(dateStrMidnightInTz(TODAY, TZ).getTime() + 8 * 3_600_000), exercises: [{ volume: 30_000 }] })
    const after = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(after.signals.sessions7d).toBe(before.signals.sessions7d)
    expect(after.result).toEqual(before.result)
  })

  it('refuses a day that has not ended, at 23:59 local, and accepts it at 00:01', async () => {
    setup()
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    await expect(finaliseActivityDay(typedRepo(), 'u1', TZ, YESTERDAY, new Date(nextMid - 60_000))).rejects.toThrow(/has not ended/)
    await expect(finaliseActivityDay(typedRepo(), 'u1', TZ, YESTERDAY, new Date(nextMid + 60_000))).resolves.toBeTruthy()
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
    const final = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
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
    const twoBack = shiftDateStr(YESTERDAY, -1)
    // Stamped 25 h after that day ended: past the grace, so final.
    f.derived.push({ day: twoBack, activityScore: 41, activityContributors: { preTaper: 44, finalisedAt: nextMid - 86_400_000 + 25 * 3_600_000 } })
    await buildReadinessPayload('u1', TZ)
    await drain()
    expect(activityWrites().some(w => w.day === twoBack)).toBe(false)
  })

  it("serves yesterday's stored value inside the grace without waiting on a re-score, and re-scores behind the read", async () => {
    const f = setup()
    const nextMid = dateStrMidnightInTz(TODAY, TZ).getTime()
    // Stamped 2 h after yesterday ended: stored, but still inside the 24 h grace.
    f.derived.push({ day: YESTERDAY, activityScore: 41, activityContributors: { preTaper: 44, finalisedAt: nextMid + 2 * 3_600_000 } })
    // A finished day's HR read never answers: if the read waited on the re-score it would hang here.
    const todayMs = dateStrMidnightInTz(TODAY, TZ).getTime()
    const hr = repo.getHrForWindow.getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    repo.getHrForWindow.mockImplementation(async (u, from, to) => {
      if (from.getTime() < todayMs) await gate
      return hr(u, from, to)
    })
    const p = await buildReadinessPayload('u1', TZ)
    expect(p.readinessCompositeContributors!.activityBalance.score).toBe(44)
    expect(activityWrites().some(w => w.day === YESTERDAY)).toBe(false)
    release()
    await drain()
    expect(activityWrites().some(w => w.day === YESTERDAY)).toBe(true)
  })

  it('picks up heart rate that arrives after the first finalise', async () => {
    const f = monthFixture(TODAY, TZ)
    const evening = (r: { timestamp: Date }) => r.timestamp.getTime() >= dateStrMidnightInTz(YESTERDAY, TZ).getTime() + 18 * 3_600_000
      && r.timestamp.getTime() < dateStrMidnightInTz(TODAY, TZ).getTime()
    const lateRows = f.hr.filter(evening)
    expect(lateRows.length).toBeGreaterThan(0)
    f.hr = f.hr.filter(r => !evening(r))
    repo = fixtureRepo(f)
    // 06:30 local: the ring has not drained last evening yet.
    vi.setSystemTime(new Date(dateStrMidnightInTz(TODAY, TZ).getTime() + 6.5 * 3_600_000))
    await buildReadinessPayload('u1', TZ)
    await drain()
    const first = structuredClone(f.derived.find(r => r.day === YESTERDAY)!)
    const firstScore = first.activityScore
    const firstStamp = activityFinalisedAt(first.activityContributors)!
    // The evening lands; three hours later the next read re-scores the day behind it.
    f.hr.push(...lateRows)
    vi.setSystemTime(new Date(firstStamp.getTime() + 3 * 3_600_000))
    await buildReadinessPayload('u1', TZ)
    await drain()
    const second = f.derived.find(r => r.day === YESTERDAY)!
    const full = await loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)
    expect(second.activityScore).toBe(full.result!.score)
    expect(second.activityContributors).not.toEqual(first.activityContributors)
    expect(second.activityScore).not.toBe(firstScore)
  })

  it('re-scores a day inside the grace at most once an hour, and not at all once past it', () => {
    const dayEnd = dateStrMidnightInTz(TODAY, TZ).getTime()
    const grace = (stampedAtMs: number, nowMs: number) => staleFinishedDays(
      TODAY, TZ, new Map([[YESTERDAY, new Date(stampedAtMs)]]), 1,
      { graceMs: ACTIVITY_FINAL_GRACE_HOURS * 3_600_000, minIntervalMs: 3_600_000, now: new Date(nowMs) })
    expect(grace(dayEnd + 3_600_000, dayEnd + 3_600_000 + 30 * 60_000)).toEqual([])
    expect(grace(dayEnd + 3_600_000, dayEnd + 3 * 3_600_000)).toEqual([YESTERDAY])
    const past = dayEnd + (ACTIVITY_FINAL_GRACE_HOURS + 1) * 3_600_000
    expect(grace(past, past + 5 * 3_600_000)).toEqual([])
  })

  it("keeps the training-load re-check's rule: final once stamped after the day ended", () => {
    const dayEnd = dateStrMidnightInTz(TODAY, TZ).getTime()
    expect(staleFinishedDays(TODAY, TZ, new Map([[YESTERDAY, new Date(dayEnd + 60_000)]]), 1)).toEqual([])
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

describe('failures (issue 2435)', () => {
  it('still reads the scored value when only the write fails, and reports the failure', async () => {
    setup()
    const ok = await buildReadinessPayload('u1', TZ)
    const expected = ok.readinessCompositeContributors!.activityBalance.score
    await drain()

    setup()
    const write = repo.upsertOuraDailyDerived.getMockImplementation()!
    repo.upsertOuraDailyDerived.mockImplementation(async (u, day, patch) => {
      if ((patch as Record<string, unknown>).activityScore !== undefined) throw new Error('db down')
      return write(u, day, patch)
    })
    const p = await buildReadinessPayload('u1', TZ)
    await drain()
    expect(p.readinessCompositeContributors!.activityBalance.score).toBe(expected)
    expect(reportServerError).toHaveBeenCalled()
    expect(String(reportServerError.mock.calls[0][0].message)).toMatch(/storing activity/)
  })

  it('reports a scoring failure and serves the read with a neutral activity balance', async () => {
    setup()
    const hr = repo.getHrForWindow.getMockImplementation()!
    // Today's own HR read succeeds; any finished day's fails.
    repo.getHrForWindow.mockImplementation(async (u, from, to) => {
      if (from.getTime() < dateStrMidnightInTz(TODAY, TZ).getTime()) throw new Error('hr down')
      return hr(u, from, to)
    })
    const p = await buildReadinessPayload('u1', TZ)
    await drain()
    expect(p.readinessCompositeContributors).not.toBeNull()
    expect(reportServerError).toHaveBeenCalled()
    expect(String(reportServerError.mock.calls[0][0].message)).toMatch(/scoring activity/)
  })
})

describe('a day with nothing to score (issue 2435)', () => {
  it('is stamped final-but-empty once past the grace, and not scored again on later reads', async () => {
    setup({ metrics: [], hr: [], sessions: [], derived: [], program: null })
    await buildReadinessPayload('u1', TZ)
    await drain()
    const longAgo = shiftDateStr(TODAY, -3)
    const row = repo.upsertOuraDailyDerived.mock.calls.find(c => c[1] === longAgo)
    expect(row).toBeDefined()
    expect((row![2] as { activityScore: number | null }).activityScore).toBeNull()
    expect(activityFinalisedAt((row![2] as { activityContributors: unknown }).activityContributors)).not.toBeNull()

    // Two hours later: only yesterday (still inside its grace) is looked at again.
    repo.upsertOuraDailyDerived.mockClear()
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 3_600_000))
    await buildReadinessPayload('u1', TZ)
    await drain()
    const redone = new Set(activityWrites().map(w => w.day))
    expect(redone.has(longAgo)).toBe(false)
    expect([...redone].every(d => d === YESTERDAY)).toBe(true)
  })

  it('resolves the HR profile once for a whole read, not once per scored day', async () => {
    setup()
    const observed = vi.fn(async () => null)
    ;(repo as unknown as Record<string, unknown>).getObservedHrProfile = observed
    ;(repo as unknown as Record<string, unknown>).listFitnessTests = vi.fn(async () => [])
    await buildReadinessPayload('u1', TZ)
    await drain()
    expect(activityWrites().length).toBe(ACTIVITY_FINALISE_DAYS)
    expect(observed).toHaveBeenCalledTimes(1)
  })
})

describe('a zone that changes its clocks (issue 2435)', () => {
  const NY = 'America/New_York'
  const NY_TODAY = '2026-03-09' // the day after the spring-forward: 2026-03-08 was only 23 h long
  const NY_YESTERDAY = '2026-03-08'

  it("finalises and reads the previous calendar day, not the one before it", async () => {
    repo = fixtureRepo(monthFixture(NY_TODAY, NY))
    vi.setSystemTime(new Date(dateStrMidnightInTz(NY_TODAY, NY).getTime() + 15 * 3_600_000))
    const p = await buildReadinessPayload('u1', NY)
    await drain()
    const days = activityWrites().map(w => w.day)
    expect(days).toContain(NY_YESTERDAY)
    const final = await loadActivityDay(typedRepo(), 'u1', NY, NY_YESTERDAY)
    expect(p.readinessCompositeContributors!.activityBalance.score).toBe(Math.round(final.result!.preTaperScore))
    // The day that ends at 00:00 on the 9th is 23 hours long, not 24.
    const len = dateStrMidnightInTz(NY_TODAY, NY).getTime() - dateStrMidnightInTz(NY_YESTERDAY, NY).getTime()
    expect(len).toBe(23 * 3_600_000)
  })
})
