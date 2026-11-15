import type { PoolClient } from 'pg'
import { formatInTimeZone } from 'date-fns-tz'
import { tombstoneWorkoutSessionInTx } from '@/lib/workout/delete-session'

/**
 * #3802: the one-off clean-up of the owner's old bad rows, approved by the owner on 15 Nov
 * (issue comment 6885652396) and specified row by row in comment 6885759021. Run through the agent
 * key as `clean-owner-history-3802` (`lib/agent-actions/jobs.ts`), never as a migration: the count
 * check below would fail on every database but the owner's.
 *
 * Every group is selected by its rule AND the user id; nothing is written by id alone.
 *
 *   1   live sessions never finished, started more than a day ago            → tombstone
 *   2   live completed sessions with no live exercise log                    → tombstone
 *   3a  live sessions with completed_at = started_at, started at local midnight → tombstone
 *   3b  live, started at local midnight, longer than 6 h, with a live log    → started_at = first log
 *   3c  live, longer than 10 h, not at local midnight, every live log at or
 *       before completed_at − 10 h (at least one)                            → completed_at − 10 h
 *   4   the seven named activity_logs, live and the owner's                  → tombstone ('app')
 *   5   daily_zone_minutes with all five zones 0                             → delete (a server cache)
 *
 * Sessions are tombstoned through `tombstoneWorkoutSessionInTx`, the code the app's own session
 * delete runs (exercise and set logs tombstoned with it, the phase counter decremented), and the
 * personal records of their exercises are reconciled after commit, as `deleteWorkoutSessionAndReconcile`
 * does. An activity is tombstoned the way `deleteActivityLog` does it. Every write bumps
 * `updated_at`, so the delta pull carries the change and the tombstones to the phones. The zone rows
 * are server-derived and never synced, so they are deleted outright.
 *
 * A write runs in one transaction. It locks the rows, re-plans, and refuses (writing nothing) unless
 * every group's count equals what the caller's dry run reported; each statement must then touch
 * exactly the planned rows or the transaction rolls back. A second run finds 0 in every group.
 */

export const CLEAN_GROUPS = ['1', '2', '3a', '3b', '3c', '4', '5'] as const
export type CleanGroup = typeof CLEAN_GROUPS[number]
export type CleanCounts = Record<CleanGroup, number>

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

interface Plan {
  tombstone: Record<'1' | '2' | '3a', string[]>
  startFix: TimeChange[]
  endFix: TimeChange[]
  activities: string[]
  zoneDays: string[]
  /** Live exercise and set logs under the sessions to tombstone (they go with them). */
  childLogs: { exerciseLogs: number; setLogs: number }
  /** prescribed_runs that credit one of the activities (left linked, as the app's delete leaves them). */
  linkedPrescribedRunIds: string[]
  /** Local dates the write touches, for the log's `days_moved`. */
  dates: Set<string>
}

const iso = (d: Date) => d.toISOString()

