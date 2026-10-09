import { getPool } from '@/lib/data/postgres/client'
import type { WorkoutRepository } from '@/lib/data/repository'
import { toAestDateStr } from '@trainingai/shared/date-utils'
import {
  planStylelessOneRmRederive, medianStylelessMovePct, type StylelessLogInput,
} from '@trainingai/shared/workout/styleless-one-rm-rederive'

/**
 * Issue 2357: re-derive the stored 1RMs of styleless working sets without the AMRAP discount.
 * The ONE implementation behind both doors: `POST /api/admin/rederive-styleless-one-rm` (admin
 * session) and the agent-key job `rederive-styleless-one-rm` (`lib/agent-actions/jobs.ts`).
 *
 * **It overwrites stored 1RMs, so it is a production data change.** Run order (docs/admin-actions.md
 * section 11): a verified snapshot, the dry run (its `summary.wouldWrite` against the issue's
 * prediction of 118 logs), the write, then a read-only `claude_ro` check.
 *
 * A log qualifies when its estimate went through `calculate1RM`'s styleless branch and nothing
 * else: a live, non-deloaded log with a positive stored 1RM, of an exercise that is not
 * bodyweight, outside a baseline session (bodyweight and baseline sets keep the AMRAP discount by
 * design), with no style id, no style name, and no set carrying a planned percentage.
 *
 * Writes `exercise_logs.estimated_1rm`, `target_80` and each set's `intensity_pct`, every value
 * derived server-side, with `updated_at` moved so the delta pull delivers the rows to the device.
 * Each log update is conditional on the stored value it was planned from, and the transaction
 * rolls back if the rows written differ from the rows planned. **`personal_records` is not
 * written**: the owner signed off the logs, and a best re-dated into the past would not reach the
 * device (its delta keys on `achieved_at`). The report lists each best a re-derived log would pass
 * (`bestsBehindLogs`), for the owner to decide separately.
 *
 * Idempotent: a re-derived log is `unchanged` on the next run, so a second run writes 0.
 * Bounded: at most `MAX_SCAN` logs are read and `MAX_WRITES` written per call; `remaining` says
 * how many qualifying changes are left for the next call.
 */

export const MAX_SCAN = 5000
export const MAX_WRITES = 500
const SAMPLE_LIMIT = 50

export interface StylelessRederiveReport {
  dryRun: boolean
  timezone: string
  generatedAt: string
  summary: {
    logsExamined: number
    scanTruncated: boolean
    wouldWrite: number
    unchanged: number
    wouldLower: number
    written: number
    remaining: number
    exercises: number
    daysMoved: number
    medianMovePct: number | null
    largestMovePct: number | null
  }
  bestsBehindLogs: { exerciseName: string; storedBest: number | null; rederivedLogMax: number }[]
  wouldLowerLogs: { exerciseLogId: string; exerciseName: string; loggedAt: string; stored: number; rederived: number }[]
  sample: { exerciseLogId: string; exerciseName: string; loggedAt: string; before: number; after: number }[]
}

export type StylelessRederiveResult =
  | { ok: true; report: StylelessRederiveReport }
  | { ok: false; error: string }

