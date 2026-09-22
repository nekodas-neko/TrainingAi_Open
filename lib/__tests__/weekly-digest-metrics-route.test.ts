/**
 * BF-5 — the route returns the numbers, and the prompt it builds from them is UNCHANGED.
 *
 * The change this file guards is a refactor with a user-visible blast radius: the context block fed
 * to the model used to be assembled from raw rows inline, and is now formatted from the structured
 * `WeeklyDigestMetrics` the route returns. If a single template drifted, the model would be told
 * something different and the user would read something different — silently, because every
 * assertion you would naturally write about "does it still return a digest" still passes.
 *
 * So the first test freezes the whole prompt, not a substring of it. The frozen string was not
 * transcribed by hand: it was captured by running THIS fixture against `origin/main`'s route and
 * again against the rewritten one, and diffing. Anything that changes the wording fails here.
 *
 * **The frozen string was updated once, deliberately, on 2026-09-20 (BF-178).** One line moved
 * from "Oura readiness" to "Readiness": the number is the app's own ble-derived composite and
 * crediting it to Oura in the text fed to the model was the defect. That is the only sanctioned
 * reason to touch this string — it exists to catch the change nobody meant to make, so a diff
 * here should be argued for, never absorbed.
 *
 * Runs in a NON-default timezone deliberately — in Brisbane a window assertion passes against a
 * route that hardcodes DEFAULT_TZ and proves nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fx from './weekly-digest-fixture'

const getWorkoutSessionsFrom = vi.fn(async (_u: string, _from: Date) => [] as unknown[])
const listBodyMetrics = vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[])
const listSleepSessions = vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[])
const getOuraDaily = vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[])
const getOuraDailyDerived = vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[])
const listRecentPersonalRecords = vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[])
const listExerciseLibrary = vi.fn(async () => [] as unknown[])
const getExerciseMuscleAssignments = vi.fn(async (_n: string[]) => ({}) as Record<string, unknown[]>)
const getFriendIds = vi.fn(async (_u: string) => [] as string[])
const upsertAiHealthInsight = vi.fn(async () => undefined)
const readFreshInsight = vi.fn(async (..._a: unknown[]) => null as string | null)
const generateText = vi.fn(async (_o: unknown) => ({ text: '  the recap  ' }))

let seq = 0
let sessionUser: { id: string; timezone?: string } | null = { id: 'u-0', timezone: fx.TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
const repo = () => ({
  getWorkoutSessionsFrom, listBodyMetrics, listSleepSessions, getOuraDaily, getOuraDailyDerived,
  listRecentPersonalRecords, listExerciseLibrary, getExerciseMuscleAssignments, getFriendIds,
  upsertAiHealthInsight,
})
vi.mock('@/lib/data', () => ({ getRepository: async () => repo(), getRepositoryAsync: async () => repo() }))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_m: unknown, run: () => Promise<{ text: string }>) => run(),
}))
vi.mock('@/lib/ai/insight-cache', () => ({
  hashInsightContext: (p: string) => {
    let h = 5381
    for (let i = 0; i < p.length; i++) h = ((h * 33) ^ p.charCodeAt(i)) >>> 0
    return `h:${h.toString(16)}`
  },
  readFreshInsight: (...a: unknown[]) => readFreshInsight(...a),
}))

import { POST } from '@/app/api/weekly-digest/route'
import type { WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics'

const post = (body?: unknown) =>
  POST(new Request('http://localhost/api/weekly-digest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never)

const bodyOf = async (r: Response) =>
  r.json() as Promise<{ weekStart: string; cached: boolean; digest: string; metrics: WeeklyDigestMetrics }>

/** The data block the prompt carries — everything after the guards. */
const contextOf = () => {
  const prompt = (generateText.mock.calls[0][0] as { prompt: string }).prompt
  return prompt.slice(prompt.lastIndexOf('\n\n') + 2)
}

const loadFixture = () => {
  getWorkoutSessionsFrom.mockResolvedValue(fx.sessions as never)
  listBodyMetrics.mockResolvedValue(fx.bodyMetrics as never)
  listSleepSessions.mockResolvedValue(fx.sleepSessions as never)
  getOuraDailyDerived.mockResolvedValue(fx.derivedRows as never)
  listRecentPersonalRecords.mockResolvedValue(fx.personalRecords as never)
  listExerciseLibrary.mockResolvedValue(fx.exerciseLibrary as never)
  getExerciseMuscleAssignments.mockResolvedValue(fx.muscleAssignments as never)
  getFriendIds.mockResolvedValue(fx.friendIds)
}