async function plan(client: Pick<PoolClient, 'query'>, userId: string, tz: string): Promise<Plan> {
  // Every query binds $2 = tz, so each rule reads the same local midnight.
  const ids = async (where: string) => (await client.query<{ id: string; started_at: Date }>(
    `SELECT ws.id, ws.started_at FROM workout_sessions ws
     WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND $2::text IS NOT NULL AND ${where}
     ORDER BY ws.started_at, ws.id`, [userId, tz])).rows
  const midnight = `(ws.started_at AT TIME ZONE $2)::time = time '00:00'`
  const liveLog = `SELECT 1 FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL`

  const g1 = await ids(`ws.completed_at IS NULL AND ws.started_at < now() - interval '1 day'`)
  const g2 = await ids(`ws.completed_at IS NOT NULL AND NOT EXISTS (${liveLog})`)
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
     ORDER BY day`, [userId])).rows.map(r => r.day)

  const toTombstone = [...new Set([...g1, ...g2, ...g3a].map(r => r.id))]
  const child = (await client.query<{ exercise_logs: number; set_logs: number }>(
    `SELECT count(DISTINCT el.id)::int AS exercise_logs, count(sl.id)::int AS set_logs
     FROM exercise_logs el LEFT JOIN set_logs sl ON sl.exercise_log_id = el.id AND sl.deleted_at IS NULL
     WHERE el.workout_session_id = ANY($1::uuid[]) AND el.deleted_at IS NULL`, [toTombstone])).rows[0]

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
    linkedPrescribedRunIds: linked,
    dates,
  }
}

const countsOf = (p: Plan): CleanCounts => ({
  '1': p.tombstone['1'].length, '2': p.tombstone['2'].length, '3a': p.tombstone['3a'].length,
  '3b': p.startFix.length, '3c': p.endFix.length, '4': p.activities.length, '5': p.zoneDays.length,
})

/** Ids only: no titles, names or health values (the report is posted on a public issue). */
function describePlan(p: Plan) {
  const tombstoneIds = [...p.tombstone['1'], ...p.tombstone['2'], ...p.tombstone['3a']]
  return {
    counts: countsOf(p),
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
    caches: CACHES_3802,
  }
}

export type CleanReport = ReturnType<typeof describePlan> & {
  dryRun: boolean
  written?: {
    sessionsRetimed: number
    sessionsTombstoned: number
    exerciseLogsTombstoned: number
    setLogsTombstoned: number
    activitiesTombstoned: number
    zoneDaysDeleted: number
    personalRecordsReconciled: number
  }
}

export type CleanResult =
  | { ok: true; report: CleanReport; affectedRows: number; daysMoved: number }
  | { ok: false; error: 'counts_changed'; expected: CleanCounts; found: CleanCounts }

/** Thrown inside the transaction when a statement touches a different number of rows than planned. */
class RowCountMismatch extends Error {}

function expectRows(what: string, got: number | null, want: number) {
  if (got !== want) throw new RowCountMismatch(`${what}: touched ${got ?? 0} rows, planned ${want}`)
}

export interface CleanDeps {
  connect: () => Promise<PoolClient>
  reconcilePersonalRecord: (userId: string, exerciseName: string) => Promise<unknown>
}

export async function cleanOwnerHistory3802(
  deps: CleanDeps, userId: string, tz: string,
  opts: { dryRun: true; expect?: CleanCounts } | { dryRun: false; expect: CleanCounts },
): Promise<CleanResult> {
  const client = await deps.connect()
  try {
    if (opts.dryRun) {
      // Read-only, and in a READ ONLY transaction so a slip in the planner cannot write.
      await client.query('BEGIN READ ONLY')
      try {
        const p = await plan(client, userId, tz)
        return { ok: true, report: { dryRun: true, ...describePlan(p) }, affectedRows: 0, daysMoved: 0 }
      } finally {
        await client.query('ROLLBACK')
      }
    }

    await client.query('BEGIN')
    let p: Plan
    let exerciseNames: string[] = []
    try {
      // Lock everything a group can draw from, so nothing moves between the plan and the writes.
      await client.query(`SELECT id FROM workout_sessions WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE`, [userId])
      await client.query(`SELECT id FROM activity_logs WHERE user_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`, [userId, ACTIVITY_IDS_3802])
      await client.query(`SELECT day FROM daily_zone_minutes WHERE user_id = $1 FOR UPDATE`, [userId])
      p = await plan(client, userId, tz)
      const found = countsOf(p)
      if (CLEAN_GROUPS.some(g => found[g] !== opts.expect[g])) {
        await client.query('ROLLBACK')
        return { ok: false, error: 'counts_changed', expected: opts.expect, found }
      }

      const now = new Date().toISOString()
      // 3b and 3c first, so a row is never both corrected and tombstoned (the groups are disjoint
      // by rule; the order is the spec's belt and braces).
      for (const c of p.startFix) {
        // The value is taken in SQL, not from the plan's JS Date, so microseconds survive.
        const r = await client.query(
          `UPDATE workout_sessions ws SET updated_at = $3, started_at = (
             SELECT min(el.logged_at) FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL)
           WHERE ws.id = $1 AND ws.user_id = $2 AND ws.deleted_at IS NULL`,
          [c.id, userId, now])
        expectRows(`3b ${c.id}`, r.rowCount, 1)
      }
      for (const c of p.endFix) {
        const r = await client.query(
          `UPDATE workout_sessions SET completed_at = completed_at - interval '10 hours', updated_at = $3
           WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [c.id, userId, now])
        expectRows(`3c ${c.id}`, r.rowCount, 1)
      }

      const sessions = [...new Set([...p.tombstone['1'], ...p.tombstone['2'], ...p.tombstone['3a']])]
      const names = new Set<string>()
      for (const id of sessions) {
        const n = await tombstoneWorkoutSessionInTx(client, userId, id, now)
        if (n == null) throw new RowCountMismatch(`session ${id} was not live`)
        for (const name of n) names.add(name)
      }
      exerciseNames = [...names]

      const a = await client.query(
        `UPDATE activity_logs SET deleted_at = $3, deleted_reason = 'app', updated_at = $3
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [userId, p.activities, now])
      expectRows('4', a.rowCount, p.activities.length)

      const z = await client.query(
        `DELETE FROM daily_zone_minutes
         WHERE user_id = $1 AND day = ANY($2::date[])
           AND zone1_sec = 0 AND zone2_sec = 0 AND zone3_sec = 0 AND zone4_sec = 0 AND zone5_sec = 0`,
        [userId, p.zoneDays])
      expectRows('5', z.rowCount, p.zoneDays.length)

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    }

    // After commit, as deleteWorkoutSessionAndReconcile does: a record may cite a log just tombstoned.
    for (const name of exerciseNames) await deps.reconcilePersonalRecord(userId, name)

    const sessionsTombstoned = new Set([...p.tombstone['1'], ...p.tombstone['2'], ...p.tombstone['3a']]).size
    const written = {
      sessionsRetimed: p.startFix.length + p.endFix.length,
      sessionsTombstoned,
      exerciseLogsTombstoned: p.childLogs.exerciseLogs,
      setLogsTombstoned: p.childLogs.setLogs,
      activitiesTombstoned: p.activities.length,
      zoneDaysDeleted: p.zoneDays.length,
      personalRecordsReconciled: exerciseNames.length,
    }
    return {
      ok: true,
      report: { dryRun: false, ...describePlan(p), written },
      affectedRows: written.sessionsRetimed + sessionsTombstoned + written.activitiesTombstoned + written.zoneDaysDeleted,
      daysMoved: p.dates.size,
    }
  } finally {
    client.release()
  }
}
