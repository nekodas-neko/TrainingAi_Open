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
