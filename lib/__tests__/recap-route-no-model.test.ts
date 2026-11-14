/**
 * #3748 — the workout recap route answers from the session's numbers and reaches no model.
 *
 * This replaces `recap-route-degrade.test.ts` (RV-69). That file tested a fallback for a failed
 * model call; with no model there is no failure to fall back from, so what is worth holding now is
 * the opposite: nothing on this route can call a model, read or write the stored insight, or be
 * refused by a rate limit, and the same session gives the same text every time.
 *
 * The model modules are mocked so a call would be SEEN, not so the route can use them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recapText } from '@trainingai/shared/workout/recap-text'

const getWorkoutSessionDetail = vi.fn(async (_u: string, _id: string) => null as unknown)
const getRecentSessionsOfType = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const listProgressionStyles = vi.fn(async (_u: string) => [] as unknown[])
const listRecentPersonalRecords = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const upsertAiHealthInsight = vi.fn(async () => undefined)
const getAiHealthInsightWithHash = vi.fn(async () => null)
const generateText = vi.fn(async (_o: unknown) => ({ text: 'a model wrote this' }))
const loggedGenerateText = vi.fn(async (..._a: unknown[]) => ({ text: 'a model wrote this' }))
const rateLimit = vi.fn((..._a: unknown[]) => false)
const reportServerError = vi.fn()

let userId: string | null = 'u-1'
vi.mock('@/auth', () => ({
  auth: async () => (userId ? { user: { id: userId, timezone: 'Australia/Brisbane' } } : null),
}))
const repo = () => ({
  getWorkoutSessionDetail, getRecentSessionsOfType, listProgressionStyles,
  listRecentPersonalRecords, upsertAiHealthInsight, getAiHealthInsightWithHash,
})
vi.mock('@/lib/data', () => ({
  getRepository: async () => repo(),
  getRepositoryAsync: async () => repo(),
}))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: (...a: unknown[]) => loggedGenerateText(...a),
}))
// Refuses everything: if the route still consulted a limiter, every request below would be a 429.
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET } from '@/app/api/workout-sessions/[id]/recap/route'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const START = new Date('2026-09-10T02:00:00Z')

const sessionDetail = () => ({
  id: SESSION_ID,
  sessionId: 'prog-session-1',
  startedAt: START,
  completedAt: new Date(START.getTime() + 45 * 60_000),
  exercises: [
    { volume: 8200, styleId: null, sets: [{ setNumber: 1, weightKg: 100, reps: 5, rpe: 7, restTimeSec: null }] },
  ],
})

const get = (id = SESSION_ID) =>
  GET(new Request(`http://localhost/api/workout-sessions/${id}/recap`) as never,
      { params: Promise.resolve({ id }) })

beforeEach(() => {
  for (const m of [getWorkoutSessionDetail, getRecentSessionsOfType, listProgressionStyles,
                   listRecentPersonalRecords, upsertAiHealthInsight, getAiHealthInsightWithHash,
                   generateText, loggedGenerateText, rateLimit, reportServerError]) m.mockClear()
  getRecentSessionsOfType.mockResolvedValue([])
  listProgressionStyles.mockResolvedValue([])
  listRecentPersonalRecords.mockResolvedValue([])
  getWorkoutSessionDetail.mockResolvedValue(sessionDetail())
  userId = 'u-1'
})

describe('the recap is written from the facts', () => {
  it('returns the text recapText gives for this session, in the same shape as before', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ recap: 'You trained for 45 min and moved 8,200 kg in total.' })
  })

  it('passes the route\'s own facts through: records and the usual duration reach the text', async () => {
    listRecentPersonalRecords.mockResolvedValue([{ id: 'pr-1' }, { id: 'pr-2' }])
    // Three earlier sessions of this type at 30 min, so 45 min is 50% over the usual.
    getRecentSessionsOfType.mockResolvedValue([1, 2, 3].map(i => ({
      id: `other-${i}`,
      startedAt: new Date(START.getTime() - i * 7 * 86_400_000),
      completedAt: new Date(START.getTime() - i * 7 * 86_400_000 + 30 * 60_000),
    })))
    const { recap } = await (await get()).json() as { recap: string }
    expect(recap).toBe(recapText({
      durationMin: 45, durationVsMedianPct: 50, totalVolumeKg: 8200, prCount: 2,
      rpeDrift: null, restAdherencePct: null, sessionRpe: null,
    }))
    expect(recap).toContain('You set 2 new personal records')
    expect(recap).toContain('50% longer than your usual')
  })

  it('answers the same on every call', async () => {
    const first = await (await get()).json()
    const second = await (await get()).json()
    expect(second).toEqual(first)
  })

  it('never carries the degraded flag — there is nothing left to degrade from', async () => {
    expect(await (await get()).json()).not.toHaveProperty('degraded')
  })

  it('tells the client not to store it in the HTTP cache', async () => {
    expect((await get()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('nothing on this route reaches a model', () => {
  it('calls no model function, reads and writes no stored insight, and consults no rate limit', async () => {
    // More requests than the old 20-an-hour limit allowed.
    for (let i = 0; i < 25; i++) expect((await get()).status).toBe(200)
    expect(generateText).not.toHaveBeenCalled()
    expect(loggedGenerateText).not.toHaveBeenCalled()
    expect(getAiHealthInsightWithHash).not.toHaveBeenCalled()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
  })
})

describe('auth and ownership are unchanged', () => {
  it('refuses without a session, before any read', async () => {
    userId = null
    const res = await get()
    expect(res.status).toBe(401)
    expect(getWorkoutSessionDetail).not.toHaveBeenCalled()
  })

  it('looks the session up under the signed-in user, and a session that is not theirs is 404', async () => {
    getWorkoutSessionDetail.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    expect(getWorkoutSessionDetail).toHaveBeenCalledWith('u-1', SESSION_ID)
  })

  it('a malformed id never reaches the repo', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
    expect(getWorkoutSessionDetail).not.toHaveBeenCalled()
  })

  it('a repo error answers 500, with no recap', async () => {
    getWorkoutSessionDetail.mockRejectedValue(new Error('22P02 invalid input syntax for type uuid'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal error' })
    expect(reportServerError).toHaveBeenCalled()
  })
})
