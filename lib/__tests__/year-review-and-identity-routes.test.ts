/**
 * PS-39 — the year you had and the name you wear for it: `year-review`, `seasons` and
 * `user/equipped-title`.
 *
 * Batched because they are the three reads and writes behind the same surface — a retrospective and
 * the identity attached to it — and because two of them are thin enough that a file of their own
 * would say less than this comment does. What each one actually decides:
 *
 *   · **`year-review`'s window is 365 days back from the USER's local midnight**, threaded into
 *     `aestMidnight`'s fourth argument. That argument defaults to Brisbane, which is right for the
 *     owner and wrong for everyone else — LA-19's whole class of bug — so the fixture below runs in
 *     a zone where the two answers differ by nine hours and a calendar day.
 *   · **A bodyweight PR is not comparable to a barbell one.** Its `estimated1rm` is a BW_REF-relative
 *     index, not kilograms, so `pickHeadlinePersonalRecord` prefers the best LOADED lift and only
 *     falls back to bodyweight when there is nothing else. A headline of "your biggest lift: 412"
 *     from a pull-up index is not a rounding error, it is a different unit.
 *   · **Only the volume is rounded.** Sets, sessions and minutes are counts and pass through.
 *   · **`equipped-title` accepts `null`**, because that is how you take a title OFF. A guard written
 *     as "must be a known title" with no null branch makes the choice permanent.
 *   · **An unknown title id is refused**, so the stored value is always renderable — `TITLES[id]`
 *     drives an icon component, and a missing entry is a crash on someone else's leaderboard row,
 *     not on the writer's screen.
 *
 * Fixture discipline (the PS-39 note): every case fails on the ONE rule it names. Where two
 * quantities could coincide — the two timezones, the two PR candidates — the fixture forces them
 * apart, because equal values put nothing under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const listSeasonsWithResults = vi.fn(async (_u: string) => [] as Row[])
const updateEquippedTitle = vi.fn(async (..._a: unknown[]) => undefined)
const getYearReviewTotals = vi.fn(async (..._a: unknown[]) => ({
  sessionCount: 0, totalSets: 0, totalVolumeKg: 0, totalMinutes: 0,
}) as Row)
const getYearReviewTopExercises = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listRecentPersonalRecords = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getSessionLoadsFrom = vi.fn(async (..._a: unknown[]) => [] as Row[])

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listSeasonsWithResults, updateEquippedTitle, getYearReviewTotals,
    getYearReviewTopExercises, listRecentPersonalRecords, getSessionLoadsFrom,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getYearReview } from '@/app/api/year-review/route'
import { GET as getSeasons } from '@/app/api/seasons/route'
import { PATCH as patchTitle } from '@/app/api/user/equipped-title/route'

/**
 * 15:00 on the 10th in UTC−5, and already 06:00 on the **11th** in Brisbane.
 *
 * Every derived value therefore differs between the user's zone and the default: the day string,
 * the 365-day window's start, and which month a session falls in. A fixture whose timezone IS
 * `DEFAULT_TZ` proves nothing about which zone was read — the same trap as any pair of equal
 * quantities — so the assertions below are only meaningful because these two disagree.
 */
const NOW = new Date('2026-03-10T20:00:00Z')
const USER_TZ = 'Etc/GMT+5'                                  // fixed offset: no DST to reason about
const SINCE_IN_USER_TZ = new Date('2025-03-10T05:00:00Z')    // local midnight, 365 days back
const SINCE_IN_DEFAULT_TZ = new Date('2025-03-10T14:00:00Z') // what forgetting the argument gives

