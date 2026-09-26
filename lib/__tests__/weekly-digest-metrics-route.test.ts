/**
 * BF-5 — the route returns the numbers, and the text it builds from them is UNCHANGED.
 *
 * The change this file guards is a refactor with a user-visible blast radius: the recap's prose
 * used to be assembled from raw rows inline, and is now formatted from the structured
 * `WeeklyDigestMetrics` the route returns. If a single template drifted the user would read
 * something different — silently, because every assertion you would naturally write about "does
 * it still return a digest" still passes.
 *
 * So the first test freezes the whole digest, not a substring of it. The frozen string was not
 * transcribed by hand: it was captured by running THIS fixture against the route and diffing.
 * Anything that changes the wording fails here.
 *
 * **It was updated twice, deliberately.** On 2026-09-20 (BF-178) one line moved from "Oura
 * readiness" to "Readiness": the number is the app's own ble-derived composite and crediting it
 * to Oura was the defect. On 2026-09-26 (RV-201) the model went away — the golden was a prompt
 * fed to Gemini, and is now the digest the user actually reads, rendered from the same numbers by
 * `buildWeeklyDigestText`. Those are the only sanctioned reasons to touch this string: it exists
 * to catch the change nobody meant to make, so a diff here should be argued for, never absorbed.
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

import { GET } from '@/app/api/weekly-digest/route'
import { buildWeeklyDigestText, type WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics'

// A GET since RV-201 — it always was a read, and only a POST because it ran a model.
const post = () => GET()

const bodyOf = async (r: Response) =>
  r.json() as Promise<{ weekStart: string; digest: string; metrics: WeeklyDigestMetrics }>

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

describe('the digest is byte-identical to the text this fixture has always produced', () => {
  it('builds exactly this digest', async () => {
    loadFixture()
    const json = await bodyOf(await post())
    expect(json.digest).toBe(DIGEST_TEXT)
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

  it('returns them on every call — there is no longer a cached path to miss', async () => {
    // Before RV-201 the digest came from a stored row keyed on (user, week, context hash), and
    // the metrics rode along only when that row was rebuilt. A page fed only by cache misses was
    // blank almost every time. The row is gone; a stale one left over must not be read back.
    loadFixture()
    readFreshInsight.mockResolvedValue('a digest from earlier this week')

    const first = await bodyOf(await post())
    const second = await bodyOf(await post())

    expect(first.digest).not.toBe('a digest from earlier this week')
    expect(readFreshInsight).not.toHaveBeenCalled()
    expect(first.metrics.training.volumeKg).toBe(7000)
    expect(second.digest).toBe(first.digest)
    expect(second.metrics).toEqual(first.metrics)
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
    expect(json.digest).toContain('first week of data')
  })

  it('carries the PR description, not just the number — a bodyweight PR is not a weight', async () => {
    loadFixture()
    const json = await bodyOf(await post())
    expect(json.metrics.prs.map(p => p.exerciseName)).toEqual(['Bench', 'Squat'])
    expect(json.metrics.prs[0].description).toContain('Bench')
  })
})

// Captured, not transcribed — see the file header.
const DIGEST_TEXT = `• 2 sessions, 7,000 kg total (+40% vs the week before, which had 1)
• Most-worked muscles by weighted sets: chest 1.5, triceps 1.5, quads 1.0
• Personal records: Bench 103kg est. 1RM; Squat 142kg est. 1RM
• Recovery — overnight HRV up 8 ms to 60 ms, readiness down 5 to 66, sleep quality up 12 to 67/100, sleep averaging 7.3 h a night
• High daytime stress ~51 min/day (week before ~44)
• Training stress averaged 4.8, with at least one high-load day
• Illness radar: watch
• Resilience: adequate (as of 2026-09-01)
• Weight down 1.3 kg over the fortnight`

/**
 * RV-69 — the model's failure must not discard the week. RV-201 removed the failure mode.
 *
 * Every number in the recap was computed by this route before the model was ever called; the
 * model only wrote the sentences about them, and answering 502 threw away a complete
 * `WeeklyDigestMetrics`. The degrade path — 200, the facts, `degraded: true` — was that fix.
 *
 * Rendering the sentences from the same numbers in code retires the class rather than handling
 * it: there is no provider to fail, no limiter to refuse, and no stored row to serve one blip's
 * fallback from for the rest of the week. What follows pins that the guarantee RV-69 argued for
 * is now held by the route's shape instead of by a catch block — which is the only thing that
 * makes deleting the catch block's tests safe rather than a quiet loss of coverage.
 */
describe('the week can no longer be lost to something outside this route (RV-69, RV-201)', () => {
  it('reaches no model, no insight cache and no stored row on any path', async () => {
    loadFixture()
    const json = await bodyOf(await post())

    expect(json.digest).toContain('2 sessions, 7,000 kg total')
    expect(generateText).not.toHaveBeenCalled()
    expect(readFreshInsight).not.toHaveBeenCalled()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  it('answers 200 with the week as recorded even when the provider would have exploded', async () => {
    loadFixture()
    generateText.mockRejectedValue(new Error('provider exploded'))
    const res = await post()

    expect(res.status).toBe(200)
    const json = await bodyOf(res)
    expect(json.metrics.training.volumeKg).toBe(7000)
    expect(json.weekStart).toBe('2026-08-31')
  })

  /**
   * Not a tautology: the route could narrow or re-derive either side. This pins that the metrics
   * the charts render are the same object the prose was written from, so the two cannot disagree.
   */
  it('renders its prose from the very metrics it returns', async () => {
    loadFixture()
    const json = await bodyOf(await post())
    expect(json.digest).toBe(buildWeeklyDigestText(json.metrics))
  })
})
