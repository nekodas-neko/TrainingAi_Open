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
const { Pool } = require('pg')
const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

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
  const failed = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sqlText = readFileSync(join(migrationsDir, file), 'utf-8')
    try {
      await pool.query(sqlText)
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file])
      ran++
    } catch (err) {
      failed.push(file)
      console.warn(`[migrate] ${file}:`, err.message?.slice(0, 200))
    }
  }

  console.info(`[migrate] applied ${ran}, skipped ${applied.size} already recorded, ${failed.length} failed`)
  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
