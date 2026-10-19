// A per-key mutual-exclusion lock across requests and replicas (#3079 review, item 4).
//
// Two Oura sleep webhooks for one user can land in the same second. The night re-score reads the
// nights before a write and re-scores after it, so two interleaved runs can let an older read write
// last. `withUserLock` runs one holder per key at a time:
//
//   - **In this process**, callers for the same key queue on a promise chain, so a burst never
//     reaches the database as contention at all.
//   - **Across replicas**, the holder takes a session-level advisory lock on its own connection.
//     Session-level, not transaction-scoped, for the reason `lib/oura/cloud/renewal.ts` gives: the
//     work under the lock is many statements on other connections (a connect backfill writes 90 days
//     of sleep inside it), and a transaction held idle across them is killed by the pool's 15 s
//     `idle_in_transaction_session_timeout` (`client.ts`), dropping the lock mid-run.
//   - **A waiter holds no connection.** It tries the lock, gives the connection back and tries again
//     shortly, so a queue of waiters cannot starve the deliberately small pool.
//
// If the lock cannot be had within `waitMs`, the work runs anyway and the wait is logged: the
// writes under it are Oura's data and must land, and losing ordering for one run is the lesser harm.
import type { Pool } from 'pg'

const chains = new Map<string, Promise<unknown>>()

export interface UserLockOptions {
  waitMs?: number
  pollMs?: number
  label?: string
}

export async function withUserLock<T>(
  pool: Pick<Pool, 'connect'>, key: string, run: () => Promise<T>, opts: UserLockOptions = {},
): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const mine = previous.catch(() => {}).then(() => withDbLock(pool, key, run, opts))
  chains.set(key, mine)
  try {
    return await mine
  } finally {
    if (chains.get(key) === mine) chains.delete(key)
  }
}

async function withDbLock<T>(pool: Pick<Pool, 'connect'>, key: string, run: () => Promise<T>, opts: UserLockOptions): Promise<T> {
  const { waitMs = 30_000, pollMs = 50, label = 'user lock' } = opts
  const deadline = Date.now() + waitMs
  for (;;) {
    const client = await pool.connect()
    let broken: Error | undefined
    const onError = (err: Error) => {
      broken = err
      console.error(`[${label}] database connection error while holding the lock:`, err.message)
    }
    client.on('error', onError)
    let locked = false
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key])
      locked = rows[0]?.locked === true
      if (locked) return await run()
    } finally {
      if (locked && !broken) {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]).catch((err: Error) => { broken = err })
      }
      client.removeListener('error', onError)
      // A client whose unlock failed may still hold the lock; destroy it so the lock goes with it.
      client.release(broken)
    }
    if (Date.now() >= deadline) {
      console.warn(`[${label}] waited ${waitMs} ms for the lock; running without it`)
      return run()
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}
