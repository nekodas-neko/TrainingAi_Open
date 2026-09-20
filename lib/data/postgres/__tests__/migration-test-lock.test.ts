import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  migrationTestLock, lockPidsEverHeld, lockPidsStillHeld, LOCK_PG_LOCKS_OBJID,
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
