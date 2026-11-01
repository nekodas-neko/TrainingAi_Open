// A finished day's Activity score is stored final and, past its grace, never redone. So a read that
// failed (and was swallowed into a default) must never be what gets stored: the day stays un-finalised
// and the next pass retries. Late Oura MET must re-score a stamped day once. Parallel reads must not
// each run their own finalise pass. (Whole-batch review of 1.500.0, on #3347 and #3341.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { activityFinalisedAt } from '@trainingai/shared/health/activity-day'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { resolveHrProfile, maxHrIsUnread } from '@trainingai/shared/health/hr-profile'
import { EMPTY_OBSERVED_HR } from '@trainingai/shared/health/observed-hr'
import { monthFixture, fixtureRepo, type ActivityFixture } from './fixtures/activity-day-fixtures'

let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { finaliseActivityDay, runBackgroundFinalise } from '@/lib/health/activity-finalise'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
const NOW = new Date('2026-10-08T05:00:00Z') // 15:00 Brisbane

beforeEach(() => {
  reportServerError.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const typedRepo = () => repo as unknown as Parameters<typeof finaliseActivityDay>[0]
const drain = () => new Promise(r => setTimeout(r, 0))
const activityWrites = () => repo.upsertOuraDailyDerived.mock.calls
  .filter(c => (c[2] as Record<string, unknown>).activityScore !== undefined)
  .map(c => c[1] as string)

describe('a read that fails is never stored as a finished day’s final score', () => {
  const cases: [string, NonNullable<ActivityFixture['failReads']>, RegExp][] = [
    ['the step goals', { goals: true }, /goals read failed/],
    ['the observed heart rate', { observedHr: true }, /max heart rate .* could not be read/],
    ['the fitness tests', { fitnessTests: true }, /max heart rate .* could not be read/],
  ]
  for (const [name, failReads, message] of cases) {
    it(`${name}: the finalise throws, the payload leaves yesterday unstamped, and today still scores`, async () => {
      const f = monthFixture(TODAY, TZ)
      f.failReads = failReads
      repo = fixtureRepo(f)

      await expect(finaliseActivityDay(typedRepo(), 'u1', TZ, YESTERDAY)).rejects.toThrow(message)
      expect(repo.upsertOuraDailyDerived).not.toHaveBeenCalled()

      const payload = await buildReadinessPayload('u1', TZ)
      await drain()
      const stored = f.derived.find(r => r.day === YESTERDAY)
      expect(stored == null || activityFinalisedAt(stored.activityContributors) == null).toBe(true)
      expect(activityWrites()).toEqual([])
      expect(reportServerError).toHaveBeenCalled()
      expect(payload.activitySignals).toBeTruthy()

      // Today is live and keeps scoring through the loader (the day log) with the read failing.
      const today = await loadActivityDay(typedRepo(), 'u1', TZ, TODAY)
      expect(today.result).toBeTruthy()
    })
  }

  it('an HR profile the caller resolved from failed reads is refused for a finished day, and used for today', async () => {
    repo = fixtureRepo(monthFixture(TODAY, TZ))
    await expect(loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY, { maxHr: 190, maxHrUnread: true })).rejects.toThrow(/max heart rate/)
    await expect(loadActivityDay(typedRepo(), 'u1', TZ, YESTERDAY, { maxHr: 190 })).resolves.toBeTruthy()
    const today = await loadActivityDay(typedRepo(), 'u1', TZ, TODAY, { maxHr: 190, maxHrUnread: true })
    expect(today.result).toBeTruthy()
  })

  it('names each swallowed HR-profile read, including an unreadable age', async () => {
    const ok = await resolveHrProfile(fixtureRepo(monthFixture(TODAY, TZ)) as never, 'u1', TZ)
    expect(maxHrIsUnread(ok)).toBe(false)
    for (const failReads of [{ user: true }, { observedHr: true }, { fitnessTests: true }]) {
      const f = monthFixture(TODAY, TZ)
      f.failReads = failReads
      const profile = await resolveHrProfile(fixtureRepo(f) as never, 'u1', TZ)
      expect(maxHrIsUnread(profile), JSON.stringify(failReads)).toBe(true)
    }
    expect(maxHrIsUnread(null)).toBe(true)
  })

  it('flags an unreadable age even when a Cooper test or an observed max names the ceiling (#3392)', async () => {
    const cooper = { testType: 'cooper12', date: '2026-09-14', maxHr: 175 }
    const withCooper = (failUser: boolean) => {
      const f = monthFixture(TODAY, TZ)
      f.failReads = failUser ? { user: true } : undefined
      return { ...fixtureRepo(f), listFitnessTests: vi.fn(async () => [cooper]) } as never
    }
    const ok = await resolveHrProfile(withCooper(false), 'u1', TZ)
    expect(ok.maxHrSource).toBe('cooper-blend')
    expect(maxHrIsUnread(ok)).toBe(false)
    const failed = await resolveHrProfile(withCooper(true), 'u1', TZ)
    expect(failed.maxHrSource).toBe('cooper-blend')
    expect(maxHrIsUnread(failed)).toBe(true)

    const f = monthFixture(TODAY, TZ)
    f.failReads = { user: true }
    const observed = { ...EMPTY_OBSERVED_HR, isReliable: true, max: 200, sampleCount: 50 }
    const obsRepo = { ...fixtureRepo(f), getObservedHrProfile: vi.fn(async () => observed) } as never
    const viaObserved = await resolveHrProfile(obsRepo, 'u1', TZ)
    expect(viaObserved.maxHrSource).toBe('observed')
    expect(maxHrIsUnread(viaObserved)).toBe(true)
  })
})

describe('Oura MET that arrives after the stamp (#3079)', () => {
  // Clock at 15:00 on the 11th; the 9th ended at midnight on the 10th, so its grace ended at midnight
  // on the 11th and a stamp taken at 10:00 on the 11th is final by the clock.
  const T = '2026-10-11'
  const DAY = '2026-10-09'
  const STAMPED_AT = new Date('2026-10-11T00:00:00Z') // 10:00 Brisbane
  const NOW2 = new Date('2026-10-11T05:00:00Z')        // 15:00 Brisbane

  async function stampedDay(metChangedAt: Date | null) {
    const f = monthFixture(T, TZ)
    repo = fixtureRepo(f)
    vi.setSystemTime(STAMPED_AT)
    await finaliseActivityDay(typedRepo(), 'u1', TZ, DAY)
    vi.setSystemTime(NOW2)
    if (metChangedAt) f.metChangedAt = [{ date: DAY, changedAt: metChangedAt }]
    repo.upsertOuraDailyDerived.mockClear()
    return f
  }
  const rescoredDays = async () => {
    await buildReadinessPayload('u1', TZ)
    await drain()
    return activityWrites().filter(d => d === DAY).length
  }

  it('re-scores a stamped day once when its MET changed after the stamp', async () => {
    await stampedDay(new Date('2026-10-11T02:00:00Z')) // 12:00, after the 10:00 stamp
    expect(await rescoredDays()).toBe(1)
    // The re-score stamped 15:00, later than the MET change, so it is not redone.
    vi.setSystemTime(new Date(NOW2.getTime() + 2 * 3_600_000))
    repo.upsertOuraDailyDerived.mockClear()
    expect(await rescoredDays()).toBe(0)
  })

  it('leaves a stamped day alone when its MET did not change after the stamp', async () => {
    await stampedDay(new Date('2026-10-10T23:00:00Z')) // 09:00, before the stamp
    expect(await rescoredDays()).toBe(0)
  })

  it('counts the Oura day before it too, as the training-stress re-check does', async () => {
    const f = await stampedDay(null)
    f.metChangedAt = [{ date: shiftDateStr(DAY, -1), changedAt: new Date('2026-10-11T02:00:00Z') }]
    expect(await rescoredDays()).toBe(1)
  })
})

describe('parallel reads share one background finalise pass', () => {
  it('four parallel payload reads score each older day once', async () => {
    repo = fixtureRepo(monthFixture(TODAY, TZ))
    await Promise.all([1, 2, 3, 4].map(() => buildReadinessPayload('u1', TZ)))
    await drain(); await drain()
    const counts = new Map<string, number>()
    for (const d of activityWrites()) counts.set(d, (counts.get(d) ?? 0) + 1)
    const older = [...counts].filter(([d]) => d !== YESTERDAY)
    expect(older.length).toBe(6)
    expect(older.every(([, n]) => n === 1)).toBe(true)
  })

  it('runBackgroundFinalise refuses a second pass while one runs, and allows one after', async () => {
    let release!: () => void
    const first = vi.fn(() => new Promise<void>(r => { release = r }))
    expect(runBackgroundFinalise('guard-user', first)).toBe(true)
    const second = vi.fn(async () => undefined)
    expect(runBackgroundFinalise('guard-user', second)).toBe(false)
    expect(runBackgroundFinalise('other-user', async () => undefined)).toBe(true)
    await drain() // `pass` starts a microtask later (#3392)
    release(); await drain()
    expect(runBackgroundFinalise('guard-user', second)).toBe(true)
    await drain()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a pass that throws synchronously still frees the guard (#3392)', async () => {
    const syncThrow = (() => { throw new Error('sync boom') }) as unknown as () => Promise<void>
    expect(runBackgroundFinalise('sync-throwing-user', syncThrow)).toBe(true)
    await drain()
    expect(reportServerError).toHaveBeenCalled()
    expect(runBackgroundFinalise('sync-throwing-user', async () => undefined)).toBe(true)
  })

  it('a pass that throws still frees the guard', async () => {
    expect(runBackgroundFinalise('throwing-user', async () => { throw new Error('boom') })).toBe(true)
    await drain()
    expect(runBackgroundFinalise('throwing-user', async () => undefined)).toBe(true)
  })
})
