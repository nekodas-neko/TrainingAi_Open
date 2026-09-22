/**
 * RV-69 — the daily digest answers with the day when the model cannot describe it.
 *
 * Every line the model is given is assembled by this route before the call, from the user's own
 * logs. Returning 502 threw all of it away and left the card showing an amber "could not be
 * written" line, with the day's figures sitting in scope one statement above.
 *
 * This file also pins the one restructure the change required. `readSameDayInsights` returns
 * EARLIER AI PROSE for the same day, and it used to be pushed onto the same `lines` array as the
 * facts — so degrading from that array would re-serve a model's sentences as though they were
 * recorded figures. The facts are captured before it, and the prompt still carries both, in the
 * same order, because the hash it feeds must not move (Q-291).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const empty = () => vi.fn(async (..._a: unknown[]) => [] as unknown[])
const getDaySessionSummaries = empty()
const listRecentPersonalRecords = empty()
const listFoodLogs = empty()
const listBodyMetrics = empty()
const listExerciseLibrary = empty()
const listFoodLogsSummary = empty()
const listProgramPhases = empty()
const getActiveProgram = vi.fn(async (_u: string) => null as unknown)
const getNutritionTargets = vi.fn(async (_u: string) => null as unknown)
const getDayCheckin = vi.fn(async (..._a: unknown[]) => null as unknown)
const getUserGoals = vi.fn(async (_u: string) => ({}) as Record<string, unknown>)
const getWorkoutSessionsFrom = empty()
const countAllSessionsSinceStart = vi.fn(async (..._a: unknown[]) => new Map())
const upsertAiHealthInsight = vi.fn(async () => undefined)
const readFreshInsight = vi.fn(async (..._a: unknown[]) => null as string | null)
const readSameDayInsights = vi.fn(async (..._a: unknown[]) => null as string | null)
const generateText = vi.fn(async (_o: unknown) => ({ text: '  a warm reflection  ' }))

let seq = 0
let userId = 'u-0'
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId, timezone: 'Australia/Brisbane' } }) }))
const repo = () => ({
  getDaySessionSummaries, listRecentPersonalRecords, getActiveProgram, listFoodLogs,
  getNutritionTargets, getDayCheckin, getUserGoals, listBodyMetrics, listExerciseLibrary,
  listFoodLogsSummary, listProgramPhases, getWorkoutSessionsFrom, countAllSessionsSinceStart,
  upsertAiHealthInsight,
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
vi.mock('@/lib/ai/same-day-context', () => ({
  SAME_DAY_GUIDANCE: 'same-day guidance',
  readSameDayInsights: (...a: unknown[]) => readSameDayInsights(...a),
}))

import { POST } from '@/app/api/daily-digest/route'

const post = () =>
  POST(new Request('http://localhost/api/daily-digest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }) as never)

const promptOf = () => (generateText.mock.calls[0][0] as { prompt: string }).prompt

beforeEach(() => {
  for (const m of [getDaySessionSummaries, listRecentPersonalRecords, listFoodLogs, listBodyMetrics,
                   listExerciseLibrary, listFoodLogsSummary, listProgramPhases, getActiveProgram,
                   getNutritionTargets, getDayCheckin, getUserGoals, getWorkoutSessionsFrom,
                   countAllSessionsSinceStart, upsertAiHealthInsight, readFreshInsight,
                   readSameDayInsights, generateText]) m.mockClear()
  for (const m of [getDaySessionSummaries, listRecentPersonalRecords, listFoodLogs, listBodyMetrics,
                   listExerciseLibrary, listFoodLogsSummary, listProgramPhases,
                   getWorkoutSessionsFrom]) m.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(null)
  getNutritionTargets.mockResolvedValue(null)
  getUserGoals.mockResolvedValue({})
  countAllSessionsSinceStart.mockResolvedValue(new Map())
  readFreshInsight.mockResolvedValue(null)
  readSameDayInsights.mockResolvedValue(null)
  generateText.mockResolvedValue({ text: '  a warm reflection  ' })
  // The morning check-in is what gets the route past its "nothing happened today" early return.
  getDayCheckin.mockResolvedValue({ physicalTiredness: 2, soreMuscles: ['quads'] })
  userId = `u-${++seq}` // the route rate-limits 3/min per user
})

describe('a failed model call degrades to the day (RV-69)', () => {
  it('answers 200 with the recorded lines rather than 502', async () => {
    generateText.mockRejectedValue(new Error('provider exploded'))
    const res = await post()
    expect(res.status).toBe(200)
    const json = await res.json() as { digest: string; degraded: boolean; date: string }
    expect(json.degraded).toBe(true)
    expect(json.digest).toContain('Rest day: no training logged today')
    expect(json.digest).toContain('This morning: tiredness 2/5, sore: quads')
  })

  it('does not persist the fallback as the day\'s digest', async () => {
    generateText.mockRejectedValue(new Error('provider exploded'))
    await post()
    expect(upsertAiHealthInsight).not.toHaveBeenCalled()
  })

  /**
   * Earlier AI prose is context for the model, never a fact about the day. If it reached the
   * degraded answer, a fallback whose whole purpose is "only what was recorded" would be quoting a
   * model back to the user as a recorded figure.
   */
  it('leaves same-day AI prose out of the degraded answer, though the prompt still carries it', async () => {
    readSameDayInsights.mockResolvedValue('Earlier today the app said your HRV looked strong.')
    generateText.mockRejectedValue(new Error('provider exploded'))
    const json = await post().then(r => r.json()) as { digest: string }
    expect(json.digest).not.toContain('HRV looked strong')
    expect(json.digest).toContain('This morning: tiredness 2/5, sore: quads')
  })
})

describe('the prompt is unchanged by the restructure', () => {
  it('appends the same-day block after the facts, in that order', async () => {
    readSameDayInsights.mockResolvedValue('SAME-DAY-BLOCK')
    await post()
    const prompt = promptOf()
    expect(prompt.indexOf('This morning:')).toBeLessThan(prompt.indexOf('SAME-DAY-BLOCK'))
    expect(prompt).toContain('This morning: tiredness 2/5, sore: quads\nSAME-DAY-BLOCK')
  })

  it('carries no trailing separator when there is no same-day block', async () => {
    await post()
    expect(promptOf()).toContain('This morning: tiredness 2/5, sore: quads')
    expect(promptOf().endsWith('\n')).toBe(false)
  })

  it('still returns and stores the model\'s digest on the happy path', async () => {
    const json = await post().then(r => r.json()) as { digest: string; degraded?: boolean }
    expect(json.digest).toBe('a warm reflection')
    expect(json.degraded).toBeUndefined()
    expect(upsertAiHealthInsight).toHaveBeenCalled()
  })
})
