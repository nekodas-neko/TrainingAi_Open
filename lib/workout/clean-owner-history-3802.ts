import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { formatInTimeZone } from 'date-fns-tz'
import { tombstoneWorkoutSessionInTx } from '@/lib/workout/delete-session'

/**
 * #3802: the one-off clean-up of the owner's old bad rows, approved by the owner on 15 Nov
 * (issue comment 6885652396) and specified row by row in comment 6885759021. Run through the agent
 * key as `clean-owner-history-3802` (`lib/agent-actions/jobs.ts`), never as a migration: the count
 * check below would fail on every database but the owner's.
 *
 * Every group is selected by its rule AND the user id; nothing is written by id alone. Local times
 * are the spec's, Australia/Brisbane, whatever the account's stored zone says.
 *
 *   1   live, never finished, started more than a day ago, on a local date
 *       from 26 May to 3 Jul 2026 (the spec's window)                        → tombstone
 *   2   live, completed, no live exercise log, finished more than a day ago  → tombstone
 *   3a  live, completed_at = started_at, started at local midnight           → tombstone
 *   3b  live, started at local midnight, longer than 6 h, with a live log
 *       before completed_at                                                  → started_at = first log
 *   3c  live, longer than 10 h, not at local midnight, every live log at or
 *       before completed_at − 10 h (at least one)                            → completed_at − 10 h
 *   4   the seven named activity_logs, live and the owner's                  → tombstone ('app')
 *   5   daily_zone_minutes with all five zones 0, days 3 to 21 Jun 2026
 *       (the spec's window)                                                  → delete (a server cache)
 *
 * Group 2's age bound is not in the spec's table, which gives no window for it: a workout finished
 * minutes ago may still have its logs in the phone's outbox, and tombstoning it would make the
 * server refuse them (`ensureWorkoutSession`). A day is the bound group 1 already uses.
 *
 * Sessions are tombstoned through `tombstoneWorkoutSessionInTx`, the code the app's own session
 * delete runs (exercise and set logs tombstoned with it, the phase counter decremented), with
 * `liveChildrenOnly` so a child that was already tombstoned keeps its own `deleted_at`. The personal
 * records of their exercises are reconciled after commit, as `deleteWorkoutSessionAndReconcile`
 * does. An activity is tombstoned the way `deleteActivityLog` does it. Every write bumps
 * `updated_at`, so the delta pull carries the change and the tombstones to the phones. The zone rows
 * are server-derived and never synced, so they are deleted outright.
 *
 * A write runs in one transaction. It locks the rows and plans again. It refuses, writing nothing,
 * unless every group's count is the spec's (`SPEC_COUNTS_3802`) and every group's row set is the one
 * the caller's dry run reported (`digests`, a sha256 per group). Each statement must then touch
 * exactly the planned rows or the transaction rolls back. A second run finds 0 in every group, and
 * a write is refused.
 */

export const CLEAN_GROUPS = ['1', '2', '3a', '3b', '3c', '4', '5'] as const
export type CleanGroup = typeof CLEAN_GROUPS[number]
export type CleanCounts = Record<CleanGroup, number>
export type CleanDigests = Record<CleanGroup, string>

/** The spec's zone for "local midnight" and its date windows. */
export const SPEC_TZ_3802 = 'Australia/Brisbane'

/** What production held on 15 Nov (comment 6885759021). A write refuses on any other plan. */
export const SPEC_COUNTS_3802: Readonly<CleanCounts> = Object.freeze({ '1': 14, '2': 3, '3a': 4, '3b': 7, '3c': 4, '4': 7, '5': 19 })

/** Inclusive local dates (Australia/Brisbane): group 1 by `started_at`, group 5 by `day`. */
export const GROUP1_WINDOW_3802 = { from: '2026-05-26', to: '2026-07-03' } as const
export const GROUP5_WINDOW_3802 = { from: '2026-06-03', to: '2026-06-21' } as const

