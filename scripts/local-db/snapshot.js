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
  const isLocalPort = port === '5433'
  if (!isLoopback || !isLocalPort) {
    throw new Error(
      `Refusing to restore into "${url}" — this only targets the local dev DB ` +
      `(loopback/socket host, port 5433). This command TRUNCATEs tables.`,
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

  // ── 3. pnpm db:local first, so every migration is applied. The snapshot carries data, not
  // schema (plan §9) — that is the property that makes migration rehearsal work: apply migration
  // N, load prod-shaped rows, then run N+1 and see what it does to real values. ─────────────────
  console.log('[snapshot] applying local migrations first (pnpm db:local) …')
  execSync('bash scripts/local-db/setup.sh', { cwd: path.join(__dirname, '..', '..'), stdio: 'inherit' })

  console.log(`[snapshot] fetching ${snapshotUrl} …`)
  const lines = await fetchLines(snapshotUrl, secret)
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
    for (const table of manifest.tables) {
      if (SKIP_TABLES.has(table)) {
        console.log(`[snapshot] skipping ${table} (cannot round-trip — see script header)`)
        continue
      }
      const rows = rowsByTable.get(table) ?? []
      await client.query(`TRUNCATE TABLE ${quoteIdent(table)} CASCADE`)
      if (rows.length === 0) { loaded[table] = 0; continue }

      const columns = Object.keys(rows[0])
      const colList = columns.map(quoteIdent).join(', ')
      // Batched parameterized INSERTs rather than the binary COPY protocol — no new dependency,
      // and 500 rows/statement keeps each within Postgres's bind-parameter limits comfortably.
      const BATCH = 500
      let n = 0
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const values = []
        const tuples = batch.map((row, ri) => {
          const placeholders = columns.map((c, ci) => {
            values.push(row[c])
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

    await client.query("SET session_replication_role = 'origin'")
    await client.query('COMMIT')

    // ── 7. Fail loudly on any mismatch — print per-table loaded counts against the manifest's. ──
    console.log('[snapshot] loaded counts vs manifest:')
    let mismatch = false
    for (const table of manifest.tables) {
      if (SKIP_TABLES.has(table)) continue
      const expected = manifest.rowCounts?.[table]
      const actual = loaded[table] ?? 0
      const ok = expected == null || expected === actual
      if (!ok) mismatch = true
      console.log(`  ${ok ? 'ok  ' : 'MISMATCH'} ${table}: loaded ${actual}, manifest said ${expected}`)
    }
    if (mismatch) {
      console.error('[snapshot] MISMATCH — some table loaded a different count than the manifest claimed.')
      process.exitCode = 1
    } else {
      console.log('[snapshot] all counts match. Restored successfully.')
      console.log(`[snapshot] the owner's user row now logs in with the standard local dev password ("testpass123").`)
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

function quoteIdent(id) {
  return `"${String(id).replace(/"/g, '""')}"`
}

main().catch(err => {
  console.error('[snapshot] failed:', err.message ?? err)
  process.exit(1)
})
