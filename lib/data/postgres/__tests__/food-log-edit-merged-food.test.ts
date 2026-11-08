// #3670 ①. An edit pushed against a food the look-alike merge retired keeps the keeper, and must
// convert its quantity with the merge's own factor so the grams are what the user typed.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000367001'

describe.skipIf(!canRun)('createFoodLog: an edit against a merged-away food (#3670)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let mealTypeId: string

  const clean = async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
  }
  const food = async (servingSizeG: number, opts: { name?: string; retired?: boolean } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO food_items (user_id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, source, deleted_at)
       VALUES ($1, $2, 'Acme', $3, 100, 10, 10, 1, 'manual', $4) RETURNING id`,
      [USER, opts.name ?? 'Greek Yoghurt', servingSizeG, opts.retired ? new Date() : null])
    return rows[0].id as string
  }
  const stored = async (id: string) => {
    const { rows } = await pool.query(`SELECT food_item_id, quantity_multiplier FROM food_logs WHERE id = $1`, [id])
    return { foodItemId: rows[0].food_item_id as string, quantity: Number(rows[0].quantity_multiplier) }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'f3670@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })
  afterAll(async () => {
    if (!canRun) return
    await clean()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(async () => {
    await clean()
    const { rows } = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Breakfast', 1) RETURNING id`, [USER])
    mealTypeId = rows[0].id
  })

  // The state after the merge: 1 × E (170 g) became 1.7 × K (100 g), and E is tombstoned.
  const mergedLog = async () => {
    const keeper = await food(100)
    const extra = await food(170, { retired: true })
    const id = randomUUID()
    await pool.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, '2026-11-08', $3, $4, 1.7)`, [id, USER, mealTypeId, keeper])
    return { id, keeper, extra }
  }

  it('converts 2 servings of the retired food into the keeper, keeping the grams', async () => {
    const { id, keeper, extra } = await mergedLog()
    await repo.createFoodLog(USER, { id, date: '2026-11-08', mealTypeId, foodItemId: extra, quantityMultiplier: 2 })
    const row = await stored(id)
    expect(row.foodItemId).toBe(keeper)
    expect(row.quantity * 100).toBeCloseTo(340, 6)
  })

  it('leaves an edit against the stored food alone', async () => {
    const { id, keeper } = await mergedLog()
    await repo.createFoodLog(USER, { id, date: '2026-11-08', mealTypeId, foodItemId: keeper, quantityMultiplier: 2 })
    expect(await stored(id)).toEqual({ foodItemId: keeper, quantity: 2 })
  })

  it('does not convert against a food that is not a retired look-alike', async () => {
    const { id, keeper } = await mergedLog()
    const other = await food(170, { name: 'Something Else', retired: true })
    await repo.createFoodLog(USER, { id, date: '2026-11-08', mealTypeId, foodItemId: other, quantityMultiplier: 2 })
    expect(await stored(id)).toEqual({ foodItemId: keeper, quantity: 2 })
  })

  it('takes the client food when the converted quantity is out of range', async () => {
    const keeper = await food(1)
    const extra = await food(1000, { retired: true })
    const id = randomUUID()
    await pool.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, '2026-11-08', $3, $4, 1)`, [id, USER, mealTypeId, keeper])
    await repo.createFoodLog(USER, { id, date: '2026-11-08', mealTypeId, foodItemId: extra, quantityMultiplier: 5 })
    expect(await stored(id)).toEqual({ foodItemId: extra, quantity: 5 })
  })
})
