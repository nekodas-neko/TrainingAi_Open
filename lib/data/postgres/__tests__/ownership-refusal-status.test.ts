// RV-33 — a refusal that reaches the client as an empty-bodied 500 and files itself as a fault.
//
// Q-462/Q-463 settled this: an id that is not yours is a 404, not a server fault, and fixed it on
// `phase-sets/[id]`, `supplements/[id]`, `meal-types/[id]`, `activity-logs` and `log-exercise`. Two
// routes were missed — both throw the CORRECT `NotFoundError` from the repository and then let it
// escape an unguarded handler, so the client gets a 500 with no body it can render, and a correctly
// refused request burns a row in the fault channel nobody watches.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-0000000fd0a1'
const USER_B = '00000000-0000-4000-8000-0000000fd0a2'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_A, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('ownership refusals answer 404, not an empty 500 (RV-33)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let bStyleId: string
  let bFoodLogId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `refusal-status-${tag}@example.com`],
      )
    }

    const style = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'B Ramp') RETURNING id`, [USER_B])
    bStyleId = style.rows[0].id

    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, 'B Lunch', '🍽️', 0, 11, 15) RETURNING id`, [USER_B])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'B Rice', 100, 130, 2.7, 28, 0.3, 'manual') RETURNING id`, [USER_B])
    const fl = await pool.query(
      `INSERT INTO food_logs (user_id, meal_type_id, food_item_id, date, quantity_multiplier)
       VALUES ($1, $2, $3, '2026-08-20', 1) RETURNING id`, [USER_B, mt.rows[0].id, fi.rows[0].id])
    bFoodLogId = fl.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('POST /api/progression-styles answers 404 with a body for another user\'s style id', async () => {
    const { POST } = await import('@/app/api/progression-styles/route')
    const res = await POST(new Request('http://localhost/api/progression-styles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: { id: bStyleId, name: 'Stolen', sets: [] } }),
    }) as never)

    expect(res.status).toBe(404)
    // The whole complaint: a 500 here carried NO body, so the UI had nothing to render.
    expect((await res.json()).error).toMatch(/not found/i)

    const { rows } = await pool.query(
      `SELECT name FROM progression_styles WHERE id = $1`, [bStyleId])
    expect(rows[0].name).toBe('B Ramp')
  })

  it('PATCH /api/nutrition/food-logs/[id] answers 404 with a body for another user\'s log', async () => {
    const { PATCH } = await import('@/app/api/nutrition/food-logs/[id]/route')
    const res = await PATCH(new Request(`http://localhost/api/nutrition/food-logs/${bFoodLogId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantityMultiplier: 5 }),
    }), { params: Promise.resolve({ id: bFoodLogId }) })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)

    const { rows } = await pool.query(
      `SELECT quantity_multiplier FROM food_logs WHERE id = $1`, [bFoodLogId])
    expect(Number(rows[0].quantity_multiplier)).toBe(1)
  })

  it('both routes still succeed on the caller\'s own row', async () => {
    const { POST } = await import('@/app/api/progression-styles/route')
    const created = await POST(new Request('http://localhost/api/progression-styles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: { name: 'A Ramp', sets: [] } }),
    }) as never)
    expect(created.status).toBe(200)

    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, 'A Lunch', '🍽️', 0, 11, 15) RETURNING id`, [USER_A])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'A Rice', 100, 130, 2.7, 28, 0.3, 'manual') RETURNING id`, [USER_A])
    const fl = await pool.query(
      `INSERT INTO food_logs (user_id, meal_type_id, food_item_id, date, quantity_multiplier)
       VALUES ($1, $2, $3, '2026-08-20', 1) RETURNING id`, [USER_A, mt.rows[0].id, fi.rows[0].id])

    const { PATCH } = await import('@/app/api/nutrition/food-logs/[id]/route')
    const res = await PATCH(new Request(`http://localhost/api/nutrition/food-logs/${fl.rows[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantityMultiplier: 2 }),
    }), { params: Promise.resolve({ id: fl.rows[0].id }) })
    expect(res.status).toBe(200)
  })

  // The hardening bullet folded in with RV-33: `updateMealType` was the only repo writer that
  // `.set()`s its argument wholesale, safe only because its one caller uses a `.strict()` schema.
  it('updateMealType writes only whitelisted columns, whatever the caller passes', async () => {
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, 'A Snack', '🍎', 3, 15, 17) RETURNING id, created_at`, [USER_A])
    const { id, created_at } = mt.rows[0]

    await repo.updateMealType(id, USER_A, {
      name: 'A Snack Renamed',
      // Settable column keys that the compile-time `Omit<>` cannot actually stop at runtime.
      userId: USER_B, createdAt: new Date('2000-01-01'),
    } as never)

    const { rows } = await pool.query(
      `SELECT name, user_id, created_at FROM meal_types WHERE id = $1`, [id])
    expect(rows[0].name).toBe('A Snack Renamed')
    expect(rows[0].user_id).toBe(USER_A)
    expect(new Date(rows[0].created_at).getTime()).toBe(new Date(created_at).getTime())
  })

  it('a patch of only unknown keys refuses rather than reaching "No values to set"', async () => {
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, 'A Supper', '🌙', 4, 19, 22) RETURNING id`, [USER_A])
    await expect(repo.updateMealType(mt.rows[0].id, USER_A, { userId: USER_B } as never))
      .rejects.toThrow(/No fields to update/i)
  })
})
