// Q-134: updateSupplement passed the raw request body into Drizzle `.set()` — the `Omit<>` is
// compile-time only, so userId/deletedAt/createdAt were all settable column keys, and the only
// thing stopping it was the single caller's `.strict()` schema one route away.
//
// The updated_at assertion below is a regression guard, not a bug fix: Q-124(c) claimed a web edit
// never bumped it and so never synced, which is wrong — migration 078 installs a BEFORE UPDATE
// trigger on this table. It is asserted here because the column is what getSyncDelta filters on,
// and it now has two independent producers (the trigger and the repo function).
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-0000000d0c01'
const OTHER = '00000000-0000-4000-8000-0000000d0c02'

describe.skipIf(!canRun)('updateSupplement write shape', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let supplementId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, tag] of [[OWNER, 'owner'], [OTHER, 'other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `update-supplement-${tag}@example.com`],
      )
    }
    const r = await pool.query(
      `INSERT INTO supplements (user_id, name, dose, sort_order, updated_at)
       VALUES ($1, 'Creatine', '5g', 0, now() - interval '1 hour') RETURNING id`,
      [OWNER],
    )
    supplementId = r.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [OWNER, OTHER]) {
      await pool.query(`DELETE FROM supplements WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('bumps updated_at so the edit reaches getSyncDelta, without clobbering unsent fields', async () => {
    const before = await pool.query(`SELECT updated_at FROM supplements WHERE id = $1`, [supplementId])
    await repo.updateSupplement(supplementId, OWNER, { name: 'Creatine Monohydrate' })
    const after = await pool.query(`SELECT name, dose, updated_at FROM supplements WHERE id = $1`, [supplementId])

    expect(after.rows[0].name).toBe('Creatine Monohydrate')
    expect(after.rows[0].dose).toBe('5g')
    expect(new Date(after.rows[0].updated_at).getTime())
      .toBeGreaterThan(new Date(before.rows[0].updated_at).getTime())
  })

  it('ignores column keys outside the allowlist rather than writing them', async () => {
    // The shape a non-strict caller would hand it. Cast because the type forbids these — the point
    // is that the type is the only thing that used to forbid them.
    await repo.updateSupplement(supplementId, OWNER, {
      name: 'Creatine Monohydrate',
      userId: OTHER,
      deletedAt: new Date(),
      createdAt: new Date('2000-01-01'),
    } as never)

    const { rows } = await pool.query(
      `SELECT user_id, deleted_at, created_at FROM supplements WHERE id = $1`, [supplementId])
    expect(rows[0].user_id).toBe(OWNER)
    expect(rows[0].deleted_at).toBeNull()
    expect(new Date(rows[0].created_at).getFullYear()).toBeGreaterThan(2000)
  })
})
