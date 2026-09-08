/**
 * PS-39 — two AI prose routes, both believed tested and neither actually was (#956).
 *
 * They share the property worth pinning: **the model is never load-bearing, and its failure must not
 * leak.** Each has a live incident behind that:
 *
 *   · `session-explain/insight` once returned `errorLog`'s output as the response body — which is
 *     `[ERROR]: ${error}` — so a driver error published **the whole failing statement, every column
 *     of `workout_sessions`, to the client** (Q-483). Reached by a malformed id (22P02).
 *   · `running-plan/explain` must answer 200 with the deterministic rationale when the model throws.
 *     The AI only rephrases a rationale the app already computed; a 500 there would blank a card
 *     that had the answer in hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getNextSession = vi.fn(async (_userId: string, _tz: string) => ({}) as Record<string, unknown>)
const upsertAiHealthInsight = vi.fn(async () => undefined)
const readFreshInsight = vi.fn(async (_repo: unknown, _u: string, _s: string, _d: string, _h: string) => null as string | null)
const loggedStreamText = vi.fn((_meta: unknown, _opts: unknown) => ({ textStream: (async function* () { yield 'why' })() }))
const generateText = vi.fn(async (_opts: unknown) => ({ text: '  a warm sentence  ' }))
const reportServerError = vi.fn()

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getNextSession, upsertAiHealthInsight }),
  getRepositoryAsync: async () => ({ getNextSession, upsertAiHealthInsight }),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedStreamText: (m: unknown, o: unknown) => loggedStreamText(m, o),
  loggedGenerateText: async (_m: unknown, run: () => Promise<{ text: string }>) => run(),
}))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/ai/stream', () => ({
  textStreamResponse: (stream: AsyncIterable<string>) =>
    new Response(new ReadableStream({
      async start(c) { for await (const s of stream) c.enqueue(new TextEncoder().encode(s)); c.close() },
    }), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
}))
vi.mock('@/lib/ai/insight-cache', () => ({
  // Content-derived, not length-derived. A length stub cannot tell a readiness of 80 from 42 —
  // same number of characters — so the "a moved signal changes the key" case could never fail.
  hashInsightContext: (p: string) => {
    let h = 5381
    for (let i = 0; i < p.length; i++) h = ((h * 33) ^ p.charCodeAt(i)) >>> 0
    return `h:${h.toString(16)}`
  },
  readFreshInsight: (r: unknown, u: string, s: string, d: string, h: string) => readFreshInsight(r, u, s, d, h),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET as sessionExplain } from '@/app/api/session-explain/insight/route'
import { POST as runningExplain } from '@/app/api/running-plan/explain/route'

const recommendation = () => ({
  session: { id: 's1', name: 'Upper' },
  signals: { ouraReadiness: 80, sleepTrend: 0.1, hrvTrend: null, energyLevel: 4, soreMuscles: [] },
  weightedComponents: {
    recovery: { score: 70, weight: 0.5 }, balance: { score: 60, weight: 0.3 }, freshness: { score: 80, weight: 0.2 },
  },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: false,
})

/** A fresh user per case — both routes rate-limit per user and cases would throttle each other. */
let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }

const explainPost = (body: unknown) =>
  runningExplain(new Request('http://localhost/api/running-plan/explain', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

const validBody = { type: 'easy', durationMin: 30, rationale: 'Your legs are fresh.', gateReasons: [] }

beforeEach(() => {
  for (const m of [getNextSession, upsertAiHealthInsight, readFreshInsight, loggedStreamText, generateText, reportServerError]) m.mockClear()
  getNextSession.mockResolvedValue(recommendation())
  readFreshInsight.mockResolvedValue(null)
  loggedStreamText.mockImplementation(() => ({ textStream: (async function* () { yield 'why' })() }))
  generateText.mockResolvedValue({ text: '  a warm sentence  ' })
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

  it('serves a fresh cached narrative without calling the model', async () => {
    readFreshInsight.mockResolvedValue('cached because the signals have not moved')
    const res = await sessionExplain()
    expect(await res.text()).toBe('cached because the signals have not moved')
    expect(loggedStreamText).not.toHaveBeenCalled()
  })

  it('recomputes the recommendation rather than trusting a sessionId param (Q-293)', async () => {
    // The fast path that read the cached narrative from `sessionId` alone could not know whether
    // the signals it describes still hold — and signals moving during the day is this route's whole
    // subject. `getNextSession` builds the context, so the cache hash depends on it.
    await sessionExplain()
    expect(getNextSession).toHaveBeenCalledWith(expect.any(String), 'Australia/Brisbane')
    const hash = readFreshInsight.mock.calls[0][4]

    // A moved signal must produce a different hash, or a stale narrative would be served as fresh.
    readFreshInsight.mockClear()
    getNextSession.mockResolvedValue({ ...recommendation(), signals: { ...recommendation().signals, ouraReadiness: 42 } })
    await sessionExplain()
    expect(readFreshInsight.mock.calls[0][4]).not.toBe(hash)
  })
})

describe('POST /api/running-plan/explain', () => {
  it('falls back to the deterministic rationale when the model throws, at 200', async () => {
    // The AI only rephrases a rationale the app already computed. A 500 here would blank a card
    // that has the answer in hand.
    generateText.mockRejectedValue(new Error('model exploded'))
    const res = await explainPost(validBody)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Your legs are fresh.', degraded: true })
  })

  it('returns the model sentence, trimmed, when it works', async () => {
    expect(await (await explainPost(validBody)).json()).toEqual({ message: 'a warm sentence' })
  })

  it('caps what it will join into a prompt (F6), and rejects an unknown key', async () => {
    // These strings go straight into the prompt; without caps a replayed client ships a megabyte.
    expect((await explainPost({ ...validBody, rationale: 'x'.repeat(501) })).status).toBe(400)
    expect((await explainPost({ ...validBody, gateReasons: Array(13).fill('r') })).status).toBe(400)
    expect((await explainPost({ ...validBody, surprise: 1 })).status).toBe(400)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('refuses without a session, before reading the body', async () => {
    sessionUser = null
    expect((await explainPost(validBody)).status).toBe(401)
    expect(generateText).not.toHaveBeenCalled()
  })
})
