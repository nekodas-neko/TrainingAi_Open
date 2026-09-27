#!/usr/bin/env node
// Rebuild a local dev database from the migrations alone, then seed it (OR-194 ③).
//
//   LOCAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/trainingai_lane_a pnpm db:rebuild
//
// **Why this exists: a fresh clone used to guarantee a database built from migrations and nothing
// else, and a persistent local agent loses that.** A long-lived database collects hand-applied
// changes, and two things read the schema as truth: `generate-claude-ro-views.js`, which writes
// whatever columns it finds into the committed read-only views, and every DB-backed test. Run this at
// the start of a local session and both see what CI sees.
//
// Cross-platform on purpose. `setup.sh` needs `initdb`, `su` and a Linux Postgres layout, so it
// cannot run on the owner's Windows machine; this needs only a reachable server and `node`.
//
// **It never touches `.env.local`.** `setup.sh` rewrites every `DATABASE_URL=` line in that file,
// and on a developer machine those lines can hold production credentials. Pass the URL in.
//
// **It refuses anything that is not a local server** — the first statement it runs is
// `DROP DATABASE … WITH (FORCE)`.
const { Client } = require('pg')
const { spawnSync } = require('child_process')
const { readFileSync } = require('fs')
const { join } = require('path')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

/**
 * Parse and vet the target. Returns { url, dbName, adminUrl }, or throws with the reason.
 * An empty host is a Unix-socket URL (`postgresql://u:p@/db?host=/tmp`), which is local by nature.
 */
function vetTarget(raw) {
  if (!raw) throw new Error('LOCAL_DATABASE_URL is not set. Pass the URL of the local database to rebuild.')
  if (!/^postgres(ql)?:\/\//.test(raw)) throw new Error(`not a Postgres URL: ${raw.split(':')[0]}:`)
  // A Unix-socket URL has an empty host (`…@/db?host=/tmp`), which WHATWG `URL` rejects outright
  // when credentials are present. Parse it with a placeholder host and remember it was a socket.
  const socket = /^postgres(ql)?:\/\/([^@/]*@)?\//.test(raw)
  let u
  try { u = new URL(socket ? raw.replace(/^(postgres(?:ql)?:\/\/(?:[^@/]*@)?)\//, '$1socket.invalid/') : raw) }
  catch { throw new Error(`LOCAL_DATABASE_URL is not a URL: ${raw}`) }
  const host = socket ? '' : u.hostname
  if (!LOCAL_HOSTS.has(host)) throw new Error(`refusing to drop a database on "${host}" — local servers only`)
  const socketHost = u.searchParams.get('host') ?? ''
  if (socket && socketHost && !socketHost.startsWith('/')) {
    throw new Error(`refusing host=${socketHost} — a socket URL must name a directory`)
  }
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''))
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`database name must be plain snake_case, got "${dbName}"`)
  if (dbName === 'postgres') throw new Error('refusing to rebuild the maintenance database "postgres"')
  // String surgery rather than `URL.toString()`, so a socket URL comes back in its own shape.
  const adminUrl = raw.replace(new RegExp(`/${dbName}(?=\\?|$)`), '/postgres')
  return { url: raw, dbName, adminUrl }
}

async function main() {
  const { url, dbName, adminUrl } = vetTarget(process.env.LOCAL_DATABASE_URL)

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${dbName}`)
  } finally {
    await admin.end()
  }
  console.info(`[rebuild] ${dbName} dropped and recreated`)

  const migrate = spawnSync(process.execPath, [join(__dirname, 'migrate.js')], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
  if (migrate.status !== 0) {
    console.error(`[rebuild] migrate.js exited ${migrate.status} — database left unseeded`)
    process.exit(migrate.status ?? 1)
  }

  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    await db.query(readFileSync(join(__dirname, 'seed.sql'), 'utf-8'))
  } finally {
    await db.end()
  }
  console.info(`[rebuild] seeded. Ready: ${url}`)
}

if (require.main === module) {
  main().catch(err => { console.error(`[rebuild] ${err.message}`); process.exit(1) })
}

module.exports = { vetTarget }
