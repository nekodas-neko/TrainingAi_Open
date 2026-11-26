/**
 * Fail a test run that leaves rows behind in the shared `exercise_library` (#4055, #4109).
 *
 * #4038 and #4053 each left rows in a table every other DB test reads, and the second one passed the
 * static rule (scripts/check-test-exercise-library-cleanup.js) because the test renamed its rows and
 * then deleted by the old names. Only a look at the table itself catches that.
 *
 * Per RUN, not per file: vitest runs files in parallel workers against one database, so a file
 * cannot be told apart from its neighbours' writes mid-run, and serialising DB files to get that
 * would make the suite meaningfully slower. Nothing is deleted: a silent cleanup would hide the bug.
 *
 * WHICH ROWS ARE THIS RUN'S (#4109). The first version snapshotted the table when the run started and
 * failed it for any row that was new when it ended. On a database another run shares (a second `pnpm
 * test`, a loop of one file, an agent's run beside the owner's), a row ANOTHER run had inserted and not yet
 * removed was blamed on this one, naming the wrong files: 9 of 30 loops of one passing file failed that way.
 * (CI is not affected: each of its four test shards has its own Postgres service.)
 *
 * Now each run tags its own connections and counts only the rows they insert:
 *  - the run sets `PGAPPNAME` and `PGOPTIONS` (`-c vitest.run_tag=<tag>`) to a fresh tag before any worker
 *    starts, and `pg` (and `psql`) send them on every connection, in this process and in every worker and child
 *    process that inherits the environment. Two channels because a test may set its own `PGAPPNAME` (the
 *    #4007 pool-pressure test does, to find its connections) and must not escape the guard by it;
 *  - a trigger on `exercise_library` (`AFTER INSERT`, installed by the first run, dropped by the last) sends
 *    one `NOTIFY` per inserted row carrying the row id and the inserting connection's two tags;
 *  - this run LISTENs, keeps the ids whose tag is its own, and at the end reports the ones still in the table.
 *    It compares by id, so a row renamed after insert still counts, and a row the test removed does not.
 * A row inserted by a connection that carries no run tag (the dev server, a psql session) is no run's leak
 * and is not blamed on any run.
 *
 * THE HOOK IS DDL, SO IT IS INSTALLED ONLY WHERE THAT IS SAFE. The trigger and its function are created on
 * whatever `DATABASE_URL` names, so the guard installs them only when the URL is a local host (`localhost`,
 * `127.0.0.1`, `::1`, or a socket path as the host) or the database name marks a test database (it contains
 * "test"). Anything else gets the old read-only comparison against a snapshot and one warning line; the
 * guard never writes to a database it cannot show is disposable. See `mayInstallHook`.
 *
 * If the trigger cannot be installed (no permission, the table is locked for seconds) the run falls back to
 * the old comparison against a snapshot, with its old false positives, and says so on stderr.
 *
 * A run killed with SIGKILL leaves the trigger behind. That is harmless: the next run finds it, reuses it
 * (the function is replaced in place), and the last run alive drops it. Until then it only sends
 * notifications nobody reads.
 *
 * WHAT THE PER-RUN ATTRIBUTION CAN MISS, and how that is bounded. The tag travels in the process environment,
 * so a connection that does not carry it is attributed to no run: a child process started with a clean `env`,
 * a URL that sets its own `application_name` AND `options`, a connection that resets its own tags. To keep
 * those from hiding a leak, attribution is used only when two or more runs are alive at the end (the case it
 * exists for). With one run registered nobody else can own a surviving row, so every row that was not in the
 * start snapshot is flagged, tagged or not: the old behaviour, with no false positive left to avoid.
 * Remaining gaps: with two or more runs alive, an untagged connection's leak is nobody's; and a run that
 * started and ended entirely inside this one, leaving a row, is blamed on this one (the snapshot cannot tell).
 *
 * Silent (nothing watched, no failure) when DATABASE_URL is unset, the database is unreachable, or the
 * table is absent, and in watch mode, where "after" has no end.
 */
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type LibraryRow = { id: string; name: string }

/** Rows present now that were not in the snapshot, by id, so a renamed row still counts. */
export function leftoverRows(before: LibraryRow[], after: LibraryRow[]): LibraryRow[] {
  const known = new Set(before.map(r => r.id))
  return after.filter(r => !known.has(r.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Test files that mention a leftover name, as a lead only: a renamed row's name will not be in the
 * file that made it, which is why this is "likely" and the run-level failure is the guarantee.
 */
export function likelyFiles(names: string[], root: string): string[] {
  const hits = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!['node_modules', '.next', '.git', 'mobile', 'android', 'ios'].includes(e.name)) walk(path.join(dir, e.name))
      } else if (/\.(test|fixture)\.(ts|tsx)$/.test(e.name)) {
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8')
        if (names.some(n => n.length >= 4 && text.includes(n))) hits.add(path.relative(root, path.join(dir, e.name)))
      }
    }
  }
  try { walk(root) } catch { /* a lead only */ }
  return [...hits].sort()
}

