// Q-481: the outbox delivers at-least-once, and `body_metrics` + `waterMlDelta` was the one push
// branch of nineteen that is not idempotent under replay. Three deliveries of one 250 ml quick-add
// measured 750 ml, each answering {"processed":1,"errors":[]}.
//
// Replay is reachable by ordinary means on the canonical runtime: if a push reaches the server and
// commits but the response is lost — signal dropped mid-response, the OS killing a backgrounded app,
// a timeout — the mutation is still `pending` on the device and the next sync re-pushes it.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job (no DATABASE_URL).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000000481'
const DATE = '2026-08-09'

describe.skipIf(!canRun)('water quick-add replay (Q-481)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const water = async () => {
    const r = await pool.query('SELECT water_ml FROM body_metrics WHERE user_id = $1 AND date = $2', [TEST_USER_ID, DATE])
    return r.rows[0]?.water_ml ?? null
  }
  const push = (id: string, delta: number) =>
    repo.pushMutations(TEST_USER_ID, [{ id, domain: 'body_metrics', date: DATE, payload: { waterMlDelta: delta } }])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `water-replay-${TEST_USER_ID}@example.com`],
    )
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM applied_mutations WHERE user_id = $1', [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM applied_mutations WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  it('counts one delivery once, and three deliveries of the SAME id still once', async () => {
    expect(await push('water-fixed-id-001', 250)).toEqual({ processed: 1, errors: [] })
    expect(await water()).toBe(250)

    // The replays. Each must report processed — it WAS processed, on the first delivery — so the
    // client confirms and drops the row instead of retrying it forever.
    expect(await push('water-fixed-id-001', 250)).toEqual({ processed: 1, errors: [] })
    expect(await push('water-fixed-id-001', 250)).toEqual({ processed: 1, errors: [] })

    expect(await water()).toBe(250)
  })

  it('still SUMS genuinely distinct quick-adds — the fix must not reintroduce SYNC-P7', async () => {
    await push('water-a', 250)
    await push('water-b', 300)
    await push('water-c', 150)

    expect(await water()).toBe(700)
  })

  it('sums distinct adds arriving concurrently, and refuses a concurrent duplicate of one id', async () => {
    await Promise.all([push('conc-a', 100), push('conc-b', 100), push('conc-a', 100), push('conc-b', 100)])

    // Two distinct ids, each applied once: the claim is the exclusion, so two simultaneous replays
    // of one id cannot both read "not applied" and both add.
    expect(await water()).toBe(200)
  })

  it('scopes the ledger to the user, so two people may hold the same mutation id', async () => {
    const other = '00000000-0000-4000-8000-000000000482'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [other, `water-replay-other-${other}@example.com`],
    )
    try {
      await push('shared-id', 250)
      await repo.pushMutations(other, [{ id: 'shared-id', domain: 'body_metrics', date: DATE, payload: { waterMlDelta: 400 } }])

      expect(await water()).toBe(250)
      const r = await pool.query('SELECT water_ml FROM body_metrics WHERE user_id = $1 AND date = $2', [other, DATE])
      expect(r.rows[0].water_ml).toBe(400)
    } finally {
      await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [other])
      await pool.query('DELETE FROM applied_mutations WHERE user_id = $1', [other])
      await pool.query('DELETE FROM users WHERE id = $1', [other])
    }
  })

  it('does not claim the id when the write is refused, so a rejected delta can be retried', async () => {
    // Implausible delta: the branch throws before the increment. The claim must roll back with it,
    // or a corrected re-push of the same mutation would be silently swallowed as "already applied".
    const bad = await push('water-bad', 999_999)
    expect(bad.processed).toBe(0)
    expect(bad.errors).toHaveLength(1)

    const rows = await pool.query('SELECT 1 FROM applied_mutations WHERE user_id = $1 AND mutation_id = $2', [TEST_USER_ID, 'water-bad'])
    expect(rows.rowCount).toBe(0)
  })
})
