// BF-39's follow-up — a saved meal has no last-used timestamp at all.
//
// Q-395c filed that as a constraint: *"`food_logs` carries no `saved_meal_id`, so a saved meal has
// no last-used timestamp at all … True MRU needs a column that does not exist — Lane A's to add."*
// BF-39 added the column; this is the read it exists for.
//
// **Derived, never stored.** A "last used" column needs a write on every log and an un-write on
// every delete, and it is wrong forever the first time either is missed — which is what every
// stored counter in this project has eventually done.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000391001'
const OTHER = '00000000-0000-4000-8000-000000391002'

describe.skipIf(!canRun)('saved meals, most-recently-eaten first (BF-39 follow-up)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let mealTypeId: string
  let foodItemId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `mru-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [id])
    }
    const { rows: mt } = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Lunch', 1) RETURNING id`, [USER])
    mealTypeId = mt[0].id
    const { rows: fi } = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'Oats', 100, 380, 13, 67, 7, 'manual') RETURNING id`, [USER])
    foodItemId = fi[0].id
  })

  /** A saved meal created `createdAgoDays` ago. */
  const meal = async (name: string, createdAgoDays: number, userId = USER) => {
    const { rows } = await pool.query(
      `INSERT INTO saved_meals (user_id, name, created_at) VALUES ($1, $2, now() - ($3 || ' days')::interval) RETURNING id`,
      [userId, name, String(createdAgoDays)])
    return rows[0].id as string
  }

  /** Derived from the clock, never a fixed date — the window this sorts on is `now`-relative. */
  const ate = async (savedMealId: string, agoDays: number, userId = USER) => {
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              saved_meal_id, meal_group_id, logged_at)
       VALUES ($1, to_char(now() - ($2 || ' days')::interval, 'YYYY-MM-DD'), $3, $4, 1, $5, $6,
               now() - ($2 || ' days')::interval)`,
      [userId, String(agoDays), mealTypeId, foodItemId, savedMealId, randomUUID()])
  }

  const names = async () => (await repo.listSavedMeals(USER)).map(m => m.name)

  it('reports when each meal was last eaten', async () => {
    const a = await meal('Pancakes', 10)
    await ate(a, 2)
    const [row] = await repo.listSavedMeals(USER)
    expect(row.lastUsedAt).toBeInstanceOf(Date)
    expect(Date.now() - row.lastUsedAt!.getTime()).toBeGreaterThan(24 * 3600_000)
  })

  it('is null for a meal never eaten, which is not the same as long ago', async () => {
    await meal('Never Eaten', 1)
    const [row] = await repo.listSavedMeals(USER)
    expect(row.lastUsedAt).toBeNull()
  })

  it('puts the most recently eaten first, whatever the creation order', async () => {
    const old = await meal('Old Favourite', 90)
    const recent = await meal('Made Yesterday', 1)
    await ate(old, 0)          // eaten today
    await ate(recent, 30)      // eaten a month ago
    expect(await names()).toEqual(['Old Favourite', 'Made Yesterday'])
  })

  // NULLS LAST, then createdAt: a meal never eaten sits where it sat before this existed, so
  // saving one does not drop it out of sight while it waits to be used.
  it('sorts never-eaten meals after eaten ones, and among themselves by newest first', async () => {
    const eaten = await meal('Eaten Once', 90)
    await meal('Saved Long Ago', 60)
    await meal('Saved Recently', 2)
    await ate(eaten, 5)
    expect(await names()).toEqual(['Eaten Once', 'Saved Recently', 'Saved Long Ago'])
  })

  it('takes the LATEST log, not the first', async () => {
    const a = await meal('Twice Eaten', 30)
    await ate(a, 20)
    await ate(a, 1)
    const [row] = await repo.listSavedMeals(USER)
    expect(Date.now() - row.lastUsedAt!.getTime()).toBeLessThan(3 * 24 * 3600_000)
  })

  it('ignores a deleted log — un-eating is a thing that happens', async () => {
    const a = await meal('Deleted Log', 30)
    await ate(a, 1)
    await pool.query(`UPDATE food_logs SET deleted_at = now() WHERE saved_meal_id = $1`, [a])
    const [row] = await repo.listSavedMeals(USER)
    expect(row.lastUsedAt).toBeNull()
  })

  // The user scope is on BOTH sides of the correlated subquery. Matching on the meal id alone would
  // let another account's log date this user's meal — a wrong sort AND a leak of when they ate.
  it("ignores another user's log against the same meal id", async () => {
    const mine = await meal('Shared Name', 30)
    await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Lunch', 1)`, [OTHER])
    const { rows: theirMt } = await pool.query(
      `SELECT id FROM meal_types WHERE user_id = $1 LIMIT 1`, [OTHER])
    const { rows: theirFi } = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'Theirs', 100, 100, 1, 1, 1, 'manual') RETURNING id`, [OTHER])
    // A log owned by OTHER that names MY meal. The FK allows it; the read must not.
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              saved_meal_id, logged_at)
       VALUES ($1, to_char(now(), 'YYYY-MM-DD'), $2, $3, 1, $4, now())`,
      [OTHER, theirMt[0].id, theirFi[0].id, mine])

    const [row] = await repo.listSavedMeals(USER)
    expect(row.lastUsedAt).toBeNull()
  })
})
