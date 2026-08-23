import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'
import idempotentSqlstates from './idempotent-sqlstates.json'

let _pool: Pool | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let schemaApplied = false

/**
 * Pool size. 10 unless `PG_POOL_MAX` lowers it, and it can only ever lower it — total connections
 * are `max` × (replicas + workers) and must stay under the Railway Postgres limit (CLAUDE.md), so an
 * env var that could *raise* this would be a way to breach that budget by typo.
 *
 * The one caller that sets it is the BLE rollup worker (`lib/oura-ble/rollup-worker.ts`), which runs
 * this same module in a `worker_threads` realm and would otherwise open a second pool of 10. It asks
 * for 2 — the `claude_readonly` precedent — so a replica running a rollup holds 12, not 20.
 */
function poolMax(): number {
  const raw = Number(process.env.PG_POOL_MAX)
  return Number.isInteger(raw) && raw > 0 && raw < 10 ? raw : 10
}

export function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: (process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true')
        ? { rejectUnauthorized: false }
        : false,
      max: poolMax(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Auto-reap stuck work so a crash mid-transaction can't leave an orphaned
      // `idle in transaction` session holding a connection slot (and locks)
      // forever — the failure mode behind the connection-saturation outage.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 15_000,
    })
    // Required by node-postgres: without an 'error' listener, an error on an
    // idle/backend client (e.g. the DB dropping a connection during a blip)
    // surfaces as an unhandledRejection that crashes the process. Swallow and
    // log it instead — the pool replaces the dead client on the next acquire.
    _pool.on('error', (err) => {
      console.error('[pg pool] idle client error:', (err as Error).message)
    })
  }
  return _pool
}

export function getDb() {
  if (!_db) _db = drizzle(getPool(), { schema })
  return _db
}

/**
 * SQLSTATEs that mean "the object is already there" — the expected outcome of re-running an
 * idempotent migration against a database that already has it, not a failure.
 *
 * The list itself lives in `idempotent-sqlstates.json` so `scripts/local-db/migrate.js` can read
 * the same one. That script's docstring says it mirrors this function, and until 2026-08-20 it did
 * not: it had no classifier at all, so it reported four already-applied migrations as failures on
 * every run against an existing database.
 */
const IDEMPOTENT_SQLSTATES = new Set(Object.keys(idempotentSqlstates.codes))

export function isIdempotentMigrationError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code !== undefined && IDEMPOTENT_SQLSTATES.has(code)
}

export async function ensureSchema(): Promise<void> {
  if (schemaApplied) return
  const pool = getPool()

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
  } catch (err) {
    // 23505 = unique_violation: two replicas raced to create the table; the winner already created it
    if ((err as { code?: string }).code !== '23505') throw err
  }

  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')
  const applied = new Set(rows.map(r => r.filename))

  const migrationsDir = join(process.cwd(), 'lib/data/postgres/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  let ran = 0
  const alreadyPresent: string[] = []
  const failed: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sqlText = readFileSync(join(migrationsDir, file), 'utf-8')
    try {
      await pool.query(sqlText)
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file])
      ran++
    } catch (err) {
      if (isIdempotentMigrationError(err)) {
        alreadyPresent.push(file)
        continue
      }
      // A migration that genuinely did not apply. It is NOT recorded in schema_migrations, so it
      // is retried on every boot — which is why one of these can print forever and still be real.
      const code = (err as { code?: string }).code ?? 'no code'
      failed.push(`${file} [${code}]`)
      console.error(`[ensureSchema] FAILED ${file} [${code}]:`, (err as Error).message?.slice(0, 200))
    }
  }

  if (alreadyPresent.length > 0) {
    console.info(`[ensureSchema] ${alreadyPresent.length} already present: ${alreadyPresent.join(', ')}`)
  }
  console.info(
    `[ensureSchema] ${ran} applied, ${alreadyPresent.length} already present, ${failed.length} failed`,
  )
  if (failed.length > 0) {
    // Deliberately not thrown. A migration that cannot apply is usually permanent (a schema the
    // file can no longer produce), so failing closed here would crash-loop every boot in
    // production rather than surface anything new. Loud and non-fatal is the trade.
    console.error(`[ensureSchema] ${failed.length} migration(s) DID NOT APPLY: ${failed.join(', ')}`)
  }
  schemaApplied = true
}