/** The activities comment 6885759021 names: the 24 Sep treadmill copy, the two 17 Jun manual walks, the four stubs. */
export const ACTIVITY_IDS_3802 = [
  'b8083d04-bd7a-4437-bef6-abf5b688d9ec',
  '359255c1-afaf-49a1-b3e1-dc225937e4f8',
  '95b5220b-56a1-4719-9bfd-08b1acf8aa1e',
  '948e3f07-3d5f-40e9-8eee-95f850be792d',
  'df9fbaa9-91a1-48fe-b311-f90637ebeaf0',
  '5fe2fa30-465c-4a8e-99a3-347a8c705ec8',
  '455c3e32-7bf9-412d-a83f-cc52559f1c45',
] as const

/**
 * The caches a write makes stale, and what refreshes each. The job runs on the server, so it cannot
 * clear a phone's cache itself: the phone's next pull raises its `workouts` and `activity` flags and
 * `invalidatePulledDomains` (lib/cache-groups.ts) runs the two groups named here.
 */
export const CACHES_3802 = [
  'device: invalidateWorkoutSummaries (pull flag `workouts`) — sessions tombstoned or re-timed',
  'device: invalidateActivityWrites (pull flag `activity`) — activities tombstoned',
  'server: personal_records — reconciled for every exercise in a tombstoned session',
  'server: daily_zone_minutes — the all-zero rows are the deleted cache; a read recomputes a day from heart rate',
] as const

interface TimeChange { id: string; before: string; after: string }

/** What reconciling the tombstoned sessions' exercises would do to their records. Counts only. */
export interface RecordEffect { exercises: number; lower: number; remove: number; unchanged: number; add: number; raise: number }

interface Plan {
  tombstone: Record<'1' | '2' | '3a', string[]>
  startFix: TimeChange[]
  endFix: TimeChange[]
  activities: string[]
  zoneDays: string[]
  /** Live exercise logs, and live set logs, under the sessions to tombstone (they go with them). */
  childLogs: { exerciseLogs: number; setLogs: number }
  /** The exercises whose records are reconciled after a write, with each one's stored record. */
  records: { names: string[]; stored: Map<string, number> }
  recordEffect: RecordEffect
  /** prescribed_runs that credit one of the activities (left linked, as the app's delete leaves them). */
  linkedPrescribedRunIds: string[]
  /** Local dates the write touches, for the log's `days_moved`. */
  dates: Set<string>
}

const iso = (d: Date) => d.toISOString()

export interface CleanDeps {
  connect: () => Promise<PoolClient>
  reconcilePersonalRecord: (userId: string, exerciseName: string) => Promise<unknown>
  bestQualifyingPersonalRecord: (userId: string, exerciseName: string, opts: { excludeSessionIds: string[] }) =>
    Promise<{ estimated1rm: number } | null>
}

