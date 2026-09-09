/**
 * PS-39 — the four heart-rate reads: `hr-profile`, `health/hr-recovery-profile`,
 * `workout/exercise-hr-trend` and `oura/hr-data`.
 *
 * Batched because they are the app's four answers to "what was my heart doing", and three of them
 * share one `days`-clamping idiom whose bounds nothing checked. Each carries a decision:
 *
 *   · **Every value in `hr-profile` comes from the single resolver.** The route used to run its own
 *     `computeObservedHr` + `resolveMaxHr` pass alongside it, which is how the codebase ended up
 *     with divergent answers to "what is my max HR". The resolver is left REAL here and driven
 *     through the repository, so the resolution itself is exercised rather than stubbed.
 *   · **The reserve is floored at 30**, so a bad or low resting reading cannot collapse it and make
 *     every beat read as max effort.
 *   · **An observed max is used only when it is reliable AND at least the age estimate** — a
 *     corroborated max below the estimate is a quiet day, not a new ceiling.
 *   · **`oura/hr-data` persists a durable snapshot fire-and-forget, and REPORTS a failed write.**
 *     A console.error is invisible in production, which is how that write failed on every recap for
 *     months with no user-facing symptom: the recap renders either way.
 *   · **An aged-out workout falls back to the snapshot**, flagged `fromSnapshot`, and the rest-window
 *     HRV is filled from it separately because RR dies at 90 days while the trace lives to 180.
 *
 * Fixture discipline (the PS-39 note): each case fails on the ONE rule it names and satisfies the
 * others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MIN_RELIABLE_SAMPLES, CORROBORATION } from '@trainingai/shared/health/observed-hr'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_u: string) => ({ dateOfBirth: '1990-01-01' }) as Row | null)
const listBodyMetrics = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getHrForWindow = vi.fn(async (..._a: unknown[]) => [] as { bpm: number }[])
const getSetHrStatsSince = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getOuraWorkouts = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getSetHrStatsForExercise = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getWorkoutSessionById = vi.fn(async (..._a: unknown[]) => null as Row | null)
const upsertWorkoutHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const upsertSetHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const getWorkoutHrStats = vi.fn(async (..._a: unknown[]) => null as Row | null)

const computeWorkoutHr = vi.fn(async (..._a: unknown[]) => null as Row | null)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: (...a: unknown[]) => computeWorkoutHr(...a),
}))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getUserById, listBodyMetrics, getHrForWindow, getSetHrStatsSince, getOuraWorkouts,
    getSetHrStatsForExercise, getWorkoutSessionById, upsertWorkoutHrStats, upsertSetHrStats,
    getWorkoutHrStats,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getProfile } from '@/app/api/hr-profile/route'
import { GET as getRecovery } from '@/app/api/health/hr-recovery-profile/route'
import { GET as getTrend } from '@/app/api/workout/exercise-hr-trend/route'
import { GET as getHrData } from '@/app/api/oura/hr-data/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000b1'
const nextish = (url: string) =>
  Object.assign(new Request(`http://localhost${url}`), { nextUrl: new URL(`http://localhost${url}`) }) as never

const recovery = (query = '') => getRecovery(new Request(`http://localhost/api/health/hr-recovery-profile${query}`))
const trend = (query: string) => getTrend(nextish(`/api/workout/exercise-hr-trend${query}`))
const hrData = (query: string) => getHrData(nextish(`/api/oura/hr-data${query}`))

/** `computeObservedHr` only calls a max corroborated once it has this many plausible readings. */
const reliableBpms = (bpm: number) => Array.from({ length: MIN_RELIABLE_SAMPLES }, () => ({ bpm }))

/**
 * Enough readings to HAVE a max, too few to be called reliable.
 *
 * Below `CORROBORATION` there is no max at all, so `observed.max != null` rejects the window and
 * the reliability guard is never reached — a two-reading fixture tests the wrong half of the rule.
 */