const patch = (body: unknown) => patchTitle(new Request('http://localhost/x', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as never)

beforeEach(() => {
  for (const m of [listSeasonsWithResults, updateEquippedTitle, getYearReviewTotals,
                   getYearReviewTopExercises, listRecentPersonalRecords, getSessionLoadsFrom]) m.mockClear()
  getYearReviewTotals.mockResolvedValue({ sessionCount: 0, totalSets: 0, totalVolumeKg: 0, totalMinutes: 0 })
  getYearReviewTopExercises.mockResolvedValue([])
  listRecentPersonalRecords.mockResolvedValue([])
  getSessionLoadsFrom.mockResolvedValue([])
  sessionUser = { id: 'u-1', timezone: USER_TZ }
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/year-review', () => {
  it("anchors the 365-day window at the USER's local midnight, not the default zone's", async () => {
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    expect(SINCE_IN_USER_TZ).not.toEqual(SINCE_IN_DEFAULT_TZ)
    vi.useFakeTimers(); vi.setSystemTime(NOW)

    await getYearReview()

    // All four reads share one window — a route that computed it twice could drift between them.
    expect(getYearReviewTotals).toHaveBeenCalledWith('u-1', SINCE_IN_USER_TZ)
    expect(getYearReviewTopExercises).toHaveBeenCalledWith('u-1', SINCE_IN_USER_TZ, 5)
    expect(listRecentPersonalRecords).toHaveBeenCalledWith('u-1', SINCE_IN_USER_TZ, NOW)
    expect(getSessionLoadsFrom).toHaveBeenCalledWith('u-1', SINCE_IN_USER_TZ)
  })

  it('falls back to the default zone only when the session carries none', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    sessionUser = { id: 'u-1' }
    await getYearReview()
    expect(getYearReviewTotals).toHaveBeenCalledWith('u-1', SINCE_IN_DEFAULT_TZ)
  })

  it("buckets a session by the user's calendar day, which can be a different YEAR", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    // 04:00 UTC on New Year's Day is 23:00 on 2025-12-31 for this user and 14:00 on 2026-01-01 in
    // Brisbane. Two months apart in the trailing-year buckets, so the assertion can tell them apart
    // — a session logged mid-afternoon UTC would land in the same bucket either way and prove
    // nothing.
    getSessionLoadsFrom.mockResolvedValue([{ startedAt: new Date('2026-01-01T04:00:00Z') }])
    const body = await (await getYearReview()).json()

    const counts: number[] = body.monthlySessionCounts
    expect(counts).toHaveLength(12)
    expect(counts[8]).toBe(1)   // December 2025, three months before the user's March 10th
    expect(counts[9]).toBe(0)   // January 2026 — where the default zone would have put it
  })

  it("anchors the monthly buckets on the user's month, not the default zone's", async () => {
    // **A separate clock, because `NOW` could not decide this.** At 2026-03-10 the two zones differ
    // by a calendar DAY but sit in the same month, and `monthlySessionCounts` reads only year and
    // month — so swapping the anchor changed nothing and the mutation survived. 20:00 UTC on the
    // 31st is still March for this user and already April in Brisbane, which is the only kind of
    // instant where the two anchors give different buckets.
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-31T20:00:00Z'))
    // Midday UTC, so the session's own day string is identical in both zones — this case is about
    // the anchor alone, and a session that also moved would confound the two.
    getSessionLoadsFrom.mockResolvedValue([{ startedAt: new Date('2026-01-15T12:00:00Z') }])
    const counts: number[] = (await (await getYearReview()).json()).monthlySessionCounts

    expect(counts[9]).toBe(1)   // two months before the user's March
    expect(counts[8]).toBe(0)   // three months before Brisbane's April
  })

  it('prefers the best LOADED lift for the headline, even when a bodyweight index is larger', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    // The bodyweight number is deliberately the biggest in the set. If it were smaller, the filter
    // and a plain maximum would agree and nothing here would be under test.
    listRecentPersonalRecords.mockResolvedValue([
      { exerciseName: 'Squat',    estimated1rm: 180, exerciseType: 'barbell',    achievedAt: NOW },
      { exerciseName: 'Pull-up',  estimated1rm: 412, exerciseType: 'bodyweight', achievedAt: NOW },
      { exerciseName: 'Deadlift', estimated1rm: 220, exerciseType: 'barbell',    achievedAt: NOW },
    ])
    const body = await (await getYearReview()).json()
    expect(body.biggestPr).toEqual({ exerciseName: 'Deadlift', estimated1rm: 220, exerciseType: 'barbell' })
    expect(body.prCount).toBe(3)
  })

  it('falls back to a bodyweight PR when it is the only kind there is', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    listRecentPersonalRecords.mockResolvedValue([
      { exerciseName: 'Pull-up', estimated1rm: 412, exerciseType: 'bodyweight', achievedAt: NOW },
    ])
    const body = await (await getYearReview()).json()
    expect(body.biggestPr?.exerciseName).toBe('Pull-up')
  })

  it('reports no headline rather than a zero one when nothing was set', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const body = await (await getYearReview()).json()
    expect(body.biggestPr).toBeNull()
    expect(body.prCount).toBe(0)
    expect(body.longestWeeklyStreak).toBe(0)
  })

  it('rounds the volume and passes the counts through untouched', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    getYearReviewTotals.mockResolvedValue({
      sessionCount: 137, totalSets: 2411, totalVolumeKg: 412_345.67, totalMinutes: 8_213,
    })
    getYearReviewTopExercises.mockResolvedValue([{ exerciseName: 'Squat', setCount: 300 }])
    const body = await (await getYearReview()).json()
    expect(body.totalVolumeKg).toBe(412_346)
    expect(body).toMatchObject({ sessionCount: 137, totalSets: 2411, totalMinutes: 8_213 })
    expect(body.topExercises).toEqual([{ exerciseName: 'Squat', setCount: 300 }])
  })

  it('refuses without a session, before reading anything', async () => {
    sessionUser = null
    expect((await getYearReview()).status).toBe(401)
    expect(getYearReviewTotals).not.toHaveBeenCalled()
    expect(listRecentPersonalRecords).not.toHaveBeenCalled()
  })
})

