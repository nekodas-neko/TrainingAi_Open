// BF-203a. `plan_meal_answers` gains an `estimated` state that must carry its calories, while a
// decline must carry none. These are the constraints the estimator (later tasks) relies on, so they
// are pinned against a real database rather than assumed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = randomUUID()

describe.skipIf(!canRun)('plan_meal_answers estimated state (BF-203a)', () => {
  let pool: import('pg').Pool
  let mealId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    const repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `bf203a-${TEST_USER_ID}@example.com`])
    const plan = await repo.createMealPlan(TEST_USER_ID, {
      name: 'Estimates', mealsPerDay: 1,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      activate: true,
      variants: [{
        dayType: 'all', targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
        meals: [{ position: 0, name: 'Lunch', targetCalories: 620, targetProteinG: 45, targetCarbsG: 60, targetFatG: 20 }],
      }],
    })
    mealId = plan.variants[0].meals[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_plans WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  const insert = (answer: string, estCalories: number | null, date: string) =>
    pool.query(
      `INSERT INTO plan_meal_answers (user_id, plan_meal_id, log_date, answer, est_calories, est_protein_g)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [TEST_USER_ID, mealId, date, answer, estCalories, estCalories == null ? null : 45],
    )

  it('stores an estimate that carries its calories', async () => {
    await expect(insert('estimated', 620, '2026-09-01')).resolves.toBeTruthy()
  })

  it('refuses an estimate with no calories', async () => {
    await expect(insert('estimated', null, '2026-09-02')).rejects.toThrow(/plan_meal_answers_estimate_shape/)
  })

  it('refuses a decline that carries calories', async () => {
    await expect(insert('no', 400, '2026-09-03')).rejects.toThrow(/plan_meal_answers_estimate_shape/)
  })

  it('still stores a plain decline, and still refuses a stored yes', async () => {
    await expect(insert('no', null, '2026-09-04')).resolves.toBeTruthy()
    await expect(insert('yes', null, '2026-09-05')).rejects.toThrow(/plan_meal_answers_answer_check/)
  })
})
