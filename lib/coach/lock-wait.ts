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
 * #4098: how long a READ that repairs something (the program-phase sync, the session read's baseline
 * self-heal) may wait for a lock. A repair is retried by the next read, so a read never waits the 4 s
 * a write does: it try-locks the lift lock (no wait) and gives its row waits this much, then skips.
 */
export const readLockWait = { ms: 300 }

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

/**
 * #4082: the one lock every writer of a person's lift preferences and stored plans takes FIRST.
 *
 * Before it, each writer took its own locks in its own order: a lift's advisory lock, then its preference
 * row, then the stored plan rows. One stored plan holds several lifts, so a weekly check-in (lift A, then
 * lift B, in one transaction) and a Coach apply on lift B met in a cycle: the check-in held plan row P and
 * wanted B, the apply held B and wanted P. Postgres ended it with 40P01 after a second, and one side
 * answered 500. With this lock taken before anything else, two such writers cannot hold one thing each
 * and want the other's: the second waits here, holding nothing, until the first commits.
 *
 * Per user, so it queues only one person's own lift changes behind each other (a tap, an undo, a check-in
 * save: each a short transaction); another user's writers never see it. Transaction-scoped, so it is
 * released at commit or rollback with no cleanup, and re-taking it inside the same transaction (the
 * check-in takes it for the whole save, and each lift apply nested in it takes it again) is free.
 * Bounded like the others: past `lockWait` the caller gets `busy`, not a statement timeout.
 */
// #4098: the table of every writer that holds more than one of these rows, and why none can cycle, is in
// docs/lift-write-lock-order.md. A new writer is added there in the same PR.
export async function lockLiftWrites(db: Db, userId: string): Promise<void> {
  await withBoundedLockWait(db, async () => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext(${userId}))`)
  })
}

/** #4098: take the lift-write lock only if it is free right now, never waiting. Inside a transaction. */
export async function tryLiftWrites(db: Db, userId: string): Promise<boolean> {
  const res = await db.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('lift_writes:user'), hashtext(${userId})) AS ok`)
  return res.rows[0]?.ok === true
}

/**
 * #4082: run `run` in a transaction that holds the per-user, per-domain lock first, for a Coach apply
 * whose "read the current value, then write" must not interleave with another apply of the same thing
 * (nutrition targets, user goals, program phase, early deload). The second apply waits here, then reads
 * what the first wrote and is refused as stale instead of recording the same "before" twice. Nested in a
 * caller's transaction this is a savepoint and the lock lasts to the outer commit. Bounded: a wait past
 * `lockWait` throws 55P03 before anything is written, which `applyCoachPatch` answers as `busy`.
 */
export async function withDomainLock<T>(db: Db, userId: string, domain: string, run: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const t = tx as unknown as Db
    await withBoundedLockWait(t, async () => {
      await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`coach_apply:${domain}`}), hashtext(${userId}))`)
    })
    return run(t)
  })
}
