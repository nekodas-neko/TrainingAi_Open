import type { Pool, PoolClient } from 'pg'

/**
 * Serializes tests that execute a whole migration file against the shared dev database.
 *
 * Q-171: `cable-exercise-merge-migration.test.ts` failed ~1 run in 3 under the full suite and
 * passed alone. It is not a defect in that test — data migrations are **table-wide by nature**, and
 * vitest runs test files in parallel workers against one `trainingai_dev`, so one file's migration
 * rewrites another file's fixture rows mid-test.
 *
 * Measured rather than inferred: seed the Cable test's exact fixture (a `Cable Crunch` log at 20,
 * a `Cable Crunch` PR at 99), then run migration **163** as a concurrent worker would, and that
 * user's PR comes back **20**. Migration 163 step 3 is an unrestricted
 * `UPDATE personal_records … FROM best`, and its step 1 `INSERT INTO exercise_estimates` carries no
 * name filter at all — neither is scoped to 163's own test users, because a data migration has no
 * business being scoped to anyone.
 *
 * So the fix cannot be "scope the migration" (that would break what it is for) and must not be
 * `retry` (Q-171 says so explicitly, and a flaky red is how a real regression gets waved through).
 * It is mutual exclusion: two global migrations must not run against this database at once.
 *
 * The lock is held for the whole test, not just the `run()` call — a sibling migration landing
 * between this test's seed and its assertion corrupts it just as effectively.
 */
const MIGRATION_TEST_LOCK_KEY = 171_0164

/**
 * The backend pids this PROCESS currently holds the lock on, and every pid it has ever held it on.
 *
 * **LA-123 — this exists so a test can assert something that is true of itself.** The obvious
 * check, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'`, reads the whole cluster: not
 * this database, not this session, not this process. Fifteen other files take this same key in
 * parallel vitest workers against the same Postgres, so that count is an assertion about whether
 * somebody else happens to be mid-migration, which is nobody's invariant and went red once on a
 * clean tree.
 *
 * A pid is one live backend, and a backend belongs to one process's pool — so filtering `pg_locks`
 * to these pids (and to this key) keeps the real database evidence while scoping it to connections
 * this process owns. `everHeld` rather than `held` because the assertion worth making runs *after*
 * release: "the locks we took are gone", which a set emptied on release could not express.
 */
const heldPids = new Set<number>()
const everHeldPids = new Set<number>()

/** Every backend pid this process has taken the lock on. See `heldPids` above. */
export function lockPidsEverHeld(): number[] {
  return [...everHeldPids]
}

/** Backend pids this process is holding the lock on right now — empty unless a lock leaked. */
export function lockPidsStillHeld(): number[] {
  return [...heldPids]
}

/** `pg_locks` coordinates for `pg_try_advisory_lock(bigint)`: the key splits across classid/objid,
 *  and `objsubid` is 1 for the single-argument form. Verified against a live backend rather than
 *  read off the documentation. */
export const LOCK_PG_LOCKS_OBJID = MIGRATION_TEST_LOCK_KEY

/**
 * Runs a whole migration file the way `ensureSchema` does — one multi-statement simple query, so
 * Postgres wraps it in a single implicit transaction — with one statement prepended.
 *
 * **DV-3.** The advisory lock above stops two *migrations* running at once. It does nothing about
 * the other 162 test files that create a user and `DELETE FROM users` in `afterAll`, and migrations
 * 163 and 164 both carry
 * `INSERT INTO exercise_estimates … SELECT … FROM personal_records` with no user filter, because a
 * data migration has no business having one. At READ COMMITTED the `INSERT … SELECT` fixes its
 * snapshot at statement start, so it can read a foreign user's `personal_records` rows, block on
 * the referential-integrity check while that user's DELETE is still uncommitted, and then fail with
 * `exercise_estimates_user_id_fkey` the moment the delete commits. That is the CI failure DV-3
 * saw on PR #1419 — one red run out of 997 files, green on re-run.
 *
 * Reproduced deterministically rather than inferred: hold an uncommitted `DELETE FROM users` on a
 * second connection, start the migration, wait for it to block, commit the delete. Without this
 * lock that is `23503 exercise_estimates_user_id_fkey`, three times out of three; with it, green,
 * three times out of three. `migration-test-lock.test.ts` runs exactly that sequence.
 *
 * `SHARE` is the weakest mode that conflicts with the `ROW EXCLUSIVE` a `DELETE` takes, and it is
 * self-compatible, so the migration tests do not block each other on it. Taking it FIRST, before
 * the migration touches anything else, is what keeps it deadlock-free against the ordinary tests:
 * they hold only their own short `DELETE FROM users` lock and never wait on a table this
 * transaction already holds. A test that deleted a user *and* wrote a migration-touched table
 * inside one explicit transaction could still deadlock; none does today, and Postgres would
 * detect it rather than hang.
 *
 * Not a retry, deliberately — Q-171 says so, and a flaky red is how a real regression gets waved
 * through.
 */
export function runMigrationSql(pool: Pool, sql: string) {
  return pool.query(`LOCK TABLE users IN SHARE MODE;\n${sql}`)
}

export interface MigrationLock {
  acquire(): Promise<void>
  release(): Promise<void>
}

/**
 * Advisory locks are per-connection, so this checks one client out of the pool and holds it —
 * `pool.query()` would hand back a different connection and silently drop the lock.
 *
 * `pg_try_advisory_lock` in a poll loop rather than the blocking `pg_advisory_lock`, and the
 * connection is returned to the pool between attempts: a *waiting* test must hold no connection.
 * Measured — with the blocking form, `push-mutations-complete-workout-hr.test.ts` (3.3 s solo
 * against vitest's 5 s default) tipped over the timeout in 2 of 5 full-suite runs, against 8 clean
 * runs on the same tree without this lock. Every worker parks its own pooled connection in a
 * blocked `pg_advisory_lock`, and they come out of one shared `max_connections`.
 */
export function migrationTestLock(getPool: () => Pool): MigrationLock {
  let client: PoolClient | null = null
  let pid: number | null = null
  return {
    async acquire() {
      for (;;) {
        const candidate = await getPool().connect()
        const { rows } = await candidate.query<{ ok: boolean; pid: number }>(
          'SELECT pg_try_advisory_lock($1) AS ok, pg_backend_pid() AS pid', [MIGRATION_TEST_LOCK_KEY])
        if (rows[0].ok) {
          client = candidate
          pid = rows[0].pid
          heldPids.add(pid)
          everHeldPids.add(pid)
          return
        }
        candidate.release()
        await new Promise(r => setTimeout(r, 20))
      }
    },
    async release() {
      if (!client) return
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_TEST_LOCK_KEY])
      } finally {
        if (pid != null) { heldPids.delete(pid); pid = null }
        client.release()
        client = null
      }
    },
  }
}
