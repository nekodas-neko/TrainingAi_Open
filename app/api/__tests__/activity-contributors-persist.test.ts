// Q-526 — the Activity score stored the blend wrapper where its contributors should go.
//
// `oura_daily_derived.activity_contributors` held `{base, adjustment, trained}` — the wrapper that
// folds an Oura *Cloud* activity score into ours — and not one of the six component sub-scores
// `computeActivityScore` produces. The components were already in memory on the same request (the
// route serves them to the client as `activityContributors`); they were simply never written.
//
// **The cost is a measurement that cannot be made afterwards.** Rebuilding a past day's contributors
// means recomputing them from raw inputs at TODAY's goals, and `strengthFreqGoal` went 3 → 5 and the
// volume target changed basis on 2026-08-11 — so "what did strengthFreq score on 2026-08-02?" has no
// answer. Sleep, readiness and illness all store their breakdown; activity was the only one that did
// not. Measured against production 2026-08-26: all 30 rows carrying the column held the wrapper and
// zero component keys, and on every one `adjustment` was 0 and `base` equalled `activity_score` —
// the blend has had nothing to adjust since the BLE re-key, so the column stored the score twice and
// its parts not at all.
//
// The property that makes this worth doing is not "six keys are present" but **the stored row
// reproduces its own score**: the components reproduce `preTaper` under the model's weights
// renormalised over whichever keys are present, and `acwr` is the taper's only input.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ACTIVITY_MODEL } from '@trainingai/shared/health/activity-score'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  bodyMetrics: [] as Record<string, unknown>[],
  workouts: [] as Record<string, unknown>[],
  program: null as Record<string, unknown> | null,
  upsertDerived: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
const repoStub = () => ({
    listBodyMetrics:          async () => repo.bodyMetrics,
    listSleepSessions:        async () => [],
    getWorkoutSessionsFrom:   async () => repo.workouts,
    getOuraDaily:             async () => [],
    getActiveProgram:         async () => repo.program,
    getHrForWindow:           async () => [],
    getOuraDailySummary:      async () => [],
    getOuraDailyDerived:      async () => [],
    getLatestOuraCloudVitals: async () => null,
    getMoodLog:               async () => null,
    getUserById:              async () => ({ id: 'u1', dateOfBirth: '1995-01-01', heightCm: 180, sex: 'male', activityLevel: 'moderate' }),
    upsertOuraDailyDerived:   repo.upsertDerived,
    insertErrorEvent:         async () => {},
})
vi.mock('@/lib/data', () => ({
  getRepository: async () => repoStub(),
  getRepositoryAsync: async () => repoStub(),
}))

import { GET } from '@/app/api/readiness-score/route'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const today = todayInTz(TZ)
const day = (back: number) => shiftDateStr(today, -back)

const metrics = (days: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: days }, (_, i) => ({
    date: day(i), steps: 9200, activeCalories: 520, weightKg: 80, ...over,
  }))

/** Logged strength sessions inside the rolling 7-day window, so the strength lane scores too. */
const sessions = (n: number, volumeKg: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `w${i}`, date: day(i), startedAt: new Date(`${day(i)}T02:00:00.000Z`),
    completedAt: new Date(`${day(i)}T03:00:00.000Z`),
    exercises: [{ name: 'Squat', volume: volumeKg, sets: [] }],
  }))

const activityWrite = () =>
  repo.upsertDerived.mock.calls.find(c => c[2]?.activityScore != null)

beforeEach(() => {
  repo.bodyMetrics = []
  repo.workouts = []
  repo.program = null
  repo.upsertDerived.mockReset()
})

