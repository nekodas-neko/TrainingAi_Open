// Staged-race tests hold a lock open on one connection and need to know when the code under test is
// parked on it. Polling `pg_stat_activity` for "any session waiting on a lock" is not enough: any
// other session on the same database (a dev server, a second test process) ends the wait early and
// the race is never staged (#3929). This waits for a backend that is blocked by the holder itself.
import { sql, type SQL } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'

/** The backend pid a Drizzle transaction runs on. */
export async function txBackendPid(tx: { execute: (q: SQL) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<number> {
  const { rows } = await tx.execute(sql`SELECT pg_backend_pid() AS pid`)
  return Number(rows[0].pid)
}

/** The backend pid of a pg connection. */
export async function clientBackendPid(client: Pick<PoolClient, 'query'>): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  return Number(rows[0].pid)
}

/**
 * Wait until some backend is waiting on a lock that `holderPid` holds, and fail loudly if none ever
 * is: a race that was never staged must not pass as if it had been.
 */
export async function waitUntilBlockedBy(pool: Pick<Pool, 'query'>, holderPid: number, opts: { tries?: number; everyMs?: number } = {}): Promise<number> {
  const { tries = 400, everyMs = 25 } = opts
  for (let i = 0; i < tries; i++) {
    const { rows } = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`, [holderPid])
    if (rows.length > 0) return rows[0].pid
    await new Promise(r => setTimeout(r, everyMs))
  }
  throw new Error(`no backend ever waited on a lock held by pid ${holderPid}: the race was not staged`)
}
