#!/usr/bin/env node
// Ownership-scope mutation sweep (#2425; method from docs/reviews/2026-08-09-ownership-mutation-coverage.md).
//
// For every `user_id` scoping predicate in `lib/data/postgres/adapter.ts` and its slices, neutralise
// that ONE predicate (always-true, same shape — see predicates.mjs), run the ownership burn-down test,
// and record whether the test noticed. A mutation that leaves the test green is a SURVIVOR: that
// predicate could be deleted tomorrow and nothing would say so.
//
// A developer tool, not a CI step. It needs a LOCAL Postgres and takes ~5 s per predicate per job.
//
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/<scratch> DATABASE_SSL=false \
//     node scripts/ownership-mutation-sweep/index.mjs [options]
//
// `DATABASE_URL` must name an already-migrated scratch database (`node scripts/local-db/migrate.js`).
// It is used only as a TEMPLATE: each run gets a fresh clone (`<scratch>_mw<N>`), so a mutation that
// writes into another user's rows cannot leak state into the next run and make it fail for the wrong
// reason — which would undercount survivors, the dangerous direction. The clones are dropped at the end.
// The driver refuses any host that is not localhost.
//
// Options:
//   --list                 print every predicate (file, index, line, method) and exit; no DB needed
//   --file <substr>        only predicates in files whose path contains <substr>
//   --index <n>            only predicate <n> (with --file)
//   --all-at-once          one run per file with EVERY predicate in it neutralised, plus one run with
//                          every predicate in every file — the 2026-08-09 headline measurement
//   --jobs <n>             parallel runs (default 3; each gets its own cloned DB)
//   --test <path>          test file(s) to run, comma-separated
//                          (default: both repository-ownership-scoping*.test.ts files)
//   --json <path>          write the full result list as JSON
//   --survivors-of <path>  only re-run the predicates that survived in an earlier --json file.
//                          Fast, and blind to regressions: a fixture change that makes an earlier
//                          KILL survive is never re-run. It cost #2425 two predicates. Always finish
//                          with a full run before quoting a number.
//
// Source files are never written: the mutation is applied by a vitest transform plugin
// (vitest.config.mjs). A green run only counts as a survivor if the plugin confirms it applied the
// mutation; otherwise the run is reported as an ERROR, never as a survivor.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { REPO_ROOT, TARGET_FILES, findPredicates } from './predicates.mjs'

const require = createRequire(import.meta.url)

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt
}

// Both halves of the burn-down: the hand-built Q-155 file and the #2425 schema-seeded one.
const DEFAULT_TEST = [
  'lib/data/postgres/__tests__/repository-ownership-scoping.test.ts',
  'lib/data/postgres/__tests__/repository-ownership-scoping-sweep.test.ts',
].join(',')
const tests = opt('--test', DEFAULT_TEST).split(',')
const jobs = Math.max(1, Number(opt('--jobs', '3')))
const fileFilter = opt('--file', null)
const indexFilter = opt('--index', null)
const jsonOut = opt('--json', null)
const survivorsOf = opt('--survivors-of', null)
const RUN_TIMEOUT_MS = 180_000

const files = TARGET_FILES.filter((f) => !fileFilter || f.includes(fileFilter))
const inventory = files.map((f) => ({
  file: f,
  preds: findPredicates(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')),
}))

if (flag('--list')) {
  let n = 0
  for (const { file, preds } of inventory) {
    for (const p of preds) console.log(`${file}#${p.index}\tL${p.line}\t${p.method}\t${p.text}`)
    n += preds.length
  }
  console.log(`\n${n} predicates in ${inventory.length} files`)
  process.exit(0)
}

// ---- database safety + per-job clones ---------------------------------------------------------

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) {
  console.error('ownership-mutation-sweep: DATABASE_URL (a local, migrated scratch DB) is required')
  process.exit(2)
}
const parsed = new URL(baseUrl)
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) {
  console.error(`ownership-mutation-sweep: refusing non-local host ${parsed.hostname} — local scratch DBs only`)
  process.exit(2)
}
const templateDb = decodeURIComponent(parsed.pathname.slice(1))
if (!/^[a-z0-9_]+$/.test(templateDb)) {
  console.error(`ownership-mutation-sweep: unexpected database name ${templateDb}`)
  process.exit(2)
}
const adminUrl = new URL(baseUrl)
adminUrl.pathname = '/postgres'
const cloneName = (job) => `${templateDb}_mw${job}`
const cloneUrl = (job) => {
  const u = new URL(baseUrl)
  u.pathname = `/${cloneName(job)}`
  return u.toString()
}

