/**
 * #2377 — command-line entry for the shadow readiness replay. Bundled and run by
 * `scripts/shadow-readiness-replay.mjs`; not imported by the app.
 *
 *   node scripts/shadow-readiness-replay.mjs --user <uuid> --from YYYY-MM-DD --to YYYY-MM-DD [--write] [--tz Area/City]
 *
 * Dry run unless `--write`. It refuses any database that is not on this machine: the production
 * comparison is a read-only SQL query for the owner (in the PR), never a write from here.
 */
import { replayShadowReadiness, daysMoved, DAYS_MOVED_THRESHOLD } from '@/lib/health/shadow-readiness-service'
import { isCalendarDate } from '@trainingai/shared/date-utils'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required (pass it explicitly).')
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`Refusing ${host}: the replay only runs against a local database.`)
  }
}


async function main(): Promise<void> {
  assertLocalDatabase()
  const userId = arg('user')
  const from = arg('from')
  const to = arg('to')
  if (!userId || !from || !to || !isCalendarDate(from) || !isCalendarDate(to)) {
    throw new Error('Usage: --user <uuid> --from YYYY-MM-DD --to YYYY-MM-DD [--write] [--tz Area/City]')
  }
  const write = process.argv.includes('--write')
  const result = await replayShadowReadiness(userId, from, to, { tz: arg('tz'), write })

  const fmt = (v: number | null) => (v == null ? '  —  ' : v.toFixed(1).padStart(5))
  console.info('date        shadow  live   diff  sleep heart activ body  stage')
  for (const r of result.rows) {
    const diff = r.shadowReadiness != null && r.liveReadiness != null ? r.shadowReadiness - r.liveReadiness : null
    console.info(`${r.date}  ${fmt(r.shadowReadiness)}  ${fmt(r.liveReadiness)}  ${fmt(diff)}  ${fmt(r.pillars.sleep)} ${fmt(r.pillars.heart)} ${fmt(r.pillars.activity)} ${fmt(r.pillars.body)}  ${r.maturityStage}`)
  }
  const m = daysMoved(result.rows)
  console.info(`\n${result.rows.length} days scored; ${m.compared} with a live score; ${m.moved} differ by ≥ ${DAYS_MOVED_THRESHOLD} points; median |diff| ${m.medianAbsDiff?.toFixed(1) ?? '—'}, max ${m.maxAbsDiff?.toFixed(1) ?? '—'}.`)
  console.info(result.dryRun ? 'Dry run: nothing written. Pass --write to store the rows.' : `Wrote ${result.written} rows (computed_by = replay).`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
