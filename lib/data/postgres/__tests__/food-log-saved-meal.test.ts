// BF-39 — a logged meal stops being a meal.
//
// Logging a saved meal writes one `food_logs` row per ingredient and nothing recorded that they came
// from a meal, so its identity was gone the moment it was logged. One AI-logged breakfast rendered
// as eight diary rows. `saved_meal_id` is WHAT was eaten; `meal_group_id` is WHICH TIME — two
// servings of the same meal on one day share the first and must not share the second.
//
// The cases that matter are the ones a column alone does not give you: the ownership check on a
// client-supplied meal id, the foreign key that must not make a saved meal undeletable once eaten,
// and the sync delta, which is where a new column on a synced table normally gets half-done.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000390001'
const OTHER = '00000000-0000-4000-8000-000000390002'

describe.skipIf(!canRun)('food_logs.saved_meal_id / meal_group_id (BF-39)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let mealTypeId: string
  let foodItemId: string
  let savedMealId: string

  const mkUser = async (id: string) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [id, `bf39-${id}@example.com`],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await mkUser(USER)
    await mkUser(OTHER)
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM saved_meal_items WHERE saved_meal_id IN (SELECT id FROM saved_meals WHERE user_id = $1)`, [id])
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
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Breakfast', 1) RETURNING id`, [USER])
    mealTypeId = mt[0].id
    const { rows: fi } = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'Rolled Oats', 100, 380, 13, 67, 7, 'manual') RETURNING id`, [USER])
    foodItemId = fi[0].id
    const { rows: sm } = await pool.query(
      `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'Protein Pancakes') RETURNING id`, [USER])
    savedMealId = sm[0].id
  })

  const log = (over: Record<string, unknown> = {}) => repo.createFoodLog(USER, {
    date: '2026-08-30', mealTypeId, foodItemId, quantityMultiplier: 1, ...over,
  })

  it('stores both columns and reads them back through the day list', async () => {
    const mealGroupId = randomUUID()
    await log({ savedMealId, mealGroupId })
    const [row] = await repo.listFoodLogs(USER, '2026-08-30')
    expect(row.savedMealId).toBe(savedMealId)
    expect(row.mealGroupId).toBe(mealGroupId)
  })

  it('leaves both null for an ordinary single-food log', async () => {
    await log()
    const [row] = await repo.listFoodLogs(USER, '2026-08-30')
    expect(row.savedMealId).toBeNull()
    expect(row.mealGroupId).toBeNull()
  })

  // The reason the group is a separate id from the meal: the same meal, twice in a day.
  it('gives two servings of one meal two groups, so the diary cannot merge them', async () => {
    const first = randomUUID()
    const second = randomUUID()
    await log({ savedMealId, mealGroupId: first })
    await log({ savedMealId, mealGroupId: second })
    const rows = await repo.listFoodLogs(USER, '2026-08-30')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(r => r.savedMealId))).toEqual(new Set([savedMealId]))
    expect(new Set(rows.map(r => r.mealGroupId)).size).toBe(2)
  })

  describe('ownership', () => {
    it('accepts a meal the user owns', async () => {
      expect(await repo.foodLogRefsValid(USER, mealTypeId, foodItemId, savedMealId)).toBe(true)
    })

    it('accepts an absent meal id — an ordinary single-food log', async () => {
      expect(await repo.foodLogRefsValid(USER, mealTypeId, foodItemId, null)).toBe(true)
    })

    // A client-supplied row id gets the same check as the other two. Without it a log could name
    // someone else's meal, and the diary would draw their name and picture over this user's food.
    it("refuses another user's meal id rather than storing it", async () => {
      const { rows } = await pool.query(
        `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'Their Meal') RETURNING id`, [OTHER])
      expect(await repo.foodLogRefsValid(USER, mealTypeId, foodItemId, rows[0].id)).toBe(false)
    })

    it('refuses an id that is no meal at all', async () => {
      expect(await repo.foodLogRefsValid(USER, mealTypeId, foodItemId, randomUUID())).toBe(false)
    })
  })

  // ON DELETE SET NULL, and it is load-bearing: `deleteSavedMeal` is a HARD delete, so the default
  // NO ACTION would make a saved meal permanently undeletable the moment it had been eaten once.
  it('lets a saved meal still be deleted after it has been logged, and keeps the log', async () => {
    const mealGroupId = randomUUID()
    await log({ savedMealId, mealGroupId })

    await expect(repo.deleteSavedMeal(savedMealId, USER)).resolves.not.toThrow()

    const rows = await repo.listFoodLogs(USER, '2026-08-30')
    expect(rows).toHaveLength(1)
    expect(rows[0].savedMealId).toBeNull()
    // The group survives the meal, so a diary can still draw the ingredients as one entry.
    expect(rows[0].mealGroupId).toBe(mealGroupId)
  })

  // Where a new column on a synced table normally gets half-done.
  it('carries both columns in the sync delta', async () => {
    const mealGroupId = randomUUID()
    await log({ savedMealId, mealGroupId })
    const delta = await repo.getSyncDelta(USER, new Date(0))
    const row = (delta.foodLogs ?? []).find(r => r.mealGroupId === mealGroupId)
    expect(row).toBeDefined()
    expect(row!.savedMealId).toBe(savedMealId)
  })

  // The offline replay path: the row already exists with the client's id, and the update arm has to
  // carry the meal columns or a re-push lands the row plain.
  it('keeps the grouping when the same mutation is pushed twice', async () => {
    const id = randomUUID()
    const mealGroupId = randomUUID()
    await log({ id, savedMealId, mealGroupId })
    await log({ id, savedMealId, mealGroupId })
    const rows = await repo.listFoodLogs(USER, '2026-08-30')
    expect(rows).toHaveLength(1)
    expect(rows[0].savedMealId).toBe(savedMealId)
    expect(rows[0].mealGroupId).toBe(mealGroupId)
  })

  // The upsert arm sets the meal columns only when the caller SUPPLIED them. Forcing
  // `?? null` reads as equivalent and is not: any id-bearing upsert that does not know about meals
  // would strip the grouping off a row that had one, with nothing to see afterwards.
  it('does not strip an existing grouping when a later upsert omits it', async () => {
    const id = randomUUID()
    const mealGroupId = randomUUID()
    await log({ id, savedMealId, mealGroupId })
    await log({ id, quantityMultiplier: 2 })   // a caller that knows nothing about meals

    const [row] = await repo.listFoodLogs(USER, '2026-08-30')
    expect(row.quantityMultiplier).toBe(2)     // it did update what it meant to
    expect(row.savedMealId).toBe(savedMealId)  // and left alone what it did not
    expect(row.mealGroupId).toBe(mealGroupId)
  })

  // The sibling-surface rule, at the boundary that actually strands: the web route and the offline
  // push are two write paths into one table, and a field the route carries and the push drops means
  // the phone's meals arrive as loose ingredients while the browser's do not.
  describe('the offline push branch', () => {
    it('stores the grouping a queued mutation carries', async () => {
      const id = randomUUID()
      const mealGroupId = randomUUID()
      const res = await repo.pushMutations(USER, [
        { id: 'm1', domain: 'food_logs', date: '2026-08-30',
          payload: { id, mealTypeId, foodItemId, quantityMultiplier: 1, savedMealId, mealGroupId } },
      ])
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-08-30')
      expect(row.savedMealId).toBe(savedMealId)
      expect(row.mealGroupId).toBe(mealGroupId)
    })

    it("refuses a pushed log naming another user's meal, rather than storing it", async () => {
      const { rows } = await pool.query(
        `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'Their Meal') RETURNING id`, [OTHER])
      const res = await repo.pushMutations(USER, [
        { id: 'm2', domain: 'food_logs', date: '2026-08-30',
          payload: { id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1, savedMealId: rows[0].id } },
      ])
      expect(res.errors).toHaveLength(1)
      expect(await repo.listFoodLogs(USER, '2026-08-30')).toHaveLength(0)
    })

    // `String(undefined)` is the literal "undefined", which a uuid column rejects at the driver —
    // and a driver error in the push loop is a poison pill the outbox quarantines, costing the whole
    // log over a field that was simply absent.
    it('accepts a plain single-food push with no meal fields at all', async () => {
      const res = await repo.pushMutations(USER, [
        { id: 'm3', domain: 'food_logs', date: '2026-08-30',
          payload: { id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1 } },
      ])
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-08-30')
      expect(row.savedMealId).toBeNull()
      expect(row.mealGroupId).toBeNull()
    })
  })
})