async function plan(client: Pick<PoolClient, 'query'>, deps: CleanDeps, userId: string): Promise<Plan> {
  const tz = SPEC_TZ_3802
  // Every session query binds $2 = the spec's zone, so each rule reads the same local midnight.
  const ids = async (where: string, extra: unknown[] = []) => (await client.query<{ id: string; started_at: Date }>(
    `SELECT ws.id, ws.started_at FROM workout_sessions ws
     WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND $2::text IS NOT NULL AND ${where}
     ORDER BY ws.started_at, ws.id`, [userId, tz, ...extra])).rows
  const midnight = `(ws.started_at AT TIME ZONE $2)::time = time '00:00'`
  const liveLog = `SELECT 1 FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL`

  const g1 = await ids(
    `ws.completed_at IS NULL AND ws.started_at < now() - interval '1 day'
     AND (ws.started_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`,
    [GROUP1_WINDOW_3802.from, GROUP1_WINDOW_3802.to])
  const g2 = await ids(
    `ws.completed_at IS NOT NULL AND GREATEST(ws.started_at, ws.completed_at) < now() - interval '1 day'
     AND NOT EXISTS (${liveLog})`)
  const g3a = await ids(`ws.completed_at = ws.started_at AND ${midnight}`)

  const g3b = (await client.query<{ id: string; started_at: Date; first_log: Date }>(
    `SELECT ws.id, ws.started_at, min(el.logged_at) AS first_log
     FROM workout_sessions ws JOIN exercise_logs el ON el.workout_session_id = ws.id AND el.deleted_at IS NULL
     WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND ${midnight}
       AND ws.completed_at - ws.started_at > interval '6 hours'
     GROUP BY ws.id, ws.started_at
     HAVING min(el.logged_at) < max(ws.completed_at)
     ORDER BY ws.started_at, ws.id`, [userId, tz])).rows

  const g3c = (await client.query<{ id: string; started_at: Date; completed_at: Date }>(
    `SELECT ws.id, ws.started_at, ws.completed_at FROM workout_sessions ws
     WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND NOT ${midnight}
       AND ws.completed_at - ws.started_at > interval '10 hours'
       AND EXISTS (${liveLog})
       AND NOT EXISTS (${liveLog} AND el.logged_at > ws.completed_at - interval '10 hours')
     ORDER BY ws.started_at, ws.id`, [userId, tz])).rows

  const activities = (await client.query<{ id: string; date: string }>(
    `SELECT id, date::text AS date FROM activity_logs
     WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[]) ORDER BY date, id`,
    [userId, ACTIVITY_IDS_3802])).rows

  const zoneDays = (await client.query<{ day: string }>(
    `SELECT day::text AS day FROM daily_zone_minutes
     WHERE user_id = $1 AND zone1_sec = 0 AND zone2_sec = 0 AND zone3_sec = 0 AND zone4_sec = 0 AND zone5_sec = 0
       AND day BETWEEN $2::date AND $3::date
     ORDER BY day`, [userId, GROUP5_WINDOW_3802.from, GROUP5_WINDOW_3802.to])).rows.map(r => r.day)

  const toTombstone = [...new Set([...g1, ...g2, ...g3a].map(r => r.id))]
  // Counted the way `tombstoneWorkoutSessionInTx` writes with `liveChildrenOnly`: every live exercise
  // log of the session, and every live set under any of its exercise logs.
  const child = (await client.query<{ exercise_logs: number; set_logs: number }>(
    `SELECT
       (SELECT count(*)::int FROM exercise_logs WHERE workout_session_id = ANY($1::uuid[]) AND deleted_at IS NULL) AS exercise_logs,
       (SELECT count(*)::int FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id
         WHERE el.workout_session_id = ANY($1::uuid[]) AND sl.deleted_at IS NULL) AS set_logs`, [toTombstone])).rows[0]

  // The names `tombstoneWorkoutSessionInTx` returns (every log, live or not), and what the one rule
  // (`bestQualifyingPersonalRecord`) would leave each record at once the sessions are gone.
  const names = (await client.query<{ exercise_name: string }>(
    `SELECT DISTINCT exercise_name FROM exercise_logs WHERE workout_session_id = ANY($1::uuid[]) ORDER BY exercise_name`,
    [toTombstone])).rows.map(r => r.exercise_name)
  const stored = new Map((await client.query<{ exercise_name: string; estimated_1rm: number }>(
    `SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = ANY($2::text[])`,
    [userId, names])).rows.map(r => [r.exercise_name, Number(r.estimated_1rm)]))
  const recordEffect: RecordEffect = { exercises: names.length, lower: 0, remove: 0, unchanged: 0, add: 0, raise: 0 }
  for (const name of names) {
    const best = await deps.bestQualifyingPersonalRecord(userId, name, { excludeSessionIds: toTombstone })
    const current = stored.get(name)
    if (current == null) { if (best) recordEffect.add++; else recordEffect.unchanged++ }
    else if (!best) recordEffect.remove++
    else if (best.estimated1rm < current) recordEffect.lower++
    else if (best.estimated1rm > current) recordEffect.raise++
    else recordEffect.unchanged++
  }

  const linked = (await client.query<{ id: string }>(
    `SELECT id FROM prescribed_runs WHERE user_id = $1 AND activity_log_id = ANY($2::uuid[]) ORDER BY id`,
    [userId, activities.map(a => a.id)])).rows.map(r => r.id)

  const localDate = (d: Date) => formatInTimeZone(d, tz, 'yyyy-MM-dd')
  const dates = new Set<string>([
    ...[...g1, ...g2, ...g3a, ...g3b, ...g3c].map(r => localDate(r.started_at)),
    ...activities.map(a => a.date),
    ...zoneDays,
  ])

  return {
    tombstone: { '1': g1.map(r => r.id), '2': g2.map(r => r.id), '3a': g3a.map(r => r.id) },
    startFix: g3b.map(r => ({ id: r.id, before: iso(r.started_at), after: iso(r.first_log) })),
    endFix: g3c.map(r => ({ id: r.id, before: iso(r.completed_at), after: iso(new Date(r.completed_at.getTime() - 10 * 3_600_000)) })),
    activities: activities.map(a => a.id),
    zoneDays,
    childLogs: { exerciseLogs: child?.exercise_logs ?? 0, setLogs: child?.set_logs ?? 0 },
    records: { names, stored },
    recordEffect,
    linkedPrescribedRunIds: linked,
    dates,
  }
}

