// #3749. The saved foods the ingredient resolver may read: the signed-in user's own live foods whose
// name folds (case, whitespace) to one asked for. Another user's food never comes back, nor a food
// the look-alike merge retired, nor a near match. Runs only against a local dev Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000003749'
const OTHER = '00000000-0000-4000-8000-000000013749'

describe.skipIf(!canRun)('listFoodItemsByNames', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const food = (userId: string, name: string, source = 'barcode') =>
    repo.createFoodItem(userId, {
      name, brand: null, servingSizeG: 100, calories: 100, proteinG: 5, carbsG: 15, fatG: 2,
      source, region: 'AU',
    } as never)
  const cleanup = () => pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[OWNER, OTHER]])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [OWNER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `r3749-${id}@example.com`])
    }
  })
  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
  })
  beforeEach(cleanup)

  it('returns the owner\'s food by its folded name, and never another user\'s', async () => {
    const mine = await food(OWNER, '  Rolled   OATS ')
    await food(OTHER, 'rolled oats')
    const got = await repo.listFoodItemsByNames(OWNER, ['rolled oats'])
    expect(got.map(f => f.id)).toEqual([mine.id])
    expect(await repo.listFoodItemsByNames(OTHER, ['Banana'])).toEqual([])
  })

  it('returns every source, so the resolver (not the query) decides which to trust', async () => {
    await food(OWNER, 'banana', 'ai')
    await food(OWNER, 'banana', 'barcode')
    const got = await repo.listFoodItemsByNames(OWNER, ['BANANA'])
    expect(got.map(f => f.source).sort()).toEqual(['ai', 'barcode'])
  })

  it('takes no near match and no retired food', async () => {
    await food(OWNER, 'rolled oats, organic')
    const retired = await food(OWNER, 'rolled oats')
    await pool.query(`UPDATE food_items SET deleted_at = now() WHERE id = $1`, [retired.id])
    expect(await repo.listFoodItemsByNames(OWNER, ['rolled oats'])).toEqual([])
    expect(await repo.listFoodItemsByNames(OWNER, [])).toEqual([])
  })
})
