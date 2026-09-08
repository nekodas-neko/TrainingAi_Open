/**
 * PS-39 — the Cardiovascular hub's reads: `cardio-week`, `cardio-trends` and `running-bests`.
 *
 * Batched because they are the three reads that paint one hub from the same activity and
 * heart-rate rows, and because `cardio-week` alone runs eleven repository queries whose failure
 * behaviour is a deliberate decision rather than an accident. What each carries:
 *
 *   · **The degradation is real but PARTIAL, and the tests say which half.** Nine repository calls
 *     carry `.catch(() => [])` so a broken zone query still paints — but `resolveHrProfile` runs
 *     first and leaves two of its own three reads unguarded, so `getUserById` and `listBodyMetrics`
 *     are fatal to the whole route. Measured, not read off the source: every read was failed in
 *     turn. That makes the route's own four `.catch`es on `listBodyMetrics` dead defence, and it is
 *     filed as LA-82 rather than fixed here. The cost of the half that does work is that a failure
 *     is indistinguishable from an empty week — the card reads zero, not "unknown".
 *   · **A delta needs BOTH windows to be trustworthy.** The max-HR delta is null unless the
 *     current and prior windows are each reliable; a delta between a corroborated max and an
 *     uncorroborated one is noise wearing a number.
 *   · **Week-to-date is compared against week-to-date.** `weekGoalSoFar` scales the daily goal by
 *     the days elapsed — measuring three days against a seven-day goal always reads as failure.
 *   · **A lazy day means neither lifting nor cardio** (Q-88). Either one counts, which is why the
 *     route asks two questions and ORs them.
 *   · **`running-bests` looks back three years** as a stand-in for all-time, because no unbounded
 *     "every activity log" query exists and adding one for a bests card is not worth it.
 *   · **The trend curves see runs only**, filtered before the maths rather than inside it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'
import { MIN_RELIABLE_SAMPLES, CORROBORATION } from '@trainingai/shared/health/observed-hr'

type Row = Record<string, unknown>
type Day = { day: string; seconds: [number, number, number, number, number] }

const getZoneMinutesRange = vi.fn(async (..._a: unknown[]) => [] as Day[])
const listActivityLogs = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getHrForWindow = vi.fn(async (..._a: unknown[]) => [] as { bpm: number }[])
const getUserById = vi.fn(async (_u: string) => ({ dateOfBirth: '1990-01-01', heightCm: 180, sex: 'male', activityLevel: 'moderate' }) as Row | null)
const listBodyMetrics = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getActiveRunningPlan = vi.fn(async (_u: string) => null as Row | null)
const getDayExerciseNames = vi.fn(async (..._a: unknown[]) => [] as Row[])

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getZoneMinutesRange, listActivityLogs, getHrForWindow, getUserById,
    listBodyMetrics, getActiveRunningPlan, getDayExerciseNames,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getWeek } from '@/app/api/cardio-week/route'
import { GET as getTrends } from '@/app/api/cardio-trends/route'
import { GET as getBests } from '@/app/api/running-bests/route'

const TZ = 'Australia/Brisbane'
const zeroDay = (day: string): Day => ({ day, seconds: [0, 0, 0, 0, 0] })
const run = (over: Row = {}) => ({
  activityType: 'run', date: '2026-09-01', distanceKm: 5, durationMin: 25,
  avgHeartRate: 150, cadenceSpm: 170, ...over,
})

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: TZ, ...over }
}

/** `computeObservedHr` only calls a max corroborated once it has this many plausible readings. */
const reliableBpms = (bpm: number) => Array.from({ length: MIN_RELIABLE_SAMPLES }, () => ({ bpm }))

/**
 * Enough readings to HAVE a corroborated max, but not enough to be called reliable.
 *
 * The distinction is the whole point of the delta rule and it is easy to miss: a one-reading
 * window has `max: null`, so the `max != null` guard rejects it and the `isReliable` guard is
 * never reached. Only a window in this band tests the rule that is actually written.
 */
const corroboratedButUnreliable = (bpm: number) =>
  Array.from({ length: CORROBORATION + 5 }, () => ({ bpm }))

/**
 * Answer `getHrForWindow` by WHICH window is asked for, never by call order.
 *
 * `resolveHrProfile` calls it too, before the route's own two, so a `mockResolvedValueOnce` chain
 * feeds the profile the value meant for the current window and shifts everything after it. Keying
 * on the window's start date is also what the real repository does.
 */
