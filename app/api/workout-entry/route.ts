import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getPool } from "@/lib/data/postgres/client";
import { estimateOneRm, BW_REF, type OneRmSetInput } from "@trainingai/shared/1rm";
import { computeSetAggregates, computeIntensityPct } from "@trainingai/shared/workout/set-aggregates";
import { getRepository } from "@/lib/data";
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// 20 weights and 20 reps plus a few scalars, capped by the schema below.
const MAX_BODY_BYTES = 16 * 1024;

const WorkoutEntryPatchSchema = z.object({
  exerciseLogId: z.string().uuid(),
  weights:       z.array(z.number().min(-100).max(500)).min(1).max(20),
  reps:          z.array(z.number().int().min(0).max(100)).min(1).max(20),
}).strict();

async function assertOwnership(userId: string, exerciseLogId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM exercise_logs el
     JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE el.id = $1 AND ws.user_id = $2 AND el.deleted_at IS NULL`,
    [exerciseLogId, userId],
  );
  return rows.length > 0;
}

// PATCH — update weights/reps for an existing exercise log
export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const parsed = WorkoutEntryPatchSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { exerciseLogId, weights, reps } = parsed.data;

  if (!(await assertOwnership(userId, exerciseLogId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getPool();
  const { rows: ctxRows } = await db.query<{ exercise_name: string; style_id: string | null; phase_type: string | null; workout_session_id: string }>(
    `SELECT el.exercise_name, el.style_id, ws.phase_type, el.workout_session_id
     FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
     WHERE el.id = $1 AND el.deleted_at IS NULL`,
    [exerciseLogId],
  );
  const exerciseName = ctxRows[0].exercise_name;
  const workoutSessionId = ctxRows[0].workout_session_id;
  const repo = await getRepository();
  const exerciseType = await repo.getExerciseType(exerciseName);
  const styles = await repo.listProgressionStyles(userId);
  const style = styles.find(st => st.id === ctxRows[0].style_id)?.sets ?? null;
  const isBaseline = ctxRows[0].phase_type === 'baseline';

  const sets: OneRmSetInput[] = weights.map((w, i) => ({ weightKg: w, reps: reps[i] ?? 0 }));
  const { estimated1rm, target80 } = estimateOneRm(sets, { exerciseType, style, isBaseline });
  const effectiveWeights = exerciseType === 'bodyweight'
    ? weights.map(w => Math.max(1, BW_REF + w))
    : weights;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { volume, avgReps } = computeSetAggregates(weights, reps);

    await client.query(
      `UPDATE exercise_logs
       SET estimated_1rm = $1, target_80 = $2, volume = $3, avg_reps = $4
       WHERE id = $5`,
      [estimated1rm, target80, volume, avgReps, exerciseLogId],
    );

    // Upsert set_logs in place by (exercise_log_id, set_number) so timing/RPE data
    // recorded during the live workout survives a post-hoc weight/rep correction —
    // only weight_kg/reps/intensity_pct come from the edit dialog, everything else
    // stays untouched. Preserving the row id also stops the local-device sync pull
    // from gaining a duplicate set alongside the one it already has.
    for (let i = 0; i < weights.length; i++) {
      const intensityPct = computeIntensityPct(effectiveWeights[i], estimated1rm);
      await client.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (exercise_log_id, set_number) DO UPDATE SET
           weight_kg = EXCLUDED.weight_kg,
           reps = EXCLUDED.reps,
           intensity_pct = EXCLUDED.intensity_pct,
           deleted_at = NULL`,
        [exerciseLogId, i + 1, weights[i], reps[i], intensityPct],
      );
    }
    // Tombstone any tail sets the edit removed (e.g. 3 sets -> 2) instead of a hard
    // DELETE — a hard delete is invisible to a device that hasn't pulled yet (SYNC-3);
    // getSyncDelta already selects set_logs.deletedAt and the local delete arm
    // (sqlite-backend.ts applyDelta) already handles it. Re-adding the set later
    // resurrects the same row via the ON CONFLICT arm above.
    await client.query(
      'UPDATE set_logs SET deleted_at = now() WHERE exercise_log_id = $1 AND set_number > $2 AND deleted_at IS NULL',
      [exerciseLogId, weights.length],
    );

    await client.query('COMMIT');
    await repo.reconcilePersonalRecord(userId, exerciseName);
    await repo.deleteAiHealthInsight(userId, `session-recap:${workoutSessionId}`);
    return NextResponse.json({ success: true });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-entry' })
    await client.query('ROLLBACK');
    console.error('[workout-entry PATCH]', e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } finally {
    client.release();
  }
}

