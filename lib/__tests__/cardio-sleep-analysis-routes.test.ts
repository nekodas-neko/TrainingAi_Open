/**
 * PS-39 — the two reads that draw a conclusion from history rather than reporting it:
 * `guided-walk/segment-stats` and `sleep-performance-correlation`.
 *
 * Batched because both take months of rows and reduce them to something the app then *states* to
 * the owner, which is the class where a quiet aggregation bug is least visible: the answer is always
 * a plausible-looking number. Both carry a documented past defect, and each of those is a case here:
 *
 *   · **Treadmill interval walks count (Q-66).** They are the same workout done indoors. Filtering
 *     them out silently dropped the owner's indoor sessions from the fast/slow card they are doing
 *     the intervals for.
 *   · **Nights, not rows (Q-76).** A raw sleep-row pass put a 0.1 h evening bout and the 7.6 h night
 *     that followed on the same date, and last-write-wins picked whichever came back last —
 *     **21 % of this correlation's x-values were not nights.**
 *   · **One point per DAY, not per exercise (PS-29).** Four days of five lifts read as n = 20: the
 *     p-value was computed at 20 and the sentence said "20 paired days" for four. Points from one
 *     day share their x exactly, so the inflation runs in the direction that manufactures
 *     significance.
 *
 * The shared statistics are deliberately NOT mocked. `nightSessions`, `buildExercise1rmBaseline`,
 * `sessionMean1RmPct`, `bucketize` and `correlationInsight` all run for real — mocking them would
 * leave only the plumbing under test, and the plumbing is not where any of the three defects lived.
 *
 * Fixture discipline (the PS-39 note): every fixture forces apart the two situations its case must
 * distinguish — a day with several lifts, a nap sharing a date with its night, a treadmill log
 * beside an outdoor one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const listActivityLogs = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getWorkoutSessionsFrom = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listSleepSessions = vi.fn(async (..._a: unknown[]) => [] as Row[])
const rateLimit = vi.fn((..._a: unknown[]) => true)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ listActivityLogs, getWorkoutSessionsFrom, listSleepSessions })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as walkStats } from '@/app/api/guided-walk/segment-stats/route'
import { GET as sleepCorrelation } from '@/app/api/sleep-performance-correlation/route'

const seg = (kind: 'fast' | 'slow', avgHr: number, over: Row = {}) => ({
  index: 0, setNumber: 1, kind, startSec: 0, endSec: 180,
  avgHr, maxHr: avgHr + 5, hrAtStart: avgHr - 5,
  avgPaceSecPerKm: null, distanceKm: null, avgCadenceSpm: null,
  ...over,
})

beforeEach(() => {
  for (const m of [listActivityLogs, getWorkoutSessionsFrom, listSleepSessions, rateLimit]) m.mockClear()
  rateLimit.mockReturnValue(true)
  listActivityLogs.mockResolvedValue([])
  getWorkoutSessionsFrom.mockResolvedValue([])
  listSleepSessions.mockResolvedValue([])
  sessionUser = { id: 'u-1' }
})
afterEach(() => { vi.useRealTimers() })

describe('GET /api/guided-walk/segment-stats', () => {
  it('counts treadmill walks alongside outdoor ones (Q-66)', async () => {
    // **The treadmill log is what makes this case decide anything.** With only outdoor walks,
    // dropping `'treadmill'` from the filter changes no number and the rule is untested. Their heart
    // rates are far apart so the average moves visibly either way.
    listActivityLogs.mockResolvedValue([
      { activityType: 'walk',      segments: [seg('fast', 120)] },
      { activityType: 'treadmill', segments: [seg('fast', 140)] },
    ])
    const body = await (await walkStats()).json()
    expect(body.fast.avgHr).toBe(130)   // both; outdoor alone would be 120
  })

  it('ignores activity that is not a walk, and rows carrying no segments', async () => {
    listActivityLogs.mockResolvedValue([
      { activityType: 'walk',      segments: [seg('slow', 100)] },
      { activityType: 'run',       segments: [seg('slow', 170)] },  // a run is not a guided walk
      { activityType: 'walk',      segments: null },                 // logged before segments existed
    ])
    const body = await (await walkStats()).json()
    expect(body.slow.avgHr).toBe(100)
  })

  it('separates the fast and slow blocks, which is the whole point of the card', async () => {
    listActivityLogs.mockResolvedValue([
      { activityType: 'walk', segments: [seg('fast', 138), seg('slow', 96), seg('fast', 142)] },
    ])
    const body = await (await walkStats()).json()
    expect(body.fast.avgHr).toBe(140)
    expect(body.slow.avgHr).toBe(96)
  })

  it("reads a ~3-year window ending at the USER's today", async () => {
    // 20:00 UTC on the 10th is still the 10th in UTC−5 and already the 11th in Brisbane, so both
    // ends of the window differ by a day between the two zones and the assertion can tell them
    // apart. A fixture whose timezone IS `DEFAULT_TZ` proves nothing about which was read.
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-10T20:00:00Z'))

    sessionUser = { id: 'u-1', timezone: 'Etc/GMT+5' }
    await walkStats()
    const [userId, from, to] = listActivityLogs.mock.calls[0] as [string, string, string]
    expect(userId).toBe('u-1')
    expect(to).toBe('2026-03-10')
    expect(from).toBe('2023-03-11')   // 1095 days back from local midnight, in the user's zone

    listActivityLogs.mockClear()
    sessionUser = { id: 'u-1' }
    await walkStats()
    expect((listActivityLogs.mock.calls[0] as string[])[2]).toBe('2026-03-11')
  })

  it('answers with empty stats rather than a 500 when the read fails', async () => {
    // The card is one panel on a screen full of others; a failed history read should blank this
    // card, not take the request down with it.
    listActivityLogs.mockRejectedValue(new Error('statement timeout'))
    const res = await walkStats()
    expect(res.status).toBe(200)
    expect((await res.json()).fast.avgHr).toBeNull()
  })

  it('refuses without a session and over the rate limit, in that order', async () => {
    sessionUser = null
    expect((await walkStats()).status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()

    sessionUser = { id: 'u-1' }
    rateLimit.mockReturnValue(false)
    expect((await walkStats()).status).toBe(429)
    expect(listActivityLogs).not.toHaveBeenCalled()
  })
})

describe('GET /api/sleep-performance-correlation', () => {
  /** A workout day whose lifts all sit exactly on their own baseline, so `y` is 0 and only the
   *  COUNT of points varies with the aggregation rule under test. */
  const workoutDay = (dayIso: string, exerciseCount: number) => ({
    startedAt: new Date(`${dayIso}T02:00:00Z`),   // midday Brisbane, so the day string is unambiguous
    exercises: Array.from({ length: exerciseCount }, (_, i) => ({
      exerciseName: `Lift ${i + 1}`, estimated1rm: 100,
    })),
  })
  /**
   * A night that WAKES on `dayIso` in Brisbane — 06:06 local, which is 20:06 UTC the day before.
   *
   * Getting this an hour-block wrong is not cosmetic: `nightSessions` re-dates by circadian
   * position, so a night built at `${dayIso}T20:06Z` wakes on the MORNING AFTER `dayIso` and every
   * pairing shifts by a day. The first draft did exactly that and lost one day off each end.
   */
  const night = (dayIso: string, hours: number) => {
    const end = new Date(Date.parse(`${dayIso}T20:06:00Z`) - 86_400_000)
    return {
      date: dayIso, durationHours: hours,
      sleepStart: new Date(end.getTime() - hours * 3_600_000), sleepEnd: end,
    }
  }
  /** An evening bout on the night of `dayIso` — 19:00 Brisbane the previous evening. */
  const nap = (dayIso: string, hours: number) => {
    const start = new Date(Date.parse(`${dayIso}T09:00:00Z`) - 86_400_000)
    return {
      date: dayIso, durationHours: hours,
      sleepStart: start, sleepEnd: new Date(start.getTime() + hours * 3_600_000),
    }
  }

  it('counts one paired observation per DAY — not per lift, per session, or per unusable row (PS-29)', async () => {
    // **`n` is the assertion, and the fixture is built so that four different mistakes each move
    // it.** The first draft of this case had one session per day with three lifts, which sounds
    // like it tests the rule and does not: `sessionMean1RmPct` already averages within a session,
    // so the day-merge is a no-op and removing it changed nothing. The mutation pass survived, and
    // this is the rebuild.
    //
    // Twelve real days, plus three things that must NOT become a thirteenth point:
    //   · a SECOND session on one of the twelve — two sessions, one day, one observation;
    //   · a workout day with no sleep behind it and none the night before;
    //   · a day whose only lift appears once in the window, so it has no baseline to deviate from.
    const days = Array.from({ length: 12 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`)
    getWorkoutSessionsFrom.mockResolvedValue([
      ...days.map(d => workoutDay(d, 3)),
      workoutDay('2026-03-05', 2),                                   // a second session, same day
      workoutDay('2026-03-20', 3),                                   // no sleep behind it
      { startedAt: new Date('2026-03-21T02:00:00Z'),                 // no baseline: one sample only
        exercises: [{ exerciseName: 'Rare Lift', estimated1rm: 100 }] },
    ])
    listSleepSessions.mockResolvedValue([
      ...days.map((d, i) => night(d, i < 6 ? 5.5 : 8.5)),
      night('2026-03-21', 7.5),                                      // slept, but nothing comparable
    ])

    const body = await (await sleepCorrelation()).json()
    expect(body.stats.n).toBe(12)
    // Below the 20-point minimum, so the route says so instead of reporting a correlation. Getting
    // `n` wrong by one is a different sentence, and by sixteen a different branch entirely.
    expect(body.withheld).toBe('sample')
    expect(body.insight).toContain('12 paired days')
  })

  it('uses the NIGHT, not whichever sleep row came back last (Q-76)', async () => {
    // A 0.1 h evening bout sharing a date with the 7.6 h night that followed it. Under a raw
    // last-write-wins pass the nap can win and the day lands in `<6h`; `nightSessions` classifies by
    // circadian position, so the nap drops out entirely.
    const days = ['2026-03-01', '2026-03-02', '2026-03-03']
    getWorkoutSessionsFrom.mockResolvedValue(days.map(d => workoutDay(d, 1)))
    listSleepSessions.mockResolvedValue([
      // The nap listed BEFORE its night on 03-01 and AFTER it on 03-03, so neither ordering can
      // pass by luck — a last-write-wins bug lands one of them in `<6h` whichever way it leans.
      nap('2026-03-01', 0.1),
      night('2026-03-01', 7.6),
      night('2026-03-02', 7.5),
      night('2026-03-03', 7.4),
      nap('2026-03-03', 0.2),
    ])

    const body = await (await sleepCorrelation()).json()
    // `bucketize` drops empty buckets, so an absent label IS a count of zero.
    expect(body.buckets.find((b: Row) => b.label === '7–8h').count).toBe(3)
    expect(body.buckets.find((b: Row) => b.label === '<6h')).toBeUndefined()
  })

  it('falls back to the previous night when the sleep row is dated the night before', async () => {
    // Sleep rows are keyed on the wake date, but a row can land on the day before the workout;
    // the route tries the workout's own date first and then yesterday's.
    getWorkoutSessionsFrom.mockResolvedValue([workoutDay('2026-03-02', 1), workoutDay('2026-03-03', 1), workoutDay('2026-03-04', 1)])
    listSleepSessions.mockResolvedValue([night('2026-03-01', 8.5), night('2026-03-02', 8.4), night('2026-03-03', 8.3)])
    const body = await (await sleepCorrelation()).json()
    expect(body.buckets.find((b: Row) => b.label === '8h+').count).toBe(3)
  })

  it('drops a workout day with no sleep behind it rather than guessing one', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([workoutDay('2026-03-01', 1), workoutDay('2026-03-20', 1), workoutDay('2026-03-02', 1)])
    listSleepSessions.mockResolvedValue([night('2026-03-01', 7.5), night('2026-03-02', 7.4)])
    const body = await (await sleepCorrelation()).json()
    const total = body.buckets.reduce((a: number, b: Row) => a + (b.count as number), 0)
    // Two, not three. `bucketize` would drop an undefined `x` anyway, so the bucket total alone
    // cannot tell a guarded day from an unguarded one — the `n` assertion in the PS-29 case above
    // is what actually holds this; this case pins the visible half.
    expect(total).toBe(2)
  })

  it("reads a 90-day window in the USER's zone, and hands each repository its own date shape", async () => {
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-10T20:00:00Z'))

    sessionUser = { id: 'u-1', timezone: 'Etc/GMT+5' }
    await sleepCorrelation()
    // Workouts take a Date (local midnight, 90 days back); sleep takes ISO day strings. Two shapes
    // for one window, which is exactly where a copy-paste puts the wrong one in the wrong call.
    expect(getWorkoutSessionsFrom).toHaveBeenCalledWith('u-1', new Date('2025-12-10T05:00:00Z'))
    expect(listSleepSessions).toHaveBeenCalledWith('u-1', '2025-12-10', '2026-03-10')

    getWorkoutSessionsFrom.mockClear(); listSleepSessions.mockClear()
    sessionUser = { id: 'u-1' }
    await sleepCorrelation()
    expect((listSleepSessions.mock.calls[0] as string[])[2]).toBe('2026-03-11')
  })

  it('says it has nothing to say rather than inventing a pattern', async () => {
    const res = await sleepCorrelation()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.hasSufficientData).toBe(false)
    expect(body.insight).toBe('Not enough paired sleep + workout data yet.')
    // `bucketize` returns only buckets that caught a point, so with no data it is empty rather
    // than four zeroes — the client renders the insight, not the empty frame.
    expect(body.buckets).toEqual([])
  })

  it('refuses without a session, before reading anything', async () => {
    sessionUser = null
    expect((await sleepCorrelation()).status).toBe(401)
    expect(getWorkoutSessionsFrom).not.toHaveBeenCalled()
    expect(listSleepSessions).not.toHaveBeenCalled()
  })
})
