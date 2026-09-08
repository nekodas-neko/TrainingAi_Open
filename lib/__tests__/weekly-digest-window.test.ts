/**
 * PS-39 — `POST /api/weekly-digest`, one of the twelve #956 exposed as believed-tested-and-not.
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

import { POST } from '@/app/api/weekly-digest/route'

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: TZ } }

const post = (body?: unknown) =>
  POST(new Request('http://localhost/api/weekly-digest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never)

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
const promptOf = () => (generateText.mock.calls[0][0] as { prompt: string }).prompt
const bodyOf = async (r: Response) => r.json() as Promise<{ weekStart: string; cached: boolean; digest: string }>

describe('POST /api/weekly-digest recaps the last COMPLETED week', () => {
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
    await post()
    expect(promptOf()).toContain('first week of data')
    expect(promptOf()).not.toContain('Infinity')
  })

  it('compares the two full weeks when both have volume', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    getWorkoutSessionsFrom.mockResolvedValue([
      session(new Date('2026-09-02T15:00:00Z'), 6000),   // recap week (Aug 31 – Sep 6)
      session(new Date('2026-08-26T15:00:00Z'), 4000),   // prior week (Aug 24 – Aug 30)
    ])
    await post()
    expect(promptOf()).toContain('+50% vs the week before')
  })
})

describe('caching and failure', () => {
  it('serves a fresh cached digest without calling the model', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    readFreshInsight.mockResolvedValue('last week you did well')
    const json = await bodyOf(await post())
    expect(json).toMatchObject({ digest: 'last week you did well', cached: true })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('force bypasses the cache', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    readFreshInsight.mockResolvedValue('stale but fresh-enough by date')
    const json = await bodyOf(await post({ force: true }))
    expect(json.cached).toBe(false)
    expect(json.digest).toBe('the recap')
    expect(generateText).toHaveBeenCalled()
  })

  it('re-generates when the inputs changed, even though the week is closed (Q-293)', async () => {
    // The recap week is closed, so its inputs mostly are too — but a late ring back-fill or a
    // corrected weigh-in still changes them, and keying the cache on the week alone served the
    // first digest written for it for the rest of the week with no way to notice.
    freezeAt('2026-09-10T14:00:00Z')
    await post()
    const firstHash = readFreshInsight.mock.calls[0][4]

    readFreshInsight.mockClear()
    getWorkoutSessionsFrom.mockResolvedValue([session(new Date('2026-09-02T15:00:00Z'), 9999)])
    await post()
    expect(readFreshInsight.mock.calls[0][4]).not.toBe(firstHash)
  })

  it('answers 502 on a model failure, without leaking the error', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    generateText.mockRejectedValue(new Error('select * from workout_sessions blew up'))
    const res = await post()
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('workout_sessions')
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  it('refuses without a session, and 413s an oversized body', async () => {
    freezeAt('2026-09-10T14:00:00Z')
    sessionUser = null
    expect((await post()).status).toBe(401)

    freshUser()
    expect((await post({ force: true, pad: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(generateText).not.toHaveBeenCalled()
  })
})
