// #3670 ②. `nutrition_targets.calories` is an integer column. A decimal target reached Postgres as
// text ("2150.5"), which it refuses, so every writer answered 500 and Preview's queue re-sent it.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000367002'

describe.skipIf(!canRun)('upsertNutritionTargets with a decimal calorie target (#3670)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 't3670@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM nutrition_targets WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('stores the whole kcal on insert and on update, and keeps decimal macros', async () => {
    const first = await repo.upsertNutritionTargets(USER, { calories: 2150.5, proteinG: 150.5 })
    expect(first.calories).toBe(2150)
    expect(first.proteinG).toBe(150.5)
    const second = await repo.upsertNutritionTargets(USER, { calories: 1999.9 })
    expect(second.calories).toBe(1999)
    const { rows } = await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [USER])
    expect(rows[0].calories).toBe(1999)
  })

  it('the Coach\'s apply stores a decimal it proposed as the whole kcal', async () => {
    await pool.query(`DELETE FROM nutrition_targets WHERE user_id = $1`, [USER])
    const { getDb } = await import('@/lib/data/postgres/client')
    const { nutritionTargetsHandler } = await import('@/lib/coach/domains/goals')
    const accepted = [{ id: 'c1', field: 'calories', from: null, to: 2150.5 }] as never
    const out = await nutritionTargetsHandler.apply(
      getDb() as never, USER, { domain: 'nutrition_targets', targetId: null, changes: accepted } as never, accepted)
    expect(out.ok).toBe(true)
    const { rows } = await pool.query(`SELECT calories FROM nutrition_targets WHERE user_id = $1`, [USER])
    expect(rows[0].calories).toBe(2150)
  })
})