// DELETE — remove an exercise log and its sets
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { exerciseLogId } = (read.body ?? {}) as { exerciseLogId?: string };
  if (!exerciseLogId) return NextResponse.json({ error: "Missing exerciseLogId" }, { status: 400 });

  if (!(await assertOwnership(userId, exerciseLogId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Capture the parent session (and exercise name, for PR reconcile below) before
    // deleting so we can remove it if this was its last exercise — otherwise a phantom
    // 0-exercise session lingers in the timeline, history counts, and AI-periodization tallies.
    const { rows } = await client.query<{ workout_session_id: string; exercise_name: string }>(
      'SELECT workout_session_id, exercise_name FROM exercise_logs WHERE id = $1',
      [exerciseLogId],
    );
    const workoutSessionId = rows[0]?.workout_session_id ?? null;
    const exerciseName = rows[0]?.exercise_name ?? null;

    const now = new Date().toISOString();
    await client.query(
      'UPDATE exercise_logs SET deleted_at = $2, updated_at = $2 WHERE id = $1',
      [exerciseLogId, now],
    );
    await client.query('UPDATE set_logs SET deleted_at = $2 WHERE exercise_log_id = $1', [exerciseLogId, now]);

    let sessionDeleted = false;
    if (workoutSessionId) {
      const { rows: remaining } = await client.query<{ count: string }>(
        'SELECT COUNT(*)::int AS count FROM exercise_logs WHERE workout_session_id = $1 AND deleted_at IS NULL',
        [workoutSessionId],
      );
      if (Number(remaining[0]?.count ?? 0) === 0) {
        // Capture the session's program-session + start time before deleting so we can
        // keep the AI-periodization phase counter honest.
        const { rows: wsRows } = await client.query<{ session_id: string | null; started_at: Date; completed_at: Date | null }>(
          'SELECT session_id, started_at, completed_at FROM workout_sessions WHERE id = $1',
          [workoutSessionId],
        );
        const programSessionId = wsRows[0]?.session_id ?? null;
        const startedAt = wsRows[0]?.started_at ?? null;
        const wasCompleted = wsRows[0]?.completed_at != null;

        await client.query('UPDATE workout_sessions SET deleted_at = $2, updated_at = $2 WHERE id = $1', [workoutSessionId, now]);
        sessionDeleted = true;

        // Completing a session increments sessions_in_phase, so deleting one must decrement
        // it — but only when the deleted session falls inside the current phase window
        // (started_at >= phase_started_at) AND was actually completed (canonical definition,
        // AI-5) — an abandoned session that never completed was never counted. A session from
        // a prior phase was already excluded from the current count, so decrementing for it
        // would under-count. Floor at 0.
        if (programSessionId && startedAt && wasCompleted) {
          await client.query(
            `UPDATE session_periodization
             SET sessions_in_phase = GREATEST(sessions_in_phase - 1, 0), updated_at = now()
             WHERE user_id = $1 AND program_session_id = $2 AND $3 >= phase_started_at`,
            [userId, programSessionId, startedAt],
          );
        }
      }
    }

    await client.query('COMMIT');
    const repo = await getRepository();
    if (exerciseName) {
      await repo.reconcilePersonalRecord(userId, exerciseName);
    }
    if (workoutSessionId) {
      await repo.deleteAiHealthInsight(userId, `session-recap:${workoutSessionId}`);
    }
    return NextResponse.json({ success: true, sessionDeleted });
  } catch (e) {
    reportServerError(e, { userId, url: '/api/workout-entry' })
    await client.query('ROLLBACK');
    console.error('[workout-entry DELETE]', e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
