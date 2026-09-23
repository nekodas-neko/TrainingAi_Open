import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  migrationTestLock, lockPidsEverHeld, lockPidsStillHeld, LOCK_PG_LOCKS_OBJID, runMigrationSql,
} from './migration-test-lock'

/**
 * Q-171: the lock is the whole fix, so it needs to be shown holding rather than assumed. A helper
 * that silently no-ops — because the advisory lock was taken on a pooled connection that got handed
 * back, say — would leave the flake exactly as it was while looking fixed.
 */

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('migrationTestLock', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  afterAll(async () => {
    if (!canRun) return
    // Nothing **of ours** may still hold it, or the next file in this worker would hang.
    //
    // **LA-123: this used to count advisory locks across the whole cluster, which is not an
    // invariant this file can own.** `pg_locks` is scoped to neither database, session nor process,
    // and fifteen sibling files take this same key in parallel vitest workers against one Postgres
    // — so the old assertion went red whenever one of them happened to be mid-migration as this
    // file finished, which it did once on a clean tree (`1 file failed` against `0 tests failed`,
    // the signature of a hook). Scoping to the backend pids this process actually took the lock on
    // keeps the database evidence and drops the race: a pid is one live backend, and a backend
    // belongs to one process's pool.
    expect(lockPidsStillHeld(), 'a lock this file took was never released').toEqual([])
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND objid = $1 AND pid = ANY($2::int[])`,
      [LOCK_PG_LOCKS_OBJID, lockPidsEverHeld()])
    expect(rows[0].n, 'postgres still shows our key held on a connection we used').toBe(0)
  })

  it('a second holder waits until the first releases', async () => {
    const first = migrationTestLock(() => pool)
    const second = migrationTestLock(() => pool)

    await first.acquire()
    let secondAcquired = false
    const pending = second.acquire().then(() => { secondAcquired = true })

    // Give it a real chance to acquire; if the lock were a no-op it would have by now.
    await new Promise(r => setTimeout(r, 250))
    expect(secondAcquired).toBe(false)

    await first.release()
    await pending
    expect(secondAcquired).toBe(true)
    await second.release()
  })

  it('release is safe to call without a matching acquire', async () => {
    // afterEach runs even when beforeEach threw before acquiring.
    const lock = migrationTestLock(() => pool)
    await expect(lock.release()).resolves.toBeUndefined()
  })

  it('holds the lock on one connection, so a pool with traffic cannot lose it', async () => {
    const lock = migrationTestLock(() => pool)
    await lock.acquire()
    // Churn the pool: if the lock rode on a returned connection, these would free it.
    await Promise.all(Array.from({ length: 5 }, () => pool.query('SELECT 1')))
    // Scoped to OUR pid (LA-123). Unscoped, this passed as readily on a sibling worker's lock as
    // on its own — weaker than it looked rather than broken, and it would have gone the same way
    // as the hook above the moment it mattered. This is also the assertion that keeps the helper
    // honest: a no-op that never took the lock could not produce a row here.
    const [pid] = lockPidsStillHeld()
    expect(pid, 'acquire must record the backend it took the lock on').toBeTypeOf('number')
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND objid = $1 AND pid = $2`,
      [LOCK_PG_LOCKS_OBJID, pid])
    expect(rows[0].n).toBe(1)
    await lock.release()
  })
})

/**
 * DV-3 — the failure the advisory lock above does NOT cover.
 *
 * 171 test files `DELETE FROM users`; nine of them take that lock. Migrations 163 and 164 both
 * insert into `exercise_estimates` from an unfiltered `personal_records` scan, so a foreign user
 * deleted mid-statement takes the migration down with `exercise_estimates_user_id_fkey`.
 *
 * The sequence below is the race made deterministic: the delete is held open until the migration
 * is *observably blocked* (polled out of `pg_stat_activity`, not slept on), and only then
 * committed. Against `pool.query(sql)` this is red three times out of three; against
 * `runMigrationSql` it is green three times out of three.
 */
describe.skipIf(!canRun)('runMigrationSql — a foreign user deleted mid-migration (DV-3)', () => {
  let pool: import('pg').Pool
  const FOREIGN = '00000000-0000-4000-8000-0000000d0303'
  const migration163 = () =>
    readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/163_personal_records_reconcile.sql'), 'utf8')

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [FOREIGN])
  })

  /** Wait until some backend running this migration is parked on a lock. */
  async function migrationIsBlocked(): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%exercise_estimates%'`)
      if (rows[0].n > 0) return
      await new Promise(r => setTimeout(r, 25))
    }
    throw new Error('the migration never blocked — the race was not set up')
  }

  it('does not fail on exercise_estimates_user_id_fkey when the user vanishes mid-statement', async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [FOREIGN])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane')`, [FOREIGN, `dv3-${FOREIGN}@example.com`])
    // A PR with no backing log, so step 1 preserves it into exercise_estimates.
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
       VALUES ($1, 'DV3 Foreign Lift', 123.5, now())`, [FOREIGN])

    const deleter = await pool.connect()
    try {
      await deleter.query('BEGIN')
      await deleter.query(`DELETE FROM users WHERE id = $1`, [FOREIGN])

      const migrating = runMigrationSql(pool, migration163())
      const settled = migrating.then(() => 'ok' as const, e => e as Error)
      await migrationIsBlocked()
      await deleter.query('COMMIT')

      expect(await settled).toBe('ok')
    } finally {
      deleter.release()
      await pool.query(`DELETE FROM users WHERE id = $1`, [FOREIGN])
    }
  }, 30_000)
})