beforeEach(() => {
  for (const m of [getWorkoutSessionsFrom, listBodyMetrics, listSleepSessions, getOuraDaily,
                   getOuraDailyDerived, listRecentPersonalRecords, listExerciseLibrary,
                   getExerciseMuscleAssignments, getFriendIds, upsertAiHealthInsight,
                   readFreshInsight, generateText]) m.mockClear()
  getWorkoutSessionsFrom.mockResolvedValue([])
  for (const m of [listBodyMetrics, listSleepSessions, getOuraDaily, getOuraDailyDerived,
                   listRecentPersonalRecords, listExerciseLibrary]) m.mockResolvedValue([])
  getExerciseMuscleAssignments.mockResolvedValue({})
  getFriendIds.mockResolvedValue([])
  readFreshInsight.mockResolvedValue(null)
  generateText.mockResolvedValue({ text: '  the recap  ' })
  // A FRESH user id per test: the route rate-limits 3/min per user, so a fourth test reusing one
  // gets a 429 and every `json.metrics` read fails on undefined.
  sessionUser = { id: `u-${++seq}`, timezone: fx.TZ }
  vi.useFakeTimers()
  vi.setSystemTime(new Date(fx.NOW))
})
afterEach(() => { vi.useRealTimers() })

describe('the prompt is byte-identical to the pre-refactor route', () => {
  it('builds exactly this context block', async () => {
    loadFixture()
    await post()
    expect(contextOf()).toBe(CONTEXT_BEFORE_REFACTOR)
  })
})

describe('the route returns the metrics it used to throw away', () => {
  it('returns them on the fresh path', async () => {
    loadFixture()
    const json = await bodyOf(await post())
    expect(json.metrics.weekStart).toBe('2026-08-31')
    expect(json.metrics.weekEnd).toBe('2026-09-06')
    expect(json.metrics.training.sessions).toBe(2)
    expect(json.metrics.training.volumeKg).toBe(7000)
    expect(json.metrics.training.priorVolumeKg).toBe(5000)
  })

  it('returns them on the CACHED path too — the path the banner almost always takes', async () => {
    loadFixture()
    readFreshInsight.mockResolvedValue('a digest from earlier this week')
    const json = await bodyOf(await post())

    expect(json.cached).toBe(true)
    expect(json.digest).toBe('a digest from earlier this week')
    // The whole point: a page fed only by cache misses would be blank almost every time.
    expect(json.metrics.training.volumeKg).toBe(7000)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('buckets each day by the USER\'s local day, not UTC', async () => {
    // 2026-09-01T15:00Z is 11:00 Sep 1 in New York; 2026-09-03T15:00Z is 11:00 Sep 3. A UTC bucket
    // agrees here, so the discriminating case is added below rather than relying on these.
    getWorkoutSessionsFrom.mockResolvedValue([
      // 01:00 UTC on Sep 3 is 21:00 on Sep 2 in New York — a UTC bucket puts this on the wrong bar.
      { startedAt: new Date('2026-09-03T01:00:00Z'), exercises: [{ exerciseName: 'Bench', volume: 1234, sets: [{}] }] },
    ] as never)
    const json = await bodyOf(await post())

    const byDay = Object.fromEntries(json.metrics.training.byDay.map(d => [d.date, d.volumeKg]))
    expect(byDay['2026-09-02']).toBe(1234)
    expect(byDay['2026-09-03']).toBe(0)
  })

  it('gives every recap day a slot, so a gap is a gap and not a missing point', async () => {
    loadFixture()
    const json = await bodyOf(await post())

    expect(json.metrics.training.byDay.map(d => d.date)).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
    ])
    expect(json.metrics.readiness.byDay).toHaveLength(7)
    // Sep 1 has a derived readiness row; the rest of the week has none.
    expect(json.metrics.readiness.byDay.find(p => p.date === '2026-09-01')?.value).toBe(66)
    expect(json.metrics.readiness.byDay.find(p => p.date === '2026-09-04')?.value).toBeNull()
  })

  it('picks the HRV source for the whole week and does not mix instruments within the series', async () => {
    // One overnight value in the recap week, two body-metrics values. Overnight wins for the whole
    // series; the body-metrics days stay null rather than filling the gaps from another instrument.
    listSleepSessions.mockResolvedValue([fx.night('2026-09-01', 6.4, 58, 90)] as never)
    listBodyMetrics.mockResolvedValue([
      { date: '2026-09-02', hrvMs: 41 },
      { date: '2026-09-04', hrvMs: 39 },
    ] as never)
    const json = await bodyOf(await post())

    expect(json.metrics.hrv.source).toBe('overnight')
    expect(json.metrics.hrv.byDay.find(p => p.date === '2026-09-01')?.value).toBe(58)
    expect(json.metrics.hrv.byDay.find(p => p.date === '2026-09-02')?.value).toBeNull()
    expect(json.metrics.hrv.byDay.find(p => p.date === '2026-09-04')?.value).toBeNull()
  })

  it('falls back to body metrics only when no night in the week carries HRV', async () => {
    listSleepSessions.mockResolvedValue([] as never)
    listBodyMetrics.mockResolvedValue([{ date: '2026-09-02', hrvMs: 41 }] as never)
    const json = await bodyOf(await post())

    expect(json.metrics.hrv.source).toBe('body-metrics')
    expect(json.metrics.hrv.byDay.find(p => p.date === '2026-09-02')?.value).toBe(41)
  })

  it('reports a null volume change rather than a zero when there is no prior week', async () => {
    // 0 would draw as "no change", which is a different and false claim.
    getWorkoutSessionsFrom.mockResolvedValue([
      { startedAt: new Date('2026-09-02T15:00:00Z'), exercises: [{ exerciseName: 'Bench', volume: 5000, sets: [{}] }] },
    ] as never)
    const json = await bodyOf(await post())

    expect(json.metrics.training.priorVolumeKg).toBe(0)
    expect(json.metrics.training.volumeChangePct).toBeNull()
    expect(contextOf()).toContain('first week of data')
  })

  it('carries the PR description, not just the number — a bodyweight PR is not a weight', async () => {
    loadFixture()
    const json = await bodyOf(await post())
    expect(json.metrics.prs.map(p => p.exerciseName)).toEqual(['Bench', 'Squat'])
    expect(json.metrics.prs[0].description).toContain('Bench')
  })
})

