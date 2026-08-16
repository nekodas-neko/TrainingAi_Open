// Q-187 phase 2 — the number the whole design protects.
//
// A prefilled meal is *suggested*, not eaten. The plan's verification bar states it directly: a day
// with prefills showing and none answered must report **identical** totals to the same day with the
// plan switched off. That property is why unconfirmed prefills never enter `food_logs` at all,
// instead of getting a `confirmed_at` column and a filter at each of its 23 readers.
//
// So this asserts on the day's food and macros, not on row counts in the new table — a row-count
// test would pass just as happily if declining had quietly written a zero-calorie food log.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000018703'
const DATE = '2026-08-15'

describe.skipIf(!canRun)('declining a planned meal cannot move the day (Q-187)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let mealIds: string[] = []

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `pma-totals-${TEST_USER_ID}@example.com`])
    const plan = await repo.createMealPlan(TEST_USER_ID, {
      name: 'Totals', mealsPerDay: 2,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      activate: true,
      variants: [{
        dayType: 'all', targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
        meals: [
          { position: 0, name: 'Breakfast', targetCalories: 900, targetProteinG: 75, targetCarbsG: 90, targetFatG: 30 },
          { position: 1, name: 'Dinner', targetCalories: 900, targetProteinG: 75, targetCarbsG: 90, targetFatG: 30 },
        ],
      }],
    })
    mealIds = plan.variants[0].meals.map(m => m.id)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_plans WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM plan_meal_answers WHERE user_id = $1', [TEST_USER_ID])
  })

  const dayFood = async () => repo.listFoodLogs(TEST_USER_ID, DATE)

  it('an unanswered day has no food, so no totals to distort', async () => {
    expect(await dayFood()).toHaveLength(0)
  })

  // The load-bearing case. Declining every meal must leave the day exactly as the plan-off day.
  it('declining every planned meal writes no food at all', async () => {
    for (const id of mealIds) {
      const saved = await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: id, logDate: DATE })
      expect(saved).not.toBeNull()
    }
    expect(await repo.listPlanMealAnswers(TEST_USER_ID, DATE)).toHaveLength(2)
    // The answers exist; the day does not know about them.
    expect(await dayFood()).toHaveLength(0)
  })

  it('undoing a decline still writes no food', async () => {
    await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: mealIds[0], logDate: DATE })
    await repo.deletePlanMealAnswer(TEST_USER_ID, mealIds[0], DATE)
    expect(await dayFood()).toHaveLength(0)
  })

  // `food_logs` is read in 23 files. The reason none of them changed is that there is nothing in the
  // table to filter — this pins that, so a future "just add a status column" refactor fails here.
  it('the answers table is not reachable from the day food read', async () => {
    for (const id of mealIds) {
      await repo.savePlanMealAnswer(TEST_USER_ID, { planMealId: id, logDate: DATE })
    }
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM food_logs WHERE user_id = $1 AND date = $2', [TEST_USER_ID, DATE])
    expect(rows[0].n).toBe(0)
  })
})
