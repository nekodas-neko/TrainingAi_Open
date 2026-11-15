#!/usr/bin/env node
/**
 * Issue 3778 — how many stored days' readiness score and band would move if recomputed with the
 * centre at 75, and whether the re-anchored decision cuts still fire on the same days. READ-ONLY:
 * nothing is written, and #3778 rewrites no stored score.
 *
 *   node scripts/tuning/readiness-centre-replay.cjs --synthetic [rows=5000]
 *   DATABASE_URL=… node scripts/tuning/readiness-centre-replay.cjs --db <userId>
 *
 * `--db` opens the session with `default_transaction_read_only` and refuses to run if the server
 * says otherwise. Run it against the local database or a restored backup, never production
 * directly; production's count is the SQL in docs/reviews/2026-11-15-readiness-centre-75.md, which is
 * the same arithmetic.
 */
const path = require('path')
const { execFileSync } = require('child_process')

function bundle() {
  const root = path.resolve(__dirname, '../..')
  const file = path.join(root, 'node_modules/.cache/readiness-centre-replay/replay-entry.cjs')
  const win = process.platform === 'win32'
  execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(__dirname, 'readiness-centre-replay-entry.ts'),
    '--bundle', '--format=cjs', '--platform=node', '--packages=external', '--tsconfig=tsconfig.json', '--log-level=error', `--outfile=${file}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
  return require(file)
}

function print(title, report) {
  console.log(`\n== ${title}`)
  console.log(`rows ${report.rows} · score moved on ${report.moved} · move median ${report.medianMove} max ${report.maxMove} min ${report.minMove}`)
  console.log(`band label changed on ${report.bandChanged}: ${JSON.stringify(report.bandTransitions)}`)
  console.log('cut | before → after | fired before | fired after | stopped | started | rate-preserving')
  for (const t of report.thresholds) {
    const op = t.side === 'below' ? '<' : '≥'
    console.log(`${t.name} | ${op}${t.before} → ${op}${t.after} | ${t.firedBefore} | ${t.firedAfter} | ${t.stoppedFiring} | ${t.startedFiring} | ${op}${t.ratePreserving}`)
  }
}

async function main() {
  const [, , mode, arg] = process.argv
  if (mode === '--synthetic') {
    const lib = bundle()
    const n = Number(arg || 5000)
    for (const pop of lib.SYNTHETIC_POPULATIONS) {
      const projected = lib.syntheticStoredRows(pop, n).map(lib.projectCentreShift).filter(Boolean)
      print(`synthetic ${pop.name}`, lib.summariseCentreShift(projected))
    }
    return
  }
  if (mode !== '--db') throw new Error('usage: --synthetic [rows] | --db <userId>')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (!/^[0-9a-f-]{36}$/.test(arg || '')) throw new Error('usage: --db <userId>')
  process.env.PGOPTIONS = `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim()
  const lib = bundle()
  try {
    const ro = await lib.readOnlyState()
    if (ro !== 'on') throw new Error(`refusing to run: SHOW default_transaction_read_only is "${ro}", not "on"`)
    const rows = await lib.storedReadinessRows(arg)
    const projected = rows.map(lib.projectCentreShift).filter(Boolean)
    console.log(`${rows.length} stored rows, ${projected.length} with a contributor map`)
    print(`stored rows for ${arg}`, lib.summariseCentreShift(projected))
  } finally {
    await lib.closePool()
  }
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1 })