describe('the persisted activity breakdown (Q-526)', () => {
  it('writes the component sub-scores, not just the blend wrapper', async () => {
    repo.bodyMetrics = metrics(14)
    repo.workouts = sessions(3, 6000)
    await GET()

    const write = activityWrite()
    expect(write, 'the route must persist an activity score at all').toBeDefined()
    const stored = write![2].activityContributors as Record<string, number | null>

    // The daily-movement lane always scores here (steps + active calories are present), and the
    // strength lane scores because sessions exist in the window.
    expect(Object.keys(stored)).toEqual(expect.arrayContaining([
      'steps', 'activeEnergy', 'strengthFreq', 'strengthVolume',
    ]))
    for (const k of ['steps', 'activeEnergy', 'strengthFreq', 'strengthVolume']) {
      expect(typeof stored[k], `${k} must be a number`).toBe('number')
      expect(stored[k]).toBeGreaterThanOrEqual(0)
      expect(stored[k]).toBeLessThanOrEqual(100)
    }
  })

  // The entry's caveat: the wrapper is real information and something may read it. Merge, never
  // replace. `trained` in particular is the one bit the components cannot re-derive.
  it('keeps the blend wrapper alongside', async () => {
    repo.bodyMetrics = metrics(14)
    repo.workouts = sessions(3, 6000)
    await GET()

    const stored = activityWrite()![2].activityContributors as Record<string, number | null>
    expect(Object.keys(stored)).toEqual(expect.arrayContaining(['base', 'adjustment', 'trained']))
    expect(stored.trained).toBe(1)                 // a session was logged today
    expect(stored.adjustment).toBe(0)              // nothing to adjust — no Oura Cloud activity row
  })

  // The pass test. Not "the keys are there" — "the row reproduces its own score".
  it('stores a breakdown that reproduces the score it was stored with', async () => {
    repo.bodyMetrics = metrics(14)
    repo.workouts = sessions(4, 7500)
    await GET()

    const write = activityWrite()!
    const stored = write[2].activityContributors as Record<string, number>
    const score = write[2].activityScore as number

    // Weights renormalise over whichever contributors ran, which is why the present keys have to be
    // read from the row rather than assumed.
    const weights = ACTIVITY_MODEL.weights as Record<string, number>
    const present = Object.keys(weights).filter(k => stored[k] != null)
    expect(present.length).toBeGreaterThan(0)
    const totalWeight = present.reduce((s, k) => s + weights[k], 0)
    const preTaper = Math.round(present.reduce((s, k) => s + weights[k] * stored[k], 0) / totalWeight)

    expect(stored.preTaper).toBe(preTaper)

    // `acwr` is the taper's only input, so the row closes the loop by itself.
    const { acwrStart, acwrSpan, maxTaper } = ACTIVITY_MODEL.taper
    const acwr = stored.acwr
    const taper = acwr != null && acwr > acwrStart
      ? Math.min(1, Math.max(0, (acwr - acwrStart) / acwrSpan)) * maxTaper
      : 0
    const rederived = Math.max(0, Math.min(100, Math.round(preTaper * (1 - taper))))

    // base + adjustment is the blend on top; both are stored, so the final is reachable too.
    expect(Math.max(0, Math.min(100, rederived + (stored.adjustment ?? 0)))).toBe(score)
  })

  // A day whose strength lane is absent must renormalise, and the stored row must say so by
  // omitting those keys rather than storing a zero that reads as "scored nothing".
  it('omits a contributor that did not run rather than storing it as zero', async () => {
    repo.bodyMetrics = metrics(14)
    repo.workouts = []                      // no strength sessions at all
    await GET()

    const stored = activityWrite()![2].activityContributors as Record<string, number | null>
    expect(stored).not.toHaveProperty('strengthFreq')
    expect(stored).not.toHaveProperty('strengthVolume')
    expect(stored.trained).toBe(0)

    const weights = ACTIVITY_MODEL.weights as Record<string, number>
    const present = Object.keys(weights).filter(k => stored[k] != null)
    const totalWeight = present.reduce((s, k) => s + weights[k], 0)
    expect(Math.round(present.reduce((s, k) => s + weights[k] * (stored[k] as number), 0) / totalWeight))
      .toBe(stored.preTaper)
  })

  // The taper is the only thing standing between `preTaper` and the stored score, and it bites on
  // exactly the days worth auditing later — the overreaching ones. `acwr` is its only input, so
  // without it on the row those days are the ones that stop being re-derivable.
  it('re-derives a TAPERED day, where preTaper and the stored score differ', async () => {
    repo.bodyMetrics = metrics(30)
    // ACWR needs a 21-day span, 6+ sessions and a program older than 28 days before it resolves at
    // all. A light month with a heavy last week is what pushes it past the taper threshold.
    repo.program = { id: 'p1', startedAt: new Date(`${day(60)}T00:00:00.000Z`) }
    repo.workouts = [...sessions(4, 14_000), ...Array.from({ length: 8 }, (_, i) => ({
      id: `old${i}`, date: day(8 + i * 2), startedAt: new Date(`${day(8 + i * 2)}T02:00:00.000Z`),
      completedAt: new Date(`${day(8 + i * 2)}T03:00:00.000Z`),
      exercises: [{ name: 'Squat', volume: 600, sets: [] }],
    }))]
    await GET()

    const write = activityWrite()!
    const stored = write[2].activityContributors as Record<string, number>
    const score = write[2].activityScore as number

    const { acwrStart, acwrSpan, maxTaper } = ACTIVITY_MODEL.taper
    expect(stored.acwr, 'the fixture must actually trigger the taper').toBeGreaterThan(acwrStart)
    expect(stored.preTaper).toBeGreaterThan(score)      // otherwise this proves nothing

    const taper = Math.min(1, Math.max(0, (stored.acwr - acwrStart) / acwrSpan)) * maxTaper
    expect(Math.max(0, Math.min(100, Math.round(stored.preTaper * (1 - taper))))).toBe(score)
  })

  // The route already serves these components to the client. Storing a *different* breakdown from
  // the one it displays would be a second, drifting definition of what the score was made of.
  it('stores exactly the breakdown it serves', async () => {
    repo.bodyMetrics = metrics(14)
    repo.workouts = sessions(3, 6000)
    const served = await (await GET()).json()

    const stored = activityWrite()![2].activityContributors as Record<string, number>
    for (const [k, v] of Object.entries(served.activityContributors as Record<string, number>)) {
      expect(stored[k], `${k} served ${v} but stored ${stored[k]}`).toBe(v)
    }
  })
})
