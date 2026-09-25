// RV-177 — `createFoodItem`'s id-bearing branch read the conflicting row back UNSCOPED.
//
// The id comes from the client (the outbox mints it before the push, so the branch exists to make a
// retry idempotent). On conflict the insert no-ops and the row is read back — and reading it back by
// id alone meant that if the id belonged to SOMEBODY ELSE, their food item came back to this
// caller: name, brand and macros, for the cost of guessing a uuid.
//
// This is CLAUDE.md's write-path ownership rule (c) — a client-supplied row id in an upsert must be
// ownership-verified — on a table that does have a `user_id`, so the check is direct rather than a
// join.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const OWNER = '00000000-0000-4000-8000-000000177a01'
const OTHER = '00000000-0000-4000-8000-000000177a02'

describe.skipIf(!canRun)('createFoodItem does not hand back another user\'s row (RV-177)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  const ITEM = {
    name: 'RV177 Other Persons Chicken', brand: 'Private', servingSizeG: 100,
    calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6,
    source: 'manual' as const,
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, email] of [[OWNER, 'rv177-owner@example.com'], [OTHER, 'rv177-other@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [id, email])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1::uuid[])`, [[OWNER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER, OTHER]])
  })

  it('refuses an id that belongs to another user instead of returning their item', async () => {
    const theirs = await repo.createFoodItem(OTHER, ITEM)

    await expect(repo.createFoodItem(OWNER, { ...ITEM, name: 'Mine', id: theirs.id }))
      .rejects.toThrow()

    // And nothing of theirs moved: the refusal is a read refusal, not a silent overwrite.
    const { rows } = await pool.query(
      `SELECT user_id, name FROM food_items WHERE id = $1`, [theirs.id])
    expect(rows[0].user_id).toBe(OTHER)
    expect(rows[0].name).toBe(ITEM.name)
  })

  // The control, and the reason the fix is a scope rather than a blanket refusal: this branch
  // exists so an outbox retry of the SAME id by the SAME user is idempotent. Breaking that would
  // quarantine a legitimate mutation.
  it('still returns the caller their own row when they retry the same id', async () => {
    const mine = await repo.createFoodItem(OWNER, { ...ITEM, name: 'RV177 My Chicken' })
    const again = await repo.createFoodItem(OWNER, { ...ITEM, name: 'RV177 My Chicken', id: mine.id })
    expect(again.id).toBe(mine.id)
    expect(again.userId).toBe(OWNER)
  })
})
