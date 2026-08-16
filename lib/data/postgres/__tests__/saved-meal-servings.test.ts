// A saved meal's batch size (`saved_meals.servings`, migration 182).
//
// The two things worth a DB test rather than a unit test:
//
//   1. The default. Every saved meal that already exists in production gets this column with no
//      value of its own, and the ONLY safe reading is 1. A NULL or 0 reaching the divider would
//      make one portion infinite and then feed that into a meal plan.
//   2. Round-trip through the single write path. Both web routes and the offline outbox replay
//      funnel through `writeSavedMeal`, so a field that survives create but not update — or that
//      an upsert silently resets — is a real failure mode here.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-000000000031'
const USER_B = '00000000-0000-4000-8000-000000000032'

describe.skipIf(!canRun)('saved meal servings', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let foodId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, email] of [[USER_A, 'sm-serv-a'], [USER_B, 'sm-serv-b']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `${email}@example.com`],
      )
    }
    const item = await repo.createFoodItem(USER_A, {
      name: 'Whey', servingSizeG: 30, calories: 120, proteinG: 25, carbsG: 2, fatG: 1,
      source: 'manual', region: 'AU',
    })
    foodId = item.id
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM saved_meals WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM saved_meals WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  const items = () => [{ foodItemId: foodId, quantityMultiplier: 2 }]

  it('defaults to one serving, so every pre-existing meal is unchanged', async () => {
    // Insert the way a row that predates the column exists: without naming it at all.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'Legacy') RETURNING id`, [USER_A],
    )
    const all = await repo.listSavedMeals(USER_A)
    expect(all.find(m => m.id === rows[0].id)?.servings).toBe(1)
  })

  it('round-trips a batch size through create and back out', async () => {
    const created = await repo.createSavedMeal(USER_A, 'Ninja Creami', items(), undefined, 2)
    expect(created.servings).toBe(2)
    const fetched = (await repo.listSavedMeals(USER_A)).find(m => m.id === created.id)
    expect(fetched?.servings).toBe(2)
  })

  it('updates the batch size in place', async () => {
    const created = await repo.createSavedMeal(USER_A, 'Batch', items(), undefined, 2)
    await repo.updateSavedMeal(created.id, USER_A, 'Batch', items(), 4)
    const fetched = (await repo.listSavedMeals(USER_A)).find(m => m.id === created.id)
    expect(fetched?.servings).toBe(4)
  })

  // The offline outbox replays a create for a meal that already exists. The upsert must carry the
  // batch size through that path too, or an edit made offline silently reverts to the old value.
  it('keeps the batch size when a create replays over an existing meal', async () => {
    const created = await repo.createSavedMeal(USER_A, 'Replayed', items(), undefined, 3)
    const again = await repo.createSavedMeal(USER_A, 'Replayed', items(), created.id, 3)
    expect(again.id).toBe(created.id)
    expect(again.servings).toBe(3)
  })

  // `totals` is the whole recipe on purpose — every existing caller reads it that way. The
  // division to one portion happens in `oneServingItems`, not here.
  it('reports totals for the whole recipe, not one portion', async () => {
    const created = await repo.createSavedMeal(USER_A, 'Batch', items(), undefined, 2)
    expect(created.totals.calories).toBe(240)
    expect(created.totals.proteinG).toBe(50)
  })

  it('refuses to write a batch size onto another user\'s meal', async () => {
    const mine = await repo.createSavedMeal(USER_A, 'Mine', items(), undefined, 2)
    await expect(repo.updateSavedMeal(mine.id, USER_B, 'Stolen', [], 9)).rejects.toThrow()
    const still = (await repo.listSavedMeals(USER_A)).find(m => m.id === mine.id)
    expect(still?.servings).toBe(2)
    expect(still?.name).toBe('Mine')
  })
})
