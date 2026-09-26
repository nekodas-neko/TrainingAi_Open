/**
 * PS-39 — `GET /api/weekly-digest`, one of the twelve #956 exposed as believed-tested-and-not.
 *
 * Its subject is a **date window**, which is this repo's most-broken class, and the route's own
 * comment says why the obvious window is wrong: recapping "this week so far" is near-empty on a
 * Monday morning and reads as a **misleading ~100% drop** against the prior full week. So it recaps
 * the last COMPLETED Monday–Sunday week, and compares it with the full week before that.
 *
 * The window is derived from the user's timezone, so these run in a NON-default zone: in Brisbane a
 * window assertion passes against a route that hardcodes `DEFAULT_TZ` and proves nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const getWorkoutSessionsFrom = vi.fn(async (_u: string, _from: Date) =>
  [] as Array<{ startedAt: Date; exercises: Array<{ exerciseName: string; volume: number; sets: unknown[] }> }>)
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

const TZ = 'America/New_York'          // deliberately NOT DEFAULT_TZ — see the file header
let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
// The repo object is built INSIDE the async function, not in the factory body: `vi.mock` is hoisted
// above the const declarations above, so touching them at factory time is a TDZ error.
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
  // Content-derived, not length-derived: the whole point of the hash is that a changed input
  // invalidates a cached digest, and a length stub cannot tell 42 from 80.
  hashInsightContext: (p: string) => {
    let h = 5381
    for (let i = 0; i < p.length; i++) h = ((h * 33) ^ p.charCodeAt(i)) >>> 0
    return `h:${h.toString(16)}`
  },
  readFreshInsight: (...a: unknown[]) => readFreshInsight(...a),
}))

import { GET } from '@/app/api/weekly-digest/route'
import type { WeeklyDigestMetrics } from '@trainingai/shared/health/weekly-digest-metrics'

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: TZ } }

// A GET since RV-201 — it always was a read, and only a POST because it ran a model.
const post = () => GET()

const session = (startedAt: Date, volume: number) => ({
  startedAt, exercises: [{ exerciseName: 'Bench', volume, sets: [{}, {}] }],
})

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
  freshUser()
})
afterEach(() => { vi.useRealTimers() })

/** Freeze the clock to a known instant so the week boundaries are computable, not guessed. */
const freezeAt = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)) }
/**
 * The rendered digest. This read the model's PROMPT until RV-201 removed the model — asserting
 * the response is strictly better anyway: it is what the reader gets, not what a model was told.
 */
const digestOf = async () => (await bodyOf(await post())).digest
const bodyOf = async (r: Response) =>
  r.json() as Promise<{ weekStart: string; digest: string; metrics: WeeklyDigestMetrics }>

describe('GET /api/weekly-digest recaps the last COMPLETED week', () => {
  it('on a Monday, recaps the week that just ended — not the empty one just begun', async () => {
    // The failure the route exists to avoid: "this week so far" on a Monday morning is near-empty
    // and reads as a ~100% drop against the prior full week.
    freezeAt('2026-09-07T14:00:00Z')     // Monday 10:00 in New York
    const res = await post()
    const json = await bodyOf(res)

    // The Monday of the week that just ended, in the user's zone.
    expect(json.weekStart).toBe('2026-08-31')
  })

  it('reads a full 14 days, so the comparison is full-week against full-week', async () => {
    freezeAt('2026-09-10T14:00:00Z')     // Thursday
    await post()

    const from = getWorkoutSessionsFrom.mock.calls[0][1]
    // priorWeekStart = two Mondays before this week's Monday (2026-09-07).
    expect(formatInTimeZone(from, TZ, 'yyyy-MM-dd')).toBe('2026-08-24')
  })

  it('says "first week of data" instead of dividing by a zero prior week', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    getWorkoutSessionsFrom.mockResolvedValue([
      session(new Date('2026-09-02T15:00:00Z'), 5000),   // in the recap week, none before it
    ])
    const digest = await digestOf()
    expect(digest).toContain('first week of data')
    expect(digest).not.toContain('Infinity')
    expect(digest).not.toContain('NaN')
  })

  it('compares the two full weeks when both have volume', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    getWorkoutSessionsFrom.mockResolvedValue([
      session(new Date('2026-09-02T15:00:00Z'), 6000),   // recap week (Aug 31 – Sep 6)
      session(new Date('2026-08-26T15:00:00Z'), 4000),   // prior week (Aug 24 – Aug 30)
    ])
    const { digest, metrics } = await bodyOf(await post())
    // 6000 against 4000 is +50%, and the digest states it rather than restating the tonnages.
    expect(metrics.training.volumeKg).toBe(6000)
    expect(metrics.training.priorVolumeKg).toBe(4000)
    expect(digest).toContain('+50%')
  })
})

describe('the digest is recomputed, never cached or degraded (RV-201)', () => {
  // Three tests lived here for the prose cache keyed on (week, context hash), and one for the
  // degrade path. RV-201 removed the model, so there is no paid call to cache and no failure to
  // degrade from. What Q-293 actually cared about — the digest describing the week's CURRENT
  // numbers rather than whatever was written first — is now structural, and that is what these
  // assert.
  it('follows the data when it changes under the same week key (Q-293)', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    getWorkoutSessionsFrom.mockResolvedValue([session(new Date('2026-09-02T15:00:00Z'), 6000)])
    expect(await digestOf()).toContain('6,000 kg')

    getWorkoutSessionsFrom.mockResolvedValue([session(new Date('2026-09-02T15:00:00Z'), 9000)])
    const after = await digestOf()
    expect(after).toContain('9,000 kg')
    expect(after).not.toContain('6,000 kg')
  })

  it('never calls a model and never stores a row', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    await post()
    expect(generateText).not.toHaveBeenCalled()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
    expect(readFreshInsight).not.toHaveBeenCalled()
  })

  it('answers 200 with the metrics on every path — there is no longer one that does not', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    const res = await post()
    expect(res.status).toBe(200)
    const json = await bodyOf(res)
    expect(json.metrics).toBeTruthy()
    expect((json as unknown as { degraded?: boolean }).degraded).toBeUndefined()
  })

  it('refuses without a session, and answers the owner without reaching a model', async () => {
    // The oversized-body half of this test went with the POST (RV-201): a GET carries no body, so
    // the 413 guard it asserted no longer has an input to refuse. What it was really protecting —
    // that an unauthenticated caller cannot spend a model call — now holds because there is no
    // model call to spend, which is the stronger version of the same guarantee.
    freezeAt('2026-09-10T14:00:00Z')
    sessionUser = null
    expect((await post()).status).toBe(401)

    freshUser()
    expect((await post()).status).toBe(200)
    expect(generateText).not.toHaveBeenCalled()
  })
})