const hrByWindow = ({ current, prior }: { current: { bpm: number }[]; prior: { bpm: number }[] }) => {
  const cutoff = Date.now() - 45 * 86_400_000  // between the 30-day current and 60-day prior starts
  getHrForWindow.mockImplementation(async (..._a: unknown[]) => {
    const from = _a[1] as Date
    return from.getTime() < cutoff ? prior : current
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getZoneMinutesRange.mockResolvedValue([])
  listActivityLogs.mockResolvedValue([])
  getHrForWindow.mockResolvedValue([])
  getUserById.mockResolvedValue({ dateOfBirth: '1990-01-01', heightCm: 180, sex: 'male', activityLevel: 'moderate' })
  listBodyMetrics.mockResolvedValue([])
  getActiveRunningPlan.mockResolvedValue(null)
  getDayExerciseNames.mockResolvedValue([])
})

describe('/api/cardio-week', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getWeek()).status).toBe(401)
  })

  // Eleven queries behind one card, and a broken one degrades rather than fails it — for the
  // reads that are actually guarded. The cost is a zero indistinguishable from an empty week.
  it('still paints when the guarded reads fail', async () => {
    for (const m of [getZoneMinutesRange, listActivityLogs, getHrForWindow, getActiveRunningPlan, getDayExerciseNames]) {
      m.mockRejectedValue(new Error('db down'))
    }
    const res = await getWeek()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.steps.week).toBe(0)
    expect(body.heart.avgHr).toBeNull()
    expect(body.hasRunningPlan).toBe(false)
    expect(body.trainedToday).toBe(false)
  })

  // LA-82, pinned as CURRENT BEHAVIOUR rather than endorsed. `resolveHrProfile` runs before the
  // Promise.all and guards only one of its own three reads, so these two take the whole route down
  // — which also makes the route's four `.catch`es on `listBodyMetrics` unreachable. Whether the
  // fix is to guard them or to keep failing loudly is a design question, not an obvious bug: a hub
  // painting a default resting HR as though it were measured may be worse than an error.
  it('is NOT resilient to the two reads the HR profile makes unguarded', async () => {
    getUserById.mockRejectedValue(new Error('db down'))
    await expect(getWeek()).rejects.toThrow('db down')

    getUserById.mockResolvedValue({ dateOfBirth: '1990-01-01' })
    listBodyMetrics.mockRejectedValue(new Error('db down'))
    await expect(getWeek()).rejects.toThrow('db down')
  })

  // A delta between a corroborated max and an uncorroborated one is noise wearing a number.
  it('withholds the max-HR delta unless both windows are reliable', async () => {
    // The prior window HAS a max — it is corroborated — and is still not reliable. A window with
    // too few readings to have a max at all would pass this case for the wrong reason.
    hrByWindow({ current: reliableBpms(180), prior: corroboratedButUnreliable(170) })
    const body = await (await getWeek()).json()

    expect(body.heart.isReliable).toBe(true)
    expect(body.heart.maxHrDeltaBpm).toBeNull()
    // The average needs no corroboration, so its delta still lands.
    expect(body.heart.avgHrDeltaBpm).toBe(10)
  })

  it('withholds it when the CURRENT window is the unreliable one', async () => {
    hrByWindow({ current: corroboratedButUnreliable(180), prior: reliableBpms(170) })
    const body = await (await getWeek()).json()

    expect(body.heart.isReliable).toBe(false)
    expect(body.heart.maxHrDeltaBpm).toBeNull()
    // …and the average delta is reported anyway, because an average needs no corroboration.
    expect(body.heart.avgHrDeltaBpm).toBe(10)
  })

  it('reports the max-HR delta when both windows are corroborated', async () => {
    hrByWindow({ current: reliableBpms(180), prior: reliableBpms(174) })
    expect((await (await getWeek()).json()).heart.maxHrDeltaBpm).toBe(6)
  })

  // Measuring three days of a week against a seven-day goal always reads as failure.
  it('scales the week goal to the days elapsed', async () => {
    const today = todayInTz(TZ)
    getZoneMinutesRange.mockResolvedValue([zeroDay('2026-09-07'), zeroDay('2026-09-08'), zeroDay(today)])
    const body = await (await getWeek()).json()

    expect(body.steps.weekGoal).toBe(body.steps.todayGoal * 7)
    expect(body.steps.weekGoalSoFar).toBe(body.steps.todayGoal * 3)
  })

  // Q-88: either a lifting session or any logged cardio means today was not a lazy day.
  it('credits the day for lifting or for cardio, and neither means lazy', async () => {
    expect((await (await getWeek()).json()).trainedToday).toBe(false)

    getDayExerciseNames.mockResolvedValue([{ exerciseName: 'Squat' }])
    expect((await (await getWeek()).json()).trainedToday).toBe(true)

    getDayExerciseNames.mockResolvedValue([])
    listActivityLogs.mockResolvedValue([run()])
    expect((await (await getWeek()).json()).trainedToday).toBe(true)
  })

  it('sums only this week\'s steps and reads today\'s from today\'s row', async () => {
    const today = todayInTz(TZ)
    listBodyMetrics.mockResolvedValue([
      { date: '2026-09-07', steps: 4000 }, { date: today, steps: 6000 },
    ])
    const body = await (await getWeek()).json()
    expect(body.steps.today).toBe(6000)
    expect(body.steps.week).toBe(10_000)
  })

  // `days.length || 1`: with no zone rows the goal-so-far must still be one day's worth, or a week
  // with nothing recorded shows a target of zero and reads as already cleared.
  it('never scales the goal-so-far to zero days', async () => {
    getZoneMinutesRange.mockResolvedValue([])
    const body = await (await getWeek()).json()
    expect(body.steps.weekGoalSoFar).toBe(body.steps.todayGoal)
  })

  it('answers the week window and no-store', async () => {
    const res = await getWeek()
    const body = await res.json()
    expect(body.week.to).toBe(todayInTz(TZ))
    expect(body.week.from <= body.week.to).toBe(true)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rate-limits the thirty-first read in the minute', async () => {
    for (let i = 0; i < 30; i++) expect((await getWeek()).status).toBe(200)
    expect((await getWeek()).status).toBe(429)
  })

  it('anchors the week to the caller\'s timezone, not the default', async () => {
    const toFor = async (timezone: string) => {
      getZoneMinutesRange.mockClear()
      freshUser({ timezone })
      return (await (await getWeek()).json()).week.to
    }
    expect(await toFor('Etc/GMT-14')).toBe(todayInTz('Etc/GMT-14'))
    expect(await toFor('Etc/GMT+12')).toBe(todayInTz('Etc/GMT+12'))
    expect(todayInTz('Etc/GMT-14')).not.toBe(todayInTz('Etc/GMT+12'))
  })
})

