#!/usr/bin/env node
/**
 * Tag pre-TN-75 baseline sessions `workout_sessions.phase_type = 'baseline'` (#2460).
 *
 * LOCAL DATABASE ONLY. It refuses any host that is not loopback on the local dev port, before it
 * connects. The production run belongs to the Orchestrator, after a verified snapshot, through the
 * agent key's `backfill-baseline-phase-tag` job (issue 2381), which runs the same shared code for
 * the owner's account. This script exists so the rule can be run against a fixture and tested.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/<db> LOCAL_DB_PORT=5434 \
 *     node scripts/backfill-baseline-phase-tag.mjs              # dry run: lists, counts, writes nothing
 *     node scripts/backfill-baseline-phase-tag.mjs --write      # tags the matches, in one transaction
 *   options: --user=<uuid> (one account only) · --cutoff=<ISO instant> (default below)
 *
 * The rule, the SQL and the write live in `lib/admin/baseline-phase-tag.mjs`, shared with the agent
 * key (issue 2381); read the rule there. This file is the local-database command around it.
 */
import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { DEFAULT_CUTOFF, CANDIDATES_SQL, UPDATE_SQL, failingCriteria, tagBaselineSessions } from '../lib/admin/baseline-phase-tag.mjs'

export { DEFAULT_CUTOFF, CANDIDATES_SQL, UPDATE_SQL }

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Loopback host AND the local dev port, or throw. The port is pinned as well as the host because a
 * loopback port can be a tunnel to a remote server (`railway connect` listens on localhost) — the
 * same reasoning as `scripts/local-db/snapshot.js`.
 */
export function assertLocalDatabaseUrl(url, allowedPort = process.env.LOCAL_DB_PORT || '5433') {
  if (!url) throw new Error('DATABASE_URL is required (a local dev or scratch database)')
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('DATABASE_URL is not a URL')
  }
  const port = parsed.port || '5432'
  if (!LOOPBACK.has(parsed.hostname) || port !== String(allowedPort)) {
    throw new Error(
      `refusing ${parsed.hostname}:${port}; this script only touches a local database ` +
      `(loopback, port ${allowedPort}; set LOCAL_DB_PORT if yours differs)`,
    )
  }
}

export function parseArgs(argv) {
  const out = { write: false, cutoff: DEFAULT_CUTOFF, user: null }
  for (const a of argv) {
    if (a === '--write') out.write = true
    else if (a.startsWith('--cutoff=')) out.cutoff = a.slice('--cutoff='.length)
    else if (a.startsWith('--user=')) out.user = a.slice('--user='.length)
    else throw new Error(`unknown argument ${a}`)
  }
  if (Number.isNaN(Date.parse(out.cutoff))) throw new Error(`--cutoff is not an instant: ${out.cutoff}`)
  if (out.user && !/^[0-9a-f-]{36}$/i.test(out.user)) throw new Error(`--user is not a uuid: ${out.user}`)
  return out
}

function describe(row) {
  return `${row.local_date}  ${row.session_name}  (${row.exercises} exercises, max ${row.max_reps} reps)  ` +
    `id ${row.workout_session_id}  user ${row.user_id}`
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {(line: string) => void} log
 */
export async function run(argv, env = process.env, log = console.log) {
  const opts = parseArgs(argv)
  assertLocalDatabaseUrl(env.DATABASE_URL, env.LOCAL_DB_PORT || '5433')

  const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: false })
  await client.connect()
  try {
    const result = await tagBaselineSessions(client, { cutoff: opts.cutoff, user: opts.user, write: opts.write })
    const { matches, nearMisses } = result

    log(`cutoff ${opts.cutoff}${opts.user ? `, user ${opts.user}` : ''}`)
    log(`${matches.length} session(s) match the baseline rule:`)
    for (const r of matches) log(`  + ${describe(r)}`)
    log(`${nearMisses.length} near miss(es), NOT tagged:`)
    for (const r of nearMisses) log(`  - ${describe(r)}  [${failingCriteria(r)}]`)
    const dates = [...new Set(matches.map(r => r.local_date))]
    log(`affected dates: ${dates.length ? dates.join(', ') : '(none)'}`)
    log(opts.write
      ? `written: ${result.written} (predicted ${result.predicted})`
      : 'dry run: nothing written (pass --write to tag the matches)')
    return result
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(err => {
    console.error(`backfill-baseline-phase-tag: ${err.message}`)
    process.exit(2)
  })
}
