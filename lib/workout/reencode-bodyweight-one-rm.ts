import { getPool } from '@/lib/data/postgres/client'
import type { WorkoutRepository } from '@/lib/data/repository'
import { toAestDateStr } from '@trainingai/shared/date-utils'
import { planBodyweightOneRmReencode, type BodyweightLogInput } from '@trainingai/shared/workout/bodyweight-one-rm-reencode'
import { medianStylelessMovePct } from '@trainingai/shared/workout/styleless-one-rm-rederive'
import { applyOneRmRewrite, bestsBehindRewrite, MAX_SCAN, MAX_WRITES, type StylelessRederiveReport } from './rederive-styleless-one-rm'

/**
 * #2760 (owner decided 2026-10-09: "yes, re-encode once", after a snapshot at Tuesday's release):
 * re-encode the stored bodyweight 1RM estimates from the old stepped AMRAP discount to the smooth one
 * issue 2193 (a) introduced, so every bodyweight row has one encoding and reads back the reps it was.
 * The ONE implementation behind both doors: `POST /api/admin/reencode-bodyweight-one-rm` (admin
 * session) and the agent-key job `reencode-bodyweight-one-rm` (`lib/agent-actions/jobs.ts`).
 *
 * **It overwrites stored 1RMs, so it is a production data change.** Run order (docs/admin-actions.md
 * section 11): a verified snapshot, the dry run, the write, then a read-only `claude_ro` check.
 *
 * A log qualifies when it is live, not deloaded, has a positive stored estimate and its exercise is
 * bodyweight by `getExerciseType` (the lookup the log and edit paths make). Baseline sessions are
 * included: a bodyweight baseline set went through the same AMRAP map.
 *
 * It writes what the issue 2357 re-derive writes, through the same writer (`applyOneRmRewrite`):
 * `estimated_1rm`, `target_80`, each set's `intensity_pct`, `updated_at` moved, conditional per log,
 * rolled back unless every planned log was written. Upward only (see the planner). `personal_records`
 * is not written; `bestsBehindLogs` lists any best a re-encoded log would pass. Idempotent and
 * bounded the same way: `MAX_SCAN` logs read and `MAX_WRITES` written per call, `remaining` for the rest.
 */
export async function reencodeBodyweightOneRm(args: {
  repo: Pick<WorkoutRepository, 'getExerciseType'>
  userId: string
  tz: string
  dryRun: boolean
}): Promise<{ ok: true; report: StylelessRederiveReport } | { ok: false; error: string }> {
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
     ORDER BY el.logged_at, el.id
     LIMIT $2`,
    [userId, MAX_SCAN + 1],
  )
  const scanTruncated = logRows.length > MAX_SCAN
  const scanned = logRows.slice(0, MAX_SCAN)

  const names0 = [...new Set(scanned.map(r => r.exercise_name))]
  const types = new Map(await Promise.all(names0.map(async n => [n, await repo.getExerciseType(n)] as const)))
  const bodyweight = scanned.filter(r => types.get(r.exercise_name) === 'bodyweight')

  const ids = bodyweight.map(r => r.id)
  const { rows: setRows } = ids.length === 0 ? { rows: [] } : await db.query<{
    id: string; exercise_log_id: string; weight_kg: number; reps: number; use_for_1rm: boolean; intensity_pct: number | null
  }>(
    `SELECT id, exercise_log_id, weight_kg, reps, use_for_1rm, intensity_pct
     FROM set_logs
     WHERE exercise_log_id = ANY($1::uuid[]) AND deleted_at IS NULL
     ORDER BY exercise_log_id, set_number`,
    [ids],
  )
  const setsByLog = new Map<string, BodyweightLogInput['sets']>()
  for (const s of setRows) {
    const list = setsByLog.get(s.exercise_log_id) ?? []
    list.push({
      setLogId: s.id, weightKg: Number(s.weight_kg), reps: Number(s.reps), useFor1rm: s.use_for_1rm === true,
      intensityPct: s.intensity_pct == null ? null : Number(s.intensity_pct),
    })
    setsByLog.set(s.exercise_log_id, list)
  }

  const plan = planBodyweightOneRmReencode(bodyweight.map(r => ({
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
    const applied = await applyOneRmRewrite(toWrite)
    if (!applied.ok) return applied
    written = applied.written
  }

  const bestsBehindLogs = await bestsBehindRewrite(userId, plan.changes)
  const movePcts = plan.changes.map(c => (c.after.estimated1rm / c.before.estimated1rm - 1) * 100)
  const days = new Set(plan.changes.map(c => toAestDateStr(c.loggedAt, tz)))

  return {
    ok: true,
    report: {
      dryRun,
      timezone: tz,
      generatedAt: new Date().toISOString(),
      summary: {
        logsExamined: bodyweight.length,
        scanTruncated,
        wouldWrite: plan.changes.length,
        unchanged: plan.unchanged,
        wouldLower: plan.wouldLower.length,
        written,
        remaining: plan.changes.length - (dryRun ? 0 : written),
        exercises: new Set(plan.changes.map(c => c.exerciseName)).size,
        daysMoved: days.size,
        medianMovePct: medianStylelessMovePct(plan.changes),
        largestMovePct: movePcts.length ? Math.round(Math.max(...movePcts) * 10) / 10 : null,
      },
      bestsBehindLogs,
      wouldLowerLogs: plan.wouldLower.map(w => ({ ...w, loggedAt: w.loggedAt.toISOString() })),
      sample: plan.changes.slice(0, 50).map(c => ({
        exerciseLogId: c.exerciseLogId, exerciseName: c.exerciseName, loggedAt: c.loggedAt.toISOString(),
        before: c.before.estimated1rm, after: c.after.estimated1rm,
      })),
    },
  }
}
