// Standalone migration runner for the local dev DB.
// Mirrors lib/data/postgres/client.ts's ensureSchema(), without needing ts-node.
//
// **It records what it applied, and that is not bookkeeping for its own sake (Q-324).**
// `ensureSchema()` — which every DB test and the dev server call — reads `schema_migrations` to
// decide what to skip. This runner used to write nothing there, so a database it had just fully
// migrated looked *empty* to `ensureSchema()`: the next process re-ran all ~200 migration files,
// and under `vitest` that is every worker doing it at once against one Postgres. Measured on a
// freshly-migrated database before this change: `schema_migrations` did not exist at all.
//
// It also made three migrations fail during ordinary local setup — the `claude_ro` view generators
// include `schema_migrations` in the schema they rebuild, and it was not there to rebuild.
//
// A file is recorded ONLY when it applied cleanly. A migration that genuinely failed must stay
// unrecorded so `ensureSchema()` retries it, exactly as it does in production — recording a failure
// here would silently skip it forever.
//
// **It classifies "already there" the same way `ensureSchema()` does, and exits non-zero when
// anything else fails.** Neither was true until 2026-08-20, and the two halves compounded. This
// runner had no error classifier at all, so on any database that already held the objects it
// reported four migrations as *failed* — 054 and 055 (42710, a UNIQUE constraint Postgres gives no
// `IF NOT EXISTS` for), 082 (23505, a seed row) and 157 (42P07, a table) — while `ensureSchema()`
// read the same four as "already present" and carried on. Two runners disagreeing about what a
// failure is, in the file whose own docstring says it mirrors the other.
//
// And it returned 0 regardless, so the CI job named **Migration Check** — which runs this script and
// nothing else — could not fail on a genuinely broken migration. It would print `1 failed` and go
// green.
//
// **A file that fails idempotently is still not recorded, deliberately.** `isIdempotentMigrationError`
// fires on the FIRST statement that collides, and the statements after it may never have run —
// migration 157 is a `CREATE TABLE` followed by eight `ALTER TABLE … ADD COLUMN`s, so recording it
// on a duplicate-table error could freeze a half-applied migration as done, forever. Retrying every
// boot is noisy; recording a partial application is unrecoverable.
const { Pool } = require('pg')
const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

const IDEMPOTENT_SQLSTATES = new Set(Object.keys(
  require('../../lib/data/postgres/idempotent-sqlstates.json').codes,
))

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const migrationsDir = join(__dirname, '../../lib/data/postgres/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  // Same shape as ensureSchema's, so the two agree on what "applied" means.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const { rows } = await pool.query('SELECT filename FROM schema_migrations')
  const applied = new Set(rows.map(r => r.filename))

  let ran = 0
  const alreadyPresent = []
  const failed = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sqlText = readFileSync(join(migrationsDir, file), 'utf-8')
    try {
      await pool.query(sqlText)
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file])
      ran++
    } catch (err) {
      if (IDEMPOTENT_SQLSTATES.has(err.code)) {
        alreadyPresent.push(file)
        continue
      }
      failed.push(`${file} [${err.code ?? 'no code'}]`)
      console.error(`[migrate] FAILED ${file} [${err.code ?? 'no code'}]:`, err.message?.slice(0, 200))
    }
  }

  if (alreadyPresent.length > 0) {
    console.info(`[migrate] ${alreadyPresent.length} already present: ${alreadyPresent.join(', ')}`)
  }
  console.info(
    `[migrate] applied ${ran}, skipped ${applied.size} already recorded, ` +
    `${alreadyPresent.length} already present, ${failed.length} failed`,
  )
  await pool.end()

  if (failed.length > 0) {
    console.error(`[migrate] ${failed.length} migration(s) DID NOT APPLY: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