// Captured, not transcribed — see the file header.
const CONTEXT_BEFORE_REFACTOR = `Last week (the completed Mon–Sun week being reviewed): 2 sessions, 7000 kg volume (+40% vs the week before)
The week before that: 1 sessions, 5000 kg volume
Sets per muscle that week (weighted): chest 1.5, triceps 1.5, quads 1.0
PRs that week: Bench 103kg est. 1RM, Squat 142kg est. 1RM
Overnight HRV: 60 ms avg that week (week before 52 ms)
Readiness: 66/100 avg that week (week before 71/100)
Illness radar (vs personal baseline): watch — tempC z +1.8, rhr z -0.6
Daytime stress: high for ~51 min/day avg that week (week before ~44 min/day)
Stress resilience: adequate (level 3/5, as of 2026-09-01)
Training stress (own OTS model): avg 4.8 that week, with high-load day(s)
Body weight change: -1.3 kg over 2 weeks
7.3h avg sleep
Sleep quality: 67/100 avg nightly sleep score that week (week before 55/100)
Friends training that week: 3 friends connected`

/**
 * RV-69 — the model's failure must not discard the week.
 *
 * Every number in the recap is computed by this route before the model is ever called; the model
 * only writes the sentences about them. Answering 502 threw away a complete `WeeklyDigestMetrics`
 * and the whole context block built from it. `running-plan/explain` had already established the
 * shape: 200, the deterministic content, `degraded: true`.
 */
describe('a failed model call degrades to the facts (RV-69)', () => {
  const fail = () => generateText.mockRejectedValue(new Error('provider exploded'))

  it('answers 200 with the week as recorded, not 502', async () => {
    loadFixture(); fail()
    const res = await post()
    expect(res.status).toBe(200)
    const json = await bodyOf(res) as { digest: string; degraded?: boolean }
    expect(json.degraded).toBe(true)
    expect(json.digest).toContain('2 sessions, 7000 kg volume')
  })

  it('still returns the metrics, which the banner renders regardless of the prose', async () => {
    loadFixture(); fail()
    const json = await bodyOf(await post())
    expect(json.metrics.training.volumeKg).toBe(7000)
    expect(json.weekStart).toBe('2026-08-31')
  })

  /**
   * The load-bearing half. The insight cache is keyed on (user, week, context hash) and none of the
   * three moves for the rest of the week — so a stored fallback would be served ahead of every
   * later attempt, turning one provider blip into a week of no recap.
   */
  it('does not persist the fallback as the week\'s digest', async () => {
    loadFixture(); fail()
    await post()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  it('carries the same lines the model was given', async () => {
    loadFixture()
    const withModel = await bodyOf(await post())
    const context = contextOf()
    generateText.mockClear()
    sessionUser = { id: `u-${++seq}`, timezone: fx.TZ }
    fail()
    const degraded = await bodyOf(await post()) as { digest: string }
    for (const line of context.split('\n')) expect(degraded.digest).toContain(line)
    expect(withModel.digest).toBe('the recap')
  })
})