export function describeLeak(leftover: LibraryRow[], files: string[]): string {
  const lines = [
    `exercise_library gained ${leftover.length} row(s) during this test run and kept them (#4055):`,
    ...leftover.slice(0, 50).map(r => `  - ${JSON.stringify(r.name)} (${r.id})`),
    ...(leftover.length > 50 ? [`  ... and ${leftover.length - 50} more`] : []),
    files.length ? `Test files that mention these names: ${files.join(', ')}` : 'No test file mentions these names — the test probably renamed its rows.',
    'Delete by the ids the test created, in an afterAll that runs on failure; the cleanup is not done for you.',
  ]
  return lines.join('\n')
}

async function snapshot(url: string): Promise<LibraryRow[] | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000, application_name: 'vitest-leak-guard' })
  client.on('error', () => {})
  try {
    await client.connect()
    const { rows } = await client.query<LibraryRow>('SELECT id, name FROM exercise_library')
    return rows
  } catch {
    return null
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * True when it is safe to run DDL (the insert hook) against this URL: a local host, a socket path, or a database
 * whose name marks it a test database. Anything unparseable is not safe: fail closed.
 */
export function mayInstallHook(url: string): boolean {
  // `postgresql://u:p@/db?host=/tmp` (an empty host before a socket path) is not a valid WHATWG URL: parse it with a
  // placeholder host and remember that the host was empty.
  const emptyHost = /^(postgres(?:ql)?:\/\/[^/@]*@)\//i.test(url)
  let u: URL
  try { u = new URL(emptyHost ? url.replace('@/', '@placeholder/') : url) } catch { return false }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return false
  const hostPart = emptyHost ? '' : decodeURIComponent(u.hostname)
  const host = (u.searchParams.get('host') ?? hostPart).replace(/^\[|\]$/g, '').toLowerCase()
  const local = host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('/')
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, '')).toLowerCase()
  return local || /test/.test(dbName)
}

/**
 * `LEAK_GUARD_SCOPE` gives a run its own trigger, channel and run count, so the guard's own test can start a run that
 * is the only one registered while the outer `pnpm test` run is live. Never set in a real run.
 */
const SCOPE = (process.env.LEAK_GUARD_SCOPE ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 24)
const CHANNEL = `catalogue_leak_guard${SCOPE ? `_${SCOPE}` : ''}`
const TRIGGER = `zz_catalogue_leak_guard${SCOPE ? `_${SCOPE}` : ''}`
/** Advisory keys: one serialises installing and removing the trigger, one counts the runs that are alive. */
const KEY_OFFSET = SCOPE ? 100 + [...SCOPE].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1_000_000, 7) * 2 : 0
const SETUP_KEY = 41090001 + KEY_OFFSET
const RUNS_KEY = 41090002 + KEY_OFFSET

/** The hook the tag and the row ids travel through; see the header. */
const INSTALL_SQL = `
  CREATE OR REPLACE FUNCTION ${TRIGGER}() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    PERFORM pg_notify('${CHANNEL}', json_build_object('id', NEW.id, 'app', current_setting('application_name', true), 'run', current_setting('vitest.run_tag', true))::text);
    RETURN NULL;
  END $f$;
`
const CREATE_TRIGGER_SQL = `CREATE TRIGGER ${TRIGGER} AFTER INSERT ON exercise_library FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}()`

/** Rows ours: the notified ids that are still in the table. */
export function ownLeftovers(notified: string[], present: LibraryRow[]): LibraryRow[] {
  const mine = new Set(notified)
  return present.filter(r => mine.has(r.id)).sort((a, b) => a.name.localeCompare(b.name))
}

interface Watch {
  tag: string
  listener: Client
  notified: Set<string>
}

/** Takes the tag, installs the trigger if no run has, registers this run as alive, and starts listening. Null: not possible. */
async function startWatch(url: string): Promise<Watch | null> {
  const tag = `vitest-run-${randomUUID()}`
  const listener = new Client({ connectionString: url, connectionTimeoutMillis: 3000, application_name: 'vitest-leak-guard' })
  listener.on('error', () => {})
  const notified = new Set<string>()
  try {
    await listener.connect()
    await listener.query(`SET lock_timeout = '5s'`)
    await listener.query('SELECT pg_advisory_lock($1)', [SETUP_KEY])
    try {
      await listener.query(INSTALL_SQL) // the function: replaced in place, takes no lock on the table
      const have = await listener.query(`SELECT 1 FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'exercise_library'::regclass`, [TRIGGER])
      if (have.rowCount === 0) await listener.query(CREATE_TRIGGER_SQL)
      await listener.query('SELECT pg_advisory_lock_shared($1)', [RUNS_KEY])
    } finally {
      await listener.query('SELECT pg_advisory_unlock($1)', [SETUP_KEY]).catch(() => {})
    }
    listener.on('notification', msg => {
      try {
        const body = JSON.parse(msg.payload ?? '{}') as { id?: string; app?: string; run?: string }
        if ((body.run === tag || body.app === tag) && body.id) notified.add(body.id)
      } catch { /* not ours */ }
    })
    await listener.query(`LISTEN ${CHANNEL}`)
    return { tag, listener, notified }
  } catch {
    await listener.end().catch(() => {})
    return null
  }
}

