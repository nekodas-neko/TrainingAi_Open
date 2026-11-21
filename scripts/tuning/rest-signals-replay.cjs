#!/usr/bin/env node
/**
 * Issue 3718 — over the last N days (default 90), how many days each of the daily check's three new
 * rest signals would have flagged, how many of those the check already suggested rest on for another
 * reason, and how many were days a workout was done. READ-ONLY and COUNTS ONLY: no value, date or name
 * is printed.
 *
 *   DATABASE_URL=… node scripts/tuning/rest-signals-replay.cjs --db <userId> [days=90]
 *
 * The session is opened with `default_transaction_read_only`, and the script refuses to run if the
 * server says otherwise. Run it against the local database or a restored backup. Production's count
 * through the claude_ro endpoint is `scripts/tuning/rest-signals-3718.sql`, which approximates the
 * sleep trend (see its header); this script runs the shipped code and is exact.
 */
const path = require('path')
const { execFileSync } = require('child_process')

function bundle() {
  const root = path.resolve(__dirname, '../..')
  const file = path.join(root, 'node_modules/.cache/rest-signals-replay/replay-entry.cjs')
  const win = process.platform === 'win32'
  execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(__dirname, 'rest-signals-replay-entry.ts'),
    '--bundle', '--format=cjs', '--platform=node', '--packages=external', '--tsconfig=tsconfig.json', '--log-level=error', `--outfile=${file}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
  return require(file)
}

function print(s) {
  console.log(`days ${s.days} · any new signal ${s.anySignal.flagged} · newly suggested (nothing else did) ${s.newlySuggested} · grade raised ${s.gradeRaised}`)
  console.log('signal | evaluable days | flagged | already suggested (any grade) | already, above soft | workout done')
  for (const [k, c] of Object.entries(s.bySignal)) {
    console.log(`${k} | ${s.evaluable[k]} | ${c.flagged} | ${c.alreadySuggested} | ${c.alreadySuggestedNotSoft} | ${c.trained}`)
  }
  const a = s.anySignal
  console.log(`any | ${s.evaluableAny} | ${a.flagged} | ${a.alreadySuggested} | ${a.alreadySuggestedNotSoft} | ${a.trained}`)
}

async function main() {
  const [, , mode, arg, daysArg] = process.argv
  if (mode !== '--db') throw new Error('usage: --db <userId> [days]')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (!/^[0-9a-f-]{36}$/.test(arg || '')) throw new Error('usage: --db <userId> [days]')
  const days = Number(daysArg || 90)
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error('days must be 1..400')
  process.env.PGOPTIONS = `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim()
  const lib = bundle()
  try {
    const ro = await lib.readOnlyState()
    if (ro !== 'on') throw new Error(`refusing to run: SHOW default_transaction_read_only is "${ro}", not "on"`)
    print(lib.summariseRestSignalReplay(await lib.replayDays(arg, days)))
  } finally {
    await lib.closePool()
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