const corroboratedButUnreliable = (bpm: number) =>
  Array.from({ length: CORROBORATION + 5 }, () => ({ bpm }))

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

afterEach(() => { vi.useRealTimers() })

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getUserById.mockResolvedValue({ dateOfBirth: '1990-01-01' })
  listBodyMetrics.mockResolvedValue([])
  getHrForWindow.mockResolvedValue([])
  getSetHrStatsSince.mockResolvedValue([])
  getOuraWorkouts.mockResolvedValue([])
  getSetHrStatsForExercise.mockResolvedValue([])
  getWorkoutSessionById.mockResolvedValue(null)
  getWorkoutHrStats.mockResolvedValue(null)
  upsertWorkoutHrStats.mockResolvedValue(undefined)
  upsertSetHrStats.mockResolvedValue(undefined)
  computeWorkoutHr.mockResolvedValue(null)
})

describe('/api/hr-profile', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getProfile()).status).toBe(401)
  })

  // The resolver is real here, so this is the actual age → estimate arithmetic, not a stub's echo.
  it('estimates the ceiling from age and mirrors it into the working max', async () => {
    const age = new Date().getFullYear() - 1990
    const body = await (await getProfile()).json()

    expect(body.estimatedMax).toBe(220 - age)
    expect(body.workingMax).toBe(body.maxHr)
    expect(body.workingMaxSource).toBe('estimated')
  })

  // A corroborated max BELOW the estimate is a quiet month, not a new ceiling. This fixture is
  // reliable in every respect — it simply never went above the estimate.
  it('keeps the estimate when a reliable observation sits under it', async () => {
    getHrForWindow.mockResolvedValue(reliableBpms(150))
    const body = await (await getProfile()).json()

    expect(body.observed.isReliable).toBe(true)
    expect(body.workingMaxSource).toBe('estimated')
    expect(body.maxHr).toBe(body.estimatedMax)
  })

  // The one case where the resolved ceiling and the age estimate DIFFER — which is the only shape
  // that can tell `maxHr` from `estimatedMax` in everything derived from it below.
  it('takes the observation once it is reliable AND above the estimate', async () => {
    listBodyMetrics.mockResolvedValue([{ restingHeartRate: 50 }])
    getHrForWindow.mockResolvedValue(reliableBpms(200))
    const body = await (await getProfile()).json()

    expect(body.workingMaxSource).toBe('observed')
    expect(body.maxHr).toBe(200)
    expect(body.estimatedMax).toBeLessThan(200)
    // Both derived from the RESOLVED ceiling, not the estimate — indistinguishable in every other
    // case here, because everywhere else the two are the same number.
    expect(body.workingMax).toBe(200)
    expect(body.reserve).toBe(150)
    expect(body.targetAnchorMax).toBe(200)
  })

  // `targetAnchorMax` is NOT the ceiling: it anchors *reachable* targets, so it follows what you
  // have actually hit even when that sits below the age estimate. A reliable 150 leaves the ceiling
  // at the estimate while the anchor drops to 150 — the one place the two deliberately disagree,
  // and invisible in every case where the observation wins or is discarded.
  it('anchors reachable targets on what was actually hit, not the ceiling', async () => {
    getHrForWindow.mockResolvedValue(reliableBpms(150))
    const body = await (await getProfile()).json()

    expect(body.maxHr).toBe(body.estimatedMax)
    expect(body.targetAnchorMax).toBe(150)
    expect(body.targetAnchorMax).toBeLessThan(body.maxHr)
  })

  it('falls back to the estimate as the anchor when nothing was observed', async () => {
    const body = await (await getProfile()).json()
    expect(body.targetAnchorMax).toBe(body.estimatedMax)
  })

  // …and an observation above the estimate that is NOT corroborated is still not a ceiling. Same
  // 200 bpm as the case above; only the sample count differs — and it sits in the band that HAS a
  // max, so it is the reliability guard being tested rather than `max != null`.
  it('ignores an uncorroborated observation however high it is', async () => {
    getHrForWindow.mockResolvedValue(corroboratedButUnreliable(200))
    const body = await (await getProfile()).json()

    expect(body.observed.max).toBe(200)
    expect(body.observed.isReliable).toBe(false)
    expect(body.workingMaxSource).toBe('estimated')
    expect(body.maxHr).toBe(body.estimatedMax)
    // …and it does not anchor targets either. The anchor follows what was *reliably* hit, so an
    // uncorroborated spike must not become the number every target is measured against.
    expect(body.targetAnchorMax).toBe(body.estimatedMax)
  })

  // The floor exists so a bad resting reading cannot collapse the reserve and make every beat read
  // as max effort. 170 resting against a ~184 estimate is a 14 bpm reserve before the floor.
  it('floors the reserve so a bad resting reading cannot collapse it', async () => {
    listBodyMetrics.mockResolvedValue([{ restingHeartRate: 170 }])
    const body = await (await getProfile()).json()

    expect(body.restingHr).toBe(170)
    expect(body.maxHr - body.restingHr).toBeLessThan(30)
    expect(body.reserve).toBe(30)
  })

  it('computes a real reserve when the readings are ordinary', async () => {
    listBodyMetrics.mockResolvedValue([{ restingHeartRate: 50 }])
    const body = await (await getProfile()).json()
    expect(body.reserve).toBe(body.maxHr - 50)
  })

  it('rate-limits the twenty-first read, and answers no-store', async () => {
    const first = await getProfile()
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    for (let i = 1; i < 20; i++) expect((await getProfile()).status).toBe(200)
    expect((await getProfile()).status).toBe(429)
  })
})