const countsOf = (p: Plan): CleanCounts => ({
  '1': p.tombstone['1'].length, '2': p.tombstone['2'].length, '3a': p.tombstone['3a'].length,
  '3b': p.startFix.length, '3c': p.endFix.length, '4': p.activities.length, '5': p.zoneDays.length,
})

/** sha256 of the group's sorted row keys: an id, a day, or for a re-timing the id with both times. */
export function digestOf(keys: readonly string[]): string {
  return createHash('sha256').update([...keys].sort().join('\n')).digest('hex')
}

const change = (c: TimeChange) => `${c.id} ${c.before} ${c.after}`
const digestsOf = (p: Plan): CleanDigests => ({
  '1': digestOf(p.tombstone['1']), '2': digestOf(p.tombstone['2']), '3a': digestOf(p.tombstone['3a']),
  '3b': digestOf(p.startFix.map(change)), '3c': digestOf(p.endFix.map(change)),
  '4': digestOf(p.activities), '5': digestOf(p.zoneDays),
})

const matchesSpec = (c: CleanCounts) => CLEAN_GROUPS.every(g => c[g] === SPEC_COUNTS_3802[g])

/** Ids only: no titles, names or health values (the report is posted on a public issue). */
function describePlan(p: Plan) {
  const tombstoneIds = [...p.tombstone['1'], ...p.tombstone['2'], ...p.tombstone['3a']]
  const counts = countsOf(p)
  return {
    counts,
    /** Pass these back verbatim as the write's `params.digests`. */
    digests: digestsOf(p),
    /** Whether every count is the spec's; a write refuses unless it is. */
    matchesSpec: matchesSpec(counts),
    groups: {
      '1': { action: 'tombstone', ids: p.tombstone['1'] },
      '2': { action: 'tombstone', ids: p.tombstone['2'] },
      '3a': { action: 'tombstone', ids: p.tombstone['3a'] },
      '3b': { action: 'started_at := first live exercise log', changes: p.startFix.map(c => ({ id: c.id, startedAt: { before: c.before, after: c.after } })) },
      '3c': { action: 'completed_at := completed_at - 10 h', changes: p.endFix.map(c => ({ id: c.id, completedAt: { before: c.before, after: c.after } })) },
      '4': { action: "tombstone (deleted_reason 'app')", ids: p.activities, linkedPrescribedRunIds: p.linkedPrescribedRunIds },
      '5': { action: 'delete', days: p.zoneDays },
    },
    /** A session matching more than one tombstone group is tombstoned once. */
    overlaps: tombstoneIds.filter((id, i) => tombstoneIds.indexOf(id) !== i),
    childLogs: p.childLogs,
    /** What the post-commit reconcile would do to the records of the tombstoned sessions' exercises. */
    personalRecords: p.recordEffect,
    caches: CACHES_3802,
  }
}