export async function rederiveStylelessOneRm(args: {
  repo: Pick<WorkoutRepository, 'getExerciseType'>
  userId: string
  tz: string
  dryRun: boolean
}): Promise<StylelessRederiveResult> {
  const { repo, userId, tz, dryRun } = args
  const db = getPool()

  const { rows: logRows } = await db.query<{
    id: string; exercise_name: string; logged_at: Date; estimated_1rm: number; target_80: number | null
  }>(
    `SELECT el.id, el.exercise_name, el.logged_at, el.estimated_1rm, el.target_80
     FROM exercise_logs el
     JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE ws.user_id = $1
       AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
       AND el.estimated_1rm > 0
       AND el.exercise_deloaded = false
       AND ws.phase_type IS DISTINCT FROM 'baseline'
       AND el.style_id IS NULL AND el.style_name IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM set_logs sl
         WHERE sl.exercise_log_id = el.id AND sl.deleted_at IS NULL AND sl.planned_pct IS NOT NULL
       )
     ORDER BY el.logged_at, el.id
     LIMIT $2`,
    [userId, MAX_SCAN + 1],
  )
  const scanTruncated = logRows.length > MAX_SCAN
  const scanned = logRows.slice(0, MAX_SCAN)

  // `getExerciseType`, the lookup the log and edit paths make (case-insensitive), so a log is
  // classed exactly as the path that stored it classed it.
  const names0 = [...new Set(scanned.map(r => r.exercise_name))]
  const types = new Map(await Promise.all(names0.map(async n => [n, await repo.getExerciseType(n)] as const)))
  const weighted = scanned.filter(r => types.get(r.exercise_name) !== 'bodyweight')

  const ids = weighted.map(r => r.id)
  const { rows: setRows } = ids.length === 0 ? { rows: [] } : await db.query<{
    id: string; exercise_log_id: string; weight_kg: number; reps: number; intensity_pct: number | null
  }>(
    `SELECT id, exercise_log_id, weight_kg, reps, intensity_pct
     FROM set_logs
     WHERE exercise_log_id = ANY($1::uuid[]) AND deleted_at IS NULL
     ORDER BY exercise_log_id, set_number`,
    [ids],
  )
  const setsByLog = new Map<string, StylelessLogInput['sets']>()
  for (const s of setRows) {
    const list = setsByLog.get(s.exercise_log_id) ?? []
    list.push({ setLogId: s.id, weightKg: Number(s.weight_kg), reps: Number(s.reps), intensityPct: s.intensity_pct == null ? null : Number(s.intensity_pct) })
    setsByLog.set(s.exercise_log_id, list)
  }

  const plan = planStylelessOneRmRederive(weighted.map(r => ({
    exerciseLogId: r.id,
    exerciseName: r.exercise_name,
    loggedAt: new Date(r.logged_at),
    estimated1rm: Number(r.estimated_1rm),
    target80: r.target_80 == null ? null : Number(r.target_80),
    sets: setsByLog.get(r.id) ?? [],
  })))

  const toWrite = plan.changes.slice(0, MAX_WRITES)
  let written = 0
  if (!dryRun && toWrite.length > 0) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      for (const c of toWrite) {
        // Conditional on the value this change was planned from: a log edited since the read is
        // left alone, and the count check below then rolls the whole run back.
        const res = await client.query(
          `UPDATE exercise_logs SET estimated_1rm = $1, target_80 = $2, updated_at = now()
           WHERE id = $3 AND estimated_1rm = $4 AND deleted_at IS NULL`,
          [c.after.estimated1rm, c.after.target80, c.exerciseLogId, c.before.estimated1rm],
        )
        if (res.rowCount !== 1) continue
        written++
        for (const s of c.sets) {
          await client.query(
            `UPDATE set_logs SET intensity_pct = $1, updated_at = now() WHERE id = $2 AND exercise_log_id = $3`,
            [s.intensityPct, s.setLogId, c.exerciseLogId],
          )
        }
      }
      if (written !== toWrite.length) {
        await client.query('ROLLBACK')
        return { ok: false, error: `wrote ${written} of ${toWrite.length} planned logs (a log changed during the run); rolled back, nothing written` }
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  // Bests: reported, not written (see the header).
  const maxByExercise = new Map<string, number>()
  for (const c of plan.changes) {
    maxByExercise.set(c.exerciseName, Math.max(maxByExercise.get(c.exerciseName) ?? 0, c.after.estimated1rm))
  }
  const names = [...maxByExercise.keys()]
  const { rows: prRows } = names.length === 0 ? { rows: [] } : await db.query<{ exercise_name: string; estimated_1rm: number }>(
    `SELECT exercise_name, estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = ANY($2::text[])`,
    [userId, names],
  )
  const bestByName = new Map(prRows.map(r => [r.exercise_name, Number(r.estimated_1rm)]))
  const bestsBehindLogs = names
    .filter(n => (bestByName.get(n) ?? 0) < maxByExercise.get(n)!)
    .map(n => ({ exerciseName: n, storedBest: bestByName.get(n) ?? null, rederivedLogMax: maxByExercise.get(n)! }))

  const movePcts = plan.changes.map(c => (c.after.estimated1rm / c.before.estimated1rm - 1) * 100)
  const days = new Set(plan.changes.map(c => toAestDateStr(c.loggedAt, tz)))

  return {
    ok: true,
    report: {
      dryRun,
      timezone: tz,
      generatedAt: new Date().toISOString(),
      summary: {
        logsExamined: weighted.length,
        scanTruncated,
        wouldWrite: plan.changes.length,
        unchanged: plan.unchanged,
        wouldLower: plan.wouldLower.length,
        written,
        remaining: plan.changes.length - (dryRun ? 0 : written),
        exercises: names.length,
        daysMoved: days.size,
        medianMovePct: medianStylelessMovePct(plan.changes),
        largestMovePct: movePcts.length ? Math.round(Math.max(...movePcts) * 10) / 10 : null,
      },
      bestsBehindLogs,
      wouldLowerLogs: plan.wouldLower.map(w => ({ ...w, loggedAt: w.loggedAt.toISOString() })),
      sample: plan.changes.slice(0, SAMPLE_LIMIT).map(c => ({
        exerciseLogId: c.exerciseLogId, exerciseName: c.exerciseName, loggedAt: c.loggedAt.toISOString(),
        before: c.before.estimated1rm, after: c.after.estimated1rm,
      })),
    },
  }
}
