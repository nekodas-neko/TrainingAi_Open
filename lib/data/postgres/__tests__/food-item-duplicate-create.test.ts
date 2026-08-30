// BF-38 — creating a food the user already has must not write a second row.
//
// Measured in production 2026-08-30: 221 `food_items`, 200 distinct name+brand, **21 redundant**,
// 20 of them from the `ai` source. Nothing had ever checked, at any layer.
//
// The asymmetry between the two write paths is the load-bearing part and is asserted here so
// nobody "fixes" it into consistency: the interactive create REUSES an existing row, the offline
// push branch does NOT. The push mints its id on the device and a `food_logs` mutation is already
// queued against it — handing back a different id would leave that log pointing at a row the server
// never created, and `food_logs.food_item_id` is a foreign key with ON DELETE RESTRICT. The device
// de-duplicates before it queues anything instead
// (`packages/shared/src/nutrition/create-food-item.ts`).
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000380001'
const OTHER = '00000000-0000-4000-8000-000000380002'

describe.skipIf(!canRun)('food_items de-duplication on create (BF-38)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `food-dup-${id}@example.com`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  // The row the owner photographed, three times over, in a 24-item list.
  const macAndCheese = {
    name: 'LOADED MAC & CHEESE', brand: 'CORE POWERFOODS',
    servingSizeG: 350, calories: 672, proteinG: 44, carbsG: 70, fatG: 22,
    source: 'ai' as const, region: 'AU',
  }

  const countFor = async (userId: string) => {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM food_items WHERE user_id = $1`, [userId])
    return rows[0].n as number
  }

  it('returns the existing row instead of writing a second one', async () => {
    const first = await repo.createFoodItem(USER, macAndCheese, { reuseExisting: true })
    const second = await repo.createFoodItem(USER, { ...macAndCheese }, { reuseExisting: true })
    expect(second.id).toBe(first.id)
    expect(await countFor(USER)).toBe(1)
  })

  it('matches through the case and whitespace the model varies between calls', async () => {
    const first = await repo.createFoodItem(USER, macAndCheese, { reuseExisting: true })
    const second = await repo.createFoodItem(USER, {
      ...macAndCheese, name: '  loaded   mac & cheese', brand: 'core powerfoods ',
    }, { reuseExisting: true })
    expect(second.id).toBe(first.id)
    expect(await countFor(USER)).toBe(1)
  })

  it('still writes a second row when a number a log depends on differs', async () => {
    // mandarin, x4 in production: 42 kcal/80 g and 53 kcal/100 g. Same food, two servings — and
    // food_logs multiplies against the serving, so reusing one for the other changes what the new
    // log means.
    const small = await repo.createFoodItem(USER, {
      name: 'Mandarin', servingSizeG: 80, calories: 42, proteinG: 0.7, carbsG: 10.5, fatG: 0.2,
      source: 'ai', region: 'AU',
    }, { reuseExisting: true })
    const large = await repo.createFoodItem(USER, {
      name: 'Mandarin', servingSizeG: 100, calories: 53, proteinG: 0.8, carbsG: 13.3, fatG: 0.3,
      source: 'ai', region: 'AU',
    }, { reuseExisting: true })
    expect(large.id).not.toBe(small.id)
    expect(await countFor(USER)).toBe(2)
  })

  it('does not reuse another user\'s identical row', async () => {
    const theirs = await repo.createFoodItem(OTHER, macAndCheese, { reuseExisting: true })
    const mine = await repo.createFoodItem(USER, macAndCheese, { reuseExisting: true })
    expect(mine.id).not.toBe(theirs.id)
    expect(await countFor(USER)).toBe(1)
    expect(await countFor(OTHER)).toBe(1)
  })

  it('writes the duplicate when the caller does not ask to reuse — the default', async () => {
    const first = await repo.createFoodItem(USER, macAndCheese)
    const second = await repo.createFoodItem(USER, { ...macAndCheese })
    expect(second.id).not.toBe(first.id)
    expect(await countFor(USER)).toBe(2)
  })

  // The property that keeps the outbox intact. A push arrives with the id the device already
  // referenced from a queued food_log; if this ever started returning a different id, that log
  // would fail its foreign key on the way in.
  it('honours the pushed id even when an identical row exists, so a queued log still resolves', async () => {
    const existing = await repo.createFoodItem(USER, macAndCheese, { reuseExisting: true })
    const pushedId = randomUUID()
    const pushed = await repo.createFoodItem(USER, { ...macAndCheese, id: pushedId })
    expect(pushed.id).toBe(pushedId)
    expect(pushed.id).not.toBe(existing.id)

    // And the log that was queued against it resolves — the thing the asymmetry is protecting.
    const { rows: mt } = await pool.query(
      `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, 'Lunch', 1) RETURNING id`, [USER],
    )
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier)
       VALUES ($1, '2026-08-30', $2, $3, 1)`,
      [USER, mt[0].id, pushedId],
    )
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM food_logs WHERE user_id = $1 AND food_item_id = $2`, [USER, pushedId],
    )
    expect(rows[0].n).toBe(1)
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [USER])
  })

  it('re-pushing the same mutation is still idempotent', async () => {
    const id = randomUUID()
    const a = await repo.createFoodItem(USER, { ...macAndCheese, id })
    const b = await repo.createFoodItem(USER, { ...macAndCheese, id })
    expect(b.id).toBe(a.id)
    expect(await countFor(USER)).toBe(1)
  })
})
