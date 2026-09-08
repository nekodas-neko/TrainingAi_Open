/**
 * PS-39 — `GET /api/day-timeline`, the cross-domain aggregate the Home screen's timeline reads.
 *
 * **Its own file rather than a batch, because it is the batch**: 309 lines merging sleep, workouts,
 * meals, saved activities, Oura walks and Oura tags into one ordered list. CLAUDE.md names it the
 * sanctioned exception to the offline-first read rule (SYNC-R3) — a client-side assembler
 * reproducing this merge was judged out of scope — which makes it the one screen whose ordering
 * nothing else can check.
 *
 * The decisions the response shape hides:
 *
 *   · **Readiness comes from our own derived row before the Cloud column** (Q-43). Cloud-only was
 *     null for every user not on Oura Cloud, and for this owner since the BLE re-key.
 *   · **A meal sits at the LATEST item logged inside its window**, and falls back to the window's
 *     END rather than its start — so a meal logged outside its window still sorts late instead of
 *     jumping to the window's earliest minute.
 *   · **A started-but-empty workout row is a phantom** — abandoned, or a post-delete leftover — and
 *     has nothing to show.
 *   · **An Oura walk that overlaps a saved activity is dropped**, so a confirmed walk and the raw
 *     detection behind it are one entry, not two.
 *   · **A guided walk is recognised by its `segments`**, checked before the run/walk keyword
 *     collapse that would otherwise flatten it to a bare "Walk".
 *   · **The day group is recomputed from each event's own timestamp**, which is what puts a
 *     "fell asleep" after midnight on the right side of the divide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MIN_DISTANCE_M, MIN_AVG_SPEED_KMH, MIN_DURATION_SEC, MAX_DURATION_SEC,
} from '@/lib/activity/detection-thresholds'

type Row = Record<string, unknown>

const listSleepSessions = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getWorkoutSessionsFrom = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listFoodLogs = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listMealTypes = vi.fn(async (_u: string) => [] as Row[])
const getOuraWorkouts = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraDaily = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listActivityLogs = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listOuraTags = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraDailyDerived = vi.fn(async (..._a: unknown[]) => [] as Row[])

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listSleepSessions, getWorkoutSessionsFrom, listFoodLogs, listMealTypes,
    getOuraWorkouts, getOuraDaily, listActivityLogs, listOuraTags, getOuraDailyDerived,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET } from '@/app/api/day-timeline/route'

const TZ = 'Australia/Brisbane'
const DAY = '2026-09-08'
const YESTERDAY = '2026-09-07'
/** Brisbane is a fixed +10 with no DST, so an explicit offset pins the local wall-clock hour. */
const bne = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+10:00`)

const timeline = (query = `?date=${DAY}`) =>
  GET(new Request(`http://localhost/api/day-timeline${query}`))

const body = async (query?: string) => (await timeline(query)).json()
const eventsOf = async (type: string, query?: string) =>
  (await body(query)).events.filter((e: Row) => e.type === type)

const sleep = (over: Row = {}) => ({
  date: DAY, sleepStart: bne(YESTERDAY, '22:00'), sleepEnd: bne(DAY, '06:00'),
  durationHours: 8, sleepScore: null, onsetLatencySec: null, ouraId: null, ...over,
})
const workout = (over: Row = {}) => ({
  id: 'ws-1', sessionName: 'Upper', startedAt: bne(DAY, '17:00'), completedAt: bne(DAY, '18:00'),
  exercises: [{ exerciseName: 'Press', sets: [{}, {}, {}] }], ...over,
})
const activity = (over: Row = {}) => ({
  date: DAY, title: 'Morning walk', activityType: 'walk', startTime: '09:00:00', endTime: '09:30:00',
  durationMin: 30, distanceKm: 2.5, caloriesBurned: 120, segments: null, ...over,
})
const ouraWalk = (over: Row = {}) => ({
  day: DAY, startDatetime: bne(DAY, '12:00'), endDatetime: bne(DAY, '12:30'),
  distanceM: 2000, calories: 100, activity: 'walking', ...over,
})

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: TZ, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  listSleepSessions.mockResolvedValue([])
  getWorkoutSessionsFrom.mockResolvedValue([])
  listFoodLogs.mockResolvedValue([])
  listMealTypes.mockResolvedValue([])
  getOuraWorkouts.mockResolvedValue([])
  getOuraDaily.mockResolvedValue([])
  listActivityLogs.mockResolvedValue([])
  listOuraTags.mockResolvedValue([])
  getOuraDailyDerived.mockResolvedValue([])
})