describe('GET /api/seasons', () => {
  it('lists the caller’s seasons and nobody else’s', async () => {
    listSeasonsWithResults.mockResolvedValue([{ id: 's-1', name: 'Spring' }])
    const res = await getSeasons()
    expect(res.status).toBe(200)
    expect(listSeasonsWithResults).toHaveBeenCalledWith('u-1')
    expect(await res.json()).toEqual({ seasons: [{ id: 's-1', name: 'Spring' }] })
  })

  it('refuses without a session, before reading anything', async () => {
    sessionUser = null
    expect((await getSeasons()).status).toBe(401)
    expect(listSeasonsWithResults).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/user/equipped-title', () => {
  it('equips a known title and echoes what was stored', async () => {
    const res = await patch({ titleId: 'iron_will' })
    expect(res.status).toBe(200)
    expect(updateEquippedTitle).toHaveBeenCalledWith('u-1', 'iron_will')
    expect(await res.json()).toEqual({ equippedTitle: 'iron_will' })
  })

  it('accepts null, because that is how a title comes OFF', async () => {
    // The guard is `titleId !== null && …`. Written as a plain "must be a known title" it would
    // refuse every unequip, and the first title chosen would be permanent.
    const res = await patch({ titleId: null })
    expect(res.status).toBe(200)
    expect(updateEquippedTitle).toHaveBeenCalledWith('u-1', null)
    expect(await res.json()).toEqual({ equippedTitle: null })
  })

  it('refuses a title id that is not in the catalogue', async () => {
    // `TITLES[id]` resolves an icon component, so an id that is not really a title is stored fine
    // and then fails to render.
    for (const titleId of ['not_a_title', '', 7, undefined]) {
      updateEquippedTitle.mockClear()
      expect((await patch({ titleId })).status, JSON.stringify({ titleId })).toBe(400)
      expect(updateEquippedTitle).not.toHaveBeenCalled()
    }
    expect((await patch({})).status).toBe(400)
  })

  it("refuses every key the catalogue inherits rather than owns", async () => {
    // **This found a live bug.** `TITLES` is a plain object literal, so `TITLES['constructor']` walks
    // the prototype chain and is truthy — as are seven siblings. All eight passed the old
    // `!TITLES[titleId]` guard, were stored, and then broke rendering: `profile-tab.tsx` mounts
    // `<title.Icon />` from the same map and `(Object).Icon` is undefined, which React answers with
    // a hard crash. The row survives a reload, so the profile tab stays broken until it is edited.
    // The guard now asks `hasOwnProperty`.
    for (const titleId of ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
                           '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      updateEquippedTitle.mockClear()
      expect((await patch({ titleId })).status, titleId).toBe(400)
      expect(updateEquippedTitle, titleId).not.toHaveBeenCalled()
    }
  })

  it('413s a body over the cap rather than buffering it', async () => {
    expect((await patch({ titleId: 'iron_will', pad: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(updateEquippedTitle).not.toHaveBeenCalled()
  })

  it('refuses without a session, before reading the body', async () => {
    sessionUser = null
    expect((await patch({ titleId: 'iron_will' })).status).toBe(401)
    expect(updateEquippedTitle).not.toHaveBeenCalled()
  })
})
