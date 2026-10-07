#!/usr/bin/env node
/**
 * Tag pre-TN-75 baseline sessions `workout_sessions.phase_type = 'baseline'` (#2460).
 *
 * LOCAL DATABASE ONLY. It refuses any host that is not loopback on the local dev port, before it
 * connects. The production run belongs to the Orchestrator, after a verified snapshot, using the
 * SQL in this file (PR #2647 carries the read-only half ready to paste). This script exists so the
 * rule can be read, run against a fixture, and tested.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/<db> LOCAL_DB_PORT=5434 \
 *     node scripts/backfill-baseline-phase-tag.mjs              # dry run: lists, counts, writes nothing
 *     node scripts/backfill-baseline-phase-tag.mjs --write      # tags the matches, in one transaction
 *   options: --user=<uuid> (one account only) · --cutoff=<ISO instant> (default below)
 *
 * WHY. Since TN-75 (#1957, merged 2026-09-29) the server stores a baseline session's
 * `phase_type = 'baseline'`, and the 1RM history behind the Strength trend card and the plateau
 * flag leaves those sessions out (`wsIsBaselineSession`). Rows logged before that carry NULL, so
 * the owner's 09-07 → 09-12 baseline round still reads as a dip until they are tagged.
 *
 * THE RULE. A NULL-tag session is a baseline session when all four hold:
 *
 *   1. its program is `phase_mode = 'ai_dynamic'` — the only mode with a per-session baseline
 *      phase (`log-exercise.ts` writes 'baseline' only from `session_periodization`);
 *   2. it is the FIRST live workout of its program session (`workout_sessions.session_id`): a
 *      session's periodization row starts in `baseline`, and a rebuilt session is a new program
 *      session (BF-143), so its first run is the calibration;
 *   3. every exercise in it has exactly ONE live set: the baseline phase prescribes one set
 *      (`session-data.ts`); the 2026-09-28 production read found exactly that shape;
 *   4. none of its sets carries a `planned_pct`: the baseline set has no progression style, so
 *      nothing was planned. This one can only remove false positives.
 *
 * (2) alone would wrongly tag a session whose baseline was skipped with prior data (its first run
 * is prescribed, several sets); (3) alone would tag a short prescribed day. So both are required,
 * and every NULL-tag session that meets (2) or (3) but not all four is printed as a NEAR MISS with
 * the failing criteria, for a human to look at. Nothing outside the matches is written.
 *
 * Known blind spots, each printed as a near miss rather than guessed at: a baseline split over
 * two workouts (BF-131's partial baseline: the second one is not a first run), a baseline where the
 * lifter added an extra set, and a program whose `phase_mode` has changed since.
 *
 * EXPECTED ON PRODUCTION: five sessions, one per program session, dated 2026-09-07 → 2026-09-12
 * (history entry 2026-09-28, "TN-75's last question answered"). Anything else is a stop-and-look.
 *
 * ADDITIVE AND IDEMPOTENT. It only sets `phase_type` where it is NULL, and a second run finds
 * nothing. `updated_at` is deliberately left alone: the on-device store has no `phase_type`, so
 * there is nothing to sync, and bumping it would re-send every tagged row to the phone for nothing.
 */
import pg from 'pg'
import { pathToFileURL } from 'node:url'

/** TN-75 merged 2026-09-29 21:34 Brisbane; from then on the server tags a baseline at write time. */
export const DEFAULT_CUTOFF = '2026-09-30T00:00:00+10:00'

/**
 * Every NULL-tag live session before `$1` (cutoff) that meets criterion 2 or 3, judged against all
 * four. `$2` is an optional user id. Read-only. `matches` is the verdict.
 */
