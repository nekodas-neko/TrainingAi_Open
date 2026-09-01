// BF-97 — a scanned meal groups in the diary, and the group carries its own name.
//
// BF-39 gave `food_logs` a `meal_group_id` and named the group from `saved_meal_id`. A scan has no
// saved meal, deliberately — creating one would put a row in the user's meal library to satisfy a
// display rule — so it has nowhere to get a name and renders as N loose ingredients. `meal_group_name`
// is that name, denormalised onto every row of the group the same way the id already is.
//
// The cases worth a test are the ones a column alone does not give you: the two write paths agreeing
// (the web route and the offline push are how this drifts), the sync delta, and the upsert arm that
// must not strip a name a later caller does not know about.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { MEAL_GROUP_NAME_MAX_CHARS } from '@trainingai/shared/nutrition/meal-group-name'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000970001'
const OTHER = '00000000-0000-4000-8000-000000970002'

describe.skipIf(!canRun)('food_logs.meal_group_name (BF-97)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let mealTypeId: string
  let foodItemId: string

  const mkUser = async (id: string) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [id, `bf97-${id}@example.com`],
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
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [id])
    }
    const { rows: mt } = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Lunch', 1) RETURNING id`, [USER])
    mealTypeId = mt[0].id
    const { rows: fi } = await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'Pulled Beef', 100, 200, 25, 0, 10, 'ai') RETURNING id`, [USER])
    foodItemId = fi[0].id
  })

  const log = (over: Record<string, unknown> = {}) => repo.createFoodLog(USER, {
    date: '2026-09-01', mealTypeId, foodItemId, quantityMultiplier: 1, ...over,
  })

  it('stores the name and reads it back through the day list', async () => {
    const mealGroupId = randomUUID()
    await log({ mealGroupId, mealGroupName: 'Beef and vegetables' })
    const [row] = await repo.listFoodLogs(USER, '2026-09-01')
    expect(row.mealGroupId).toBe(mealGroupId)
    expect(row.mealGroupName).toBe('Beef and vegetables')
  })

  // The whole point of the column: a scanned group has no saved meal, and must still group and be
  // nameable. If this needed a `savedMealId` the entry's rejected option 2 would be the only way.
  it('needs no saved meal — the group stands on its own id and name', async () => {
    const mealGroupId = randomUUID()
    await log({ mealGroupId, mealGroupName: 'Beef and vegetables' })
    const [row] = await repo.listFoodLogs(USER, '2026-09-01')
    expect(row.savedMealId).toBeNull()
    expect(row.mealGroupName).toBe('Beef and vegetables')
  })

  it('leaves it null for an ordinary single-food log', async () => {
    await log()
    const [row] = await repo.listFoodLogs(USER, '2026-09-01')
    expect(row.mealGroupName).toBeNull()
  })

  // Where a new column on a synced table normally gets half-done.
  it('carries the name in the sync delta', async () => {
    const mealGroupId = randomUUID()
    await log({ mealGroupId, mealGroupName: 'Beef and vegetables' })
    const delta = await repo.getSyncDelta(USER, new Date(0))
    const row = (delta.foodLogs ?? []).find(r => r.mealGroupId === mealGroupId)
    expect(row).toBeDefined()
    expect(row!.mealGroupName).toBe('Beef and vegetables')
  })

  // The same rule BF-39 established for the ids, and for the same reason: `?? null` here would make
  // every id-bearing upsert that knows nothing about groups strip the name off a row that had one.
  it('does not strip an existing name when a later upsert omits it', async () => {
    const id = randomUUID()
    const mealGroupId = randomUUID()
    await log({ id, mealGroupId, mealGroupName: 'Beef and vegetables' })
    await log({ id, quantityMultiplier: 2 })   // a caller that knows nothing about groups

    const [row] = await repo.listFoodLogs(USER, '2026-09-01')
    expect(row.quantityMultiplier).toBe(2)
    expect(row.mealGroupName).toBe('Beef and vegetables')
    expect(row.mealGroupId).toBe(mealGroupId)
  })

  // The sibling-surface rule at the boundary that actually strands: the web route and the offline
  // push are two write paths into one table, and a field the route carries and the push drops means
  // the phone's scans arrive as loose ingredients while the browser's do not.
  describe('the offline push branch', () => {
    const push = (payload: Record<string, unknown>) => repo.pushMutations(USER, [
      { id: `m-${randomUUID()}`, domain: 'food_logs', date: '2026-09-01', payload },
    ])

    it('stores the name a queued mutation carries', async () => {
      const mealGroupId = randomUUID()
      const res = await push({ id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1, mealGroupId, mealGroupName: 'Beef and vegetables' })
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-09-01')
      expect(row.mealGroupId).toBe(mealGroupId)
      expect(row.mealGroupName).toBe('Beef and vegetables')
    })

    it('normalises whitespace to no name rather than storing a blank header', async () => {
      const res = await push({ id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1, mealGroupId: randomUUID(), mealGroupName: '   ' })
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-09-01')
      expect(row.mealGroupName).toBeNull()
    })

    // Truncating rather than rejecting is what keeps a display string from becoming a poison pill:
    // a 4xx here quarantines the mutation and costs the whole food log.
    it('truncates an over-long name and still stores the log', async () => {
      const res = await push({
        id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1,
        mealGroupId: randomUUID(), mealGroupName: 'b'.repeat(MEAL_GROUP_NAME_MAX_CHARS + 50),
      })
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-09-01')
      expect(row.mealGroupName).toHaveLength(MEAL_GROUP_NAME_MAX_CHARS)
    })

    // A non-string reaching a text column is harmless where a non-string reaching a uuid column is a
    // driver error — but the two write paths must still agree on what it means, which is "no name".
    it('ignores a name that is not a string', async () => {
      const res = await push({ id: randomUUID(), mealTypeId, foodItemId, quantityMultiplier: 1, mealGroupId: randomUUID(), mealGroupName: 42 })
      expect(res.errors).toEqual([])
      const [row] = await repo.listFoodLogs(USER, '2026-09-01')
      expect(row.mealGroupName).toBeNull()
    })
  })
})