/** How many runs are registered as alive right now (this one included): the shared holders of RUNS_KEY. */
async function liveRuns(w: Watch): Promise<number> {
  const r = await w.listener.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND mode = 'ShareLock' AND granted AND classid = $1 AND objid = $2 AND objsubid = 1`,
    [Math.floor(RUNS_KEY / 2 ** 32), RUNS_KEY % 2 ** 32],
  )
  return Number(r.rows[0]?.n ?? 0)
}

/** Unregisters; the last run alive drops the trigger (best effort: a leftover trigger only sends notifications nobody reads). */
async function stopWatch(w: Watch): Promise<void> {
  try {
    await w.listener.query('SELECT pg_advisory_lock($1)', [SETUP_KEY])
    try {
      await w.listener.query('SELECT pg_advisory_unlock_shared($1)', [RUNS_KEY])
      const last = (await w.listener.query('SELECT pg_try_advisory_lock($1) AS ok', [RUNS_KEY])).rows[0]?.ok === true
      if (last) {
        try {
          await w.listener.query(`SET lock_timeout = '3s'`)
          await w.listener.query(`DROP TRIGGER IF EXISTS ${TRIGGER} ON exercise_library`)
          await w.listener.query(`DROP FUNCTION IF EXISTS ${TRIGGER}()`)
        } catch { /* left in place */ }
        await w.listener.query('SELECT pg_advisory_unlock($1)', [RUNS_KEY]).catch(() => {})
      }
    } finally {
      await w.listener.query('SELECT pg_advisory_unlock($1)', [SETUP_KEY]).catch(() => {})
    }
  } catch { /* the connection is gone: its locks went with it */ }
}

function report(leftover: LibraryRow[]) {
  // Not a throw: vitest reports an error from a global teardown as "error during close" and still
  // exits 0 (measured on 4.1.11), which is the one outcome this check exists to prevent.
  process.stderr.write(`\n${describeLeak(leftover, likelyFiles(leftover.map(r => r.name), process.cwd()))}\n\n`)
  process.exitCode = 1
}

export default async function setup(project?: { vitest?: { config?: { watch?: boolean } } }) {
  const url = process.env.DATABASE_URL
  if (!url || project?.vitest?.config?.watch) return
  const before = await snapshot(url)
  if (!before) return

  const safe = mayInstallHook(url)
  if (!safe) {
    process.stderr.write('[catalogue leak guard] DATABASE_URL is not a local or test database: not installing the insert hook (it is DDL); comparing against a snapshot instead (#4109).\n')
  }
  const watch = safe ? await startWatch(url) : null
  if (!watch) {
    if (safe) process.stderr.write('[catalogue leak guard] could not install its insert hook: comparing against a snapshot, which blames this run for rows another run on the same database inserts (#4109).\n')
    return async () => {
      const after = await snapshot(url)
      if (!after) return
      const leftover = leftoverRows(before, after)
      if (leftover.length > 0) report(leftover)
    }
  }

  // Before any worker starts: they inherit it, and every connection they open names this run.
  const had = { PGAPPNAME: process.env.PGAPPNAME, PGOPTIONS: process.env.PGOPTIONS }
  process.env.PGAPPNAME = watch.tag
  process.env.PGOPTIONS = `${had.PGOPTIONS ? `${had.PGOPTIONS} ` : ''}-c vitest.run_tag=${watch.tag}`
  return async () => {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      // Notifications reach the listener ahead of the reply to its next query; two round trips, then a beat.
      await watch.listener.query('SELECT 1')
      await watch.listener.query('SELECT 1')
      await new Promise(r => setTimeout(r, 50))
      const ids = [...watch.notified]
      const present = ids.length
        ? (await watch.listener.query<LibraryRow>('SELECT id, name FROM exercise_library WHERE id = ANY($1::uuid[])', [ids])).rows
        : []
      // One run registered: nobody else can own a surviving row, so flag every new row, tagged or not. Two or
      // more: only this run's own (see the header for what that can miss).
      const alone = (await liveRuns(watch)) <= 1
      let leftover = ownLeftovers(ids, present)
      if (alone) {
        const after = await snapshot(url)
        if (after) {
          const seen = new Set(leftover.map(r => r.id))
          leftover = [...leftover, ...leftoverRows(before, after).filter(r => !seen.has(r.id))].sort((a, b) => a.name.localeCompare(b.name))
        }
      }
      if (leftover.length > 0) report(leftover)
    } catch {
      // The check could not run (the connection dropped): say so rather than pass silently.
      process.stderr.write('[catalogue leak guard] could not read exercise_library at the end of the run; no verdict.\n')
    } finally {
      await stopWatch(watch)
      await watch.listener.end().catch(() => {})
    }
  }
}