describe('/api/health/hr-recovery-profile', () => {
  /**
   * `floor`, not `round` — defensively, though this route does not currently need it.
   *
   * `computeHrRecoveryProfile` anchors on an ms offset from now, so the elapsed fraction here is
   * ~0 and the two agree at every hour; a timezone sweep from UTC+14 to UTC−12 confirmed that.
   * Its sibling `exercise-hr-trend` anchors at the caller's LOCAL MIDNIGHT, where `now − since` is
   * N days plus however much of today has elapsed, and `round` answers **N + 1** after local
   * midday — which is what turned this file red on every branch from 02:00 UTC (12:00 Brisbane).
   * `floor` is exact either way, so both sites use it rather than depending on which anchor a
   * route happens to have today.
   */
  const daysAsked = () => {
    const since = getSetHrStatsSince.mock.calls[0][1] as Date
    return Math.floor((Date.now() - since.getTime()) / 86_400_000)
  }

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await recovery()).status).toBe(401)
  })

  it('defaults to a hundred and eighty days', async () => {
    await recovery()
    expect(daysAsked()).toBe(180)
  })

  it('honours a days param, clamps it at two years, and ignores nonsense', async () => {
    for (const [query, expected] of [['?days=30', 30], ['?days=9999', 730], ['?days=banana', 180], ['?days=0', 180], ['?days=-5', 180]] as const) {
      getSetHrStatsSince.mockClear()
      await recovery(query)
      expect(daysAsked(), query).toBe(expected)
    }
  })

  it('rate-limits the thirty-first read, and answers no-store', async () => {
    expect((await recovery()).headers.get('Cache-Control')).toBe('private, no-store')
    for (let i = 1; i < 30; i++) expect((await recovery()).status).toBe(200)
    expect((await recovery()).status).toBe(429)
  })
})

