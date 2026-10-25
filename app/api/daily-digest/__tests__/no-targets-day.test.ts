import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

// #3304 made a day with food logged but no `nutrition_targets` row return `digest: null`, so the
// End of Day card showed nothing for anyone without targets (#3326). That day now gets the
// eaten-so-far line, without a budget or a protein target.

const USER_ID = '00000000-0000-4000-8000-000000003326'
const TODAY = todayInTz('Australia/Brisbane')

let targets: { calories: number; proteinG: number; carbsG: number; fatG: number } | null = null
let foodLogs: unknown[] = []

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/health/energy-balance-service', () => ({
  computeEnergyBalance: async () => ({ balance: { budgetKcal: 2400 } }),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getDaySessionSummaries: async () => [],
    listRecentPersonalRecords: async () => [],
    getActiveProgram: async () => null,
    listFoodLogs: async () => foodLogs,
    getNutritionTargets: async () => targets,
    getDayCheckin: async () => null,
    getUserGoals: async () => ({ stepsGoal: null, stepsGoalType: 'daily' }),
    listBodyMetrics: async () => [],
    listExerciseLibrary: async () => [],
    listFoodLogsSummary: async () => Array.from({ length: 12 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}` })),
  }),
}))

const digestOf = async () => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
  expect(res.status).toBe(200)
  return (await res.json() as { digest: string | null }).digest
}

describe('daily digest — food logged, no nutrition targets (#3326)', () => {
  beforeEach(() => {
    vi.resetModules()
    foodLogs = [
      { id: '1', date: TODAY, calories: 1200, proteinG: 60, carbsG: 100, fatG: 40 },
      { id: '2', date: TODAY, calories: 600, proteinG: 30, carbsG: 50, fatG: 20 },
    ]
  })

  it('still says what was eaten, with no budget or protein target', async () => {
    targets = null
    expect(await digestOf()).toBe(
      'Today was a rest day, with no training logged. You have eaten 1,800 kcal and 90 g protein.',
    )
  })

  it('leaves a day with targets as it was', async () => {
    targets = { calories: 2200, proteinG: 150, carbsG: 250, fatG: 70 }
    const digest = await digestOf()
    expect(digest).toContain('You have eaten 1,800 of your 2,400 kcal budget and 90 g of 150 g protein.')
  })

  it('stays null with neither food nor anything else logged', async () => {
    targets = null
    foodLogs = []
    expect(await digestOf()).toBeNull()
  })
})
