#!/usr/bin/env node
/**
 * Issue 2435 — how many past days' stored Activity scores would change if each finished day were
 * scored once over the whole day (`finaliseActivityDay`) instead of keeping the in-progress value
 * the last app open stored. READ-ONLY: the session is opened with `default_transaction_read_only`,
 * and nothing is written.
 *
 *   DATABASE_URL=… node scripts/tuning/activity-finalise-replay-2435.cjs <userId> [days=90]
 *
 * Run it against the local database or a restored backup, never production directly. The scoring
 * is not reimplemented: it bundles the shipped `loadActivityDay` (see the entry file).
 */
const path = require('path')
const { execFileSync } = require('child_process')

function bundle() {
  const root = path.resolve(__dirname, '../..')
  // Inside the repo's node_modules: packages stay external and Node resolves them from here.
  const file = path.join(root, 'node_modules/.cache/activity-finalise-replay/replay-entry.cjs')
  const win = process.platform === 'win32'
  execFileSync(win ? 'npx.cmd' : 'npx', ['esbuild', path.join(__dirname, 'activity-finalise-replay-entry.ts'),
    '--bundle', '--format=cjs', '--platform=node', '--packages=external', '--tsconfig=tsconfig.json', '--log-level=error', `--outfile=${file}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], shell: win })
  return require(file)
}

async function main() {
  const [, , userId, daysArg] = process.argv
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (!/^[0-9a-f-]{36}$/.test(userId || '')) throw new Error('usage: <userId> [days]')
  const days = Number(daysArg || 90)
  // Every statement this process runs is refused if it writes.
  process.env.PGOPTIONS = `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim()

  const lib = bundle()
  const repo = new lib.PostgresWorkoutRepository()
  const user = await repo.getUserById(userId)
  if (!user) throw new Error(`no user ${userId}`)
  const tz = user.timezone || lib.DEFAULT_TZ
  const today = lib.todayInTz(tz)
  const rows = await repo.getOuraDailyDerived(userId, lib.shiftDateStr(today, -days), lib.shiftDateStr(today, -1))
  const stored = rows.filter(r => r.activityScore != null)

  let changed = 0, finalised = 0, nowNull = 0
  const lines = []
  for (const r of stored) {
    if (lib.activityFinalisedAt(r.activityContributors) != null) { finalised++; continue }
    const day = await lib.loadActivityDay(repo, userId, tz, r.day)
    const next = day.result ? day.result.score : null
    if (next == null) nowNull++
    if (next !== r.activityScore) {
      changed++
      lines.push(`  ${r.day}  stored ${String(r.activityScore).padStart(3)} → ${next == null ? '  —' : String(next).padStart(3)}  moveHours ${day.signals.moveHours ?? '—'}  steps ${day.signals.steps ?? '—'}`)
    }
  }
  console.log(`User ${userId} (${tz}), finished days ${lib.shiftDateStr(today, -days)} … ${lib.shiftDateStr(today, -1)}`)
  console.log(`Days with a stored Activity score: ${stored.length} (${finalised} already final)`)
  console.log(`Days whose score would change if finalised: ${changed}${nowNull ? ` (${nowNull} would have nothing to score and keep the stored value)` : ''}`)
  for (const l of lines) console.log(l)
  process.exit(0)
}

main().catch(e => { console.error(e.message); process.exit(1) })