describe('/api/workout/exercise-hr-trend', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await trend(`?exerciseName=Press`)).status).toBe(401)
  })

  it('needs an exercise to trend, and says so', async () => {
    const res = await trend('')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('exerciseId or exerciseName')
    expect(getSetHrStatsForExercise).not.toHaveBeenCalled()
  })

  it('matches by id when it has one, and by name otherwise', async () => {
    await trend(`?exerciseId=ex-1&exerciseName=Press`)
    expect(getSetHrStatsForExercise.mock.calls[0][1]).toMatchObject({ exerciseId: 'ex-1', exerciseName: 'Press' })

    getSetHrStatsForExercise.mockClear()
    await trend(`?exerciseName=Press`)
    expect(getSetHrStatsForExercise.mock.calls[0][1]).toMatchObject({ exerciseId: null, exerciseName: 'Press' })
  })

  const sinceOf = () => (getSetHrStatsForExercise.mock.calls[0][1] as { since: Date }).since

  it('clamps the window the same way its sibling does', async () => {
    // Pinned to mid-afternoon in the fixture's zone — the half of the day that used to fail. See
    // `daysAsked` above: with a local-midnight anchor, `round` flips to N+1 after local midday, so
    // this case has to be both floored AND clock-independent to mean anything.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T05:00:00Z'))   // 15:00 in Australia/Brisbane
    for (const [query, expected] of [['', 180], ['?days=30', 30], ['?days=9999', 730], ['?days=banana', 180], ['?days=0', 180]] as const) {
      getSetHrStatsForExercise.mockClear()
      await trend(`?exerciseName=Press${query.replace('?', '&')}`)
      expect(Math.floor((Date.now() - sinceOf().getTime()) / 86_400_000), query || 'default').toBe(expected)
    }
  })

  // The banned `Date.now() − N × 86_400_000` starts mid-day in the user's zone and straddles two
  // local days at its far edge. This must be a local midnight, and the CALLER's.
  it('anchors the window at the caller\'s local midnight', async () => {
    const sinceFor = async (timezone: string) => {
      getSetHrStatsForExercise.mockClear()
      freshUser({ timezone })
      await trend(`?exerciseName=Press`)
      return sinceOf()
    }
    const ahead = await sinceFor('Etc/GMT-14')
    const behind = await sinceFor('Etc/GMT+12')

    expect(ahead.getTime()).not.toBe(behind.getTime())
    for (const d of [ahead, behind]) {
      expect(d.getUTCMinutes()).toBe(0)
      expect(d.getUTCSeconds()).toBe(0)
    }
  })

  it('rate-limits the thirty-first read, and answers no-store', async () => {
    expect((await trend(`?exerciseName=Press`)).headers.get('Cache-Control')).toBe('private, no-store')
    for (let i = 1; i < 30; i++) expect((await trend(`?exerciseName=Press`)).status).toBe(200)
    expect((await trend(`?exerciseName=Press`)).status).toBe(429)
  })
})