export interface CleanWritten {
  sessionsRetimed: number
  sessionsTombstoned: number
  exerciseLogsTombstoned: number
  setLogsTombstoned: number
  phaseCountersDecremented: number
  activitiesTombstoned: number
  zoneDaysDeleted: number
  personalRecords: {
    reconciled: number
    /** Null when the read-back after the reconcile failed (listed in `failed`). */
    lowered: number | null
    removed: number | null
    /** Reconciles that threw after commit (the data write stands). An error code each, no names. */
    failed: { error: string }[]
  }
}

export type CleanReport = ReturnType<typeof describePlan> & { dryRun: boolean; written?: CleanWritten }

export type CleanResult =
  | { ok: true; report: CleanReport; affectedRows: number; daysMoved: number }
  | { ok: false; error: 'counts_unexpected'; expected: CleanCounts; found: CleanCounts }
  | { ok: false; error: 'ids_changed'; groups: CleanGroup[]; found: CleanCounts }

/** Thrown inside the transaction when a statement touches a different number of rows than planned. */
class RowCountMismatch extends Error {}

function expectRows(what: string, got: number | null, want: number) {
  if (got !== want) throw new RowCountMismatch(`${what}: touched ${got ?? 0} rows, planned ${want}`)
}

const errorCode = (e: unknown) => {
  const code = (e as { code?: unknown })?.code
  return typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown'
}