const { Client } = require('pg')
const admin = new Client({ connectionString: adminUrl.toString(), ssl: false })
let cloneChain = Promise.resolve()
// Serialised: CREATE DATABASE … TEMPLATE needs the template idle, and two clones at once contend.
function freshClone(job) {
  const run = cloneChain.then(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${cloneName(job)} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${cloneName(job)} TEMPLATE ${templateDb}`)
  })
  cloneChain = run.catch(() => {})
  return run
}

// ---- one vitest run ---------------------------------------------------------------------------

const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const config = path.join(REPO_ROOT, 'scripts/ownership-mutation-sweep/vitest.config.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-sweep-'))

async function runOne(job, file, index) {
  await freshClone(job)
  const marker = path.join(tmp, `marker-${job}`)
  fs.rmSync(marker, { force: true })
  const env = {
    ...process.env,
    DATABASE_URL: cloneUrl(job),
    DATABASE_SSL: 'false',
    OWNERSHIP_MUTATION_FILE: file ?? '',
    OWNERSHIP_MUTATION_INDEX: index === null ? '' : String(index),
    OWNERSHIP_MUTATION_MARKER: marker,
  }
  if (!file) {
    delete env.OWNERSHIP_MUTATION_FILE
    delete env.OWNERSHIP_MUTATION_INDEX
  }
  const started = Date.now()
  const { code, output } = await new Promise((resolve) => {
    const child = spawn(process.execPath, [vitestBin, 'run', '--config', config, ...tests], {
      cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS)
    child.on('close', (c) => { clearTimeout(timer); resolve({ code: c, output }) })
  })
  const applied = fs.existsSync(marker)
  const failedTests = [...output.matchAll(/^\s*(?:×|✗|FAIL)\s.*?>\s(.+?)(?:\s\d+ms)?$/gm)].map((m) => m[1].trim())
  const passed = /Tests\s+(\d+) passed/.exec(output)?.[1]
  let status
  if (file && !applied) status = 'error'
  else if (code === 0) status = 'survived'
  else if (/Tests\s+.*\d+ failed/.test(output)) status = 'killed'
  else status = 'error'
  return { status, code, applied, ms: Date.now() - started, failedTests, passed, tail: status === 'error' ? output.slice(-2000) : undefined }
}

async function pool(items, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async (_, job) => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(job, items[i])
    }
  }))
  return results
}

// ---- main -------------------------------------------------------------------------------------

const t0 = Date.now()
await admin.connect()
try {
  console.log(`baseline: unmutated run of ${tests.join(', ')}`)
  const base = await runOne(0, null, null)
  if (base.status !== 'survived') {
    console.error(`baseline is not green (exit ${base.code}) — fix that before measuring anything\n${base.tail ?? ''}`)
    process.exit(1)
  }
  console.log(`baseline green: ${base.passed} tests, ${(base.ms / 1000).toFixed(1)} s\n`)

  let items
  if (flag('--all-at-once')) {
    items = inventory.map(({ file, preds }) => ({ file, index: 'all', line: 0, method: `(all ${preds.length})`, text: '' }))
    if (!fileFilter) {
      const n = inventory.reduce((a, { preds }) => a + preds.length, 0)
      items.push({ file: '*', index: 'all', line: 0, method: `(every file, all ${n})`, text: '' })
    }
  } else {
    // --survivors-of <json>: re-run only what survived a previous --json run — the quick loop while
    // adding coverage. Matched by file + index + predicate text, so an edit that shifted the
    // numbering re-runs the shifted predicate rather than silently skipping it.
    const prior = survivorsOf
      ? new Set(JSON.parse(fs.readFileSync(survivorsOf, 'utf8'))
        .filter((r) => r.status === 'survived').map((r) => `${r.file}#${r.index}#${r.text}`))
      : null
    items = inventory.flatMap(({ file, preds }) => preds
      .filter((p) => indexFilter === null || p.index === Number(indexFilter))
      .filter((p) => !prior || prior.has(`${file}#${p.index}#${p.text}`))
      .map((p) => ({ file, index: p.index, line: p.line, method: p.method, text: p.text })))
  }
  console.log(`running ${items.length} mutation(s) with ${jobs} job(s)…`)

  let done = 0
  const results = await pool(items, async (job, item) => {
    const r = await runOne(job, item.file, item.index)
    done++
    const tag = r.status === 'survived' ? 'SURVIVED' : r.status === 'killed' ? 'killed  ' : 'ERROR   '
    console.log(`[${String(done).padStart(3)}/${items.length}] ${tag} ${item.file}#${item.index} L${item.line} ${item.method}`)
    return { ...item, ...r }
  })

  const survivors = results.filter((r) => r.status === 'survived')
  const errors = results.filter((r) => r.status === 'error')
  console.log('\n=== survivors (predicate removed, test still green) ===')
  const byFile = new Map()
  for (const s of survivors) {
    if (!byFile.has(s.file)) byFile.set(s.file, [])
    byFile.get(s.file).push(s)
  }
  for (const [file, list] of byFile) {
    console.log(`\n${file}`)
    for (const s of list) console.log(`  #${s.index}\tL${s.line}\t${s.method}\t${s.text}`)
  }
  if (errors.length) {
    console.log('\n=== errors (NOT counted either way) ===')
    for (const e of errors) console.log(`  ${e.file}#${e.index} exit=${e.code} applied=${e.applied}\n${e.tail}`)
  }
  const total = results.length
  console.log(`\nsurvivors ${survivors.length} of ${total}; killed ${results.filter((r) => r.status === 'killed').length}; errors ${errors.length}`)
  console.log(`wall time ${((Date.now() - t0) / 60000).toFixed(1)} min with ${jobs} job(s)`)
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2))
} finally {
  for (let j = 0; j < jobs; j++) {
    await admin.query(`DROP DATABASE IF EXISTS ${cloneName(j)} WITH (FORCE)`).catch(() => {})
  }
  await admin.end()
  fs.rmSync(tmp, { recursive: true, force: true })
}
