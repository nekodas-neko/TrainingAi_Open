import { getPool } from '@/lib/data/postgres/client'
import { toAestDateStr } from '@trainingai/shared/date-utils'
import {
  planHrr1BestRecompute, summariseHrr1BestChanges, type Hrr1BestChange, type StoredHrr1Best,
} from '@trainingai/shared/workout/hrr1-best-recompute'

const SAMPLE_LIMIT = 50

export interface Hrr1BestRecomputeReport {
  dryRun: boolean
  generatedAt: string
  summary: ReturnType<typeof summariseHrr1BestChanges> & { sessionsExamined: number; written: number; daysMoved: number }
  sample: { workoutSessionId: string; startedAt: string; before: number | null; after: number | null }[]
}

/**
 * #2601 (owner approved 2026-10-07): recompute every stored `workout_hr_stats.hrr1_best` as the max
 * of its session's `set_hr_stats.hrr1_bpm` (HRR60), null where no set has one. The ONE
 * implementation behind both doors: `POST /api/admin/recompute-hrr1-best` (admin session) and the
 * agent-key job `recompute-hrr1-best` (`lib/agent-actions/jobs.ts`).
 *
 * **It overwrites stored values — about 25 ring-only sessions lose theirs — so it is a production
 * data change.** Run order (docs/admin-actions.md section 12): a verified snapshot, then
 * `backfill-set-hrr1` (which fills `hrr1_bpm` for old rows), then this as a dry run, then the write.
 *
 * A direct SET, not the summary upsert, which COALESCEs and so can never clear a value. One
 * transaction, each row matched on its session AND the caller's user; if the rows written differ
 * from the rows planned, it rolls back and fails. Idempotent: a second run finds nothing to change.
 */
export async function recomputeHrr1Best(args: { userId: string; tz: string; dryRun: boolean }): Promise<{ ok: true; report: Hrr1BestRecomputeReport } | { ok: false; error: string }> {
  const { userId, tz, dryRun } = args
  const db = getPool()
  const { rows } = await db.query<{ workout_session_id: string; started_at: Date; hrr1_best: number | null; max_set_hrr60: number | null }>(
    `SELECT w.workout_session_id, ws.started_at, w.hrr1_best,
            (SELECT max(s.hrr1_bpm) FROM set_hr_stats s
              JOIN set_logs sl ON sl.id = s.set_log_id
             WHERE s.workout_session_id = w.workout_session_id AND s.user_id = $1
               AND sl.deleted_at IS NULL) AS max_set_hrr60
       FROM workout_hr_stats w
       JOIN workout_sessions ws ON ws.id = w.workout_session_id
      WHERE w.user_id = $1 AND ws.deleted_at IS NULL
      ORDER BY ws.started_at`,
    [userId],
  )
  const stored: StoredHrr1Best[] = rows.map(r => ({
    workoutSessionId: r.workout_session_id, startedAt: r.started_at,
    hrr1Best: r.hrr1_best, maxSetHrr60: r.max_set_hrr60,
  }))
  const changes = planHrr1BestRecompute(stored)

  let written = 0
  if (!dryRun && changes.length) {
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      for (const c of changes) {
        const res = await client.query(
          `UPDATE workout_hr_stats SET hrr1_best = $1, computed_at = now()
            WHERE workout_session_id = $2 AND user_id = $3`,
          [c.after, c.workoutSessionId, userId],
        )
        written += res.rowCount ?? 0
      }
      if (written !== changes.length) {
        await client.query('ROLLBACK')
        return { ok: false, error: `wrote ${written} rows, expected ${changes.length}; rolled back` }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  const days = new Set(changes.map((c: Hrr1BestChange) => toAestDateStr(c.startedAt, tz)))
  return {
    ok: true,
    report: {
      dryRun,
      generatedAt: new Date().toISOString(),
      summary: { sessionsExamined: stored.length, ...summariseHrr1BestChanges(changes), written, daysMoved: dryRun ? 0 : days.size },
      sample: changes.slice(0, SAMPLE_LIMIT).map(c => ({
        workoutSessionId: c.workoutSessionId, startedAt: c.startedAt.toISOString(), before: c.before, after: c.after,
      })),
    },
  }
}