describe('/api/day-timeline — the guards', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await timeline()).status).toBe(401)
  })

  // Q-130: the client fills date params from `localDateString()`, which emits slashes.
  it('accepts either separator and answers the dash form', async () => {
    expect((await body(`?date=2026/09/08`)).date).toBe(DAY)
    expect((await body(`?date=${DAY}`)).date).toBe(DAY)
  })

  it('refuses a date-shaped string that is not a real day', async () => {
    const res = await timeline('?date=2026-13-45')
    expect(res.status).toBe(400)
    expect(getWorkoutSessionsFrom).not.toHaveBeenCalled()
  })

  it('defaults to today in the caller\'s timezone, not the default', async () => {
    const dateFor = async (timezone: string) => {
      freshUser({ timezone })
      return (await body('')).date
    }
    const ahead = await dateFor('Etc/GMT-14')
    const behind = await dateFor('Etc/GMT+12')
    expect(ahead).not.toBe(behind)
  })

  it('answers no-store', async () => {
    expect((await timeline()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/day-timeline — sleep', () => {
  // Q-43: Cloud-only readiness was null for anyone not on Oura Cloud, and for this owner since
  // the BLE re-key. Our own derived row wins.
  it('prefers our own derived readiness over the Cloud column', async () => {
    listSleepSessions.mockResolvedValue([sleep()])
    getOuraDaily.mockResolvedValue([{ date: DAY, readinessScore: 55, sleepScore: 60 }])
    getOuraDailyDerived.mockResolvedValue([{ day: DAY, readinessScore: 82, sleepScore: 79 }])

    const [wake] = await eventsOf('wakeup')
    expect(wake.readinessScore).toBe(82)
    expect(wake.sleepScore).toBe(79)
  })

  it('falls back to the Cloud column when nothing was derived', async () => {
    listSleepSessions.mockResolvedValue([sleep()])
    getOuraDaily.mockResolvedValue([{ date: DAY, readinessScore: 55, sleepScore: 60 }])

    const [wake] = await eventsOf('wakeup')
    expect(wake.readinessScore).toBe(55)
    expect(wake.sleepScore).toBe(60)
  })

  // The session's own score outranks both — it is the row the night was scored on.
  it('lets the session\'s own sleep score win over either', async () => {
    listSleepSessions.mockResolvedValue([sleep({ sleepScore: 91 })])
    getOuraDailyDerived.mockResolvedValue([{ day: DAY, readinessScore: 82, sleepScore: 79 }])
    expect((await eventsOf('wakeup'))[0].sleepScore).toBe(91)
  })

  it('reports the onset latency in minutes on the fell-asleep event', async () => {
    listSleepSessions.mockResolvedValue([sleep({ onsetLatencySec: 900 })])
    const [asleep] = await eventsOf('sleep')
    expect(asleep.latencyMin).toBe(15)
    expect(asleep.subtitle).toBe('15 min latency')
  })

  // The night starts on yesterday's evening wall clock, so its own timestamp is what puts it
  // under the right heading — not the day it was fetched for.
  it('files a fell-asleep before midnight under yesterday', async () => {
    listSleepSessions.mockResolvedValue([sleep()])
    const [asleep] = await eventsOf('sleep')
    expect(asleep.day).toBe('yesterday')
    expect(asleep.date).toBe(YESTERDAY)

    // …and a wake-up the same morning is today's.
    expect((await eventsOf('wakeup'))[0].day).toBe('today')
  })

  it('says nothing about sleep when there is none', async () => {
    expect(await eventsOf('wakeup')).toEqual([])
    expect(await eventsOf('sleep')).toEqual([])
  })
})

describe('/api/day-timeline — workouts', () => {
  it('skips a started-but-empty session', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'real' }),
      workout({ id: 'phantom', exercises: [], startedAt: bne(DAY, '19:00') }),
    ])
    const events = await eventsOf('workout')
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Upper')
  })

  it('counts sets across exercises and reports a duration only when completed', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ exercises: [
        { exerciseName: 'Press', sets: [{}, {}, {}] },
        { exerciseName: 'Row', sets: [{}, {}] },
      ] }),
      workout({ id: 'ws-2', startedAt: bne(DAY, '19:00'), completedAt: null }),
    ])
    const [later, earlier] = await eventsOf('workout')  // newest first
    expect(later.durationMin).toBeUndefined()
    expect(earlier).toMatchObject({ sets: 5, exerciseCount: 2, durationMin: 60 })
    expect(earlier.exerciseNames).toEqual(['Press', 'Row'])
  })

  // The repository is asked from yesterday's start, so it can return older rows; the route's own
  // window is what keeps them off the timeline.
  it('drops a session outside the two days it draws', async () => {
    getWorkoutSessionsFrom.mockResolvedValue([
      workout({ id: 'old', startedAt: bne('2026-09-01', '17:00') }),
      workout({ id: 'yday', startedAt: bne(YESTERDAY, '17:00') }),
    ])
    const events = await eventsOf('workout')
    expect(events).toHaveLength(1)
    expect(events[0].day).toBe('yesterday')
  })
})

