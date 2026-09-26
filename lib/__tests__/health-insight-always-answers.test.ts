/**
 * RV-69 asked that this route answer with the readings when the model could not interpret them —
 * 200 with the facts in hand rather than a 502 — and that it not persist that fallback.
 *
 * RV-201 removed the model, so that guarantee now holds UNCONDITIONALLY rather than on a failure
 * path: there is no call to fail, no 502 to return, and nothing written. These tests assert the
 * stronger form. The file was `health-insight-degrade.test.ts` while there was something to
 * degrade from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const empty = () => vi.fn(async (..._a: unknown[]) => [] as unknown[])
const getOuraDaily = empty()
const listSleepSessions = empty()
const listBodyMetrics = empty()
const getOuraDailyDerived = empty()
const getOuraDailySummary = empty()
const getWorkoutSessionsFrom = empty()
const getUserById = vi.fn(async (_u: string) => ({ dob: null }) as unknown)
const upsertAiHealthInsight = vi.fn(async () => undefined)
const readFreshInsight = vi.fn(async (..._a: unknown[]) => null as string | null)
const generateText = vi.fn(async (_o: unknown) => ({ text: '  a measured reading  ' }))

let seq = 0
let userId = 'u-0'
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId, timezone: 'Australia/Brisbane' } }) }))
const repo = () => ({
  getOuraDaily, listSleepSessions, listBodyMetrics, getOuraDailyDerived, getOuraDailySummary,
  getWorkoutSessionsFrom, getUserById, upsertAiHealthInsight,
})
vi.mock('@/lib/data', () => ({ getRepository: async () => repo(), getRepositoryAsync: async () => repo() }))
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

import { POST } from '@/app/api/ai/health-insight/route'

const DATE = '2026-09-10'
const post = () =>
  POST(new Request('http://localhost/api/ai/health-insight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'heart-rate', date: DATE }),
  }) as never)

beforeEach(() => {
  for (const m of [getOuraDaily, listSleepSessions, listBodyMetrics, getOuraDailyDerived,
                   getOuraDailySummary, getWorkoutSessionsFrom, getUserById, upsertAiHealthInsight,
                   readFreshInsight, generateText]) m.mockClear()
  for (const m of [getOuraDaily, listSleepSessions, getOuraDailyDerived, getOuraDailySummary,
                   getWorkoutSessionsFrom]) m.mockResolvedValue([])
  listBodyMetrics.mockResolvedValue([{ date: DATE, restingHeartRate: 48, hrvMs: 71 }])
  getUserById.mockResolvedValue({ dob: null })
  readFreshInsight.mockResolvedValue(null)
  generateText.mockResolvedValue({ text: '  a measured reading  ' })
  userId = `u-${++seq}` // the route rate-limits 10/hour per user
})

describe('the route always answers with the readings (RV-69, unconditional since RV-201)', () => {
  it('answers 200 with them, and there is no longer a path that does not', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const json = await res.json() as { insight: string; degraded?: boolean }
    expect(json.insight).toContain('48 bpm')
    expect(json.insight).toContain('71 ms')
    // `degraded` marked an answer assembled because the model failed. Nothing is degraded now.
    expect(json.degraded).toBeUndefined()
  })

  it('never calls a model', async () => {
    await post()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('persists nothing — the answer is recomputed, not stored', async () => {
    await post()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  /** Guard text and absent-metric notes were instructions to a model, never readings. */
  it('carries no prompt scaffolding into the answer', async () => {
    const json = await post().then(r => r.json()) as { insight: string }
    expect(json.insight).not.toMatch(/never invent|metric units|superlative/i)
  })

  /** Nothing measured is not a failure, and it must not become one. */
  it('leaves the no-readings path alone', async () => {
    listBodyMetrics.mockResolvedValue([])
    const json = await post().then(r => r.json()) as { insight: string; degraded?: boolean }
    expect(json.insight).toMatch(/no heart rate readings were recorded/i)
    expect(json.degraded).toBeUndefined()
    expect(generateText).not.toHaveBeenCalled()
  })
})
