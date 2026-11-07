// #3651 / #3652. A barcode scan resolves against the whole live library: a food older than the 20
// the list route returns is found, a food the look-alike merge retired is not (its keeper is), and
// another user's food never is. Runs only against a local dev Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000003651'
const OTHER = '00000000-0000-4000-8000-000000013651'

describe.skipIf(!canRun)('findFoodItemsByBarcode', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const food = (userId: string, name: string, barcode: string | null) =>
    repo.createFoodItem(userId, {
      name, brand: null, servingSizeG: 100, calories: 100, proteinG: 0, carbsG: 0, fatG: 0,
      source: 'barcode', region: 'AU', ...(barcode ? { barcode } : {}),
    } as never)
  const cleanup = () => pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[OWNER, OTHER]])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [OWNER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `r3651-${id}@example.com`])
    }
  })
  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, OTHER]])
  })
  beforeEach(cleanup)

  it('finds a food the 20-row list would cut off', async () => {
    const old = await food(OWNER, 'Old tin', '9300000000011')
    await pool.query(`UPDATE food_items SET created_at = now() - interval '200 days' WHERE id = $1`, [old.id])
    for (let i = 0; i < 25; i++) await food(OWNER, `Bulk ${i}`, null)
    expect((await repo.searchFoodItems(OWNER, '')).some(f => f.id === old.id)).toBe(false)
    expect((await repo.findFoodItemsByBarcode(OWNER, ' 9300000000011 ')).map(f => f.id)).toEqual([old.id])
  })

  it('skips a retired food and another user’s, and answers nothing for an unknown code', async () => {
    const extra = await food(OWNER, 'Beans', '9300000000028')
    const keeper = await food(OWNER, 'Beans', '9300000000028')
    await pool.query(`UPDATE food_items SET created_at = now() + interval '1 day', deleted_at = now() WHERE id = $1`, [extra.id])
    await food(OTHER, 'Theirs', '9300000000035')
    expect((await repo.findFoodItemsByBarcode(OWNER, '9300000000028')).map(f => f.id)).toEqual([keeper.id])
    expect(await repo.findFoodItemsByBarcode(OWNER, '9300000000035')).toEqual([])
    expect(await repo.findFoodItemsByBarcode(OWNER, '9399999999999')).toEqual([])
  })
})