describe('/api/day-timeline — meals', () => {
  const mealType = (over: Row = {}) =>
    ({ id: 'mt-1', name: 'Lunch', emoji: '🥗', timeStartHour: 11, timeEndHour: 14, ...over })
  const foodLog = (over: Row = {}) =>
    ({ mealTypeId: 'mt-1', calories: 500, loggedAt: bne(DAY, '12:30'), ...over })

  it('sits at the latest item logged inside the window', async () => {
    listMealTypes.mockResolvedValue([mealType()])
    listFoodLogs.mockResolvedValue([
      foodLog({ loggedAt: bne(DAY, '11:30'), calories: 200 }),
      foodLog({ loggedAt: bne(DAY, '13:45'), calories: 300 }),
    ])
    const [meal] = await eventsOf('meal')
    expect(meal.timeMs).toBe(bne(DAY, '13:45').getTime())
    expect(meal.subtitle).toContain('500 kcal')
  })

  // The fallback is the window's END, not its start: a meal logged outside its window should
  // still sort late rather than jumping to the window's earliest minute.
  it('falls back to the end of the window when nothing was logged inside it', async () => {
    listMealTypes.mockResolvedValue([mealType()])
    listFoodLogs.mockResolvedValue([foodLog({ loggedAt: bne(DAY, '20:00') })])
    const [meal] = await eventsOf('meal')
    expect(meal.timeMs).toBe(bne(DAY, '14:00').getTime())
  })

  it('groups by meal type and titles from it', async () => {
    listMealTypes.mockResolvedValue([mealType(), mealType({ id: 'mt-2', name: 'Dinner', emoji: '🍝', timeStartHour: 17, timeEndHour: 21 })])
    listFoodLogs.mockResolvedValue([
      foodLog({ mealTypeId: 'mt-1' }),
      foodLog({ mealTypeId: 'mt-2', loggedAt: bne(DAY, '18:00') }),
    ])
    const meals = await eventsOf('meal')
    expect(meals.map((m: Row) => m.title)).toEqual(['🍝 Dinner', '🥗 Lunch'])  // newest first
  })

  it('still shows a meal whose type has been deleted', async () => {
    listFoodLogs.mockResolvedValue([foodLog({ mealTypeId: 'gone' })])
    const [meal] = await eventsOf('meal')
    expect(meal.title).toBe('Meal')
  })
})