export const CANDIDATES_SQL = `
WITH per_log AS (
  SELECT el.workout_session_id, el.id AS exercise_log_id,
         COUNT(sl.id)          AS sets,
         COUNT(sl.planned_pct) AS planned_sets,
         MAX(sl.reps)          AS max_reps
  FROM exercise_logs el
  JOIN set_logs sl ON sl.exercise_log_id = el.id AND sl.deleted_at IS NULL
  WHERE el.deleted_at IS NULL
  GROUP BY el.workout_session_id, el.id
),
shape AS (
  SELECT workout_session_id,
         COUNT(*)          AS exercises,
         MAX(sets)         AS max_sets_per_exercise,
         SUM(planned_sets) AS planned_sets,
         MAX(max_reps)     AS max_reps
  FROM per_log
  GROUP BY workout_session_id
),
runs AS (
  SELECT ws.id,
         ROW_NUMBER() OVER (PARTITION BY ws.session_id ORDER BY ws.started_at, ws.id) AS run_of_session
  FROM workout_sessions ws
  WHERE ws.deleted_at IS NULL AND ws.session_id IS NOT NULL
),
judged AS (
  SELECT ws.id AS workout_session_id,
         ws.user_id,
         ws.session_name,
         ws.started_at,
         to_char(ws.started_at AT TIME ZONE u.timezone, 'YYYY-MM-DD') AS local_date,
         p.phase_mode,
         r.run_of_session,
         sh.exercises,
         sh.max_sets_per_exercise,
         sh.planned_sets,
         sh.max_reps,
         COALESCE(p.phase_mode = 'ai_dynamic', false)  AS is_ai_dynamic,
         COALESCE(r.run_of_session = 1, false)         AS is_first_run,
         sh.max_sets_per_exercise = 1                  AS one_set_each,
         sh.planned_sets = 0                           AS unplanned
  FROM workout_sessions ws
  JOIN users u ON u.id = ws.user_id
  JOIN shape sh ON sh.workout_session_id = ws.id
  LEFT JOIN runs r ON r.id = ws.id
  LEFT JOIN program_sessions ps ON ps.id = ws.session_id
  LEFT JOIN programs p ON p.id = ps.program_id AND p.user_id = ws.user_id
  WHERE ws.phase_type IS NULL
    AND ws.deleted_at IS NULL
    AND ws.started_at < $1::timestamptz
    AND ($2::uuid IS NULL OR ws.user_id = $2::uuid)
)
SELECT *, (is_ai_dynamic AND is_first_run AND one_set_each AND unplanned) AS matches
FROM judged
WHERE is_first_run OR one_set_each
ORDER BY user_id, started_at, workout_session_id
`

/**
 * The write: the same judgement, re-evaluated inside the UPDATE so it can never tag a row the
 * listing would not have, and `phase_type IS NULL` again so it cannot overwrite a tag.
 */
export const UPDATE_SQL = `
UPDATE workout_sessions ws
SET phase_type = 'baseline'
FROM (${CANDIDATES_SQL}) c
WHERE c.workout_session_id = ws.id
  AND c.matches
  AND ws.phase_type IS NULL
RETURNING ws.id
`

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

function failing(row) {
  return [
    !row.is_ai_dynamic && `program phase_mode ${row.phase_mode ?? '(no program session)'}`,
    !row.is_first_run && `run ${row.run_of_session ?? '?'} of its session, not the first`,
    !row.one_set_each && `${row.max_sets_per_exercise} sets on one exercise`,
    !row.unplanned && `${row.planned_sets} set(s) with a planned_pct`,
  ].filter(Boolean).join('; ')
}

function describe(row) {
  return `${row.local_date}  ${row.session_name}  (${row.exercises} exercises, max ${row.max_reps} reps)  ` +
    `id ${row.workout_session_id}  user ${row.user_id}`
}

export async function run(argv, env = process.env, log = console.log) {
  const opts = parseArgs(argv)
  assertLocalDatabaseUrl(env.DATABASE_URL, env.LOCAL_DB_PORT || '5433')

  const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: false })
  await client.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(CANDIDATES_SQL, [opts.cutoff, opts.user])
    const matches = rows.filter(r => r.matches)
    const nearMisses = rows.filter(r => !r.matches)

    log(`cutoff ${opts.cutoff}${opts.user ? `, user ${opts.user}` : ''}`)
    log(`${matches.length} session(s) match the baseline rule:`)
    for (const r of matches) log(`  + ${describe(r)}`)
    log(`${nearMisses.length} near miss(es), NOT tagged:`)
    for (const r of nearMisses) log(`  - ${describe(r)}  [${failing(r)}]`)
    const dates = [...new Set(matches.map(r => r.local_date))]
    log(`affected dates: ${dates.length ? dates.join(', ') : '(none)'}`)

    if (!opts.write) {
      await client.query('ROLLBACK')
      log('dry run: nothing written (pass --write to tag the matches)')
      return { predicted: matches.length, written: 0, matches, nearMisses }
    }

    const res = await client.query(UPDATE_SQL, [opts.cutoff, opts.user])
    const want = new Set(matches.map(r => r.workout_session_id))
    const got = new Set(res.rows.map(r => r.id))
    const same = want.size === got.size && [...want].every(id => got.has(id))
    if (!same) {
      await client.query('ROLLBACK')
      throw new Error(`wrote ${got.size} row(s) but the listing predicted ${want.size}; rolled back`)
    }
    await client.query('COMMIT')
    log(`written: ${got.size} (predicted ${want.size})`)
    return { predicted: want.size, written: got.size, matches, nearMisses }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
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
