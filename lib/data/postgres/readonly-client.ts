import { Pool, type QueryResult, type QueryResultRow } from 'pg'

/**
 * Isolated connection pool for the read-only query endpoint.
 *
 * Deliberately NOT the app's pool. That one is `max: 10`, and exhausting it took production down in
 * session 165 — an ad-hoc analytical query must be structurally incapable of starving the app, so
 * this gets its own two connections and nothing more.
 *
 * The connection string must authenticate as `claude_readonly`, a role created out-of-band with
 * SELECT-only grants on the `claude_ro` view schema and `default_transaction_read_only = on`. See
 * docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md §4.1.
 *
 * **This used to say the role — not anything in this file — is what makes the endpoint read-only.
 * That was wrong, and it is the whole of RV-190.** The role's grants are real, but its read-only
 * flag, statement timeout and owner scope are session DEFAULTS a submitted query can `SET` its way
 * out of, and they persisted on a pool that was never reset. The GRANTs hold; the three settings
 * did not. Every query on this pool therefore goes through {@link runScoped}, which reasserts them
 * per query inside a read-only transaction — see its note.
 */

/** Hard ceiling on connections this pool may hold. Small on purpose — see above. */
export const READONLY_POOL_MAX = 2

let _pool: Pool | null = null

/** True when the read-only DB connection is configured. Callers must fail closed when it isn't. */
export function isReadonlyDbConfigured(): boolean {
  return !!process.env.CLAUDE_DB_READONLY_URL
}

/**
 * The read-only pool, constructed lazily so it does not exist at all while the feature is disabled.
 * Throws when unconfigured — callers check {@link isReadonlyDbConfigured} first.
 */
export function getReadonlyPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.CLAUDE_DB_READONLY_URL
    if (!connectionString) throw new Error('CLAUDE_DB_READONLY_URL is not set')
    _pool = new Pool({
      connectionString,
      ssl: (process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true')
        ? { rejectUnauthorized: false }
        : false,
      max: READONLY_POOL_MAX,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      // Belt to the role-level braces: the role already sets these, but a connection-level copy
      // means a mis-provisioned role still can't hold a slot open indefinitely.
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
    })
    // Same non-negotiable as the main pool: without an 'error' listener, an error on an idle client
    // surfaces as an unhandledRejection and crash-loops the process.
    _pool.on('error', (err) => {
      console.error('[pg readonly pool] idle client error:', (err as Error).message)
    })
  }
  return _pool
}

/**
 * Non-secret description of the configured connection — username, host, port, database. Exists
 * because a misconfigured `CLAUDE_DB_READONLY_URL` fails as `password authentication failed for
 * user "<x>"`, and without seeing which username is actually in play, diagnosing it costs a deploy
 * cycle per guess. **Never returns the password.**
 */
export function describeReadonlyConnection(): {
  configured: boolean; user?: string; host?: string; port?: string; database?: string; parseError?: string
} {
  const raw = process.env.CLAUDE_DB_READONLY_URL
  if (!raw) return { configured: false }
  try {
    const u = new URL(raw)
    return {
      configured: true,
      user: decodeURIComponent(u.username),
      host: u.hostname,
      port: u.port || '5432',
      database: u.pathname.replace(/^\//, ''),
    }
  } catch (err) {
    return { configured: true, parseError: err instanceof Error ? err.message : String(err) }
  }
}

/** Test seam — drops the memoised pool so a test can re-read the environment. */
export function __resetReadonlyPoolForTests(): void {
  _pool = null
}

/** The statement timeout every scoped query runs under, matching the role's own default. */
export const SCOPED_STATEMENT_TIMEOUT_MS = 10_000

/**
 * Run one ad-hoc query with its protections reasserted per query, and torn down afterwards (RV-190).
 *
 * **The defect this closes.** The `claude_readonly` role's three protections — the owner scope
 * `app.claude_ro_owner`, `default_transaction_read_only` and `statement_timeout` — are all session
 * DEFAULTS set with `ALTER ROLE`. A caller can overwrite any of them with a plain `SET`, and
 * because each query ran in autocommit on a two-connection pool that is never reset, the override
 * outlived the request: it rode the pooled connection into the next query. So one request could
 * turn writes back on, lift the time limit, or **re-point the owner scope at another user — after
 * which a later, honest query reads that user's rows.**
 *
 * **Why a transaction is the fix rather than sanitising the SQL.** `READ ONLY` on the transaction
 * cannot be lifted from inside it (`SET TRANSACTION READ ONLY` is one-way, and a `SET` of the
 * session flag does not apply to the transaction already in progress), and `ROLLBACK` discards
 * every session-level setting the query made along with it. That holds for SQL nobody has parsed,
 * which is the whole point of an ad-hoc query endpoint — a blocklist of statements would have to
 * be complete to work, and this does not.
 *
 * **Which part is load-bearing, measured by mutation rather than asserted.** The `RESET ALL` on
 * the way IN is: removing it is the only change here that fails a test, because it is what stops a
 * connection dirtied by an earlier query from scoping this one. The rest is belt, in the same sense
 * as this pool's connection-level `statement_timeout` above:
 *
 *   · `BEGIN TRANSACTION READ ONLY` is redundant **while the role is correctly provisioned** — its
 *     `default_transaction_read_only = on` already makes every transaction read-only, so dropping
 *     the keyword changes nothing observable here. It is what holds if that role default is ever
 *     missing, which is the failure this file already guards against elsewhere.
 *   · `ROLLBACK` over `COMMIT`, and `RESET ALL` on the way out, are likewise not independently
 *     observable once the inbound reset exists. They state the intent and cost a round trip.
 *
 * Do not read the belt as tested: a change to any of it will pass this suite.
 */
export async function runScoped<R extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  sql: string,
  opts: { ownerId?: string; timeoutMs?: number } = {},
): Promise<QueryResult<R>> {
  const client = await pool.connect()
  try {
    // BEFORE, not only after. A connection can already be dirty — from a path that does not go
    // through here, or from a request served before this wrapper existed — and `SET LOCAL` only
    // overrides what it names, so an inherited session-level `app.claude_ro_owner` would still be
    // in force for this very query. Resetting on the way in is what makes the scope this query
    // runs under depend on the role rather than on whatever ran last. The test that drives the
    // unwrapped path proves it: without this, the first scoped query still read the leaked owner.
    await client.query('RESET ALL')
    await client.query('BEGIN TRANSACTION READ ONLY')
    try {
      // `SET LOCAL` lasts exactly as long as the transaction, so neither of these can leak.
      await client.query(`SET LOCAL statement_timeout = ${Number(opts.timeoutMs ?? SCOPED_STATEMENT_TIMEOUT_MS)}`)
      // Only when a caller names one. Left unset, `current_setting` falls through to the role's
      // default, which is the configured owner — the same scope, without this deciding it.
      if (opts.ownerId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.ownerId)) {
          throw new Error('ownerId must be a uuid')
        }
        await client.query(`SET LOCAL app.claude_ro_owner = '${opts.ownerId}'`)
      }
      return await client.query<R>(sql)
    } finally {
      // Always, including after a failed query: an aborted transaction still holds its connection's
      // state until something ends it.
      await client.query('ROLLBACK').catch(() => {})
    }
  } finally {
    await client.query('RESET ALL').catch(() => {})
    client.release()
  }
}
