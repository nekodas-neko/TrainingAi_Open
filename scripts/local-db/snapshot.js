#!/usr/bin/env node
// pnpm db:snapshot — fetches a Q-530 admin DB snapshot and restores it into the LOCAL dev DB.
// docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md §5.
//
// Usage:
//   SNAPSHOT_URL='https://<railway-app>/api/admin/db-snapshot?bulk=0' \
//   ADMIN_SNAPSHOT_SECRET=<the secret> \
//   node scripts/local-db/snapshot.js
//
// A snapshot nobody can load is a file, not a capability — this is the round-trip, not an
// afterthought. It restores DATA into whatever schema `pnpm db:local` already applied; the
// snapshot never carries schema, migrations are the schema (plan §9).
const { Pool } = require('pg')
const { execSync } = require('child_process')
const path = require('path')

const TARGET_URL = process.env.DATABASE_URL
  ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'

// ── 1. Refuse anything that isn't the local dev DB. Hard guard, first thing, before anything is
// fetched. This command TRUNCATEs tables; pointing it at a Railway URL must be impossible, not
// merely discouraged. ──────────────────────────────────────────────────────────────────────────
function assertLocalTarget(url) {
  // `new URL()` throws on the Unix-socket form the session-start hook actually writes —
  // `postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433` has an EMPTY host between
  // `@` and `/`, which the WHATWG URL parser rejects outright. Caught locally: this guard is the
  // one thing standing between a mistaken run and TRUNCATEing a real database, so it must not
  // itself fail closed by throwing "not a valid URL" on the sandbox's own default. Regex instead —
  // tolerant of the empty-host form, and still refuses anything that isn't unambiguously local.
  const m = url.match(/^[a-z]+:\/\/[^@/]*@?([^/?]*)(?:\/[^?]*)?(?:\?(.*))?$/i)
  if (!m) throw new Error(`DATABASE_URL is not a recognisable connection string: ${url}`)
  const [, hostport, query] = m
  const [hostFromUrl, portFromUrl] = hostport.split(':')
  const params = new URLSearchParams(query ?? '')
  const host = hostFromUrl || params.get('host') || ''
  const port = portFromUrl || params.get('port') || ''
  const isLoopback = ['localhost', '127.0.0.1', ''].includes(host) || host.startsWith('/')
  // The port is pinned, not just the host, because a loopback port can be a tunnel to a remote
  // server (`railway connect` listens on localhost). A machine whose dev Postgres sits elsewhere —
  // the owner's runs TrainingAI's on 5434 because 5433 belongs to another project — names it with
  // LOCAL_DB_PORT, the same variable setup.sh reads, rather than this guard widening to any port.
  const allowedPort = process.env.LOCAL_DB_PORT || '5433'
  const isLocalPort = port === allowedPort
  if (!isLoopback || !isLocalPort) {
    throw new Error(
      `Refusing to restore into "${url}" — this only targets the local dev DB ` +
      `(loopback/socket host, port ${allowedPort}; set LOCAL_DB_PORT if yours differs). This command TRUNCATEs tables.`,
    )
  }
}

// Empty since Q-285 dropped `push_subscriptions`, which was the only entry: all three of its
// withheld columns were NOT NULL, so a view row could never satisfy the insert. Kept as a set
// rather than removed — the round-trip hazard it names is a property of withheld NOT NULL columns,
// not of that one table, and the next table with them needs somewhere to go (plan §5.1).
const SKIP_TABLES = new Set()

const OWNER_PASSWORD_HASH = '$2b$10$ccKSMzFRkJGPfCkKKOhCGuv8c8kbYJnUbszPj55iS3VGyG0ih.KmS' // "testpass123", same as seed.sql