describe('/api/day-timeline — walks', () => {
  // The saved activity and the raw Oura detection behind it are one walk, not two.
  it('drops an Oura walk that overlaps a saved activity', async () => {
    listActivityLogs.mockResolvedValue([activity({ startTime: '12:00:00', endTime: '12:30:00' })])
    getOuraWorkouts.mockResolvedValue([ouraWalk({ startDatetime: bne(DAY, '12:10'), endDatetime: bne(DAY, '12:25') })])

    const walks = await eventsOf('walk')
    expect(walks).toHaveLength(1)
    expect(walks[0].title).toBe('Walk')
    expect(walks[0].distanceKm).toBe(2.5)  // the saved one's figure, not the detection's
  })

  it('keeps an Oura walk at a different time of day', async () => {
    listActivityLogs.mockResolvedValue([activity({ startTime: '09:00:00', endTime: '09:30:00' })])
    getOuraWorkouts.mockResolvedValue([ouraWalk()])
    expect(await eventsOf('walk')).toHaveLength(2)
  })

  // A guided walk is the only writer of `segments`; the keyword collapse below it would flatten
  // it to a bare "Walk".
  it('recognises a guided walk before the keyword collapse', async () => {
    listActivityLogs.mockResolvedValue([activity({ title: 'Interval session', segments: [{}] })])
    expect((await eventsOf('walk'))[0].title).toBe('Guided Walk')
  })

  it('collapses a run and a walk to their own labels, and keeps anything else', async () => {
    listActivityLogs.mockResolvedValue([
      activity({ title: 'Evening Run', activityType: 'run', startTime: '18:00:00' }),
      activity({ title: 'Park walk', startTime: '09:00:00' }),
      activity({ title: 'Kayaking', activityType: 'paddle', startTime: '14:00:00' }),
    ])
    expect((await eventsOf('walk')).map((w: Row) => w.title)).toEqual(['Run', 'Kayaking', 'Walk'])
  })

  /**
   * Each case must fail on the ONE guard it names and satisfy the other two.
   *
   * The first draft did not: "too far below the distance floor" was 749 m over half an hour, which
   * is 1.5 km/h and so was rejected by the SPEED check, and "too slow" was 166 m, rejected by the
   * DISTANCE check. Both cases passed, and deleting either guard changed nothing.
   */
  const ends = (startHhmm: string, seconds: number) =>
    new Date(bne(DAY, startHhmm).getTime() + seconds * 1000)

  it('rejects a detection on each quality guard, one at a time', async () => {
    const cases: Array<[string, Row]> = [
      // 700 m in 8 min is 5.25 km/h — fast enough and long enough, just too short a distance.
      ['distance', { distanceM: MIN_DISTANCE_M - 50, endDatetime: ends('12:00', MIN_DURATION_SEC + 60) }],
      // 1 km in an hour is 1 km/h — far enough and long enough, just too slow.
      ['speed', { distanceM: 1000, endDatetime: ends('12:00', 3600) }],
      // Six minutes: fast and far enough per minute, simply under the duration floor.
      ['too short', { distanceM: 1000, endDatetime: ends('12:00', MIN_DURATION_SEC - 60) }],
      // Over three hours is not a walk any more, however far it went.
      ['too long', { distanceM: 20_000, endDatetime: ends('12:00', MAX_DURATION_SEC + 60) }],
    ]
    for (const [name, over] of cases) {
      getOuraWorkouts.mockResolvedValue([ouraWalk(over)])
      expect(await eventsOf('walk'), `rejected on ${name}`).toEqual([])
    }
  })

  it('keeps a detection that clears all three, and labels a run', async () => {
    getOuraWorkouts.mockResolvedValue([ouraWalk({ activity: 'running' })])
    const [walk] = await eventsOf('walk')
    expect(walk.title).toBe('Run')
    expect(walk.durationMin).toBe(30)
    expect(walk.distanceKm).toBe(2)
  })
})

describe('/api/day-timeline — tags and ordering', () => {
  it('labels a known tag type, and falls back to its raw name', async () => {
    listOuraTags.mockResolvedValue([
      { startTime: bne(DAY, '10:00'), endTime: null, tagType: 'rest_mode', customName: null, comment: null, mood: null, source: 'oura' },
      { startTime: bne(DAY, '11:00'), endTime: null, tagType: 'tag_generic_stress', customName: null, comment: null, mood: null, source: 'oura' },
      { startTime: bne(DAY, '12:00'), endTime: null, tagType: 'nap', customName: 'Afternoon kip', comment: null, mood: null, source: 'oura' },
    ])
    expect((await eventsOf('tag')).map((t: Row) => t.title)).toEqual(['Afternoon kip', 'Stress', 'Rest mode'])
  })

  it('skips a tag with no start time rather than sorting it to the epoch', async () => {
    listOuraTags.mockResolvedValue([
      { startTime: null, tagType: 'nap', customName: null, comment: null, mood: null, source: 'oura' },
    ])
    expect(await eventsOf('tag')).toEqual([])
  })

  it('sorts every event newest first across all the domains it merges', async () => {
    listSleepSessions.mockResolvedValue([sleep()])
    getWorkoutSessionsFrom.mockResolvedValue([workout()])
    listActivityLogs.mockResolvedValue([activity()])
    listOuraTags.mockResolvedValue([
      { startTime: bne(DAY, '14:00'), endTime: null, tagType: 'nap', customName: null, comment: null, mood: null, source: 'oura' },
    ])

    const { events } = await body()
    const times = events.map((e: Row) => e.timeMs as number)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(events[0].type).toBe('workout')   // 17:00, the latest
    expect(events[events.length - 1].type).toBe('sleep')  // 22:00 yesterday, the earliest
  })
})
