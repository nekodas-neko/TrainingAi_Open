/**
 * PS-39 — `session-explain/insight`, once believed tested and not (#956), and since #3286 a route
 * with no model: the "Why this session" text is built from the scorer's figures.
 *
 *   · It once returned `errorLog`'s output as the response body — which is `[ERROR]: ${error}` — so
 *     a driver error published **the whole failing statement, every column of `workout_sessions`,
 *     to the client** (Q-483). Reached by a malformed id (22P02).
 *   · `running-plan/explain` was the second case; **RV-200 deleted that route**.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getNextSession = vi.fn(async (_userId: string, _tz: string) => ({}) as Record<string, unknown>)
const loggedStreamText = vi.fn((_meta: unknown, _opts: unknown) => ({ textStream: (async function* () { yield 'why' })() }))
const generateText = vi.fn(async (_opts: unknown) => ({ text: 'must not be used' }))
const reportServerError = vi.fn()

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getNextSession }),
  getRepositoryAsync: async () => ({ getNextSession }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedStreamText: (m: unknown, o: unknown) => loggedStreamText(m, o),
  loggedGenerateText: async (_m: unknown, run: () => Promise<{ text: string }>) => run(),
}))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET as sessionExplain } from '@/app/api/session-explain/insight/route'

const recommendation = () => ({
  session: { id: 's1', name: 'Upper' },
  signals: { ouraReadiness: 80, sleepTrend: 0.1, hrvTrend: null, energyLevel: 4, soreMuscles: [] },
  weightedComponents: {
    recovery: { score: 70, weight: 0.5 }, balance: { score: 60, weight: 0.3 }, freshness: { score: 80, weight: 0.2 },
  },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: false,
})

/** A fresh user per case — the route rate-limits per user and cases would throttle each other. */
let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }


beforeEach(() => {
  for (const m of [getNextSession, loggedStreamText, generateText, reportServerError]) m.mockClear()
  getNextSession.mockResolvedValue(recommendation())
  freshUser()
})

describe('GET /api/session-explain/insight', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await sessionExplain()).status).toBe(401)
  })

  it('NEVER puts the caught error in the response body (Q-483)', async () => {
    // The regression that matters: returning `errorLog`'s output published the whole failing SQL
    // statement — every column of `workout_sessions` — to the client. The detail must stay in the
    // log and in reportServerError, which already have it.
    const secret = 'select "user_id", "started_at" from "workout_sessions" where secret=42'
    getNextSession.mockRejectedValue(new Error(secret))

    const res = await sessionExplain()
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain('workout_sessions')
    expect(body).not.toContain(secret)
    expect(JSON.parse(body)).toEqual({ error: 'Internal error' })
    expect(reportServerError).toHaveBeenCalled()      // banked, not discarded
  })

  it('404s when there is no AI-dynamic recommendation to explain', async () => {
    getNextSession.mockResolvedValue({ session: null, signals: null, weightedComponents: null })
    expect((await sessionExplain()).status).toBe(404)
    expect(loggedStreamText).not.toHaveBeenCalled()
  })

  it('writes the explanation from the scorer\'s figures, as plain text, with no model call', async () => {
    const res = await sessionExplain()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    const text = await res.text()
    expect(text).toContain('Upper was chosen for today')
    expect(text).toContain('muscle recovery at 70%')
    expect(text).toContain('Your readiness is 80')
    expect(loggedStreamText).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('recomputes the recommendation rather than trusting a sessionId param (Q-293)', async () => {
    // Signals move during the day and this route explains why today's session was chosen, so the
    // text follows `getNextSession` on every call. A moved signal must change the text.
    const first = await (await sessionExplain()).text()
    expect(getNextSession).toHaveBeenCalledWith(expect.any(String), 'Australia/Brisbane')

    getNextSession.mockResolvedValue({ ...recommendation(), signals: { ...recommendation().signals, ouraReadiness: 42 } })
    const second = await (await sessionExplain()).text()
    expect(second).not.toBe(first)
    expect(second).toContain('Your readiness is 42')
  })

  it('keeps its rate limit', async () => {
    for (let i = 0; i < 120; i++) expect((await sessionExplain()).status).toBe(200)
    expect((await sessionExplain()).status).toBe(429)
  })
})
