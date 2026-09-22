/**
 * RV-69 — the workout recap degrades to the session's own figures, and ONLY the model call does.
 *
 * This route is the odd one of the four. Its siblings wrap the model call in their own
 * `let text; try { … } catch` and return a 502 from it; this one had a single handler-wide catch
 * returning 500, covering the session lookup, three repo reads and `buildRecapFacts` as well. So
 * "degrade on the catch path" as the entry wrote it would have answered 200 with a recap for a
 * request that never got as far as building one — including the malformed-id case (22P02) behind
 * Q-483. The catch is scoped to the model call instead, and the outer one still answers 500.
 *
 * The other half is the client: `done-screen.tsx` reads this through `cachedFetch` under
 * `WORKOUT_RECAP_TTL`, and the only retry the card offers is a refetch. A cached fallback would
 * therefore outlive every attempt to replace it, which is why nothing here is persisted or stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getWorkoutSessionDetail = vi.fn(async (_u: string, _id: string) => null as unknown)
const getRecentSessionsOfType = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const listProgressionStyles = vi.fn(async (_u: string) => [] as unknown[])
const listRecentPersonalRecords = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const upsertAiHealthInsight = vi.fn(async () => undefined)
const readFreshInsight = vi.fn(async (..._a: unknown[]) => null as string | null)
const generateText = vi.fn(async (_o: unknown) => ({ text: '  a tidy recap  ' }))
const reportServerError = vi.fn()

let seq = 0
let userId = 'u-0'
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId, timezone: 'Australia/Brisbane' } }) }))
const repo = () => ({
  getWorkoutSessionDetail, getRecentSessionsOfType, listProgressionStyles,
  listRecentPersonalRecords, upsertAiHealthInsight,
})
vi.mock('@/lib/data', () => ({
  getRepository: async () => repo(),
  getRepositoryAsync: async () => repo(),
}))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_m: unknown, run: (s: AbortSignal) => Promise<{ text: string }>) =>
    run(new AbortController().signal),
}))
vi.mock('@/lib/ai/insight-cache', () => ({
  hashInsightContext: (p: string) => `h:${p.length}`,
  readFreshInsight: (...a: unknown[]) => readFreshInsight(...a),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET } from '@/app/api/workout-sessions/[id]/recap/route'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const START = new Date('2026-09-10T02:00:00Z')

const sessionDetail = (exercises: unknown[]) => ({
  id: SESSION_ID,
  sessionId: 'prog-session-1',
  startedAt: START,
  completedAt: new Date(START.getTime() + 45 * 60_000),
  exercises,
})

const get = () =>
  GET(new Request(`http://localhost/api/workout-sessions/${SESSION_ID}/recap`) as never,
      { params: Promise.resolve({ id: SESSION_ID }) })

beforeEach(() => {
  for (const m of [getWorkoutSessionDetail, getRecentSessionsOfType, listProgressionStyles,
                   listRecentPersonalRecords, upsertAiHealthInsight, readFreshInsight,
                   generateText, reportServerError]) m.mockClear()
  getRecentSessionsOfType.mockResolvedValue([])
  listProgressionStyles.mockResolvedValue([])
  listRecentPersonalRecords.mockResolvedValue([])
  readFreshInsight.mockResolvedValue(null)
  generateText.mockResolvedValue({ text: '  a tidy recap  ' })
  getWorkoutSessionDetail.mockResolvedValue(sessionDetail([
    { volume: 8200, styleId: null, sets: [{ setNumber: 1, weightKg: 100, reps: 5, rpe: 7, restTimeSec: null }] },
  ]))
  // Fresh user per test — the route rate-limits 20/hour per user and the limiter is process-wide.
  userId = `u-${++seq}`
})

describe('the happy path is unchanged', () => {
  it('returns the model\'s recap and stores it', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recap: 'a tidy recap' })
    expect(upsertAiHealthInsight).toHaveBeenCalled()
  })
})

describe('a failed model call degrades to the session (RV-69)', () => {
  beforeEach(() => { generateText.mockRejectedValue(new Error('provider exploded')) })

  it('answers 200 with the figures, not 500', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json() as { recap: string; degraded: boolean }
    expect(json.degraded).toBe(true)
    expect(json.recap).toContain('Duration: 45 min')
    expect(json.recap).toContain('Total volume: 8200 kg')
    expect(json.recap).toContain('New personal records: 0')
  })

  /**
   * A completed session's context hash never changes, so a stored fallback is the recap forever.
   */
  it('does not persist the fallback', async () => {
    await get()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  it('tells the client not to store it either', async () => {
    const res = await get()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

/**
 * The scoping, stated as a test rather than a comment: a failure BEFORE the model call is still a
 * 500. Nothing about "the model might fail" may soften a driver error into a 200 — that is the
 * defect Q-483 fixed by redacting the body, not by hiding the status.
 */
describe('failures that are not the model\'s still fail', () => {
  it('a repo error answers 500, with no recap', async () => {
    getWorkoutSessionDetail.mockRejectedValue(new Error('22P02 invalid input syntax for type uuid'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal error' })
    expect(reportServerError).toHaveBeenCalled()
  })

  it('a missing session is still 404', async () => {
    getWorkoutSessionDetail.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
  })

  it('a malformed id never reaches the repo', async () => {
    const res = await GET(new Request('http://localhost/api/workout-sessions/not-a-uuid/recap') as never,
                          { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(res.status).toBe(400)
    expect(getWorkoutSessionDetail).not.toHaveBeenCalled()
  })
})
