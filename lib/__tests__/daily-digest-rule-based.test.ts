/**
 * #3286 — the daily digest is written from the facts the route assembles, with no model call.
 *
 * It replaces RV-69's degrade-on-failure test: a route with no model has no failure to degrade
 * from. What is pinned here is that the AI client is never touched, that the facts reach the text,
 * and that a day with nothing to say still answers `digest: null`.
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
const generateText = vi.fn(async (_o: unknown) => ({ text: 'must not be used' }))
const aiModel = vi.fn(() => ({}))

let seq = 0
let userId = 'u-0'
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId, timezone: 'Australia/Brisbane' } }) }))
const repo = () => ({
  getDaySessionSummaries, listRecentPersonalRecords, getActiveProgram, listFoodLogs,
  getNutritionTargets, getDayCheckin, getUserGoals, listBodyMetrics, listExerciseLibrary,
  listFoodLogsSummary, listProgramPhases, getWorkoutSessionsFrom, countAllSessionsSinceStart,
})
vi.mock('@/lib/data', () => ({ getRepository: async () => repo(), getRepositoryAsync: async () => repo() }))
vi.mock('ai', () => ({ generateText: (o: unknown) => generateText(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => aiModel(),
  loggedGenerateText: async () => { throw new Error('the digest must not log a model call') },
}))

import { POST } from '@/app/api/daily-digest/route'

const post = () =>
  POST(new Request('http://localhost/api/daily-digest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }) as never)

beforeEach(() => {
  for (const m of [getDaySessionSummaries, listRecentPersonalRecords, listFoodLogs, listBodyMetrics,
                   listExerciseLibrary, listFoodLogsSummary, listProgramPhases, getActiveProgram,
                   getNutritionTargets, getDayCheckin, getUserGoals, getWorkoutSessionsFrom,
                   countAllSessionsSinceStart, generateText, aiModel]) m.mockClear()
  for (const m of [getDaySessionSummaries, listRecentPersonalRecords, listFoodLogs, listBodyMetrics,
                   listExerciseLibrary, listFoodLogsSummary, listProgramPhases,
                   getWorkoutSessionsFrom]) m.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(null)
  getNutritionTargets.mockResolvedValue(null)
  getUserGoals.mockResolvedValue({})
  countAllSessionsSinceStart.mockResolvedValue(new Map())
  // The morning check-in is what gets the route past its "nothing happened today" early return.
  getDayCheckin.mockResolvedValue({ physicalTiredness: 2, soreMuscles: ['quads'] })
  userId = `u-${++seq}` // the route rate-limits 3/min per user
})

const digestOf = async () => (await post().then(r => r.json())) as { digest: string | null; date: string; cached: boolean }

describe('the digest is a template, not a model call (#3286)', () => {
  it('never touches the AI client', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(generateText).not.toHaveBeenCalled()
    expect(aiModel).not.toHaveBeenCalled()
  })

  it('writes a rest day with the morning check-in', async () => {
    const json = await digestOf()
    expect(json.digest).toBe('Today was a rest day, with no training logged. This morning you logged tiredness 2/5 and sore quads.')
    expect(json.cached).toBe(false)
  })

  it('writes the trained session, with its exercise count and volume', async () => {
    getDaySessionSummaries.mockResolvedValue([{ sessionName: 'Upper' }])
    getWorkoutSessionsFrom.mockResolvedValue([{ startedAt: new Date(), exercises: [{ volume: 1200.4 }, { volume: 800 }] }])
    const { digest } = await digestOf()
    expect(digest).toContain('You trained Upper today: 2 exercises, 2,000 kg of volume.')
  })

  it('answers null for a day with nothing recorded', async () => {
    getDayCheckin.mockResolvedValue(null)
    const json = await digestOf()
    expect(json.digest).toBeNull()
  })

  it('treats a check-in with no answered scales as nothing to report', async () => {
    getDayCheckin.mockResolvedValue({ physicalTiredness: null, soreMuscles: [] })
    expect((await digestOf()).digest).toBeNull()
  })

  it('keeps the rate limit', async () => {
    for (let i = 0; i < 20; i++) expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(429)
  })
})
