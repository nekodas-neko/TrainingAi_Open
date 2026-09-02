// LB-18 — `Recent` unscoped from the meal bucket, which the owner settled on the device:
// "Recent doesnt need to be scoped to current meal bracket; I think it should just be all recently
// entered foods/meals."
//
// **The entry's stated Lane A blocker does not exist, and that is the finding worth keeping.** It
// says a saved meal has no last-used timestamp, that this is why `My Foods` can only order by
// `createdAt DESC`, and that a recency ordering across foods and meals therefore needs a schema
// change. `listSavedMeals` already derives `lastUsedAt` from `max(food_logs.logged_at)`, orders by
// `lastUsedAt DESC NULLS LAST, createdAt DESC`, and reads `idx_food_logs_saved_meal_recent` from
// migration 238 — deriving rather than storing, as the Stored Counters rule asks. So no migration,
// no SQLite version, no sync chain: the only thing missing was an unfiltered query.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000b518'

describe('recent food items, unscoped by meal bucket (LB-18)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let breakfast: string
  let dinner: string

  const addFood = async (name: string) => {
    const { rows } = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, 100, 100, 5, 10, 2, 'manual') RETURNING id`, [USER, name])
    return rows[0].id as string
  }
  const log = async (foodItemId: string, mealTypeId: string, loggedAt: string) => {
    await pool.query(
      `INSERT INTO food_logs (user_id, food_item_id, meal_type_id, date, quantity_multiplier, logged_at)
       VALUES ($1, $2, $3, '2026-08-30', 1, $4)`, [USER, foodItemId, mealTypeId, loggedAt])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `lb18-${USER}@example.com`])
    // `meal_types` is user-scoped, not a global lookup — so this user gets its own two rather than
    // borrowing the seed's, which would leave rows behind on another account.
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, 'LB18 Breakfast', 0, 5, 11), ($1, 'LB18 Dinner', 1, 17, 22)
       RETURNING id, sort_order`, [USER])
    const ordered = mt.rows.sort((a, b) => a.sort_order - b.sort_order)
    breakfast = ordered[0].id
    dinner = ordered[1].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
  })

  it('returns items from every bucket, most recently logged first', async () => {
    const coffee = await addFood('Coffee')
    const steak = await addFood('Steak')
    await log(coffee, breakfast, '2026-08-30T07:00:00Z')
    await log(steak, dinner, '2026-08-30T18:00:00Z')

    const recent = await repo.listRecentFoodItems(USER, 12)
    // Absolute, not "steak before coffee": a bug that dropped one bucket entirely would still
    // satisfy an ordering-only assertion.
    expect(recent.map(i => i.name)).toEqual(['Steak', 'Coffee'])
  })

  // The behaviour the owner was complaining about, kept as the contrast.
  it('the scoped query still sees only its own bucket', async () => {
    const coffee = await addFood('Coffee')
    const steak = await addFood('Steak')
    await log(coffee, breakfast, '2026-08-30T07:00:00Z')
    await log(steak, dinner, '2026-08-30T18:00:00Z')

    expect((await repo.listRecentFoodItemsForMealType(USER, breakfast, 5)).map(i => i.name))
      .toEqual(['Coffee'])
  })

  it('de-duplicates a food eaten in two buckets, keeping its most recent log', async () => {
    const eggs = await addFood('Eggs')
    await log(eggs, breakfast, '2026-08-30T07:00:00Z')
    await log(eggs, dinner, '2026-08-30T19:00:00Z')

    expect((await repo.listRecentFoodItems(USER, 12)).map(i => i.name)).toEqual(['Eggs'])
  })

  it('excludes deleted logs', async () => {
    const gone = await addFood('Deleted Thing')
    await log(gone, breakfast, '2026-08-30T07:00:00Z')
    await pool.query(`UPDATE food_logs SET deleted_at = now() WHERE user_id = $1`, [USER])

    expect(await repo.listRecentFoodItems(USER, 12)).toEqual([])
  })

  it('is scoped to the user', async () => {
    const mine = await addFood('Mine')
    await log(mine, breakfast, '2026-08-30T07:00:00Z')

    expect(await repo.listRecentFoodItems('00000000-0000-4000-8000-00000000b519', 12)).toEqual([])
  })
})
