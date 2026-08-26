// BF-35 — a food item's picture, stored as bytes and carried through the whole offline chain.
//
// The chain is the point. CLAUDE.md's offline rule is that adding a field to a route means updating
// the local table, the queued payload, the push branch and the pull mapping **in the same change**,
// and the failure mode when one is missed is silent: the web path works and the device path drops
// the field with no error. These cases walk the server half of that chain.
//
// The asymmetry between the two write paths is deliberate and is asserted here so nobody "fixes" it:
// the web route REFUSES an oversized image (interactive caller, can see the message), the offline
// push branch DROPS it and keeps the food (a 4xx there is a poison pill the outbox quarantines, so
// refusing would cost a whole food item over a picture — the RV-32 precedent).
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000350001'

// A real (tiny) data URI, so the validator's mime and base64 checks see something legitimate.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const OVERSIZED = `data:image/png;base64,${'A'.repeat(40_000)}`

describe.skipIf(!canRun)('food_items.image_data_uri (BF-35)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, `food-image-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
  })

  const base = {
    name: 'Test Food', servingSizeG: 100, calories: 200,
    proteinG: 10, carbsG: 20, fatG: 5, source: 'barcode' as const, region: 'AU',
  }

  it('stores the image and reads it back through the row mapper', async () => {
    const item = await repo.createFoodItem(USER, { ...base, imageDataUri: TINY_PNG })
    expect(item.imageDataUri).toBe(TINY_PNG)
    const { rows } = await pool.query(
      `SELECT image_data_uri FROM food_items WHERE id = $1`, [item.id])
    expect(rows[0].image_data_uri).toBe(TINY_PNG)
  })

  // A missed row→object mapper is the "save doesn't persist" class: the column has the value and
  // nothing reading through the repository can see it.
  it('an item without an image reads back null, not undefined-shaped', async () => {
    const item = await repo.createFoodItem(USER, base)
    expect(item.imageDataUri).toBeNull()
  })

  // Absent here means the picture never reaches the device, which is the whole reason bytes are
  // stored instead of a URL.
  it('the sync delta carries the image to the device', async () => {
    const item = await repo.createFoodItem(USER, { ...base, imageDataUri: TINY_PNG })
    const delta = await repo.getSyncDelta(USER, new Date(Date.now() - 60_000)) as
      { foodItems?: { id: string; imageDataUri?: string | null }[] }
    const synced = delta.foodItems?.find(f => f.id === item.id)
    expect(synced).toBeDefined()
    expect(synced!.imageDataUri).toBe(TINY_PNG)
  })

  it('the offline push branch keeps the food and drops an oversized image', async () => {
    const id = crypto.randomUUID()
    const res = await repo.pushMutations(USER, [{
      id: crypto.randomUUID(), domain: 'food_items', date: '2026-03-01',
      payload: { ...base, id, imageDataUri: OVERSIZED },
    }] as never)

    const { rows } = await pool.query(
      `SELECT name, image_data_uri FROM food_items WHERE id = $1`, [id])
    expect(rows).toHaveLength(1)             // the food survived
    expect(rows[0].name).toBe('Test Food')
    expect(rows[0].image_data_uri).toBeNull() // the picture did not
    // Reported without dead-lettering: `errors` would quarantine the mutation, `warnings` does not.
    expect(res.errors ?? []).toHaveLength(0)
    expect((res as { warnings?: unknown[] }).warnings ?? []).toHaveLength(1)
  })

  it('the offline push branch stores an image that is within the cap', async () => {
    const id = crypto.randomUUID()
    await repo.pushMutations(USER, [{
      id: crypto.randomUUID(), domain: 'food_items', date: '2026-03-01',
      payload: { ...base, id, imageDataUri: TINY_PNG },
    }] as never)
    const { rows } = await pool.query(`SELECT image_data_uri FROM food_items WHERE id = $1`, [id])
    expect(rows[0].image_data_uri).toBe(TINY_PNG)
  })

  // Zod `.optional()` alone rejects null, and the local mirror stores null for "no picture" — that
  // exact mismatch broke every food save in v1.42.4.
  it('the push branch accepts an explicit null image', async () => {
    const id = crypto.randomUUID()
    const res = await repo.pushMutations(USER, [{
      id: crypto.randomUUID(), domain: 'food_items', date: '2026-03-01',
      payload: { ...base, id, imageDataUri: null },
    }] as never)
    expect(res.errors ?? []).toHaveLength(0)
    const { rows } = await pool.query(`SELECT id FROM food_items WHERE id = $1`, [id])
    expect(rows).toHaveLength(1)
  })
})
