import { getPool } from './client'
import { signedInBeforeCutoff } from '@/lib/auth/session-cutoff'

/**
 * #3369 (e) — the in-flight window of an admin reset.
 *
 * A reset deletes the users row and re-creates it under the SAME id. A request that passed `auth()`
 * just before the commit and writes just after it therefore passes the foreign key and lands in the
 * fresh account: the middleware's 409 gate and `auth()`'s cut-off both ran before the commit and
 * cannot see it. Re-reading the cut-off in a transaction does not help for the paths that write in
 * many statements and have no transaction (`pushMutations`), so this is a readers-writer barrier
 * on a Postgres advisory lock instead:
 *
 * - **A write path takes the lock SHARED**, then reads `sessions_valid_from` and refuses if its
 *   sign-in (`signedInAt`) is older, then does its writes while still holding the lock.
 * - **A reset takes it EXCLUSIVE** at the top of its transaction (`lockUserWritesForReset`). It
 *   waits for the writes already in flight (which it then deletes with the rest), and every write
 *   that starts after it queues behind it, then finds the cut-off and is refused.
 *
 * So a write either finishes before the reset (and is wiped by it) or starts after it (and is
 * refused). Nothing lands in the fresh account.
 *
 * Costs, stated: one extra pooled connection is held for the duration of a covered write, and a
 * covered write waits behind a reset in progress. Only the sync push and the ring-sample ingest take
 * it; the other upload paths are covered by the 409 gate alone, whose remaining window is a request
 * already in its handler when a reset commits.
 *
 * **At most `maxBarrierHolders()` covered writes hold a lock connection at once (#3672).** The lock
 * connection and the connection `run()` queries on come from the same pool. With ten covered writes
 * in flight on a pool of ten, every connection was a lock holder waiting for a query connection: all
 * of them waited out `connectionTimeoutMillis` (5 s) and failed, and every other route stalled with
 * them. Preview's "Sync now" starts seven pushes at once, and the current app's push and the ring
 * ingest take the same barrier, so ten is reachable. A covered write past the cap waits here, in
 * memory and holding no connection, until a holder finishes. The gate is per process, which is the
 * unit the pool is per.
 */
export const CUT_OFF = Symbol('write-cut-off')

/**
 * Lock holders allowed at once: four on the pool of ten, so the holders and their query connections
 * use at most eight and two stay free for every other route. A smaller pool scales it down, never
 * below one, so a holder always has a connection left to query on.
 */
export function maxBarrierHolders(poolMax = getPool().options.max ?? 10): number {
  return Math.max(1, Math.min(4, Math.floor((poolMax - 1) / 2)))
}

let holders = 0
const waiting: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (holders < maxBarrierHolders()) { holders++; return }
  // The slot is handed over by `releaseSlot`, which keeps `holders` unchanged on a hand-over.
  await new Promise<void>(resolve => waiting.push(resolve))
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else holders--
}

/** Test seam: covered writes holding a lock connection right now, and those queued for one. */
export function barrierOccupancy(): { holders: number; waiting: number } {
  return { holders, waiting: waiting.length }
}

const lockKey = (userId: string) => `user-writes:${userId.toLowerCase()}`

export async function withUserWriteBarrier<T>(
  userId: string,
  signedInAt: number | undefined,
  run: () => Promise<T>,
): Promise<T | typeof CUT_OFF> {
  await acquireSlot()
  try {
    return await holdBarrier(userId, signedInAt, run)
  } finally {
    releaseSlot()
  }
}

async function holdBarrier<T>(
  userId: string,
  signedInAt: number | undefined,
  run: () => Promise<T>,
): Promise<T | typeof CUT_OFF> {
  const client = await getPool().connect()
  let locked = false
  try {
    await client.query('SELECT pg_advisory_lock_shared(hashtextextended($1, 0))', [lockKey(userId)])
    locked = true
    const { rows } = await client.query<{ sessions_valid_from: Date | null }>(
      'SELECT sessions_valid_from FROM users WHERE id = $1', [userId])
    if (rows.length === 0 || signedInBeforeCutoff(signedInAt, rows[0].sessions_valid_from)) return CUT_OFF
    return await run()
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock_shared(hashtextextended($1, 0))', [lockKey(userId)])
      client.release()
    } catch (err) {
      // An unlock that failed leaves a session-level lock on this connection: drop the connection.
      client.release(err as Error)
    }
  }
}

/** The key a reset locks exclusively (`erase` runs `pg_advisory_xact_lock` on it). */
export { lockKey as userWriteLockKey }
