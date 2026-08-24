import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

// Q-303: the digest was giving corrective nutrition advice ("focus on bumping that protein")
// off a single logged day drawn from a mostly-unlogged fortnight. These tests capture the actual
// prompt sent to the model and assert the sparse-coverage line and instruction are (or are not)
// present, rather than testing the pure date math in isolation — the bug was in what reaches the
// model, and a unit test on a helper function cannot see that.

const USER_ID = '00000000-0000-4000-8000-000000000420'
const TODAY = todayInTz('Australia/Brisbane')

let captured = ''
let foodLogsSummaryWindow: { from: string; to: string } | null = null

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('ai', () => ({
  generateText: vi.fn(async (args: { prompt: string }) => {
    captured = args.prompt
    return { text: 'stub digest' }
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_meta: unknown, run: () => Promise<{ text: string }>) => run(),
}))

let loggedDaysInWindow = 0

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getDaySessionSummaries: async () => [],
    listRecentPersonalRecords: async () => [],
    getActiveProgram: async () => null,
    listFoodLogs: async () => [
      { calories: 1800, proteinG: 90, carbsG: 200, fatG: 60, foodItemId: 'x', id: '1', date: TODAY },
    ],
    getNutritionTargets: async () => ({ calories: 2200, proteinG: 150, carbsG: 250, fatG: 70 }),
    getDayCheckin: async () => null,
    getUserGoals: async () => ({ stepsGoal: null, stepsGoalType: 'daily' }),
    listBodyMetrics: async () => [],
    listExerciseLibrary: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getAiHealthInsightWithHash: async () => null,
    upsertAiHealthInsight: async () => {},
    listFoodLogsSummary: async (_userId: string, from: string, to: string) => {
      foodLogsSummaryWindow = { from, to }
      return Array.from({ length: loggedDaysInWindow }, (_, i) => ({
        date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        calories: 1800, proteinG: 90, carbsG: 200, fatG: 60,
      }))
    },
  }),
}))

describe('daily digest — nutrition coverage qualifier (Q-303)', () => {
  beforeEach(() => {
    captured = ''
    foodLogsSummaryWindow = null
    vi.resetModules()
  })

  it('flags sparse coverage and instructs the model not to give corrective nutrition advice', async () => {
    loggedDaysInWindow = 4
    const { POST } = await import('../route')
    const res = await POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(captured).toBeTruthy()
    expect(captured).toContain('Nutrition logging coverage: 4 of 14 days logged in the last two weeks (sparse)')
    expect(captured).toMatch(/do not give corrective advice/)
    // The window queried is a 14-day trailing window ending today, not some other span.
    expect(foodLogsSummaryWindow?.to).toBe(TODAY)
  })

  it('says nothing about coverage when logging is not sparse', async () => {
    loggedDaysInWindow = 12
    const { POST } = await import('../route')
    const res = await POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(captured).toBeTruthy()
    expect(captured).not.toContain('Nutrition logging coverage')
    expect(captured).not.toContain('(sparse)')
  })

  it('still reports today\'s real numbers alongside the sparse-coverage flag', async () => {
    loggedDaysInWindow = 2
    const { POST } = await import('../route')
    await POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
    expect(captured).toContain('Nutrition today: 1800/2200 kcal, 90g/150g protein')
  })
})