export async function cleanOwnerHistory3802(
  deps: CleanDeps, userId: string,
  opts: { dryRun: true } | { dryRun: false; digests: CleanDigests },
): Promise<CleanResult> {
  const client = await deps.connect()
  try {
    if (opts.dryRun) {
      // Read-only, and in a READ ONLY transaction so a slip in the planner cannot write.
      await client.query('BEGIN READ ONLY')
      try {
        const p = await plan(client, deps, userId)
        return { ok: true, report: { dryRun: true, ...describePlan(p) }, affectedRows: 0, daysMoved: 0 }
      } finally {
        await client.query('ROLLBACK')
      }
    }

    await client.query('BEGIN')
    let p: Plan
    const w = { retimed: 0, sessions: 0, exerciseLogs: 0, setLogs: 0, phase: 0, activities: 0, zoneDays: 0 }
    let exerciseNames: string[] = []
    try {
      // Lock everything a group can draw from, so nothing moves between the plan and the writes.
      await client.query(`SELECT id FROM workout_sessions WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE`, [userId])
      await client.query(`SELECT id FROM activity_logs WHERE user_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`, [userId, ACTIVITY_IDS_3802])
      await client.query(`SELECT day FROM daily_zone_minutes WHERE user_id = $1 FOR UPDATE`, [userId])
      p = await plan(client, deps, userId)
      const found = countsOf(p)
      if (!matchesSpec(found)) {
        await client.query('ROLLBACK')
        return { ok: false, error: 'counts_unexpected', expected: { ...SPEC_COUNTS_3802 }, found }
      }
      const planned = digestsOf(p)
      const moved = CLEAN_GROUPS.filter(g => planned[g] !== opts.digests[g])
      if (moved.length > 0) {
        await client.query('ROLLBACK')
        return { ok: false, error: 'ids_changed', groups: moved, found }
      }

      const at = new Date().toISOString()
      // 3b and 3c first, so a row is never both corrected and tombstoned (the groups are disjoint
      // by rule; the order is the spec's belt and braces).
      for (const c of p.startFix) {
        // The value is taken in SQL, not from the plan's JS Date, so microseconds survive.
        const r = await client.query(
          `UPDATE workout_sessions ws SET updated_at = $3, started_at = (
             SELECT min(el.logged_at) FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL)
           WHERE ws.id = $1 AND ws.user_id = $2 AND ws.deleted_at IS NULL`,
          [c.id, userId, at])
        expectRows(`3b ${c.id}`, r.rowCount, 1)
        w.retimed += r.rowCount ?? 0
      }
      for (const c of p.endFix) {
        const r = await client.query(
          `UPDATE workout_sessions SET completed_at = completed_at - interval '10 hours', updated_at = $3
           WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [c.id, userId, at])
        expectRows(`3c ${c.id}`, r.rowCount, 1)
        w.retimed += r.rowCount ?? 0
      }

      const sessions = [...new Set([...p.tombstone['1'], ...p.tombstone['2'], ...p.tombstone['3a']])]
      const names = new Set<string>()
      for (const id of sessions) {
        const done = await tombstoneWorkoutSessionInTx(client, userId, id, at, { liveChildrenOnly: true })
        if (done == null) throw new RowCountMismatch(`session ${id} was not live`)
        expectRows(`session ${id}`, done.written.sessions, 1)
        w.sessions += done.written.sessions
        w.exerciseLogs += done.written.exerciseLogs
        w.setLogs += done.written.setLogs
        w.phase += done.written.phaseCountersDecremented
        for (const name of done.exerciseNames) names.add(name)
      }
      expectRows('exercise logs', w.exerciseLogs, p.childLogs.exerciseLogs)
      expectRows('set logs', w.setLogs, p.childLogs.setLogs)
      exerciseNames = [...names]

      const a = await client.query(
        `UPDATE activity_logs SET deleted_at = $3, deleted_reason = 'app', updated_at = $3
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [userId, p.activities, at])
      expectRows('4', a.rowCount, p.activities.length)
      w.activities = a.rowCount ?? 0

      const z = await client.query(
        `DELETE FROM daily_zone_minutes
         WHERE user_id = $1 AND day = ANY($2::date[])
           AND zone1_sec = 0 AND zone2_sec = 0 AND zone3_sec = 0 AND zone4_sec = 0 AND zone5_sec = 0`,
        [userId, p.zoneDays])
      expectRows('5', z.rowCount, p.zoneDays.length)
      w.zoneDays = z.rowCount ?? 0

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    }

    // After commit, as deleteWorkoutSessionAndReconcile does: a record may cite a log just
    // tombstoned. The write stands whatever happens here, so a failure is reported, not thrown.
    const failed: { error: string }[] = []
    let reconciled = 0
    for (const name of exerciseNames) {
      try {
        await deps.reconcilePersonalRecord(userId, name)
        reconciled++
      } catch (e) {
        failed.push({ error: errorCode(e) })
      }
    }
    // Read back what the reconcile left. A failure here is reported too: the report must come back.
    let lowered: number | null = null
    let removed: number | null = null
    try {
      const after = new Map((await client.query<{ exercise_name: string; estimated_1rm: number }>(
        `SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = ANY($2::text[])`,
        [userId, exerciseNames])).rows.map(r => [r.exercise_name, Number(r.estimated_1rm)]))
      lowered = 0
      removed = 0
      for (const [name, before] of p.records.stored) {
        const left = after.get(name)
        if (left == null) removed++
        else if (left < before) lowered++
      }
    } catch (e) {
      failed.push({ error: `read_back ${errorCode(e)}` })
    }

    const written: CleanWritten = {
      sessionsRetimed: w.retimed,
      sessionsTombstoned: w.sessions,
      exerciseLogsTombstoned: w.exerciseLogs,
      setLogsTombstoned: w.setLogs,
      phaseCountersDecremented: w.phase,
      activitiesTombstoned: w.activities,
      zoneDaysDeleted: w.zoneDays,
      personalRecords: { reconciled, lowered, removed, failed },
    }
    return {
      ok: true,
      report: { dryRun: false, ...describePlan(p), written },
      affectedRows: w.retimed + w.sessions + w.activities + w.zoneDays,
      daysMoved: p.dates.size,
    }
  } finally {
    client.release()
  }
}