async function fetchLines(url, secret) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } })
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status} ${await res.text().catch(() => '')}`)
  const text = await res.text() // NDJSON is streamed server-side; buffering client-side here is
  // fine — the default export (bulk=0) is "a few megabytes" per the plan §1, and a bulk pull is an
  // explicit opt-in the caller already knows is large.
  return text.split('\n').filter(Boolean).map(l => JSON.parse(l))
}

async function main() {
  assertLocalTarget(TARGET_URL)

  const snapshotUrl = process.env.SNAPSHOT_URL
  const secret = process.env.ADMIN_SNAPSHOT_SECRET
  if (!snapshotUrl || !secret) {
    console.error('Set SNAPSHOT_URL and ADMIN_SNAPSHOT_SECRET.')
    process.exitCode = 1
    return
  }

  // ── 3. Migrations first, so every one is applied. The snapshot carries data, not
  // schema (plan §9) — that is the property that makes migration rehearsal work: apply migration
  // N, load prod-shaped rows, then run N+1 and see what it does to real values. ─────────────────
  // migrate.js against the TARGET, not setup.sh: setup.sh provisions the cloud container's cluster
  // (initdb under /var, port 5433) and cannot run on a machine whose Postgres is a Docker container
  // or a native install. migrate.js is idempotent and applies exactly what is missing.
  console.log('[snapshot] applying local migrations first (migrate.js) …')
  execSync(`node ${JSON.stringify(path.join(__dirname, 'migrate.js'))}`, {
    cwd: path.join(__dirname, '..', '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TARGET_URL, DATABASE_SSL: 'false' },
  })

  console.log(`[snapshot] fetching ${snapshotUrl} …`)
  const lines = await fetchLines(snapshotUrl, secret)
  // The server streams, so a failure part-way through arrives as a final `{"error": …}` line
  // after a 200. Restoring anyway TRUNCATEs every table the stream never reached — measured
  // 2026-09-28, when `users` and 30 other tables came back empty. Refuse before touching anything.
  const serverError = lines.find(l => l.error)
  if (serverError) throw new Error(`the server failed part-way through the snapshot ("${serverError.error}") — nothing was restored`)
  const manifest = lines.find(l => l.manifest)
  if (!manifest) throw new Error('No manifest line in the snapshot — malformed response.')
  console.log(`[snapshot] manifest: ${manifest.tables.length} tables, snapshot at ${manifest.snapshotAt}`)
  if (manifest.omitted?.length) {
    console.log(`[snapshot] omitted (by the server): ${manifest.omitted.map(o => `${o.table} (${o.reason})`).join(', ')}`)
  }

  const rowsByTable = new Map()
  for (const line of lines) {
    if (!line.table || !line.row) continue
    if (!rowsByTable.has(line.table)) rowsByTable.set(line.table, [])
    rowsByTable.get(line.table).push(line.row)
  }

  const pool = new Pool({ connectionString: TARGET_URL })
  const client = await pool.connect()
  try {
    // FK order stops mattering under the replica role — the local `postgres` user is a superuser,
    // so this is available (plan §5 step 4).
    await client.query('BEGIN')
    await client.query("SET session_replication_role = 'replica'")

    const loaded = {}
    const notInTarget = new Set()
    // Truncate EVERY table in one statement before loading any. Truncating each just before its own
    // insert, with CASCADE, emptied the tables that reference it — including ones already loaded
    // earlier in the alphabet. Measured 2026-09-28: `set_logs` loaded 1,317 rows and ended with 0,
    // because `workout_sessions` came later and cascaded through `exercise_logs` to it; `users` did
    // the same to sleep, Body Battery and the rest. The count check trusted the insert counter, so
    // it reported a clean restore.
    const { rows: targetTables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    const present = new Set(targetTables.map(r => r.table_name))
    const toTruncate = manifest.tables.filter(t => !SKIP_TABLES.has(t) && present.has(t))
    if (toTruncate.length) await client.query(`TRUNCATE TABLE ${toTruncate.map(quoteIdent).join(', ')} CASCADE`)
    for (const table of manifest.tables) {
      if (SKIP_TABLES.has(table)) {
        console.log(`[snapshot] skipping ${table} (cannot round-trip — see script header)`)
        continue
      }
      // The manifest lists every claude_ro view, and some are not app tables at all —
      // `pg_stat_statements` is an extension's view, absent from a plain local Postgres. Skip what
      // the target does not have, and count it as not loaded rather than failing the restore.
      if (!present.has(table)) {
        console.log(`[snapshot] skipping ${table}: no such table in the target`)
        notInTarget.add(table)
        continue
      }
      const rows = rowsByTable.get(table) ?? []
      if (rows.length === 0) { loaded[table] = 0; continue }

      // A claude_ro view can carry a column the base table does not have: it computes one in place
      // of a withheld value (`food_items.image_bytes` is `octet_length(image_data_uri)`). Inserting
      // it fails the whole restore, so load only the columns the table has, and say what was left.
      const { rows: targetCols } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      )
      const presentCols = new Set(targetCols.map(r => r.column_name))
      const viewOnly = Object.keys(rows[0]).filter(c => !presentCols.has(c))
      if (viewOnly.length) console.log(`[snapshot] ${table}: view-only column(s) not restored: ${viewOnly.join(', ')}`)
      const columns = Object.keys(rows[0]).filter(c => presentCols.has(c))
      const colList = columns.map(quoteIdent).join(', ')
      // node-postgres binds a JS array as a Postgres ARRAY literal ('{…}'), which a json/jsonb
      // column rejects as "invalid input syntax for type json" — objects are stringified for it,
      // arrays are not. So stringify every non-null value bound for a json/jsonb column ourselves.
      const { rows: typeRows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('json', 'jsonb')`,
        [table],
      )
      const jsonCols = new Set(typeRows.map(r => r.column_name))
      const { rows: byteaRows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'bytea'`,
        [table],
      )
      const byteaCols = new Set(byteaRows.map(r => r.column_name))
      // Batched parameterized INSERTs rather than the binary COPY protocol — no new dependency,
      // and 500 rows/statement keeps each within Postgres's bind-parameter limits comfortably.
      const BATCH = 500
      let n = 0
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const values = []
        const tuples = batch.map((row, ri) => {
          const placeholders = columns.map((c, ci) => {
            values.push(restoreValue(row[c], { json: jsonCols.has(c), bytea: byteaCols.has(c) }))
            return `$${ri * columns.length + ci + 1}`
          })
          return `(${placeholders.join(', ')})`
        })
        await client.query(
          `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${tuples.join(', ')}`,
          values,
        )
        n += batch.length
      }
      loaded[table] = n
    }

    // ── 5. Resync sequences (bigserial PKs) so the next local insert doesn't collide with a
    // restored id. Every sequence Postgres owns for a column in `public`, generically — no
    // per-table list to keep in step with schema changes. ──────────────────────────────────────
    const { rows: seqRows } = await client.query(`
      SELECT
        quote_ident(n.nspname) || '.' || quote_ident(s.relname) AS seq,
        quote_ident(dn.nspname) || '.' || quote_ident(dt.relname) AS owning_table,
        quote_ident(a.attname) AS owning_column
      FROM pg_class s
      JOIN pg_namespace n ON n.oid = s.relnamespace
      JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
      JOIN pg_class dt ON dt.oid = d.refobjid
      JOIN pg_namespace dn ON dn.oid = dt.relnamespace
      JOIN pg_attribute a ON a.attrelid = dt.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S' AND n.nspname = 'public'
    `)
    for (const seq of seqRows) {
      await client.query(
        `SELECT setval('${seq.seq}', COALESCE((SELECT max(${seq.owning_column}) FROM ${seq.owning_table}), 1), true)`,
      )
    }

    // ── 6. Stamp a known bcrypt hash onto the owner's users row, so pnpm dev is usable
    // immediately (plan §5.1 — the real password_hash is withheld and restores NULL). ───────────
    await client.query('UPDATE users SET password_hash = $1', [OWNER_PASSWORD_HASH])

    // ── 7. Compare loaded counts against the manifest BEFORE committing, so a mismatch rolls back
    // rather than leaving a half-restored database behind. ────────────────────────────────────
    console.log('[snapshot] loaded counts vs manifest:')
    let mismatch = false
    for (const table of manifest.tables) {
      if (SKIP_TABLES.has(table) || notInTarget.has(table)) continue
      const expected = manifest.rowCounts?.[table]
      // What the TABLE holds, not what was inserted: a cascade or a trigger can remove rows after the
      // insert, and the insert counter would never know.
      const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n FROM ${quoteIdent(table)}`)
      const actual = n
      const ok = expected == null || expected === actual
      if (!ok) mismatch = true
      console.log(`  ${ok ? 'ok  ' : 'MISMATCH'} ${table}: loaded ${actual}, manifest said ${expected}`)
    }
    if (mismatch) {
      await client.query('ROLLBACK')
      console.error('[snapshot] MISMATCH — some table loaded a different count than the manifest claimed. Rolled back; the database is as it was.')
      process.exitCode = 1
      return
    }
    await client.query("SET session_replication_role = 'origin'")
    await client.query('COMMIT')
    console.log('[snapshot] all counts match. Restored successfully.')
    console.log(`[snapshot] the owner's user row now logs in with the standard local dev password ("testpass123").`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

/**
 * One NDJSON value, back into what its column needs.
 * - json/jsonb: stringified, because node-postgres binds a JS array as an ARRAY literal.
 * - bytea: the export serialises a Buffer as `{"type":"Buffer","data":[…]}`, and binding that object
 *   stored its JSON TEXT as the bytes. Every `oura_raw_packed.blob` in a local snapshot was
 *   corrupt (TN-56 found it: `frame-pack: unsupported format version 0x7b`, 0x7b being `{`).
 *   A `\x…` hex string, Postgres's own text form, is accepted too.
 */
function restoreValue(v, { json, bytea }) {
  if (v == null) return v
  if (bytea) {
    if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data)
    if (typeof v === 'string' && v.startsWith(String.raw`\x`)) return Buffer.from(v.slice(2), 'hex')
    return v
  }
  return json ? JSON.stringify(v) : v
}

function quoteIdent(id) {
  return `"${String(id).replace(/"/g, '""')}"`
}

if (require.main === module) main().catch(err => {
  console.error('[snapshot] failed:', err.message ?? err)
  process.exit(1)
})

module.exports = { restoreValue }
