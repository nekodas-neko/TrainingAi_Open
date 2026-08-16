import { Pool } from 'pg'

/**
 * Isolated connection pool for the read-only query endpoint.
 *
 * Deliberately NOT the app's pool. That one is `max: 10`, and exhausting it took production down in
 * session 165 — an ad-hoc analytical query must be structurally incapable of starving the app, so
 * this gets its own two connections and nothing more.
 *
 * The connection string must authenticate as `claude_readonly`, a role created out-of-band with
 * SELECT-only grants on the `claude_ro` view schema and `default_transaction_read_only = on`. That
 * role — not anything in this file — is what makes the endpoint read-only. See
 * docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md §4.1.
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
