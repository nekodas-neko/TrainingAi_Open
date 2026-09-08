/**
 * PS-39 — the Home screen's week and streak reads: `next-session`, `progress-summary`,
 * `weekly-stats`, `streak-data` and `achievements`.
 *
 * Sibling to `home-aggregate-routes.test.ts`, which covers the other half of the same screen
 * (`calendar-data`, `training-load`, `muscle-recovery`) — these are split by what has to be
 * verified together, not by screen.
 *
 * Batched because they are the five reads that paint one screen, and three of them answer
 * overlapping questions about the same week from the same `getWorkoutSessionsFrom` rows — so a
 * change to how a session is counted has to be verified across all of them at once. Each carries a
 * decision the response shape hides:
 *
 *   · **"Last night" is a NIGHT, not the most recent row** (Q-76). Sorting raw rows by date picks
 *     arbitrarily between an evening nap and the night that followed it on the same date, which is
 *     how a 0.1 h bout once became last night's sleep.
 *   · **A session is counted once per (day, session name)**, so several `workout_sessions` rows for
 *     one session on one day do not read as several workouts. Both `progress-summary` and
 *     `weekly-stats` build that key, which is why both are pinned here.
 *   · **Deload volume is held out of the week's total but kept as its own figure**, because a
 *     deload day is training rather than a rest day and its bar still needs a real height (Q-246).
 *   · **A testing day wins over a deload day.** `isDeloadSession` is true for testing too, so
 *     `every(isDeloadSession)` used to label a pure testing day "D".
 *   · **Session duration prefers the wall clock and falls back to the log span**, with an upper cap:
 *     `startedAt` falls back to local midnight when no start time was given, so an evening finish
 *     would otherwise read as an eighteen-hour session.
 *   · **A dropped exercise leaves the Home card only when the prescription actually drives load** —
 *     a pending recovery decision is advisory and must not change what the card counts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { formatInTimeZone } from 'date-fns-tz'

type Row = Record<string, unknown>

const getNextSession = vi.fn(async (_u: string, _tz?: string) => ({ session: null, isRestDay: false }) as Row)
const getSessionPeriodization = vi.fn(async (_u: string, _id: string) => null as Row | null)
const getExerciseMuscleAssignments = vi.fn(async (_n: string[]) => ({}) as Row)
const getRecentTrainedDays = vi.fn(async (_u: string, _d: number, _tz?: string) => ({}) as Row)
const getWorkoutSessionsFrom = vi.fn(async (_u: string, _from: Date) => [] as Row[])
const getDayExerciseNames = vi.fn(async (_u: string, _d: string, _tz?: string) => [] as Row[])
const getBodyMetricsBaseline = vi.fn(async (_u: string) => ({ weightKg: 80, bodyFatPct: 18 }))
const listBodyMetrics = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const listSleepSessions = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const getActiveProgram = vi.fn(async (_u: string) => null as Row | null)
const computeAchievements = vi.fn(async (_u: string, _tz: string) => ({ unlocked: [] }) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getNextSession, getSessionPeriodization, getExerciseMuscleAssignments, getRecentTrainedDays,
    getWorkoutSessionsFrom, getDayExerciseNames, getBodyMetricsBaseline, listBodyMetrics,
    listSleepSessions, getActiveProgram,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/achievements', () => ({ computeAchievements: (u: string, tz: string) => computeAchievements(u, tz) }))

import { GET as getNextSessionRoute } from '@/app/api/next-session/route'
import { GET as getProgress } from '@/app/api/progress-summary/route'
import { GET as getWeekly } from '@/app/api/weekly-stats/route'
import { GET as getStreak } from '@/app/api/streak-data/route'
import { GET as getAchievements } from '@/app/api/achievements/route'

const TZ = 'Australia/Brisbane'
/** Brisbane is a fixed +10 with no DST, so an explicit offset pins the local wall-clock hour. */
const bne = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+10:00`)

const workout = (over: Row = {}) => ({
  id: 'ws-1', sessionId: 'ps-1', sessionName: 'A', startedAt: new Date(), completedAt: null,
  isEarlyDeload: false, phaseType: null, exercises: [], ...over,
})
const exercise = (over: Row = {}) => ({
  exerciseName: 'Bench', volume: 1000, loggedAt: null, sets: [], ...over,
})
const sleep = (over: Row = {}) => ({
  date: '2026-09-01', sleepStart: bne('2026-09-01', '22:00'), sleepEnd: bne('2026-09-02', '06:00'),
  durationHours: 8, ...over,
})

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: TZ, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getNextSession.mockResolvedValue({ session: null, isRestDay: false })
  getSessionPeriodization.mockResolvedValue(null)
  getExerciseMuscleAssignments.mockResolvedValue({})
  getRecentTrainedDays.mockResolvedValue({})
  getWorkoutSessionsFrom.mockResolvedValue([])
  getDayExerciseNames.mockResolvedValue([])
  getBodyMetricsBaseline.mockResolvedValue({ weightKg: 80, bodyFatPct: 18 })
  listBodyMetrics.mockResolvedValue([])
  listSleepSessions.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(null)
  computeAchievements.mockResolvedValue({ unlocked: [] })
})

/** The week's Monday as the route itself computed it — read back rather than re-derived, so the
 *  fixtures cannot agree with a wrong window by construction. */
const mondayFromCall = () => getWorkoutSessionsFrom.mock.calls[0][1] as Date
const plusDays = (from: Date, d: number, hours = 12) =>
  new Date(from.getTime() + d * 86_400_000 + hours * 3_600_000)

describe('/api/next-session', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getNextSessionRoute()).status).toBe(401)
  })

  it('asks nothing about periodization when there is no session to run', async () => {
    const res = await getNextSessionRoute()
    expect(getSessionPeriodization).not.toHaveBeenCalled()
    expect(getExerciseMuscleAssignments).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  // The card must count what the workout screen will actually show, or the exercise count and
  // duration estimate disagree with the session the moment you open it.
  it('drops the prescribed exercises when the prescription drives load', async () => {
    getNextSession.mockResolvedValue({
      session: { id: 'ps-1', exercises: [{ id: 'e1', exerciseName: 'Bench' }, { id: 'e2', exerciseName: 'Row' }] },
      isRestDay: false,
    })
    getSessionPeriodization.mockResolvedValue({
      prescriptionStatus: 'accepted',
      prescription: { phaseAction: 'stay', droppedExerciseIds: ['e2'] },
    })

    const body = await (await getNextSessionRoute()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual(['e1'])
    // The muscle lookup runs on what SURVIVED the drop, so the sore-muscle check-in predicts the
    // same escalation the server will apply.
    expect(getExerciseMuscleAssignments).toHaveBeenCalledWith(['Bench'])
  })

  // A pending recovery decision is advisory: it is shown, not applied, until it is accepted.
  it('keeps the exercises when a pending recovery decision has not been accepted', async () => {
    getNextSession.mockResolvedValue({
      session: { id: 'ps-1', exercises: [{ id: 'e1', exerciseName: 'Bench' }, { id: 'e2', exerciseName: 'Row' }] },
      isRestDay: false,
    })
    getSessionPeriodization.mockResolvedValue({
      prescriptionStatus: 'pending',
      prescription: { phaseAction: 'deload', droppedExerciseIds: ['e2'] },
    })

    const body = await (await getNextSessionRoute()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual(['e1', 'e2'])
    expect(getExerciseMuscleAssignments).toHaveBeenCalledWith(['Bench', 'Row'])
  })

  it('passes the caller\'s timezone to the recommendation', async () => {
    freshUser({ timezone: 'Etc/GMT-14' })
    await getNextSessionRoute()
    expect(getNextSession).toHaveBeenCalledWith(sessionUser!.id, 'Etc/GMT-14')
  })
})

describe('/api/progress-summary', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getProgress()).status).toBe(401)
  })

  // Q-76: an evening nap on the same date as the night that followed it must not win "last night".
  it('reads last night as a night rather than the most recent row', async () => {
    const today = todayInTz(TZ)
    const yesterday = shiftDateStr(today, -1)
    listSleepSessions.mockResolvedValue([
      sleep({ date: today, sleepStart: bne(yesterday, '22:00'), sleepEnd: bne(today, '06:00'), durationHours: 8 }),
      sleep({ date: today, sleepStart: bne(today, '14:00'), sleepEnd: bne(today, '15:00'), durationHours: 1 }),
    ])
    const body = await (await getProgress()).json()
    expect(body.sleep.lastNightHours).toBe(8)
    // The card says "sleep", and a nights-only weekly total is the number that lines up with the
    // nightly figure above it.
    expect(body.sleep.thisWeekHours).toBe(8)
  })

  // The seven-day read reaches back past this week's Monday, so the total has to be filtered or a
  // Monday shows six nights of last week's sleep as "this week".
  it('counts only the nights inside this week', async () => {
    const today = todayInTz(TZ)
    await getProgress()
    const weekStart = formatInTimeZone(mondayFromCall(), TZ, 'yyyy-MM-dd')
    const before = shiftDateStr(weekStart, -1)

    listSleepSessions.mockResolvedValue([
      sleep({ date: today, sleepStart: bne(shiftDateStr(today, -1), '22:00'), sleepEnd: bne(today, '06:00'), durationHours: 8 }),
      sleep({ date: before, sleepStart: bne(shiftDateStr(before, -1), '22:00'), sleepEnd: bne(before, '06:00'), durationHours: 6 }),
    ])
    const body = await (await getProgress()).json()
    expect(body.sleep.thisWeekHours).toBe(8)
    expect(body.sleep.lastNightHours).toBe(8)
  })

  it('answers null for last night when nothing was recorded', async () => {
    const body = await (await getProgress()).json()
    expect(body.sleep).toEqual({ lastNightHours: null, thisWeekHours: 0 })
  })

  // Several rows for one session on one day is one workout, not several.
  it('counts a session once per day and name', async () => {
    await getProgress()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionName: 'Upper', startedAt: plusDays(monday, 0), exercises: [exercise()] }),
      workout({ id: 'b', sessionName: 'Upper', startedAt: plusDays(monday, 0, 18), exercises: [exercise()] }),
      workout({ id: 'c', sessionName: 'Lower', startedAt: plusDays(monday, 0, 18), exercises: [exercise()] }),
      // A DIFFERENT name with nothing logged: an empty row that shares a key with a real one is
      // absorbed by the dedup whether it is filtered or not, so it tests neither.
      workout({ id: 'd', sessionName: 'Mobility', startedAt: plusDays(monday, 0, 20), exercises: [] }),
    ])
    expect((await (await getProgress()).json()).workouts.completedThisWeek).toBe(2)
  })

  // Two days, one name. Earlier than Monday on purpose: the repository owns the window, and an
  // in-week second day would be a future day for anyone running this on a Monday.
  it('keeps the day in the key, so one session on two days counts twice', async () => {
    await getProgress()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionName: 'Upper', startedAt: plusDays(monday, 0), exercises: [exercise()] }),
      workout({ id: 'b', sessionName: 'Upper', startedAt: plusDays(monday, -3), exercises: [exercise()] }),
    ])
    expect((await (await getProgress()).json()).workouts.completedThisWeek).toBe(2)
  })

  // A rest day is a day you completed, which is what stops the card nagging on a scheduled day off.
  it('calls the day complete when trained, and when it is a rest day', async () => {
    getDayExerciseNames.mockResolvedValue([{ exerciseName: 'Bench' }])
    expect((await (await getProgress()).json()).workouts.todayComplete).toBe(true)

    getDayExerciseNames.mockResolvedValue([])
    expect((await (await getProgress()).json()).workouts.todayComplete).toBe(false)

    getNextSession.mockResolvedValue({ session: null, isRestDay: true })
    expect((await (await getProgress()).json()).workouts.todayComplete).toBe(true)
  })

  it('fits a weight rate over the ordered readings and answers null below three', async () => {
    listBodyMetrics.mockResolvedValue([
      { date: '2026-09-03', weightKg: 81 }, { date: '2026-09-01', weightKg: 80 }, { date: '2026-09-02', weightKg: null },
    ])
    // Two usable readings: a slope through two points is not a trend.
    expect((await (await getProgress()).json()).weightRateKgPerWeek).toBeNull()

    listBodyMetrics.mockResolvedValue([
      { date: '2026-09-03', weightKg: 82 }, { date: '2026-09-01', weightKg: 80 }, { date: '2026-09-02', weightKg: 81 },
    ])
    // Sorted ascending first, so the fit runs on 80/81/82 and not on the order the rows arrived in.
    expect((await (await getProgress()).json()).weightRateKgPerWeek).toBe(7)
  })

  // Twenty-six hours apart, so their local days always differ — a single zone equal to the default
  // proves nothing about which of the two the route read.
  it('anchors today and the week to the caller\'s timezone, not the default', async () => {
    const readFor = async (timezone: string) => {
      getDayExerciseNames.mockClear()
      getWorkoutSessionsFrom.mockClear()
      freshUser({ timezone })
      await getProgress()
      return {
        day: getDayExerciseNames.mock.calls[0][1],
        tz: getDayExerciseNames.mock.calls[0][2],
        weekFrom: (getWorkoutSessionsFrom.mock.calls[0][1] as Date).getTime(),
      }
    }
    const ahead = await readFor('Etc/GMT-14')
    const behind = await readFor('Etc/GMT+12')

    expect(ahead.day).toBe(todayInTz('Etc/GMT-14').replace(/-/g, '/'))
    expect(behind.day).toBe(todayInTz('Etc/GMT+12').replace(/-/g, '/'))
    expect(ahead.day).not.toBe(behind.day)
    expect(ahead.tz).toBe('Etc/GMT-14')
    expect(ahead.weekFrom).not.toBe(behind.weekFrom)
  })

  it('answers zero scheduled sessions when no program is active, uncacheable', async () => {
    const res = await getProgress()
    expect((await res.json()).workouts.scheduledThisWeek).toBe(0)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/weekly-stats', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getWeekly()).status).toBe(401)
  })

  it('lays out Monday to Sunday, starting on a real Monday', async () => {
    const body = await (await getWeekly()).json()
    expect(body.days.map((d: Row) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(body.days).toHaveLength(7)
    // Checked against the calendar rather than against the route's own arithmetic: every other
    // assertion here reads the week start back from the route, so a grid that began on Sunday
    // would shift the fixtures with it and look consistent.
    expect(formatInTimeZone(mondayFromCall(), TZ, 'EEE')).toBe('Mon')
    expect(body.days[0].dateKey).toBe(formatInTimeZone(mondayFromCall(), TZ, 'yyyy/MM/dd'))
  })

  it('anchors the week to the caller\'s timezone, not the default', async () => {
    const fromFor = async (timezone: string) => {
      getWorkoutSessionsFrom.mockClear()
      freshUser({ timezone })
      await getWeekly()
      return (getWorkoutSessionsFrom.mock.calls[0][1] as Date).getTime()
    }
    expect(await fromFor('Etc/GMT-14')).not.toBe(await fromFor('Etc/GMT+12'))
  })

  // A session on every day of the week, so the count of days that carry one is exactly how far
  // through the week we are. Derived from the clock rather than hardcoded — the alternative is a
  // fixture pinned to a weekday, which is red on every other day.
  it('leaves the rest of the week empty rather than filling days that have not happened', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    const elapsed = Math.floor((Date.now() - monday.getTime()) / 86_400_000)
    getWorkoutSessionsFrom.mockResolvedValue(
      Array.from({ length: 7 }, (_, d) =>
        workout({ id: `w${d}`, sessionName: `S${d}`, startedAt: plusDays(monday, d), exercises: [exercise()] })),
    )

    const body = await (await getWeekly()).json()
    expect(body.days.filter((d: Row) => (d.sessions as string[]).length > 0)).toHaveLength(elapsed + 1)
    expect(body.days[0].sessions).toEqual(['S0'])
  })

  // Q-246: held out of the headline total, kept as its own figure so the bar still has a height.
  it('keeps deload volume out of the week\'s total without discarding it', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'b', startedAt: plusDays(monday, 0), phaseType: 'deload', exercises: [exercise({ volume: 500 })] }),
    ])
    const deloadOnly = await (await getWeekly()).json()
    expect(deloadOnly.totalVolumeKg).toBe(0)
    expect(deloadOnly.days[0]).toMatchObject({ volume: 0, deloadVolume: 500, isDeload: true, isTesting: false })

    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', startedAt: plusDays(monday, 0), exercises: [exercise({ volume: 1000 })] }),
    ])
    const normal = await (await getWeekly()).json()
    expect(normal.totalVolumeKg).toBe(1000)
    expect(normal.days[0]).toMatchObject({ volume: 1000, deloadVolume: 0, isDeload: false })
  })

  // `isDeloadSession` is true for testing too, so deciding deload first labelled a testing day "D".
  it('marks a testing day as testing rather than deload', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ startedAt: plusDays(monday, 0), phaseType: 'testing', exercises: [exercise({ volume: 400 })] }),
    ])
    expect((await (await getWeekly()).json()).days[0]).toMatchObject({ isTesting: true, isDeload: false, deloadVolume: 400 })
  })

  it('leaves deload sets and intensity out of the week\'s averages', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    const set = (intensityPct: number | null) => ({ intensityPct })
    getWorkoutSessionsFrom.mockResolvedValue([
      // A zero and a null are "no intensity recorded", not an intensity of nothing — averaging them
      // in drags every week with a bodyweight set in it toward zero.
      workout({ id: 'a', startedAt: plusDays(monday, 0), exercises: [exercise({ sets: [set(80), set(90), set(0), set(null)] })] }),
      workout({ id: 'b', sessionName: 'B', startedAt: plusDays(monday, 0, 18), isEarlyDeload: true, exercises: [exercise({ sets: [set(10), set(10), set(10)] })] }),
    ])
    const body = await (await getWeekly()).json()
    expect(body.totalSets).toBe(4)
    expect(body.avgIntensityPct).toBe(85)
  })

  // `startedAt` falls back to local midnight when no start time was given, so an evening finish
  // reads as an eighteen-hour session unless the wall clock is capped.
  it('prefers the wall clock, and falls back to the log span when it is implausible', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    const start = plusDays(monday, 0, 6)
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', startedAt: start, completedAt: new Date(start.getTime() + 50 * 60_000), exercises: [exercise()] }),
    ])
    expect((await (await getWeekly()).json()).avgDurationMin).toBe(50)

    getWorkoutSessionsFrom.mockResolvedValue([
      workout({
        id: 'a', startedAt: start, completedAt: new Date(start.getTime() + 18 * 3_600_000),
        exercises: [
          exercise({ loggedAt: new Date(start.getTime() + 10 * 60_000) }),
          exercise({ exerciseName: 'Row', loggedAt: new Date(start.getTime() + 40 * 60_000) }),
        ],
      }),
    ])
    expect((await (await getWeekly()).json()).avgDurationMin).toBe(30)
  })

  it('counts a session once per day and name, ignoring rows with nothing logged', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionName: 'Upper', startedAt: plusDays(monday, 0), exercises: [exercise()] }),
      workout({ id: 'b', sessionName: 'Upper', startedAt: plusDays(monday, 0, 18), exercises: [exercise()] }),
      // A different name, so an unfiltered empty row would change the answer. One that shares a key
      // with a real session is absorbed by the dedup either way and tests neither rule.
      workout({ id: 'c', sessionName: 'Mobility', startedAt: plusDays(monday, 0), exercises: [] }),
    ])
    const body = await (await getWeekly()).json()
    expect(body.totalSessions).toBe(1)
    expect(body.days[0].sessions).toEqual(['Upper'])
  })

  // Earlier than Monday on purpose: an in-week second day is a future day on a Monday.
  it('keeps the day in the key, so one session on two days counts twice', async () => {
    await getWeekly()
    const monday = mondayFromCall()
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'a', sessionName: 'Upper', startedAt: plusDays(monday, 0), exercises: [exercise()] }),
      workout({ id: 'b', sessionName: 'Upper', startedAt: plusDays(monday, -3), exercises: [exercise()] }),
    ])
    expect((await (await getWeekly()).json()).totalSessions).toBe(2)
  })

  it('answers no-store', async () => {
    expect((await getWeekly()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/streak-data', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getStreak()).status).toBe(401)
  })

  it('reads ninety days in the caller\'s timezone, uncacheable', async () => {
    freshUser({ timezone: 'Etc/GMT-14' })
    const res = await getStreak()
    expect(getRecentTrainedDays).toHaveBeenCalledWith(sessionUser!.id, 90, 'Etc/GMT-14')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('returns the days under a key rather than as a bare value', async () => {
    getRecentTrainedDays.mockResolvedValue({ '2026-09-01': ['Upper'] })
    expect(await (await getStreak()).json()).toEqual({ trainedDays: { '2026-09-01': ['Upper'] } })
  })
})

describe('/api/achievements', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getAchievements()).status).toBe(401)
  })

  it('computes for the caller in their own timezone, uncacheable', async () => {
    freshUser({ timezone: 'Etc/GMT-14' })
    computeAchievements.mockResolvedValue({ unlocked: ['first-workout'] })
    const res = await getAchievements()
    expect(computeAchievements).toHaveBeenCalledWith(sessionUser!.id, 'Etc/GMT-14')
    expect(await res.json()).toEqual({ unlocked: ['first-workout'] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
