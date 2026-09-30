// BF-203a Task 5. Storing an estimate: idempotent, never over a decline, and a decline made over an
// estimate becomes a clean decline rather than an estimate the user said they did not eat.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = randomUUID()
const DAY = '2026-09-26'

describe.skipIf(!canRun)('estimated plan-meal answers (BF-203a)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let mealId: string
  const est = (calories = 480) => [{ planMealId: mealId, calories, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 80 }]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `bf203a-est-${TEST_USER_ID}@example.com`])
    const plan = await repo.createMealPlan(TEST_USER_ID, {
      name: 'Estimates', mealsPerDay: 1,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      activate: true,
      variants: [{
        dayType: 'all', targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
        meals: [{ position: 0, name: 'Lunch', targetCalories: 400, targetProteinG: 30, targetCarbsG: 40, targetFatG: 10 }],
      }],
    })
    mealId = plan.variants[0].meals[0].id
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_plans WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  it('writes an estimate carrying its macros and basis', async () => {
    expect(await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(), 'planA')).toBe(1)
    const [row] = await repo.listPlanMealAnswers(TEST_USER_ID, DAY)
    expect(row).toMatchObject({ answer: 'estimated', estCalories: 480, estBiasKcal: 80, estBasis: 'planA' })
  })

  it('is idempotent, and does not re-derive an estimate already written', async () => {
    await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(480), 'planA')
    expect(await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(999), 'planA')).toBe(0)
    const rows = await repo.listPlanMealAnswers(TEST_USER_ID, DAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].estCalories).toBe(480)
  })

  it('never overwrites a decline with an estimate', async () => {
    await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: mealId, logDate: DAY })
    expect(await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(), 'planA')).toBe(0)
    const [row] = await repo.listPlanMealAnswers(TEST_USER_ID, DAY)
    expect(row).toMatchObject({ answer: 'no', estCalories: null })
  })

  // The hole the plan did not see: the decline's revive path set only deleted_at, so declining a
  // meal the app had estimated left it an estimate that still counted.
  it('turns an estimate into a clean decline when the user declines the meal', async () => {
    await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(), 'planA')
    const saved = await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: mealId, logDate: DAY })
    expect(saved).toMatchObject({ answer: 'no', estCalories: null, estBasis: null })
    const rows = await repo.listPlanMealAnswers(TEST_USER_ID, DAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ answer: 'no', estCalories: null, estProteinG: null, estBiasKcal: null })
  })

  it('estimates a slot whose decline was undone', async () => {
    await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: mealId, logDate: DAY })
    await repo.deletePlanMealAnswer(TEST_USER_ID, mealId, DAY)
    expect(await repo.upsertEstimatedAnswers(TEST_USER_ID, DAY, est(), 'planA')).toBe(1)
    const rows = await repo.listPlanMealAnswers(TEST_USER_ID, DAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].answer).toBe('estimated')
  })
})
