/**
 * RV-69 — the health insight answers with the readings when the model cannot interpret them.
 *
 * This route is the one that already proved the pattern is acceptable: when nothing at all was
 * measured it returns a hand-written deterministic sentence rather than paying for a model call
 * whose only honest output is "there are no readings". The failure path had the mirror problem —
 * readings in hand, `splitMeasured` already run, and a 502 returned.
 *
 * `dataLines`, not the prompt: the prompt also carries the guards and the absent-metric notes, and
 * only the measured lines are facts about the section.
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

describe('a failed model call degrades to the readings (RV-69)', () => {
  it('answers 200 with them rather than 502', async () => {
    generateText.mockRejectedValue(new Error('provider exploded'))
    const res = await post()
    expect(res.status).toBe(200)
    const json = await res.json() as { insight: string; degraded: boolean }
    expect(json.degraded).toBe(true)
    expect(json.insight).toContain('Resting heart rate: 48 bpm')
    expect(json.insight).toContain('71 ms')
  })

  it('does not persist the fallback', async () => {
    generateText.mockRejectedValue(new Error('provider exploded'))
    await post()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  /** Guard text and absent-metric notes are instructions to the model, not readings. */
  it('carries no prompt scaffolding into the answer', async () => {
    generateText.mockRejectedValue(new Error('provider exploded'))
    const json = await post().then(r => r.json()) as { insight: string }
    expect(json.insight).not.toMatch(/never invent|metric units|superlative/i)
  })

  it('still returns and stores the model\'s insight on the happy path', async () => {
    const json = await post().then(r => r.json()) as { insight: string; degraded?: boolean }
    expect(json.insight).toBe('a measured reading')
    expect(json.degraded).toBeUndefined()
    expect(upsertAiHealthInsight).toHaveBeenCalled()
  })

  /**
   * Nothing measured is not a failure, and it must not become one: the route answers its own
   * deterministic sentence without ever calling the model, so the degrade path is unreachable.
   */
  it('leaves the no-readings path alone', async () => {
    listBodyMetrics.mockResolvedValue([])
    const json = await post().then(r => r.json()) as { insight: string; degraded?: boolean }
    expect(json.insight).toMatch(/no heart rate readings were recorded/i)
    expect(json.degraded).toBeUndefined()
    expect(generateText).not.toHaveBeenCalled()
  })
})