describe('/api/cardio-trends', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getTrends()).status).toBe(401)
  })

  // The curves are about running. A walk in the same window would otherwise sit on a chart whose
  // axis is running efficiency.
  it('builds the curves from runs alone', async () => {
    listActivityLogs.mockResolvedValue([
      run({ date: '2026-09-01' }),
      { activityType: 'walk', date: '2026-09-02', distanceKm: 3, durationMin: 40, avgHeartRate: 100, cadenceSpm: 110 },
      run({ date: '2026-09-03', distanceKm: 8, durationMin: 40 }),
    ])
    const body = await (await getTrends()).json()
    expect(body.cadenceTrend.length + body.efficiencyCurve.length).toBeGreaterThan(0)
    for (const point of [...body.cadenceTrend, ...body.efficiencyCurve]) {
      expect(point.date).not.toBe('2026-09-02')
    }
  })

  it('reads eight weeks of zones and ninety days of runs', async () => {
    await getTrends()
    const span = (from: string, to: string) =>
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    const [, zoneFrom, zoneTo] = getZoneMinutesRange.mock.calls[0] as [string, string, string]
    const [, runFrom, runTo] = listActivityLogs.mock.calls[0] as [string, string, string]
    expect(span(zoneFrom, zoneTo)).toBe(56)
    expect(span(runFrom, runTo)).toBe(90)
  })

  it('degrades to empty curves rather than failing when a read throws', async () => {
    getZoneMinutesRange.mockRejectedValue(new Error('db down'))
    listActivityLogs.mockRejectedValue(new Error('db down'))
    const res = await getTrends()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ weeklyZoneStacks: [], efficiencyCurve: [], cadenceTrend: [] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rate-limits the thirty-first read in the minute', async () => {
    for (let i = 0; i < 30; i++) expect((await getTrends()).status).toBe(200)
    expect((await getTrends()).status).toBe(429)
  })
})

describe('/api/running-bests', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getBests()).status).toBe(401)
  })

  // Three years stands in for all-time: there is no unbounded activity-log query and a bests card
  // does not justify adding one.
  it('reaches back three years', async () => {
    await getBests()
    const [, from, to] = listActivityLogs.mock.calls[0] as [string, string, string]
    expect((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000).toBe(1095)
  })

  it('measures bests from runs alone, and answers no-store', async () => {
    listActivityLogs.mockResolvedValue([
      run({ date: '2026-09-01', distanceKm: 5, durationMin: 25 }),
      { activityType: 'cycle', date: '2026-09-02', distanceKm: 60, durationMin: 90 },
    ])
    const res = await getBests()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')

    const body = await res.json()
    // A 60 km ride must not appear as a running best however it is shaped.
    expect(JSON.stringify(body)).not.toContain('60')
  })

  it('degrades to an empty result rather than failing', async () => {
    listActivityLogs.mockRejectedValue(new Error('db down'))
    expect((await getBests()).status).toBe(200)
  })

  it('rate-limits the thirty-first read in the minute', async () => {
    for (let i = 0; i < 30; i++) expect((await getBests()).status).toBe(200)
    expect((await getBests()).status).toBe(429)
  })
})
