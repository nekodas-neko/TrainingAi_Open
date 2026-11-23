import { sql } from 'drizzle-orm'
import type { Db } from './domains/types'

/**
 * #4080 review: how long a Coach apply waits for the lock another writer holds before it gives up.
 *
 * The pool's `statement_timeout` is 15 s (`lib/data/postgres/client.ts`). A lock wait is one statement,
 * so a slow holder (a weekly check-in save takes the same lift lock inside its own longer transaction)
 * ran the waiting apply into that limit and out as a 500. 4 s is well under it, so the apply answers
 * while the person is still looking at the card, and still far above how long a normal holder keeps the
 * lock (a few hundred ms, one transaction). The lift lock is two statements, so the worst wait is twice
 * this, still inside the 15 s. An object, not a constant, so a test can shorten it without sleeping.
 */
export const lockWait = { ms: 4000 }

/**
 * Run `take` (the statements that wait for a lock) with `lock_timeout` set for this transaction only,
 * then put the previous value back. `set_config(..., true)` is `SET LOCAL`: it ends with the
 * transaction, or with the savepoint when this runs nested in a caller's transaction and rolls back, so
 * it never reaches a pooled connection. Restoring afterwards keeps the bound to the wait itself and does
 * not leak into the rest of a caller's longer transaction (the weekly check-in's).
 * Must be called inside a transaction.
 */
export async function withBoundedLockWait<T>(db: Db, take: () => Promise<T>): Promise<T> {
  const prev = (await db.execute(sql`SELECT current_setting('lock_timeout') AS v`)).rows[0]?.v as string | undefined
  await db.execute(sql`SELECT set_config('lock_timeout', ${`${lockWait.ms}ms`}, true)`)
  const out = await take()
  await db.execute(sql`SELECT set_config('lock_timeout', ${prev ?? '0'}, true)`)
  return out
}