describe('/api/oura/hr-data', () => {
  const completed = { id: SESSION_ID, startedAt: new Date('2026-09-01T02:00:00Z'), completedAt: new Date('2026-09-01T03:00:00Z') }
  const computed = (over: Row = {}) => ({
    readings: [{ timestamp: new Date('2026-09-01T02:30:00Z'), bpm: 140 }],
    stats: [], setHrRows: [{ setNumber: 1 }],
    summary: { avgBpm: 130, peakBpm: 160, hrr1Best: 22, readingsCount: 1, source: 'oura' },
    workoutHrvMs: 45, ...over,
  })

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await hrData(`?sessionId=${SESSION_ID}`)).status).toBe(401)
  })

  it('needs a session id', async () => {
    expect((await hrData('')).status).toBe(400)
    expect(getWorkoutSessionById).not.toHaveBeenCalled()
  })

  // The lookup is user-scoped, so another account's session reads as absent.
  it('answers 404 for a session that is not the caller\'s', async () => {
    getWorkoutSessionById.mockResolvedValue(null)
    expect((await hrData(`?sessionId=${SESSION_ID}`)).status).toBe(404)
    expect(getWorkoutSessionById).toHaveBeenCalledWith(sessionUser!.id, SESSION_ID)
    expect(computeWorkoutHr).not.toHaveBeenCalled()
  })

  it('says it is not ready while the workout is still running', async () => {
    getWorkoutSessionById.mockResolvedValue({ ...completed, completedAt: null })
    const res = await hrData(`?sessionId=${SESSION_ID}`)
    expect(await res.json()).toEqual({ ready: false })
    expect(computeWorkoutHr).not.toHaveBeenCalled()
  })

  it('persists both durable snapshots when there is live data', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed())

    const body = await (await hrData(`?sessionId=${SESSION_ID}`)).json()
    expect(body).toMatchObject({ ready: true, hasData: true, workoutHrvMs: 45 })
    expect(body.summary.fromSnapshot).toBe(false)
    expect(upsertWorkoutHrStats).toHaveBeenCalledWith(sessionUser!.id, SESSION_ID, expect.objectContaining({ avgBpm: 130 }))
    expect(upsertSetHrStats).toHaveBeenCalledWith(sessionUser!.id, SESSION_ID, [{ setNumber: 1 }])
  })

  // A console.error here is invisible in production, which is how this write failed on every recap
  // for months: the recap renders either way, so a silent failure has no symptom at all.
  it('reports a failed snapshot write instead of swallowing it, and still answers', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed())
    upsertWorkoutHrStats.mockRejectedValue(new Error('write failed'))
    upsertSetHrStats.mockRejectedValue(new Error('write failed'))

    const res = await hrData(`?sessionId=${SESSION_ID}`)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))  // the writes are fire-and-forget
    expect(reportServerError).toHaveBeenCalledTimes(2)
  })

  it('writes nothing when the trace has already aged out', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed({ readings: [] }))

    await hrData(`?sessionId=${SESSION_ID}`)
    expect(upsertWorkoutHrStats).not.toHaveBeenCalled()
    expect(upsertSetHrStats).not.toHaveBeenCalled()
  })

  // Lever W: the scalars survive the prune even though the trace does not.
  it('falls back to the stored snapshot for an aged-out workout, and says so', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed({ readings: [], workoutHrvMs: null }))
    getWorkoutHrStats.mockResolvedValue({ avgBpm: 128, peakBpm: 155, hrr1Best: 20, workoutHrvMs: 41, readingsCount: 900, source: 'oura' })

    const body = await (await hrData(`?sessionId=${SESSION_ID}`)).json()
    expect(body.hasData).toBe(false)
    expect(body.summary).toMatchObject({ avgBpm: 128, fromSnapshot: true })
    expect(body.workoutHrvMs).toBe(41)
  })

  // RR dies at 90 days while the trace lives to 180, so the HRV is filled from the snapshot even
  // when live readings still exist.
  it('fills the HRV from the snapshot while the trace is still live', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed({ workoutHrvMs: null }))
    getWorkoutHrStats.mockResolvedValue({ avgBpm: 128, workoutHrvMs: 41 })

    const body = await (await hrData(`?sessionId=${SESSION_ID}`)).json()
    expect(body.hasData).toBe(true)
    expect(body.summary.fromSnapshot).toBe(false)  // the live summary still wins
    expect(body.workoutHrvMs).toBe(41)             // …but the HRV comes from the snapshot
  })

  it('answers a null summary for a workout that aged out before it was ever snapshotted', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed({ readings: [], workoutHrvMs: null }))
    getWorkoutHrStats.mockResolvedValue(null)

    const body = await (await hrData(`?sessionId=${SESSION_ID}`)).json()
    expect(body.summary).toBeNull()
    expect(body.workoutHrvMs).toBeNull()
  })

  it('answers no-store', async () => {
    getWorkoutSessionById.mockResolvedValue(completed)
    computeWorkoutHr.mockResolvedValue(computed())
    expect((await hrData(`?sessionId=${SESSION_ID}`)).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
