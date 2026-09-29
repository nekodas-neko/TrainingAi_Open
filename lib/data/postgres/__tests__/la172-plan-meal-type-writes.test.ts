// LA-172 — plan-meal writes store a meal type: an explicit tag, else the window its time falls in,
// else the nearest window. And the one-time backfill applies the same rule to existing meals.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000172a01'
const BACKFILL = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/202609290804_plan_meal_type_from_suggested_time.sql'), 'utf8')

describe.skipIf(!canRun)('LA-172 plan meal types', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const type: Record<string, string> = {}

  const plan = (meals: Record<string, unknown>[]) => ({
    name: 'LA-172 Plan', mealsPerDay: meals.length,
    targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60, activate: false,
    variants: [{
      dayType: 'all' as const, targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      meals: meals.map((m, i) => ({ position: i, name: `Meal ${i}`, targetCalories: 450, targetProteinG: 35, targetCarbsG: 45, targetFatG: 15, ...m })),
    }],
  })

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepository()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'la172@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    // The owner's real shape: gaps at 15-18 and after 21.
    for (const [key, start, end, order] of [['pre', 6, 10, 0], ['post', 10, 12, 1], ['lunch', 12, 15, 2], ['dinner', 18, 21, 3]] as const) {
      type[key] = (await pool.query(`INSERT INTO meal_types (user_id, name, sort_order, time_start_hour, time_end_hour) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [USER, `LA172 ${key}`, order, start, end])).rows[0].id
    }
  })
  beforeEach(async () => { await pool.query(`DELETE FROM meal_plans WHERE user_id = $1`, [USER]) })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM meal_plans WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('stores tag → containing window → nearest window on create', async () => {
    const created = await repo.createMealPlan(USER, plan([
      { suggestedTime: '07:00' }, { suggestedTime: '16:20' }, { suggestedTime: '21:00' },
      { suggestedTime: '07:00', mealTypeId: type.dinner },
    ]) as never)
    expect(created.variants[0].meals.map(m => m.mealTypeId)).toEqual([type.pre, type.lunch, type.dinner, type.dinner])
  })

  it('a new time types an UNTYPED meal, and never overrides a type already stored', async () => {
    const created = await repo.createMealPlan(USER, plan([{ suggestedTime: null }, { suggestedTime: '07:00', mealTypeId: type.dinner }]) as never)
    const [untyped, tagged] = created.variants[0].meals
    expect(untyped.mealTypeId).toBeNull()
    expect((await repo.updateMealPlanMeal(untyped.id, USER, { suggestedTime: '11:40' }))?.mealTypeId).toBe(type.post)
    expect((await repo.updateMealPlanMeal(tagged.id, USER, { suggestedTime: '12:30' }))?.mealTypeId).toBe(type.dinner)
  })

  it('the backfill types existing meals by the same rule, and touches nothing tagged', async () => {
    const created = await repo.createMealPlan(USER, plan([{ suggestedTime: '16:20' }, { suggestedTime: '07:00', mealTypeId: type.dinner }]) as never)
    const [a, tagged] = created.variants[0].meals
    await pool.query(`UPDATE meal_plan_meals SET meal_type_id = NULL WHERE id = $1`, [a.id]) // as written before LA-172
    await pool.query(BACKFILL)
    const typeOf = async (id: string) => (await pool.query(`SELECT meal_type_id FROM meal_plan_meals WHERE id = $1`, [id])).rows[0].meal_type_id
    expect(await typeOf(a.id)).toBe(type.lunch)
    expect(await typeOf(tagged.id)).toBe(type.dinner)
  })
})
