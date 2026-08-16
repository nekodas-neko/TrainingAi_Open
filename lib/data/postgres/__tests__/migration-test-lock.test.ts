import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrationTestLock } from './migration-test-lock'

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
    // Nothing may still hold it, or the next file to take it would hang.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)
    expect(rows[0].n).toBe(0)
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
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)
    expect(rows[0].n).toBeGreaterThan(0)
    await lock.release()
  })
})
