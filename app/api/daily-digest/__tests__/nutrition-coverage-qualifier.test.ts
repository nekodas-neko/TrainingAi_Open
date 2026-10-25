import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

// Q-303: the digest was giving corrective nutrition advice ("focus on bumping that protein")
// off a single logged day drawn from a mostly-unlogged fortnight. Since #3286 the digest is a
// template with no model, so these read the text the route returns: the sparse-coverage sentence
// is (or is not) there, and no advice is.

const USER_ID = '00000000-0000-4000-8000-000000000420'
const TODAY = todayInTz('Australia/Brisbane')

let foodLogsSummaryWindow: { from: string; to: string } | null = null

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

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
    listAiHealthInsightsForDate: async () => [],
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

const digestOf = async () => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
  expect(res.status).toBe(200)
  return (await res.json() as { digest: string }).digest
}

describe('daily digest — nutrition coverage qualifier (Q-303)', () => {
  beforeEach(() => {
    foodLogsSummaryWindow = null
    vi.resetModules()
  })

  it('states sparse coverage and gives no corrective advice', async () => {
    loggedDaysInWindow = 4
    const digest = await digestOf()
    expect(digest).toContain('Only 4 of the last 14 days have food logged')
    expect(digest).not.toMatch(/should|try to|aim|eat more|eat less/i)
    // The window queried is a 14-day trailing window ending today, not some other span.
    expect(foodLogsSummaryWindow?.to).toBe(TODAY)
  })

  it('says nothing about coverage when logging is not sparse', async () => {
    loggedDaysInWindow = 12
    const digest = await digestOf()
    expect(digest).toContain('You have eaten')
    expect(digest).not.toContain('days have food logged')
  })

  it('still reports today\'s real numbers alongside the sparse-coverage sentence', async () => {
    loggedDaysInWindow = 2
    const digest = await digestOf()
    // #2071: the denominator is the day's budget, never the typed goal (2,200 here). This fixture has
    // no weight on file, so there is no budget and the digest says so rather than quoting the goal.
    expect(digest).toContain('You have eaten 1,800 kcal and 90 g of 150 g protein.')
    expect(digest).not.toContain('2,200')
  })
})
