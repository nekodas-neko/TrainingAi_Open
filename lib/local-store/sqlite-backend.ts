import { runSQL, querySQL, beginTransaction, commitTransaction, rollbackTransaction } from '@/lib/sqlite/sqlite-service';
import { MAX_MUTATION_ATTEMPTS, nextRetryDelayMs } from './sync-helpers';
import type { LocalStore, LocalWorkoutHistory } from './index';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalFitnessTest, LocalPrescribedRun, LocalProgram, LocalProgressionStyle, PendingMutation,
  LocalFoodLog, LocalFoodItem, LocalDayCheckin, LocalSupplement, LocalSupplementLog, LocalInjury,
  LocalExerciseLog, LocalSetLog, LocalPersonalRecord, LocalOuraDaily,
  LocalOuraDailySummary, LocalOuraDailyDerived, LocalOuraBucket, LocalOuraHeartratePoint,
  LocalSavedMeal, LocalSavedMealItem,
  LocalExerciseLibraryEntry, LocalMealType, LocalPlanMealAnswer,
} from './types';
import type { LogExercisePayload } from '@trainingai/shared/workout/log-exercise';
import { defaultUseFor1rm } from '@trainingai/shared/workout/default-use-for-1rm';
import { assembleLocalActiveProgram, type LocalActiveProgram } from './program-assembler';

/**
 * The local `ingredients` column is a TEXT mirror of the server's JSONB. A row written by an older
 * build, or corrupted, must not throw on read — the meal still renders without its ingredient list.
 */
function parseIngredients(raw: unknown): NutritionIngredient[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as NutritionIngredient[];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed as NutritionIngredient[] : [];
  } catch {
    return [];
  }
}
import type {
  FoodLogWithItem, FoodItem, SavedMeal, SavedMealItem,
  MealPlan, MealPlanMeal, MealPlanDayType, NutritionIngredient,
} from '@trainingai/shared/types/nutrition';

// target_zone_ids is stored as a JSON array string locally (and arrives as a JSON
// string from the delta) — parse defensively so a malformed value never throws a read.
function parseZoneIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter(n => Number.isFinite(n));
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n)) : [];
  } catch { return []; }
}

// One `food_items` row -> a FoodItem. Two `SELECT *` readers share it (search, and the BF-38
// duplicate lookup) so a column added to one is not missed by the other.
// `userId`/`region` are '' because the local table stores neither: the store is one user's, and no
// local read has ever needed the region.
function foodItemRowToItem(r: Record<string, unknown>): FoodItem {
  return {
    id: String(r.id), userId: '', name: String(r.name),
    brand: r.brand ? String(r.brand) : undefined,
    servingSizeG: Number(r.serving_size_g), calories: Number(r.calories),
    proteinG: Number(r.protein_g), carbsG: Number(r.carbs_g), fatG: Number(r.fat_g),
    fiberG: r.fiber_g != null ? Number(r.fiber_g) : undefined,
    sugarG: r.sugar_g != null ? Number(r.sugar_g) : undefined,
    sodiumMg: r.sodium_mg != null ? Number(r.sodium_mg) : undefined,
    satFatG: r.sat_fat_g != null ? Number(r.sat_fat_g) : undefined,
    source: (r.source ? String(r.source) : 'manual') as FoodItem['source'],
    // `image_data_uri` is deliberately NOT read here — see LA-36. It is stored locally and the
    // server's own searchFoodItems returns it, so the device's local-first read is the one surface
    // that loses the picture. Fixing that is a visible change on two Lane B screens and wants its
    // own entry rather than riding a de-duplication PR.
    region: '', createdAt: new Date(String(r.updated_at)),
  };
}

export class SQLiteLocalStore implements LocalStore {
  async getBodyMetrics(cutoffDate: string): Promise<LocalBodyMetric[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM body_metrics WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      date:             String(r.date),
      weightKg:         (r.weight_kg as number) ?? null,
      bodyFatPct:       (r.body_fat_pct as number) ?? null,
      steps:            (r.steps as number) ?? null,
      calories:         (r.calories as number) ?? null,
      proteinG:         (r.protein_g as number) ?? null,
      carbsG:           (r.carbs_g as number) ?? null,
      fatG:             (r.fat_g as number) ?? null,
      waterMl:          (r.water_ml as number) ?? null,
      restingHeartRate: (r.resting_heart_rate as number) ?? null,
      hrvMs:            (r.hrv_ms as number) ?? null,
      spo2Pct:          (r.spo2_pct as number) ?? null,
      distanceKm:       (r.distance_km as number) ?? null,
      waistCm:          (r.waist_cm as number) ?? null,
      chestCm:          (r.chest_cm as number) ?? null,
      armCm:            (r.arm_cm as number) ?? null,
      thighCm:          (r.thigh_cm as number) ?? null,
      hipCm:            (r.hip_cm as number) ?? null,
      neckCm:           (r.neck_cm as number) ?? null,
      skeletalMusclePct:  (r.skeletal_muscle_pct as number) ?? null,
      fatFreeMassKg:      (r.fat_free_mass_kg as number) ?? null,
      subcutaneousFatPct: (r.subcutaneous_fat_pct as number) ?? null,
      visceralFatIndex:   (r.visceral_fat_index as number) ?? null,
      bodyWaterPct:       (r.body_water_pct as number) ?? null,
      muscleMassKg:       (r.muscle_mass_kg as number) ?? null,
      boneMassKg:         (r.bone_mass_kg as number) ?? null,
      proteinPct:         (r.protein_pct as number) ?? null,
      bmrKcal:            (r.bmr_kcal as number) ?? null,
      metabolicAge:       (r.metabolic_age as number) ?? null,
      updatedAt:        String(r.updated_at),
      deletedAt:        r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:       (r.sync_status as 'pending' | 'synced'),
    }));
  }

  async getMoodLogs(cutoffDate: string): Promise<LocalMoodLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mood_logs WHERE log_date >= ? AND deleted_at IS NULL ORDER BY log_date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      logDate:      String(r.log_date),
      energyLevel:  String(r.energy_level),
      sleepQuality: String(r.sleep_quality),
      bodyState:    JSON.parse(String(r.body_state ?? '[]')),
      soreMuscles:  JSON.parse(String(r.sore_muscles ?? '[]')),
      updatedAt:    String(r.updated_at),
      deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:   (r.sync_status as 'pending' | 'synced'),
    }));
  }

  async getSleepSessions(cutoffDate: string): Promise<LocalSleepSession[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM sleep_sessions WHERE date >= ? ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:              String(r.id),
      date:            String(r.date),
      durationHours:   (r.duration_hours as number) ?? null,
      deepSleepHours:  (r.deep_sleep_hours as number) ?? null,
      remSleepHours:   (r.rem_sleep_hours as number) ?? null,
      lightSleepHours: (r.light_sleep_hours as number) ?? null,
      ouraId:          (r.oura_id as string) ?? null,
      efficiency:      (r.efficiency as number) ?? null,
      onsetLatencySec: (r.onset_latency_sec as number) ?? null,
      averageHrvMs:    (r.average_hrv_ms as number) ?? null,
      avgHeartRate:    (r.avg_heart_rate as number) ?? null,
      lowestHeartRate: (r.lowest_heart_rate as number) ?? null,
      restlessPeriods: (r.restless_periods as number) ?? null,
      sleepScore:      (r.sleep_score as number) ?? null,
      respiratoryRate: (r.respiratory_rate as number) ?? null,
      sleepPhase5Min:  (r.sleep_phase_5_min as string) ?? null,
      timeInBedHours:  (r.time_in_bed_hours as number) ?? null,
      manualSleepStart: (r.manual_sleep_start as string) ?? null,
      syncStatus:      (r.sync_status as 'pending' | 'synced') ?? 'synced',
      updatedAt:       String(r.updated_at),
    }));
  }

  async getWorkoutSessions(cutoffDate: string): Promise<LocalWorkoutSession[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM workout_sessions WHERE started_at >= ? AND deleted_at IS NULL ORDER BY started_at`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:          String(r.id),
      sessionName: String(r.session_name),
      startedAt:   String(r.started_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      sessionRpe:  (r.session_rpe as number) ?? null,
      updatedAt:   String(r.updated_at),
      deletedAt:   r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:  (r.sync_status as 'pending' | 'synced') ?? 'synced',
      sessionId:      r.session_id ? String(r.session_id) : null,
      intensityMode:  r.intensity_mode ? String(r.intensity_mode) : null,
      wasOverride:    Number(r.was_override) === 1,
    }));
  }

  async getExerciseLogs(workoutSessionId: string): Promise<LocalExerciseLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM exercise_logs WHERE workout_session_id = ? AND deleted_at IS NULL ORDER BY logged_at`,
      [workoutSessionId],
    );
    return rows.map(r => this.mapExerciseLog(r));
  }

  private mapExerciseLog(r: Record<string, unknown>): LocalExerciseLog {
    return {
      id:                   String(r.id),
      workoutSessionId:     String(r.workout_session_id),
      exerciseName:         String(r.exercise_name),
      styleId:              r.style_id ? String(r.style_id) : null,
      styleName:            r.style_name ? String(r.style_name) : null,
      estimated1rm:         (r.estimated_1rm as number) ?? null,
      target80:             (r.target_80 as number) ?? null,
      volume:               (r.volume as number) ?? null,
      avgReps:              (r.avg_reps as number) ?? null,
      timeToComplete:       (r.time_to_complete as number) ?? null,
      muscleGroups:         JSON.parse(String(r.muscle_groups ?? '[]')),
      loggedAt:             String(r.logged_at),
      interExerciseRestSec: (r.inter_exercise_rest_sec as number) ?? null,
      updatedAt:            String(r.updated_at),
      deletedAt:            r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:           (r.sync_status as 'pending' | 'synced') ?? 'synced',
      exerciseDeloaded:     Number(r.exercise_deloaded) === 1,
    };
  }

  async getSetLogs(exerciseLogId: string): Promise<LocalSetLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM set_logs WHERE exercise_log_id = ? AND deleted_at IS NULL ORDER BY set_number`,
      [exerciseLogId],
    );
    return rows.map(r => this.mapSetLog(r));
  }

  private mapSetLog(r: Record<string, unknown>): LocalSetLog {
    return {
      id:            String(r.id),
      exerciseLogId: String(r.exercise_log_id),
      setNumber:     Number(r.set_number),
      weightKg:      Number(r.weight_kg),
      reps:          Number(r.reps),
      setTimeSec:    (r.set_time_sec as number) ?? null,
      restTimeSec:   (r.rest_time_sec as number) ?? null,
      intensityPct:  (r.intensity_pct as number) ?? null,
      useFor1rm:     Number(r.use_for_1rm) === 1,
      setStartMs:    (r.set_start_ms as number) ?? null,
      setEndMs:      (r.set_end_ms as number) ?? null,
      rpe:           (r.rpe as number) ?? null,
      plannedPct:    (r.planned_pct as number) ?? null,
      plannedReps:   (r.planned_reps as number) ?? null,
      plannedRestSec: (r.planned_rest_sec as number) ?? null,
      updatedAt:     String(r.updated_at),
      deletedAt:     r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:    (r.sync_status as 'pending' | 'synced') ?? 'synced',
    };
  }

  /**
   * Run `SELECT … WHERE <col> IN (…)` over `ids`, chunked.
   *
   * SQLite caps host parameters per statement (SQLITE_MAX_VARIABLE_NUMBER,
   * commonly 999). A 90-day history is ~325 exercise logs today, comfortably
   * under it, but that is a function of how much the user trains — so chunk
   * rather than leave a cap that only breaks for the heaviest users.
   */
  private async queryByIds(
    sql: (placeholders: string) => string,
    ids: string[],
    chunkSize = 400,
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const rows = await querySQL<Record<string, unknown>>(
        sql(chunk.map(() => '?').join(',')),
        chunk,
      );
      out.push(...rows);
    }
    return out;
  }

  /**
   * Whole workout history since `cutoffDate`, in **three** queries total.
   *
   * This was 1 + N + (N×M): one for sessions, one per session for its exercise
   * logs, then one per exercise log for its sets. Twenty sessions of five
   * exercises is ~121 queries, and every one crosses the Capacitor JS↔native
   * bridge. It is called from five places including the home screen, Health, and
   * the active workout screen, so that cost was paid repeatedly on the hot path.
   *
   * Now: sessions, then all their exercise logs in one IN(), then all those logs'
   * sets in one IN(), grouped in memory. Query count is constant in history size.
   */
  async getWorkoutHistory(cutoffDate: string): Promise<LocalWorkoutHistory[]> {
    const sessions = await this.getWorkoutSessions(cutoffDate);
    if (sessions.length === 0) return [];

    const elRows = await this.queryByIds(
      ph => `SELECT * FROM exercise_logs
               WHERE workout_session_id IN (${ph})
                 AND deleted_at IS NULL
               ORDER BY logged_at`,
      sessions.map(s => s.id),
    );
    const exerciseLogs = elRows.map(r => this.mapExerciseLog(r));

    const setsByLog = new Map<string, LocalSetLog[]>();
    if (exerciseLogs.length > 0) {
      const setRows = await this.queryByIds(
        ph => `SELECT * FROM set_logs
                 WHERE exercise_log_id IN (${ph})
                   AND deleted_at IS NULL
                 ORDER BY set_number`,
        exerciseLogs.map(el => el.id),
      );
      for (const r of setRows) {
        const s = this.mapSetLog(r);
        const bucket = setsByLog.get(s.exerciseLogId);
        if (bucket) bucket.push(s); else setsByLog.set(s.exerciseLogId, [s]);
      }
    }

    // Preserve the previous grouping and ordering exactly: exercise logs stay in
    // logged_at order within their session, sets in set_number order within their
    // log, and a session with no logs still appears with an empty array.
    const logsBySession = new Map<string, (LocalExerciseLog & { sets: LocalSetLog[] })[]>();
    for (const el of exerciseLogs) {
      const withSets = { ...el, sets: setsByLog.get(el.id) ?? [] };
      const bucket = logsBySession.get(el.workoutSessionId);
      if (bucket) bucket.push(withSets); else logsBySession.set(el.workoutSessionId, [withSets]);
    }

    return sessions.map(session => ({
      session,
      exerciseLogs: logsBySession.get(session.id) ?? [],
    }));
  }

  // Pending sessions with no workout_log outbox entry — the double-failure case
  // (direct POST failed, then queueMutation also failed). The payload LIKE match
  // is safe because every workout_log payload embeds its workoutSessionId uuid.
  async getStrandedPendingWorkouts(cutoffIso: string): Promise<LocalWorkoutHistory[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM workout_sessions ws
        WHERE ws.sync_status='pending' AND ws.deleted_at IS NULL
          AND ws.updated_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM mutations_outbox mo
             WHERE mo.domain='workout_log' AND mo.payload LIKE '%' || ws.id || '%'
          )`,
      [cutoffIso],
    );
    const result: LocalWorkoutHistory[] = [];
    for (const r of rows) {
      const session = {
        id: String(r.id), sessionName: String(r.session_name),
        startedAt: String(r.started_at),
        completedAt: r.completed_at ? String(r.completed_at) : null,
        sessionRpe: (r.session_rpe as number) ?? null,
        updatedAt: String(r.updated_at),
        deletedAt: r.deleted_at ? String(r.deleted_at) : null,
        syncStatus: (r.sync_status as 'pending' | 'synced') ?? 'synced',
      };
      const exerciseLogs = await Promise.all(
        (await this.getExerciseLogs(session.id)).map(async el => ({
          ...el, sets: await this.getSetLogs(el.id),
        })),
      );
      result.push({ session, exerciseLogs });
    }
    return result;
  }

  async getPersonalRecords(): Promise<LocalPersonalRecord[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM personal_records ORDER BY exercise_name`,
      [],
    );
    return rows.map(r => this.mapPersonalRecord(r));
  }

  async getPersonalRecord(exerciseName: string): Promise<LocalPersonalRecord | null> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM personal_records WHERE exercise_name = ?`,
      [exerciseName],
    );
    return rows.length ? this.mapPersonalRecord(rows[0]) : null;
  }

  private mapPersonalRecord(r: Record<string, unknown>): LocalPersonalRecord {
    return {
      exerciseName: String(r.exercise_name),
      exerciseId:   r.exercise_id ? String(r.exercise_id) : null,
      estimated1rm: Number(r.estimated_1rm),
      achievedAt:   r.achieved_at ? String(r.achieved_at) : null,
      updatedAt:    String(r.updated_at),
      syncStatus:   (r.sync_status as 'pending' | 'synced') ?? 'synced',
    };
  }

  async getOuraDaily(cutoffDay: string): Promise<LocalOuraDaily[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM oura_daily WHERE day >= ? ORDER BY day`,
      [cutoffDay],
    );
    return rows.map(r => ({
      day:                  String(r.day),
      readinessScore:       (r.readiness_score as number) ?? null,
      sleepScore:           (r.sleep_score as number) ?? null,
      activityScore:        (r.activity_score as number) ?? null,
      temperatureDeviation: (r.temperature_deviation as number) ?? null,
      activeCalories:       (r.active_calories as number) ?? null,
      contributors:         r.contributors ? JSON.parse(String(r.contributors)) : null,
      syncStatus:           (r.sync_status as 'pending' | 'synced') ?? 'synced',
      updatedAt:            String(r.updated_at),
    }));
  }

  async logWorkoutLocally(payload: LogExercisePayload, syncStatus: 'pending' | 'synced'): Promise<void> {
    const now = new Date().toISOString();
    const workoutSessionId = payload.workoutSessionId ?? crypto.randomUUID();
    const exerciseLogId = payload.exerciseLogId ?? crypto.randomUUID();
    const localDate = (payload.localDate ?? now).slice(0, 10);

    try {
      await beginTransaction();

      // Upsert the workout session row (idempotent — session may already exist).
      // session_id/intensity_mode/was_override carried through so a stranded
      // (dead-lettered-then-recovered) replay keeps its real program-session +
      // deload/override attribution instead of degrading to a name-fallback (SYN-6).
      await runSQL(
        `INSERT INTO workout_sessions
           (id, session_name, started_at, completed_at, updated_at, synced, sync_status,
            session_id, intensity_mode, was_override)
         VALUES (?,?,?,NULL,?,0,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           session_name=excluded.session_name,
           updated_at=excluded.updated_at,
           sync_status=CASE WHEN sync_status='synced' THEN excluded.sync_status ELSE sync_status END,
           session_id=COALESCE(excluded.session_id, session_id),
           intensity_mode=COALESCE(excluded.intensity_mode, intensity_mode),
           was_override=CASE WHEN excluded.was_override=1 THEN 1 ELSE was_override END`,
        [
          workoutSessionId,
          payload.sessionName,
          payload.workoutStartedAt ? new Date(payload.workoutStartedAt).toISOString() : `${localDate}T00:00:00.000Z`,
          now,
          syncStatus,
          payload.sessionId ?? null,
          payload.intensityMode ?? null,
          payload.wasOverride ? 1 : 0,
        ],
      );

      // Insert the exercise_log row — use client-provided offline estimate if present
      await runSQL(
        `INSERT OR REPLACE INTO exercise_logs
           (id, workout_session_id, exercise_name, style_id, style_name,
            estimated_1rm, target_80, volume, avg_reps, time_to_complete,
            muscle_groups, logged_at, inter_exercise_rest_sec, updated_at,
            synced, sync_status, exercise_deloaded)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
        [
          exerciseLogId,
          workoutSessionId,
          payload.exercise,
          payload.styleId ?? null,
          payload.styleName ?? null,
          payload.estimated1rm ?? null,
          payload.target80 ?? null,
          null, null,  // volume/avgReps computed server-side
          payload.timeToCompleteSet ?? null,
          JSON.stringify((payload.muscleGroups ?? []).map(mg => mg.toLowerCase())),
          now,
          payload.interExerciseRestSec ?? null,
          now,
          syncStatus,
          payload.exerciseDeloaded ? 1 : 0,
        ],
      );

      // Insert all set rows — use client-provided ids if present
      for (let i = 0; i < payload.weights.length; i++) {
        const setId = payload.setLogIds?.[i] ?? crypto.randomUUID();
        await runSQL(
          `INSERT OR REPLACE INTO set_logs
             (id, exercise_log_id, set_number, weight_kg, reps, set_time_sec,
              rest_time_sec, intensity_pct, use_for_1rm, set_start_ms, set_end_ms,
              rpe, planned_pct, planned_reps, planned_rest_sec, updated_at, synced, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
          [
            setId,
            exerciseLogId,
            i + 1,
            payload.weights[i],
            payload.reps[i] ?? payload.reps[payload.reps.length - 1],
            payload.setTimes?.[i] ?? null,
            payload.restTimes?.[i] ?? null,
            null,  // intensityPct computed server-side
            // SYN-8: same default the server applies (One Formula, One Place) —
            // previously this fell to 0 whenever the style didn't set it explicitly.
            (payload.progressionStyle?.[i]?.useFor1rm ?? defaultUseFor1rm(payload.reps, i)) ? 1 : 0,
            payload.setStartTimes?.[i] ?? null,
            payload.setEndTimes?.[i] ?? null,
            payload.rpeValues?.[i] ?? null,
            // Q-14: these mirror the PROGRESSION STYLE as prescribed, which is what a stranded
            // replay must re-send. The server decides what lands in set_logs.planned_pct - for a
            // bodyweight movement it stores NULL, because the style's pct is a rep target there,
            // not a %1RM. Keeping that decision in logExerciseFromPayload alone is deliberate:
            // the local store has no exercise-type table to make it with.
            payload.progressionStyle?.[i]?.pct ?? null,
            payload.progressionStyle?.[i]?.reps ?? null,
            payload.progressionStyle?.[i]?.restSec ?? null,
            now,
            syncStatus,
          ],
        );
      }

      await commitTransaction();
    } catch (err) {
      try { await rollbackTransaction(); } catch { /* already rolled back — keep the real error */ }
      throw err;
    }
  }

  async setSessionRpe(workoutSessionId: string, rpe: number): Promise<void> {
    // Flip sync_status back to 'pending': the session row is usually already
    // 'synced' by the time RPE is tapped (markWorkoutSynced runs on set-log),
    // and a pull landing before this RPE's outbox mutation pushes would
    // otherwise re-overwrite it via applyDelta's synced-row branch.
    await runSQL(
      `UPDATE workout_sessions SET session_rpe = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [rpe, new Date().toISOString(), workoutSessionId],
    );
  }

  // Confirmation callback for a pushed `session_rpe`/`complete_workout` mutation:
  // flips only the session's own sync_status, never its exercise/set rows (those
  // are confirmed independently by their own workout_log mutations). SYN-7: skip
  // the flip while another mutation for this same session is still queued (e.g.
  // this confirm raced ahead of a sibling workout_log/session_rpe push) — flipping
  // early would let a pull landing in the gap revert the still-outstanding edit via
  // applyDelta's synced-row overwrite branch. The LIKE match mirrors
  // getStrandedPendingWorkouts's existing pattern (every relevant payload embeds
  // the workoutSessionId uuid).
  async markSessionSynced(workoutSessionId: string): Promise<void> {
    const [{ cnt }] = await querySQL<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM mutations_outbox
        WHERE domain IN ('workout_log','session_rpe','complete_workout')
          AND payload LIKE '%' || ? || '%'`,
      [workoutSessionId],
    );
    if (Number(cnt) > 0) return;
    await runSQL(
      `UPDATE workout_sessions SET sync_status='synced' WHERE id=?`,
      [workoutSessionId],
    );
  }

  // Local-first completion write: stamps completed_at synchronously so the done
  // screen and local reads reflect completion even fully offline. Flips
  // sync_status back to 'pending' (mirrors setSessionRpe) so a pull landing
  // before the outbox mutation confirms can't revert it via applyDelta's
  // synced-row overwrite branch.
  async completeWorkoutLocally(workoutSessionId: string, completedAt: string): Promise<void> {
    await runSQL(
      `UPDATE workout_sessions SET completed_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
      [completedAt, new Date().toISOString(), workoutSessionId],
    );
  }

  // Scoped to the single exercise/set rows just confirmed by the server response —
  // never the whole session. A workout with multiple exercises confirms one at a
  // time (one POST/mutation per exercise); flipping every exercise_log/set_log
  // under the session on the FIRST confirmation would falsely mark a sibling
  // exercise's still-queued (or later dead-lettered) rows as synced.
  async markWorkoutSynced(workoutSessionId: string, exerciseLogId: string): Promise<void> {
    await runSQL(
      `UPDATE workout_sessions SET sync_status='synced' WHERE id=?`,
      [workoutSessionId],
    );
    await runSQL(
      `UPDATE exercise_logs SET sync_status='synced' WHERE id=? AND workout_session_id=?`,
      [exerciseLogId, workoutSessionId],
    );
    await runSQL(
      `UPDATE set_logs SET sync_status='synced' WHERE exercise_log_id=?`,
      [exerciseLogId],
    );
  }

  // F4 mark-synced arms — see the interface doc comment in index.ts for why these
  // are narrow UPDATE-by-key rather than full upserts.
  async markSleepSessionSynced(id: string): Promise<void> {
    await runSQL(`UPDATE sleep_sessions SET sync_status='synced' WHERE id=?`, [id]);
  }

  async markOuraDailySummarySynced(day: string): Promise<void> {
    await runSQL(`UPDATE oura_daily_summary SET sync_status='synced' WHERE day=?`, [day]);
  }

  async markOuraDailyDerivedSynced(day: string): Promise<void> {
    await runSQL(`UPDATE oura_daily_derived SET sync_status='synced' WHERE day=?`, [day]);
  }

  // D2 prep (Phase-1 Task 1) — see the interface doc comment in index.ts. The upserts here
  // are a distinct, standalone write path from applyDelta's inline pull-upsert above: a
  // genuine local write (the future on-device rollup) always computes the full row at once,
  // so no read-merge is needed (contrast upsertBodyMetric's partial-field merge), but it
  // does NOT reuse applyDelta's clobber-guard — that guard protects a pending local write
  // FROM a pull; this is the write it's protecting.
  async getOuraDailySummary(fromDay: string, toDay: string): Promise<LocalOuraDailySummary[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM oura_daily_summary WHERE day >= ? AND day <= ? ORDER BY day`,
      [fromDay, toDay],
    );
    return rows.map(r => ({
      day:                  String(r.day),
      sleepDurationHours:   (r.sleep_duration_hours as number) ?? null,
      sleepEfficiency:      (r.sleep_efficiency as number) ?? null,
      deepSleepHours:       (r.deep_sleep_hours as number) ?? null,
      remSleepHours:        (r.rem_sleep_hours as number) ?? null,
      restlessPeriods:      (r.restless_periods as number) ?? null,
      sleepLatencySec:      (r.sleep_latency_sec as number) ?? null,
      hrvAvgMs:             (r.hrv_avg_ms as number) ?? null,
      rhrLowBpm:            (r.rhr_low_bpm as number) ?? null,
      rhrAvgBpm:            (r.rhr_avg_bpm as number) ?? null,
      recoveryIndexHours:   (r.recovery_index_hours as number) ?? null,
      tempMeanC:            (r.temp_mean_c as number) ?? null,
      tempDevC:             (r.temp_dev_c as number) ?? null,
      metAvg:               (r.met_avg as number) ?? null,
      breathAvgRpm:         (r.breath_avg_rpm as number) ?? null,
      hrvBaselineMeanX8:    (r.hrv_baseline_mean_x8 as number) ?? null,
      hrvBaselineDevX8:     (r.hrv_baseline_dev_x8 as number) ?? null,
      rhrBaselineMeanX8:    (r.rhr_baseline_mean_x8 as number) ?? null,
      rhrBaselineDevX8:     (r.rhr_baseline_dev_x8 as number) ?? null,
      tempBaselineMeanX8:   (r.temp_baseline_mean_x8 as number) ?? null,
      tempBaselineDevX8:    (r.temp_baseline_dev_x8 as number) ?? null,
      sleepBaselineMeanX8:  (r.sleep_baseline_mean_x8 as number) ?? null,
      sleepBaselineDevX8:   (r.sleep_baseline_dev_x8 as number) ?? null,
      metBaselineMeanX8:    (r.met_baseline_mean_x8 as number) ?? null,
      metBaselineDevX8:     (r.met_baseline_dev_x8 as number) ?? null,
      breathBaselineMeanX8: (r.breath_baseline_mean_x8 as number) ?? null,
      breathBaselineDevX8:  (r.breath_baseline_dev_x8 as number) ?? null,
      nHistory:             (r.n_history as number) ?? null,
      syncStatus:           r.sync_status as 'pending' | 'synced',
      updatedAt:            String(r.updated_at),
    }));
  }

  async upsertOuraDailySummary(record: LocalOuraDailySummary): Promise<void> {
    await runSQL(
      `INSERT INTO oura_daily_summary
         (day, sleep_duration_hours, sleep_efficiency, deep_sleep_hours, rem_sleep_hours,
          restless_periods, sleep_latency_sec, hrv_avg_ms, rhr_low_bpm, rhr_avg_bpm,
          recovery_index_hours, temp_mean_c, temp_dev_c, met_avg, breath_avg_rpm,
          hrv_baseline_mean_x8, hrv_baseline_dev_x8, rhr_baseline_mean_x8, rhr_baseline_dev_x8,
          temp_baseline_mean_x8, temp_baseline_dev_x8, sleep_baseline_mean_x8, sleep_baseline_dev_x8,
          met_baseline_mean_x8, met_baseline_dev_x8, breath_baseline_mean_x8, breath_baseline_dev_x8,
          n_history, updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day) DO UPDATE SET
         sleep_duration_hours=excluded.sleep_duration_hours, sleep_efficiency=excluded.sleep_efficiency,
         deep_sleep_hours=excluded.deep_sleep_hours, rem_sleep_hours=excluded.rem_sleep_hours,
         restless_periods=excluded.restless_periods, sleep_latency_sec=excluded.sleep_latency_sec,
         hrv_avg_ms=excluded.hrv_avg_ms, rhr_low_bpm=excluded.rhr_low_bpm, rhr_avg_bpm=excluded.rhr_avg_bpm,
         recovery_index_hours=excluded.recovery_index_hours, temp_mean_c=excluded.temp_mean_c,
         temp_dev_c=excluded.temp_dev_c, met_avg=excluded.met_avg, breath_avg_rpm=excluded.breath_avg_rpm,
         hrv_baseline_mean_x8=excluded.hrv_baseline_mean_x8, hrv_baseline_dev_x8=excluded.hrv_baseline_dev_x8,
         rhr_baseline_mean_x8=excluded.rhr_baseline_mean_x8, rhr_baseline_dev_x8=excluded.rhr_baseline_dev_x8,
         temp_baseline_mean_x8=excluded.temp_baseline_mean_x8, temp_baseline_dev_x8=excluded.temp_baseline_dev_x8,
         sleep_baseline_mean_x8=excluded.sleep_baseline_mean_x8, sleep_baseline_dev_x8=excluded.sleep_baseline_dev_x8,
         met_baseline_mean_x8=excluded.met_baseline_mean_x8, met_baseline_dev_x8=excluded.met_baseline_dev_x8,
         breath_baseline_mean_x8=excluded.breath_baseline_mean_x8, breath_baseline_dev_x8=excluded.breath_baseline_dev_x8,
         n_history=excluded.n_history, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      [
        record.day, record.sleepDurationHours, record.sleepEfficiency, record.deepSleepHours, record.remSleepHours,
        record.restlessPeriods, record.sleepLatencySec, record.hrvAvgMs, record.rhrLowBpm, record.rhrAvgBpm,
        record.recoveryIndexHours, record.tempMeanC, record.tempDevC, record.metAvg, record.breathAvgRpm,
        record.hrvBaselineMeanX8, record.hrvBaselineDevX8, record.rhrBaselineMeanX8, record.rhrBaselineDevX8,
        record.tempBaselineMeanX8, record.tempBaselineDevX8, record.sleepBaselineMeanX8, record.sleepBaselineDevX8,
        record.metBaselineMeanX8, record.metBaselineDevX8, record.breathBaselineMeanX8, record.breathBaselineDevX8,
        record.nHistory, record.updatedAt, record.syncStatus,
      ],
    );
  }

  async getOuraDailyDerived(fromDay: string, toDay: string): Promise<LocalOuraDailyDerived[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM oura_daily_derived WHERE day >= ? AND day <= ? ORDER BY day`,
      [fromDay, toDay],
    );
    const json = (v: unknown): Record<string, unknown> | null => {
      if (v == null) return null;
      try { return JSON.parse(String(v)); } catch { return null; }
    };
    return rows.map(r => ({
      day:                            String(r.day),
      source:                         (r.source as string) ?? null,
      modelVersions:                  json(r.model_versions),
      sleepScore:                     (r.sleep_score as number) ?? null,
      sleepContributors:              json(r.sleep_contributors),
      readinessScore:                 (r.readiness_score as number) ?? null,
      readinessContributors:          json(r.readiness_contributors),
      readinessSource:                (r.readiness_source as string) ?? null,
      activityScore:                  (r.activity_score as number) ?? null,
      activityContributors:           json(r.activity_contributors),
      activeCaloriesEst:              (r.active_calories_est as number) ?? null,
      trainingLoadOts:                (r.training_load_ots as number) ?? null,
      trainingLoadHigh:               r.training_load_high == null ? null : Boolean(r.training_load_high),
      recoveryIndexHours:             (r.recovery_index_hours as number) ?? null,
      wornHoursBle:                   (r.worn_hours_ble as number) ?? null,
      nightHrvBaselineMs:             (r.night_hrv_baseline_ms as number) ?? null,
      illnessFlag:                    (r.illness_flag as string) ?? null,
      illnessScore:                   (r.illness_score as number) ?? null,
      illnessBiomarkers:              json(r.illness_biomarkers),
      daytimeStressScaled:            (r.daytime_stress_scaled as number) ?? null,
      stressHighMinutes:              (r.stress_high_minutes as number) ?? null,
      recoveryHighMinutes:            (r.recovery_high_minutes as number) ?? null,
      chronicStressScore:             (r.chronic_stress_score as number) ?? null,
      chronicStressContributors:      json(r.chronic_stress_contributors),
      resilienceLevel:                (r.resilience_level as number) ?? null,
      resilienceDailyStress:          (r.resilience_daily_stress as number) ?? null,
      resilienceDailyRestorativeTime: (r.resilience_daily_restorative_time as number) ?? null,
      resilienceDailySleepRecovery:   (r.resilience_daily_sleep_recovery as number) ?? null,
      resilienceGranular:             (r.resilience_granular as number) ?? null,
      resilienceConfidence:           (r.resilience_confidence as number) ?? null,
      bdiDerived:                     (r.bdi_derived as number) ?? null,
      vascularAge:                    (r.vascular_age as number) ?? null,
      pwv:                            (r.pwv as number) ?? null,
      bodyComp:                       json(r.body_comp),
      syncStatus:                     r.sync_status as 'pending' | 'synced',
      updatedAt:                      String(r.updated_at),
    }));
  }

  async upsertOuraDailyDerived(record: LocalOuraDailyDerived): Promise<void> {
    await runSQL(
      `INSERT INTO oura_daily_derived
         (day, source, model_versions, sleep_score, sleep_contributors, readiness_score,
          readiness_contributors, readiness_source, activity_score, activity_contributors,
          active_calories_est, training_load_ots, training_load_high, recovery_index_hours,
          worn_hours_ble, night_hrv_baseline_ms, illness_flag, illness_score, illness_biomarkers,
          daytime_stress_scaled, stress_high_minutes, recovery_high_minutes, chronic_stress_score,
          chronic_stress_contributors, resilience_level, resilience_daily_stress,
          resilience_daily_restorative_time, resilience_daily_sleep_recovery, resilience_granular,
          resilience_confidence, bdi_derived, vascular_age, pwv, body_comp, updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day) DO UPDATE SET
         source=excluded.source, model_versions=excluded.model_versions, sleep_score=excluded.sleep_score,
         sleep_contributors=excluded.sleep_contributors, readiness_score=excluded.readiness_score,
         readiness_contributors=excluded.readiness_contributors, readiness_source=excluded.readiness_source,
         activity_score=excluded.activity_score, activity_contributors=excluded.activity_contributors,
         active_calories_est=excluded.active_calories_est, training_load_ots=excluded.training_load_ots,
         training_load_high=excluded.training_load_high, recovery_index_hours=excluded.recovery_index_hours,
         worn_hours_ble=excluded.worn_hours_ble, night_hrv_baseline_ms=excluded.night_hrv_baseline_ms,
         illness_flag=excluded.illness_flag, illness_score=excluded.illness_score,
         illness_biomarkers=excluded.illness_biomarkers, daytime_stress_scaled=excluded.daytime_stress_scaled,
         stress_high_minutes=excluded.stress_high_minutes, recovery_high_minutes=excluded.recovery_high_minutes,
         chronic_stress_score=excluded.chronic_stress_score, chronic_stress_contributors=excluded.chronic_stress_contributors,
         resilience_level=excluded.resilience_level, resilience_daily_stress=excluded.resilience_daily_stress,
         resilience_daily_restorative_time=excluded.resilience_daily_restorative_time,
         resilience_daily_sleep_recovery=excluded.resilience_daily_sleep_recovery,
         resilience_granular=excluded.resilience_granular, resilience_confidence=excluded.resilience_confidence,
         bdi_derived=excluded.bdi_derived, vascular_age=excluded.vascular_age, pwv=excluded.pwv,
         body_comp=excluded.body_comp, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      [
        record.day, record.source, record.modelVersions != null ? JSON.stringify(record.modelVersions) : null,
        record.sleepScore, record.sleepContributors != null ? JSON.stringify(record.sleepContributors) : null,
        record.readinessScore, record.readinessContributors != null ? JSON.stringify(record.readinessContributors) : null,
        record.readinessSource, record.activityScore,
        record.activityContributors != null ? JSON.stringify(record.activityContributors) : null,
        record.activeCaloriesEst, record.trainingLoadOts, record.trainingLoadHigh == null ? null : (record.trainingLoadHigh ? 1 : 0),
        record.recoveryIndexHours, record.wornHoursBle, record.nightHrvBaselineMs,
        record.illnessFlag, record.illnessScore, record.illnessBiomarkers != null ? JSON.stringify(record.illnessBiomarkers) : null,
        record.daytimeStressScaled, record.stressHighMinutes, record.recoveryHighMinutes, record.chronicStressScore,
        record.chronicStressContributors != null ? JSON.stringify(record.chronicStressContributors) : null,
        record.resilienceLevel, record.resilienceDailyStress, record.resilienceDailyRestorativeTime,
        record.resilienceDailySleepRecovery, record.resilienceGranular, record.resilienceConfidence,
        record.bdiDerived, record.vascularAge, record.pwv,
        record.bodyComp != null ? JSON.stringify(record.bodyComp) : null,
        record.updatedAt, record.syncStatus,
      ],
    );
  }

  async getOuraBuckets(tier: string, fromMs: number, toMs: number): Promise<LocalOuraBucket[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM oura_bucket WHERE tier=? AND bucket_start_ms >= ? AND bucket_start_ms <= ? ORDER BY bucket_start_ms`,
      [tier, fromMs, toMs],
    );
    return rows.map(r => ({
      tier:           String(r.tier),
      bucketStartMs:  Number(r.bucket_start_ms),
      bucketStartDs:  Number(r.bucket_start_ds),
      localDate:      String(r.local_date),
      hrMean:         (r.hr_mean as number) ?? null,
      hrMin:          (r.hr_min as number) ?? null,
      hrMax:          (r.hr_max as number) ?? null,
      hrvRmssdMs:     (r.hrv_rmssd_ms as number) ?? null,
      spo2Pct:        (r.spo2_pct as number) ?? null,
      perfusionIndex: (r.perfusion_index as number) ?? null,
      skinTempC:      (r.skin_temp_c as number) ?? null,
      metMean:        (r.met_mean as number) ?? null,
      metMinutes:     (r.met_minutes as number) ?? null,
      motionMad:      (r.motion_mad as number) ?? null,
      ibiMs:          (r.ibi_ms as string) ?? null,
      sampleCount:    (r.sample_count as number) ?? null,
      syncStatus:     r.sync_status as 'pending' | 'synced',
      updatedAt:      String(r.updated_at),
    }));
  }

  async upsertOuraBucket(record: LocalOuraBucket): Promise<void> {
    await runSQL(
      `INSERT INTO oura_bucket
         (tier, bucket_start_ms, bucket_start_ds, local_date, hr_mean, hr_min, hr_max,
          hrv_rmssd_ms, spo2_pct, perfusion_index, skin_temp_c, met_mean, met_minutes,
          motion_mad, ibi_ms, sample_count, updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tier, bucket_start_ms) DO UPDATE SET
         bucket_start_ds=excluded.bucket_start_ds, local_date=excluded.local_date,
         hr_mean=excluded.hr_mean, hr_min=excluded.hr_min, hr_max=excluded.hr_max,
         hrv_rmssd_ms=excluded.hrv_rmssd_ms, spo2_pct=excluded.spo2_pct,
         perfusion_index=excluded.perfusion_index, skin_temp_c=excluded.skin_temp_c,
         met_mean=excluded.met_mean, met_minutes=excluded.met_minutes, motion_mad=excluded.motion_mad,
         ibi_ms=excluded.ibi_ms, sample_count=excluded.sample_count,
         updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      [
        record.tier, record.bucketStartMs, record.bucketStartDs, record.localDate,
        record.hrMean, record.hrMin, record.hrMax, record.hrvRmssdMs, record.spo2Pct,
        record.perfusionIndex, record.skinTempC, record.metMean, record.metMinutes,
        record.motionMad, record.ibiMs, record.sampleCount, record.updatedAt, record.syncStatus,
      ],
    );
  }

  async getOuraHeartrate(fromMs: number, toMs: number): Promise<LocalOuraHeartratePoint[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM oura_heartrate WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms`,
      [fromMs, toMs],
    );
    return rows.map(r => ({
      tsMs:       Number(r.ts_ms),
      bpm:        Number(r.bpm),
      source:     String(r.source),
      syncStatus: r.sync_status as 'pending' | 'synced',
      updatedAt:  String(r.updated_at),
    }));
  }

  async upsertOuraHeartrate(record: LocalOuraHeartratePoint): Promise<void> {
    await runSQL(
      `INSERT INTO oura_heartrate (ts_ms, bpm, source, updated_at, sync_status)
       VALUES (?,?,?,?,?)
       ON CONFLICT(ts_ms) DO UPDATE SET
         bpm=excluded.bpm, source=excluded.source, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      [record.tsMs, record.bpm, record.source, record.updatedAt, record.syncStatus],
    );
  }

  async getActivityLogs(cutoffDate: string): Promise<LocalActivityLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM activity_logs WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:           String(r.id),
      date:         String(r.date),
      activityType: String(r.activity_type),
      title:        String(r.title),
      durationMin:  (r.duration_min as number) ?? null,
      distanceKm:   (r.distance_km as number) ?? null,
      steps:        (r.steps as number) ?? null,
      avgHr:        (r.avg_hr as number) ?? null,
      maxHr:        (r.max_hr as number) ?? null,
      caloriesBurned: (r.calories_burned as number) ?? null,
      startTime:      r.start_time != null ? String(r.start_time) : null,
      endTime:        r.end_time != null ? String(r.end_time) : null,
      notes:          r.notes != null ? String(r.notes) : null,
      routePolyline:  r.route_polyline != null ? String(r.route_polyline) : null,
      splits:         typeof r.splits === 'string' ? JSON.parse(r.splits) : null,
      bestEfforts:    typeof r.best_efforts === 'string' ? JSON.parse(r.best_efforts) : null,
      paceSeries:     typeof r.pace_series === 'string' ? JSON.parse(r.pace_series) : null,
      avgPaceSecPerKm: (r.avg_pace_sec_per_km as number) ?? null,
      elevationGainM:  (r.elevation_gain_m as number) ?? null,
      elevationLossM:  (r.elevation_loss_m as number) ?? null,
      elevationProfile: typeof r.elevation_profile === 'string' ? JSON.parse(r.elevation_profile) : null,
      cadenceSpm:      (r.cadence_spm as number) ?? null,
      cadenceSeries:   typeof r.cadence_series === 'string' ? JSON.parse(r.cadence_series) : null,
      cadenceSource:   r.cadence_source != null ? (String(r.cadence_source) as 'ring' | 'strap') : null,
      segments:        typeof r.segments === 'string' ? JSON.parse(r.segments) : null,
      updatedAt:    String(r.updated_at),
      deletedAt:    r.deleted_at != null ? String(r.deleted_at) : null,
      syncStatus:   (r.sync_status as 'pending' | 'synced') ?? 'synced',
    }));
  }

  async getFitnessTests(cutoffDate: string): Promise<LocalFitnessTest[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM fitness_tests WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:          String(r.id),
      testType:    String(r.test_type),
      date:        String(r.date),
      durationSec: (r.duration_sec as number) ?? null,
      distanceM:   (r.distance_m as number) ?? null,
      avgHr:       (r.avg_hr as number) ?? null,
      maxHr:       (r.max_hr as number) ?? null,
      restingHr:   (r.resting_hr as number) ?? null,
      hrr1Bpm:     (r.hrr1_bpm as number) ?? null,
      vo2maxEst:   (r.vo2max_est as number) ?? null,
      method:      r.method != null ? String(r.method) : null,
      notes:       r.notes != null ? String(r.notes) : null,
      updatedAt:   String(r.updated_at),
      deletedAt:   r.deleted_at != null ? String(r.deleted_at) : null,
      syncStatus:  (r.sync_status as 'pending' | 'synced') ?? 'synced',
    }));
  }

  async upsertFitnessTest(record: LocalFitnessTest): Promise<void> {
    await runSQL(
      `INSERT INTO fitness_tests
         (id, test_type, date, duration_sec, distance_m, avg_hr, max_hr,
          resting_hr, hrr1_bpm, vo2max_est, method, notes,
          updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         test_type=excluded.test_type, date=excluded.date,
         duration_sec=excluded.duration_sec, distance_m=excluded.distance_m,
         avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
         resting_hr=excluded.resting_hr, hrr1_bpm=excluded.hrr1_bpm,
         vo2max_est=excluded.vo2max_est, method=excluded.method, notes=excluded.notes,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.id, record.testType, record.date, record.durationSec,
        record.distanceM, record.avgHr, record.maxHr, record.restingHr,
        record.hrr1Bpm, record.vo2maxEst, record.method, record.notes,
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  async getPrescribedRuns(cutoffDate: string): Promise<LocalPrescribedRun[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM prescribed_runs WHERE date >= ? AND deleted_at IS NULL ORDER BY date`,
      [cutoffDate],
    );
    return rows.map(r => ({
      id:            String(r.id),
      planId:        r.plan_id != null ? String(r.plan_id) : '',
      date:          String(r.date),
      runType:       String(r.run_type),
      durationMin:   (r.duration_min as number) ?? null,
      distanceKm:    (r.distance_km as number) ?? null,
      targetHrLow:   (r.target_hr_low as number) ?? null,
      targetHrHigh:  (r.target_hr_high as number) ?? null,
      targetZoneIds: parseZoneIds(r.target_zone_ids),
      rationale:     r.rationale != null ? String(r.rationale) : '',
      gateAction:    r.gate_action != null ? String(r.gate_action) : 'proceed',
      status:        (r.status as LocalPrescribedRun['status']) ?? 'pending',
      activityLogId: r.activity_log_id != null ? String(r.activity_log_id) : null,
      updatedAt:     String(r.updated_at),
      deletedAt:     r.deleted_at != null ? String(r.deleted_at) : null,
      syncStatus:    (r.sync_status as 'pending' | 'synced') ?? 'synced',
    }));
  }

  async upsertPrescribedRun(record: LocalPrescribedRun): Promise<void> {
    await runSQL(
      `INSERT INTO prescribed_runs
         (id, plan_id, date, run_type, duration_min, distance_km, target_hr_low,
          target_hr_high, target_zone_ids, rationale, gate_action, status,
          activity_log_id, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         plan_id=excluded.plan_id, date=excluded.date, run_type=excluded.run_type,
         duration_min=excluded.duration_min, distance_km=excluded.distance_km,
         target_hr_low=excluded.target_hr_low, target_hr_high=excluded.target_hr_high,
         target_zone_ids=excluded.target_zone_ids, rationale=excluded.rationale,
         gate_action=excluded.gate_action, status=excluded.status,
         activity_log_id=excluded.activity_log_id, updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [
        record.id, record.planId, record.date, record.runType, record.durationMin,
        record.distanceKm, record.targetHrLow, record.targetHrHigh,
        JSON.stringify(record.targetZoneIds ?? []), record.rationale, record.gateAction,
        record.status, record.activityLogId, record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  async getPrograms(): Promise<LocalProgram[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM local_programs ORDER BY updated_at DESC`,
      [],
    );
    return rows.map(r => this.mapProgram(r));
  }

  private mapProgram(r: Record<string, unknown>): LocalProgram {
    return {
      id:                     String(r.id),
      name:                   String(r.name),
      isActive:               Number(r.is_active) === 1,
      phaseMode:              String(r.phase_mode ?? 'manual'),
      trainingGoal:           String(r.training_goal ?? 'strength'),
      startedAt:              r.started_at ? String(r.started_at) : null,
      sessionsPerCycle:       (r.sessions_per_cycle as number) ?? null,
      totalWeeks:             (r.total_weeks as number) ?? null,
      autoApplyPrescriptions: Number(r.auto_apply_prescriptions) === 1,
      createdAt:              r.created_at ? String(r.created_at) : null,
      updatedAt:              String(r.updated_at),
    };
  }

  // Reassembles the active program's structure from the local mirror so the
  // workout screen can paint sessions/exercises/per-set progression offline.
  async getActiveProgramLocal(): Promise<LocalActiveProgram | null> {
    const [programRows, sessionRows, exerciseRows, styleRows, styleSetRows, library] = await Promise.all([
      querySQL<Record<string, unknown>>(`SELECT * FROM local_programs`, []),
      querySQL<Record<string, unknown>>(`SELECT * FROM program_sessions`, []),
      querySQL<Record<string, unknown>>(`SELECT * FROM session_exercises`, []),
      querySQL<Record<string, unknown>>(`SELECT * FROM local_progression_styles`, []),
      querySQL<Record<string, unknown>>(`SELECT * FROM style_sets`, []),
      this.getExerciseLibrary().catch(() => [] as LocalExerciseLibraryEntry[]),
    ]);

    return assembleLocalActiveProgram({
      library,
      programs:  programRows.map(r => this.mapProgram(r)),
      sessions:  sessionRows.map(r => ({
        id:                String(r.id),
        programId:         String(r.program_id),
        name:              String(r.name),
        position:          Number(r.position),
        icon:              r.icon ? String(r.icon) : null,
        timeBudgetMinutes: Number(r.time_budget_minutes ?? 60),
      })),
      exercises: exerciseRows.map(r => ({
        id:           String(r.id),
        sessionId:    String(r.session_id),
        exerciseName: String(r.exercise_name),
        styleId:      r.style_id ? String(r.style_id) : null,
        muscleGroups: JSON.parse(String(r.muscle_groups ?? '[]')),
        position:     Number(r.position),
        exerciseRole: String(r.exercise_role ?? 'primary'),
        supersetGroup: r.superset_group != null ? Number(r.superset_group) : null,
      })),
      styles:    styleRows.map(r => ({
        id:        String(r.id),
        name:      String(r.name),
        updatedAt: String(r.updated_at),
      })),
      styleSets: styleSetRows.map(r => ({
        id:        String(r.id),
        styleId:   String(r.style_id),
        setNumber: Number(r.set_number),
        pct:       Number(r.pct),
        reps:      Number(r.reps),
        restSec:   Number(r.rest_sec),
        useFor1rm: Number(r.use_for_1rm) === 1,
      })),
    });
  }

  async getProgressionStyles(): Promise<LocalProgressionStyle[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM local_progression_styles ORDER BY updated_at DESC`,
      [],
    );
    return rows.map(r => ({
      id:        String(r.id),
      name:      String(r.name),
      updatedAt: String(r.updated_at),
    }));
  }

  // Read-merges against the existing local row before writing: callers logging a
  // single metric (weight, water, etc.) pass every other field as null meaning
  // "no value for this field", not "clear it" — the same COALESCE semantics the
  // server side already applies. Without this, an unconditional overwrite nulled
  // out the rest of today's row on every single-field save.
  async upsertBodyMetric(record: LocalBodyMetric): Promise<void> {
    const existing = (await this.getBodyMetrics(record.date)).find(r => r.date === record.date)
    const merged = {
      weightKg:         record.weightKg         ?? existing?.weightKg         ?? null,
      bodyFatPct:       record.bodyFatPct       ?? existing?.bodyFatPct       ?? null,
      steps:            record.steps            ?? existing?.steps            ?? null,
      calories:         record.calories         ?? existing?.calories         ?? null,
      proteinG:         record.proteinG         ?? existing?.proteinG         ?? null,
      carbsG:           record.carbsG           ?? existing?.carbsG           ?? null,
      fatG:             record.fatG             ?? existing?.fatG             ?? null,
      waterMl:          record.waterMl          ?? existing?.waterMl          ?? null,
      restingHeartRate: record.restingHeartRate ?? existing?.restingHeartRate ?? null,
      hrvMs:            record.hrvMs            ?? existing?.hrvMs            ?? null,
      spo2Pct:          record.spo2Pct          ?? existing?.spo2Pct          ?? null,
      distanceKm:       record.distanceKm       ?? existing?.distanceKm       ?? null,
      waistCm:          record.waistCm          ?? existing?.waistCm          ?? null,
      chestCm:          record.chestCm          ?? existing?.chestCm          ?? null,
      armCm:            record.armCm            ?? existing?.armCm           ?? null,
      thighCm:          record.thighCm          ?? existing?.thighCm         ?? null,
      hipCm:            record.hipCm            ?? existing?.hipCm           ?? null,
      neckCm:           record.neckCm           ?? existing?.neckCm          ?? null,
      skeletalMusclePct:  record.skeletalMusclePct  ?? existing?.skeletalMusclePct  ?? null,
      fatFreeMassKg:      record.fatFreeMassKg      ?? existing?.fatFreeMassKg      ?? null,
      subcutaneousFatPct: record.subcutaneousFatPct ?? existing?.subcutaneousFatPct ?? null,
      visceralFatIndex:   record.visceralFatIndex   ?? existing?.visceralFatIndex   ?? null,
      bodyWaterPct:       record.bodyWaterPct       ?? existing?.bodyWaterPct       ?? null,
      muscleMassKg:       record.muscleMassKg       ?? existing?.muscleMassKg       ?? null,
      boneMassKg:         record.boneMassKg         ?? existing?.boneMassKg         ?? null,
      proteinPct:         record.proteinPct         ?? existing?.proteinPct         ?? null,
      bmrKcal:            record.bmrKcal            ?? existing?.bmrKcal            ?? null,
      metabolicAge:       record.metabolicAge       ?? existing?.metabolicAge       ?? null,
    }
    await runSQL(
      `INSERT INTO body_metrics
         (date, weight_kg, body_fat_pct, steps, calories, protein_g, carbs_g, fat_g,
          water_ml, resting_heart_rate, hrv_ms, spo2_pct, distance_km,
          waist_cm, chest_cm, arm_cm, thigh_cm, hip_cm, neck_cm,
          skeletal_muscle_pct, fat_free_mass_kg, subcutaneous_fat_pct, visceral_fat_index,
          body_water_pct, muscle_mass_kg, bone_mass_kg, protein_pct, bmr_kcal, metabolic_age,
          updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET
         weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct,
         steps=excluded.steps, calories=excluded.calories,
         protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
         water_ml=excluded.water_ml, resting_heart_rate=excluded.resting_heart_rate,
         hrv_ms=excluded.hrv_ms, spo2_pct=excluded.spo2_pct, distance_km=excluded.distance_km,
         waist_cm=excluded.waist_cm, chest_cm=excluded.chest_cm, arm_cm=excluded.arm_cm,
         thigh_cm=excluded.thigh_cm, hip_cm=excluded.hip_cm, neck_cm=excluded.neck_cm,
         skeletal_muscle_pct=excluded.skeletal_muscle_pct, fat_free_mass_kg=excluded.fat_free_mass_kg,
         subcutaneous_fat_pct=excluded.subcutaneous_fat_pct, visceral_fat_index=excluded.visceral_fat_index,
         body_water_pct=excluded.body_water_pct, muscle_mass_kg=excluded.muscle_mass_kg,
         bone_mass_kg=excluded.bone_mass_kg, protein_pct=excluded.protein_pct,
         bmr_kcal=excluded.bmr_kcal, metabolic_age=excluded.metabolic_age,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.date, merged.weightKg, merged.bodyFatPct, merged.steps,
        merged.calories, merged.proteinG, merged.carbsG, merged.fatG,
        merged.waterMl, merged.restingHeartRate, merged.hrvMs, merged.spo2Pct, merged.distanceKm,
        merged.waistCm, merged.chestCm, merged.armCm, merged.thighCm, merged.hipCm, merged.neckCm,
        merged.skeletalMusclePct, merged.fatFreeMassKg, merged.subcutaneousFatPct, merged.visceralFatIndex,
        merged.bodyWaterPct, merged.muscleMassKg, merged.boneMassKg, merged.proteinPct,
        merged.bmrKcal, merged.metabolicAge,
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  async upsertMoodLog(record: LocalMoodLog): Promise<void> {
    await runSQL(
      `INSERT INTO mood_logs
         (log_date, energy_level, sleep_quality, body_state, sore_muscles,
          updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(log_date) DO UPDATE SET
         energy_level=excluded.energy_level, sleep_quality=excluded.sleep_quality,
         body_state=excluded.body_state, sore_muscles=excluded.sore_muscles,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.logDate, record.energyLevel, record.sleepQuality,
        JSON.stringify(record.bodyState), JSON.stringify(record.soreMuscles),
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  async getDayCheckin(logDate: string, phase: string): Promise<LocalDayCheckin | null> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM day_checkins WHERE log_date=? AND phase=? AND deleted_at IS NULL`,
      [logDate, phase],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      logDate:           String(r.log_date),
      phase:             String(r.phase),
      physicalTiredness: (r.physical_tiredness as number) ?? null,
      mentalDrain:       (r.mental_drain as number) ?? null,
      barelyMoved:       (r.barely_moved as number) ?? null,
      hydration:         (r.hydration as number) ?? null,
      lateHeavyMeal:     (r.late_heavy_meal as number) ?? null,
      wakeMood:          (r.wake_mood as number) ?? null,
      perceivedRecovery: (r.perceived_recovery as number) ?? null,
      motivation:        (r.motivation as number) ?? null,
      sleepQualityFeel:  (r.sleep_quality_feel as number) ?? null,
      restingSoreness:   (r.resting_soreness as number) ?? null,
      illnessContext:            r.illness_context ? String(r.illness_context) as import('@trainingai/shared/types/day-checkin').IllnessContext : null,
      perceivedRecoveryTouched:  Number(r.perceived_recovery_touched) === 1,
      sleepQualityFeelTouched:   Number(r.sleep_quality_feel_touched) === 1,
      soreMuscles:       JSON.parse(String(r.sore_muscles ?? '[]')),
      journal:           r.journal ? String(r.journal) : null,
      updatedAt:         String(r.updated_at),
      deletedAt:         r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:        String(r.sync_status) as 'pending' | 'synced',
    };
  }

  // Q-387: `food_logging_completed_at` is COALESCEd rather than overwritten. The check-in sheets
  // call this with the flag absent (so, null), and a bare `excluded.` would clear "I have finished
  // logging today" every time the evening check-in was saved or edited — the same clobber the
  // server-side `saveDayCheckin` guards against by omitting the column when it is undefined. Undo
  // is its own write, which sets it explicitly.
  async upsertDayCheckin(record: LocalDayCheckin): Promise<void> {
    await runSQL(
      `INSERT INTO day_checkins
         (log_date, phase, physical_tiredness, mental_drain, barely_moved,
          hydration, late_heavy_meal, wake_mood, perceived_recovery, motivation,
          sleep_quality_feel, resting_soreness, illness_context, perceived_recovery_touched,
          sleep_quality_feel_touched, sore_muscles, journal, food_logging_completed_at, updated_at,
          deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(log_date, phase) DO UPDATE SET
         physical_tiredness=excluded.physical_tiredness, mental_drain=excluded.mental_drain,
         barely_moved=excluded.barely_moved, hydration=excluded.hydration,
         late_heavy_meal=excluded.late_heavy_meal, wake_mood=excluded.wake_mood,
         perceived_recovery=excluded.perceived_recovery, motivation=excluded.motivation,
         sleep_quality_feel=excluded.sleep_quality_feel, resting_soreness=excluded.resting_soreness,
         illness_context=excluded.illness_context,
         perceived_recovery_touched=excluded.perceived_recovery_touched,
         sleep_quality_feel_touched=excluded.sleep_quality_feel_touched,
         sore_muscles=excluded.sore_muscles,
         journal=excluded.journal,
         food_logging_completed_at=COALESCE(excluded.food_logging_completed_at, day_checkins.food_logging_completed_at),
         updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [
        record.logDate, record.phase, record.physicalTiredness, record.mentalDrain,
        record.barelyMoved, record.hydration, record.lateHeavyMeal,
        record.wakeMood, record.perceivedRecovery, record.motivation,
        record.sleepQualityFeel, record.restingSoreness,
        record.illnessContext, record.perceivedRecoveryTouched ? 1 : 0, record.sleepQualityFeelTouched ? 1 : 0,
        JSON.stringify(record.soreMuscles), record.journal,
        record.foodLoggingCompletedAt ?? null, record.updatedAt,
        record.deletedAt, record.syncStatus,
      ],
    );
  }

  async applyDelta(delta: Parameters<LocalStore['applyDelta']>[0]): Promise<void> {
    try {
      await beginTransaction();
      await this.applyDeltaBody(delta);
      await commitTransaction();
    } catch (err) {
      // A failed statement may have auto-aborted the transaction already, so ROLLBACK
      // can itself throw "no current transaction" — never let that mask the real error.
      try { await rollbackTransaction(); } catch { /* already rolled back */ }
      throw err;
    }
  }

  private async applyDeltaBody(delta: Parameters<LocalStore['applyDelta']>[0]): Promise<void> {
    // Meal plans: server-authoritative, so a plain overwrite. A tombstoned plan keeps its row so
    // the delete propagates to a device that has not synced rather than silently reappearing.
    for (const p of delta.mealPlans ?? []) {
      await runSQL(
        `INSERT INTO meal_plans (id, name, is_active, meals_per_day, target_calories,
           target_protein_g, target_carbs_g, target_fat_g, training_time, generated_at,
           last_reviewed_at, updated_at, deleted_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, is_active=excluded.is_active, meals_per_day=excluded.meals_per_day,
           target_calories=excluded.target_calories, target_protein_g=excluded.target_protein_g,
           target_carbs_g=excluded.target_carbs_g, target_fat_g=excluded.target_fat_g,
           training_time=excluded.training_time, generated_at=excluded.generated_at,
           last_reviewed_at=excluded.last_reviewed_at, updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at, sync_status='synced'`,
        [p.id, p.name, p.isActive ? 1 : 0, p.mealsPerDay, p.targetCalories, p.targetProteinG,
         p.targetCarbsG, p.targetFatG, p.trainingTime, p.generatedAt, p.lastReviewedAt,
         p.updatedAt, p.deletedAt],
      );
    }
    // Clear the subtree of every changed plan before re-inserting it. Re-splitting a plan (meal
    // count or training time) deletes its variants server-side and writes new ones with new ids, so
    // an upsert-by-id alone would leave the old rows orphaned locally — a plan cut from 5 meals to
    // 3 would render 8. Same delete-then-insert-by-parent shape the program subtree uses.
    const changedMealPlanIds = (delta.mealPlans ?? []).map(p => p.id);
    if (changedMealPlanIds.length) {
      const ph = changedMealPlanIds.map(() => '?').join(',');
      await runSQL(
        `DELETE FROM meal_plan_meals WHERE variant_id IN
           (SELECT id FROM meal_plan_variants WHERE meal_plan_id IN (${ph}))`,
        changedMealPlanIds,
      );
      await runSQL(`DELETE FROM meal_plan_variants WHERE meal_plan_id IN (${ph})`, changedMealPlanIds);
    }
    for (const v of delta.mealPlanVariants ?? []) {
      await runSQL(
        `INSERT INTO meal_plan_variants (id, meal_plan_id, day_type, target_calories,
           target_protein_g, target_carbs_g, target_fat_g)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           meal_plan_id=excluded.meal_plan_id, day_type=excluded.day_type,
           target_calories=excluded.target_calories, target_protein_g=excluded.target_protein_g,
           target_carbs_g=excluded.target_carbs_g, target_fat_g=excluded.target_fat_g`,
        [v.id, v.mealPlanId, v.dayType, v.targetCalories, v.targetProteinG, v.targetCarbsG, v.targetFatG],
      );
    }
    for (const m of delta.mealPlanMeals ?? []) {
      await runSQL(
        `INSERT INTO meal_plan_meals (id, variant_id, position, name, notes, target_calories,
           target_protein_g, target_carbs_g, target_fat_g, ingredients, suggested_time)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           variant_id=excluded.variant_id, position=excluded.position, name=excluded.name,
           notes=excluded.notes, target_calories=excluded.target_calories,
           target_protein_g=excluded.target_protein_g, target_carbs_g=excluded.target_carbs_g,
           target_fat_g=excluded.target_fat_g, ingredients=excluded.ingredients,
           suggested_time=excluded.suggested_time`,
        [m.id, m.variantId, m.position, m.name, m.notes, m.targetCalories, m.targetProteinG,
         m.targetCarbsG, m.targetFatG,
         // TEXT mirror of the server's JSONB — stringify here so the local column stays a plain
         // TEXT blob the reader parses, matching how oura_daily.contributors is handled.
         typeof m.ingredients === 'string' ? m.ingredients : JSON.stringify(m.ingredients ?? []),
         m.suggestedTime ?? null],
      );
    }
    // Q-187 phase 2. Gated on sync_status so a pull cannot revert an answer the user gave while
    // offline — the row is only overwritten if the device has already confirmed it with the server.
    // Without this a decline made on a plane comes back as an unanswered prompt on landing.
    for (const a of delta.planMealAnswers ?? []) {
      await runSQL(
        `INSERT INTO plan_meal_answers
           (id, plan_meal_id, log_date, answer, answered_at, updated_at, deleted_at, sync_status)
         VALUES (?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           plan_meal_id=CASE WHEN sync_status='synced' THEN excluded.plan_meal_id ELSE plan_meal_id END,
           log_date=CASE WHEN sync_status='synced' THEN excluded.log_date ELSE log_date END,
           answer=CASE WHEN sync_status='synced' THEN excluded.answer ELSE answer END,
           answered_at=CASE WHEN sync_status='synced' THEN excluded.answered_at ELSE answered_at END,
           updated_at=CASE WHEN sync_status='synced' THEN excluded.updated_at ELSE updated_at END,
           deleted_at=CASE WHEN sync_status='synced' THEN excluded.deleted_at ELSE deleted_at END`,
        [a.id, a.planMealId, a.logDate, a.answer ?? 'no', a.answeredAt ?? null,
         a.updatedAt ?? null, a.deletedAt ?? null],
      );
    }
    for (const r of delta.bodyMetrics ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM body_metrics WHERE date = ? AND sync_status='synced'`, [r.date]);
      } else {
        await runSQL(
          `INSERT INTO body_metrics
             (date, weight_kg, body_fat_pct, steps, calories, protein_g, carbs_g, fat_g,
              water_ml, resting_heart_rate, hrv_ms, spo2_pct, distance_km,
              waist_cm, chest_cm, arm_cm, thigh_cm, hip_cm, neck_cm,
              skeletal_muscle_pct, fat_free_mass_kg, subcutaneous_fat_pct, visceral_fat_index,
              body_water_pct, muscle_mass_kg, bone_mass_kg, protein_pct, bmr_kcal, metabolic_age,
              updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
           ON CONFLICT(date) DO UPDATE SET
             weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct,
             steps=excluded.steps, calories=excluded.calories,
             protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
             water_ml=excluded.water_ml, resting_heart_rate=excluded.resting_heart_rate,
             hrv_ms=excluded.hrv_ms, spo2_pct=excluded.spo2_pct, distance_km=excluded.distance_km,
             waist_cm=excluded.waist_cm, chest_cm=excluded.chest_cm, arm_cm=excluded.arm_cm,
             thigh_cm=excluded.thigh_cm, hip_cm=excluded.hip_cm, neck_cm=excluded.neck_cm,
             skeletal_muscle_pct=excluded.skeletal_muscle_pct, fat_free_mass_kg=excluded.fat_free_mass_kg,
             subcutaneous_fat_pct=excluded.subcutaneous_fat_pct, visceral_fat_index=excluded.visceral_fat_index,
             body_water_pct=excluded.body_water_pct, muscle_mass_kg=excluded.muscle_mass_kg,
             bone_mass_kg=excluded.bone_mass_kg, protein_pct=excluded.protein_pct,
             bmr_kcal=excluded.bmr_kcal, metabolic_age=excluded.metabolic_age,
             updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
             sync_status='synced'
           WHERE body_metrics.sync_status='synced'
             AND excluded.updated_at > body_metrics.updated_at`,
          [r.date, r.weightKg, r.bodyFatPct, r.steps, r.calories, r.proteinG, r.carbsG,
           r.fatG, r.waterMl, r.restingHeartRate, r.hrvMs, r.spo2Pct, r.distanceKm,
           r.waistCm, r.chestCm, r.armCm, r.thighCm, r.hipCm, r.neckCm,
           r.skeletalMusclePct, r.fatFreeMassKg, r.subcutaneousFatPct, r.visceralFatIndex,
           r.bodyWaterPct, r.muscleMassKg, r.boneMassKg, r.proteinPct, r.bmrKcal, r.metabolicAge,
           r.updatedAt, r.deletedAt],
        );
      }
    }

    for (const r of delta.moodLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM mood_logs WHERE log_date = ? AND sync_status='synced'`, [r.logDate]);
      } else {
        await runSQL(
          `INSERT INTO mood_logs
             (log_date, energy_level, sleep_quality, body_state, sore_muscles,
              updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,'synced')
           ON CONFLICT(log_date) DO UPDATE SET
             energy_level=excluded.energy_level, sleep_quality=excluded.sleep_quality,
             body_state=excluded.body_state, sore_muscles=excluded.sore_muscles,
             updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
             sync_status='synced'
           WHERE mood_logs.sync_status='synced'
             AND excluded.updated_at > mood_logs.updated_at`,
          [r.logDate, r.energyLevel, r.sleepQuality, JSON.stringify(r.bodyState),
           JSON.stringify(r.soreMuscles), r.updatedAt, r.deletedAt],
        );
      }
    }

    for (const r of delta.sleepSessions ?? []) {
      // Carry the full Oura column set (HRV/RHR/stages) so restore isn't stripped to
      // stage hours (R6). Conflict on id (the server row id, stable for the mirror);
      // clobber-guarded so a future device-authored (pending) night isn't reverted by a
      // stale pull. updated_at must advance for the update to apply.
      await runSQL(
        `INSERT INTO sleep_sessions
           (id, date, duration_hours, deep_sleep_hours, rem_sleep_hours,
            light_sleep_hours, oura_id, efficiency, onset_latency_sec, average_hrv_ms,
            avg_heart_rate, lowest_heart_rate, restless_periods, sleep_score,
            respiratory_rate, sleep_phase_5_min, time_in_bed_hours, manual_sleep_start,
            updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           date=excluded.date, duration_hours=excluded.duration_hours,
           deep_sleep_hours=excluded.deep_sleep_hours,
           rem_sleep_hours=excluded.rem_sleep_hours,
           light_sleep_hours=excluded.light_sleep_hours,
           oura_id=excluded.oura_id, efficiency=excluded.efficiency,
           onset_latency_sec=excluded.onset_latency_sec, average_hrv_ms=excluded.average_hrv_ms,
           avg_heart_rate=excluded.avg_heart_rate, lowest_heart_rate=excluded.lowest_heart_rate,
           restless_periods=excluded.restless_periods, sleep_score=excluded.sleep_score,
           respiratory_rate=excluded.respiratory_rate, sleep_phase_5_min=excluded.sleep_phase_5_min,
           time_in_bed_hours=excluded.time_in_bed_hours,
           manual_sleep_start=excluded.manual_sleep_start,
           updated_at=excluded.updated_at, sync_status='synced'
         WHERE sleep_sessions.sync_status='synced'
           AND excluded.updated_at > sleep_sessions.updated_at`,
        [r.id, r.date, r.durationHours, r.deepSleepHours, r.remSleepHours, r.lightSleepHours,
         r.ouraId, r.efficiency, r.onsetLatencySec, r.averageHrvMs, r.avgHeartRate,
         r.lowestHeartRate, r.restlessPeriods, r.sleepScore, r.respiratoryRate,
         r.sleepPhase5Min, r.timeInBedHours, r.manualSleepStart, r.updatedAt],
      );
    }

    for (const r of delta.workoutSessions ?? []) {
      if (r.deletedAt) {
        // Never delete a pending local session — it hasn't reached the server yet,
        // so the server's tombstone can't be about this row's latest state.
        await runSQL(`DELETE FROM workout_sessions WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        await runSQL(
          `INSERT INTO workout_sessions
             (id, session_name, started_at, completed_at, session_rpe, updated_at,
              session_id, intensity_mode, was_override, synced, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,1,'synced')
           ON CONFLICT(id) DO UPDATE SET
             session_name=excluded.session_name,
             started_at=excluded.started_at,
             completed_at=excluded.completed_at,
             session_rpe=excluded.session_rpe,
             updated_at=excluded.updated_at,
             session_id=excluded.session_id,
             intensity_mode=excluded.intensity_mode,
             was_override=excluded.was_override,
             sync_status='synced'
           WHERE workout_sessions.sync_status='synced'`,
          [r.id, r.sessionName, r.startedAt, r.completedAt, r.sessionRpe, r.updatedAt,
           r.sessionId ?? null, r.intensityMode ?? null, r.wasOverride ? 1 : 0],
        );
      }
    }

    for (const r of delta.exerciseLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM exercise_logs WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        await runSQL(
          `INSERT INTO exercise_logs
             (id, workout_session_id, exercise_name, style_id, style_name,
              estimated_1rm, target_80, volume, avg_reps, time_to_complete,
              muscle_groups, logged_at, inter_exercise_rest_sec, updated_at,
              exercise_deloaded, synced, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'synced')
           ON CONFLICT(id) DO UPDATE SET
             workout_session_id=excluded.workout_session_id, exercise_name=excluded.exercise_name,
             style_id=excluded.style_id, style_name=excluded.style_name,
             estimated_1rm=excluded.estimated_1rm, target_80=excluded.target_80,
             volume=excluded.volume, avg_reps=excluded.avg_reps,
             time_to_complete=excluded.time_to_complete, muscle_groups=excluded.muscle_groups,
             logged_at=excluded.logged_at, inter_exercise_rest_sec=excluded.inter_exercise_rest_sec,
             updated_at=excluded.updated_at, exercise_deloaded=excluded.exercise_deloaded,
             synced=1, sync_status='synced'
           WHERE exercise_logs.sync_status='synced'`,
          [
            r.id, r.workoutSessionId, r.exerciseName, r.styleId, r.styleName,
            r.estimated1rm, r.target80, r.volume, r.avgReps, r.timeToComplete,
            JSON.stringify(r.muscleGroups ?? []), r.loggedAt, r.interExerciseRestSec,
            r.updatedAt, r.exerciseDeloaded ? 1 : 0,
          ],
        );
      }
    }

    for (const r of delta.setLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM set_logs WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        await runSQL(
          `INSERT INTO set_logs
             (id, exercise_log_id, set_number, weight_kg, reps,
              set_time_sec, rest_time_sec, intensity_pct, use_for_1rm,
              set_start_ms, set_end_ms, rpe, planned_pct, planned_reps, planned_rest_sec,
              updated_at, synced, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'synced')
           ON CONFLICT(id) DO UPDATE SET
             exercise_log_id=excluded.exercise_log_id, set_number=excluded.set_number,
             weight_kg=excluded.weight_kg, reps=excluded.reps,
             set_time_sec=excluded.set_time_sec, rest_time_sec=excluded.rest_time_sec,
             intensity_pct=excluded.intensity_pct, use_for_1rm=excluded.use_for_1rm,
             set_start_ms=excluded.set_start_ms, set_end_ms=excluded.set_end_ms,
             rpe=excluded.rpe, planned_pct=excluded.planned_pct,
             planned_reps=excluded.planned_reps, planned_rest_sec=excluded.planned_rest_sec,
             updated_at=excluded.updated_at, synced=1, sync_status='synced'
           WHERE set_logs.sync_status='synced'`,
          [
            r.id, r.exerciseLogId, r.setNumber, r.weightKg, r.reps,
            r.setTimeSec, r.restTimeSec, r.intensityPct, r.useFor1rm ? 1 : 0,
            r.setStartMs, r.setEndMs, r.rpe, r.plannedPct, r.plannedReps, r.plannedRestSec, r.updatedAt,
          ],
        );
      }
    }

    for (const r of delta.personalRecords ?? []) {
      // Server is authoritative for PRs (computed server-side) — take the value
      // verbatim so a downward correction (C2) actually reaches devices instead
      // of being permanently clamped by a MAX() that can only go up.
      await runSQL(
        `INSERT INTO personal_records
           (exercise_name, exercise_id, estimated_1rm, achieved_at, updated_at, sync_status)
         VALUES (?,?,?,?,?,'synced')
         ON CONFLICT(exercise_name) DO UPDATE SET
           exercise_id=excluded.exercise_id,
           estimated_1rm=excluded.estimated_1rm,
           achieved_at=excluded.achieved_at,
           updated_at=excluded.updated_at,
           sync_status='synced'`,
        [r.exerciseName, r.exerciseId, r.estimated1rm, r.achievedAt, r.updatedAt],
      );
    }

    for (const r of delta.ouraDaily ?? []) {
      // Was INSERT OR REPLACE (delete+reinsert), which blows away a local sync_status —
      // now a clobber-guarded upsert so a future device-authored (BLE rollup, pending) day
      // isn't reverted by a stale server pull (D4). All existing rows default 'synced', so
      // the guard permits every forward (updated_at-advancing) mirror update.
      await runSQL(
        `INSERT INTO oura_daily
           (day, readiness_score, sleep_score, activity_score,
            temperature_deviation, active_calories, contributors, updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(day) DO UPDATE SET
           readiness_score=excluded.readiness_score, sleep_score=excluded.sleep_score,
           activity_score=excluded.activity_score,
           temperature_deviation=excluded.temperature_deviation,
           active_calories=excluded.active_calories, contributors=excluded.contributors,
           updated_at=excluded.updated_at, sync_status='synced'
         WHERE oura_daily.sync_status='synced'
           AND excluded.updated_at > oura_daily.updated_at`,
        [
          r.day, r.readinessScore, r.sleepScore, r.activityScore,
          r.temperatureDeviation, r.activeCalories,
          r.contributors != null ? JSON.stringify(r.contributors) : null,
          r.updatedAt,
        ],
      );
    }

    for (const r of delta.ouraDailySummary ?? []) {
      // Device-computed daily summary (raw physiology + EMA baseline state). All scalar.
      // Same clobber-guard as oura_daily so a pending device-authored day survives a pull.
      await runSQL(
        `INSERT INTO oura_daily_summary
           (day, sleep_duration_hours, sleep_efficiency, deep_sleep_hours, rem_sleep_hours,
            restless_periods, sleep_latency_sec, hrv_avg_ms, rhr_low_bpm, rhr_avg_bpm,
            recovery_index_hours, temp_mean_c, temp_dev_c, met_avg, breath_avg_rpm,
            hrv_baseline_mean_x8, hrv_baseline_dev_x8, rhr_baseline_mean_x8, rhr_baseline_dev_x8,
            temp_baseline_mean_x8, temp_baseline_dev_x8, sleep_baseline_mean_x8, sleep_baseline_dev_x8,
            met_baseline_mean_x8, met_baseline_dev_x8, breath_baseline_mean_x8, breath_baseline_dev_x8,
            n_history, updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(day) DO UPDATE SET
           sleep_duration_hours=excluded.sleep_duration_hours, sleep_efficiency=excluded.sleep_efficiency,
           deep_sleep_hours=excluded.deep_sleep_hours, rem_sleep_hours=excluded.rem_sleep_hours,
           restless_periods=excluded.restless_periods, sleep_latency_sec=excluded.sleep_latency_sec,
           hrv_avg_ms=excluded.hrv_avg_ms, rhr_low_bpm=excluded.rhr_low_bpm, rhr_avg_bpm=excluded.rhr_avg_bpm,
           recovery_index_hours=excluded.recovery_index_hours, temp_mean_c=excluded.temp_mean_c,
           temp_dev_c=excluded.temp_dev_c, met_avg=excluded.met_avg, breath_avg_rpm=excluded.breath_avg_rpm,
           hrv_baseline_mean_x8=excluded.hrv_baseline_mean_x8, hrv_baseline_dev_x8=excluded.hrv_baseline_dev_x8,
           rhr_baseline_mean_x8=excluded.rhr_baseline_mean_x8, rhr_baseline_dev_x8=excluded.rhr_baseline_dev_x8,
           temp_baseline_mean_x8=excluded.temp_baseline_mean_x8, temp_baseline_dev_x8=excluded.temp_baseline_dev_x8,
           sleep_baseline_mean_x8=excluded.sleep_baseline_mean_x8, sleep_baseline_dev_x8=excluded.sleep_baseline_dev_x8,
           met_baseline_mean_x8=excluded.met_baseline_mean_x8, met_baseline_dev_x8=excluded.met_baseline_dev_x8,
           breath_baseline_mean_x8=excluded.breath_baseline_mean_x8, breath_baseline_dev_x8=excluded.breath_baseline_dev_x8,
           n_history=excluded.n_history, updated_at=excluded.updated_at, sync_status='synced'
         WHERE oura_daily_summary.sync_status='synced'
           AND excluded.updated_at > oura_daily_summary.updated_at`,
        [
          r.day, r.sleepDurationHours, r.sleepEfficiency, r.deepSleepHours, r.remSleepHours,
          r.restlessPeriods, r.sleepLatencySec, r.hrvAvgMs, r.rhrLowBpm, r.rhrAvgBpm,
          r.recoveryIndexHours, r.tempMeanC, r.tempDevC, r.metAvg, r.breathAvgRpm,
          r.hrvBaselineMeanX8, r.hrvBaselineDevX8, r.rhrBaselineMeanX8, r.rhrBaselineDevX8,
          r.tempBaselineMeanX8, r.tempBaselineDevX8, r.sleepBaselineMeanX8, r.sleepBaselineDevX8,
          r.metBaselineMeanX8, r.metBaselineDevX8, r.breathBaselineMeanX8, r.breathBaselineDevX8,
          r.nHistory, r.updatedAt,
        ],
      );
    }

    for (const r of delta.ouraDailyDerived ?? []) {
      // Device-computed derived metrics. Seven columns hold TEXT JSON (stringify on write);
      // training_load_high is a boolean stored 0/1; resilience_granular is a plain REAL.
      await runSQL(
        `INSERT INTO oura_daily_derived
           (day, source, model_versions, sleep_score, sleep_contributors, readiness_score,
            readiness_contributors, readiness_source, activity_score, activity_contributors,
            active_calories_est, training_load_ots, training_load_high, recovery_index_hours,
            worn_hours_ble, night_hrv_baseline_ms, illness_flag, illness_score, illness_biomarkers,
            daytime_stress_scaled, stress_high_minutes, recovery_high_minutes, chronic_stress_score,
            chronic_stress_contributors, resilience_level, resilience_daily_stress,
            resilience_daily_restorative_time, resilience_daily_sleep_recovery, resilience_granular,
            resilience_confidence, bdi_derived, vascular_age, pwv, body_comp, updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(day) DO UPDATE SET
           source=excluded.source, model_versions=excluded.model_versions, sleep_score=excluded.sleep_score,
           sleep_contributors=excluded.sleep_contributors, readiness_score=excluded.readiness_score,
           readiness_contributors=excluded.readiness_contributors, readiness_source=excluded.readiness_source,
           activity_score=excluded.activity_score, activity_contributors=excluded.activity_contributors,
           active_calories_est=excluded.active_calories_est, training_load_ots=excluded.training_load_ots,
           training_load_high=excluded.training_load_high, recovery_index_hours=excluded.recovery_index_hours,
           worn_hours_ble=excluded.worn_hours_ble, night_hrv_baseline_ms=excluded.night_hrv_baseline_ms,
           illness_flag=excluded.illness_flag, illness_score=excluded.illness_score,
           illness_biomarkers=excluded.illness_biomarkers, daytime_stress_scaled=excluded.daytime_stress_scaled,
           stress_high_minutes=excluded.stress_high_minutes, recovery_high_minutes=excluded.recovery_high_minutes,
           chronic_stress_score=excluded.chronic_stress_score,
           chronic_stress_contributors=excluded.chronic_stress_contributors,
           resilience_level=excluded.resilience_level, resilience_daily_stress=excluded.resilience_daily_stress,
           resilience_daily_restorative_time=excluded.resilience_daily_restorative_time,
           resilience_daily_sleep_recovery=excluded.resilience_daily_sleep_recovery,
           resilience_granular=excluded.resilience_granular, resilience_confidence=excluded.resilience_confidence,
           bdi_derived=excluded.bdi_derived, vascular_age=excluded.vascular_age, pwv=excluded.pwv,
           body_comp=excluded.body_comp, updated_at=excluded.updated_at, sync_status='synced'
         WHERE oura_daily_derived.sync_status='synced'
           AND excluded.updated_at > oura_daily_derived.updated_at`,
        [
          r.day, r.source,
          r.modelVersions != null ? JSON.stringify(r.modelVersions) : null,
          r.sleepScore,
          r.sleepContributors != null ? JSON.stringify(r.sleepContributors) : null,
          r.readinessScore,
          r.readinessContributors != null ? JSON.stringify(r.readinessContributors) : null,
          r.readinessSource, r.activityScore,
          r.activityContributors != null ? JSON.stringify(r.activityContributors) : null,
          r.activeCaloriesEst, r.trainingLoadOts,
          r.trainingLoadHigh == null ? null : (r.trainingLoadHigh ? 1 : 0),
          r.recoveryIndexHours, r.wornHoursBle, r.nightHrvBaselineMs, r.illnessFlag, r.illnessScore,
          r.illnessBiomarkers != null ? JSON.stringify(r.illnessBiomarkers) : null,
          r.daytimeStressScaled, r.stressHighMinutes, r.recoveryHighMinutes, r.chronicStressScore,
          r.chronicStressContributors != null ? JSON.stringify(r.chronicStressContributors) : null,
          r.resilienceLevel, r.resilienceDailyStress, r.resilienceDailyRestorativeTime,
          r.resilienceDailySleepRecovery, r.resilienceGranular, r.resilienceConfidence,
          r.bdiDerived, r.vascularAge, r.pwv,
          r.bodyComp != null ? JSON.stringify(r.bodyComp) : null,
          r.updatedAt,
        ],
      );
    }

    for (const r of delta.activityLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM activity_logs WHERE id = ? AND sync_status='synced'`, [r.id]);
        continue;
      }
      await runSQL(
        `INSERT INTO activity_logs
           (id, date, activity_type, title, duration_min, distance_km, steps,
            avg_hr, max_hr, calories_burned, start_time, end_time, notes,
            route_polyline, splits, best_efforts, pace_series,
            avg_pace_sec_per_km, elevation_gain_m, elevation_loss_m, elevation_profile,
            cadence_spm, cadence_series, cadence_source, segments, updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           date=excluded.date, activity_type=excluded.activity_type,
           title=excluded.title, duration_min=excluded.duration_min,
           distance_km=excluded.distance_km, steps=excluded.steps,
           avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
           calories_burned=excluded.calories_burned, start_time=excluded.start_time,
           end_time=excluded.end_time, notes=excluded.notes,
           route_polyline=excluded.route_polyline, splits=excluded.splits,
           best_efforts=excluded.best_efforts, pace_series=excluded.pace_series,
           avg_pace_sec_per_km=excluded.avg_pace_sec_per_km,
           elevation_gain_m=excluded.elevation_gain_m, elevation_loss_m=excluded.elevation_loss_m,
           elevation_profile=excluded.elevation_profile,
           cadence_spm=excluded.cadence_spm, cadence_series=excluded.cadence_series,
           cadence_source=excluded.cadence_source, segments=excluded.segments,
           updated_at=excluded.updated_at, sync_status='synced'
         WHERE activity_logs.sync_status='synced'`,
        [r.id, r.date, r.activityType, r.title, r.durationMin, r.distanceKm,
         r.steps, r.avgHr, r.maxHr, r.caloriesBurned, r.startTime,
         r.endTime, r.notes, r.routePolyline,
         r.splits ? JSON.stringify(r.splits) : null,
         r.bestEfforts ? JSON.stringify(r.bestEfforts) : null,
         r.paceSeries ? JSON.stringify(r.paceSeries) : null,
         r.avgPaceSecPerKm, r.elevationGainM, r.elevationLossM,
         r.elevationProfile ? JSON.stringify(r.elevationProfile) : null,
         r.cadenceSpm, r.cadenceSeries ? JSON.stringify(r.cadenceSeries) : null, r.cadenceSource,
         r.segments ? JSON.stringify(r.segments) : null,
         r.updatedAt],
      );
    }

    for (const r of delta.fitnessTests ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM fitness_tests WHERE id = ? AND sync_status='synced'`, [r.id]);
        continue;
      }
      await runSQL(
        `INSERT INTO fitness_tests
           (id, test_type, date, duration_sec, distance_m, avg_hr, max_hr,
            resting_hr, hrr1_bpm, vo2max_est, method, notes,
            updated_at, deleted_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           test_type=excluded.test_type, date=excluded.date,
           duration_sec=excluded.duration_sec, distance_m=excluded.distance_m,
           avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
           resting_hr=excluded.resting_hr, hrr1_bpm=excluded.hrr1_bpm,
           vo2max_est=excluded.vo2max_est, method=excluded.method, notes=excluded.notes,
           updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
           sync_status='synced'
         WHERE fitness_tests.sync_status='synced'`,
        [r.id, r.testType, r.date, r.durationSec, r.distanceM, r.avgHr, r.maxHr,
         r.restingHr, r.hrr1Bpm, r.vo2maxEst, r.method, r.notes, r.updatedAt, r.deletedAt],
      );
    }

    for (const r of delta.prescribedRuns ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM prescribed_runs WHERE id = ? AND sync_status='synced'`, [r.id]);
        continue;
      }
      // Local pending completion wins — the WHERE guard blocks a pull from
      // reverting an unsynced status change.
      await runSQL(
        `INSERT INTO prescribed_runs
           (id, plan_id, date, run_type, duration_min, distance_km, target_hr_low,
            target_hr_high, target_zone_ids, rationale, gate_action, status,
            activity_log_id, updated_at, deleted_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           plan_id=excluded.plan_id, date=excluded.date, run_type=excluded.run_type,
           duration_min=excluded.duration_min, distance_km=excluded.distance_km,
           target_hr_low=excluded.target_hr_low, target_hr_high=excluded.target_hr_high,
           target_zone_ids=excluded.target_zone_ids, rationale=excluded.rationale,
           gate_action=excluded.gate_action, status=excluded.status,
           activity_log_id=excluded.activity_log_id, updated_at=excluded.updated_at,
           deleted_at=excluded.deleted_at, sync_status='synced'
         WHERE prescribed_runs.sync_status='synced'`,
        [r.id, r.planId, r.date, r.runType, r.durationMin, r.distanceKm, r.targetHrLow,
         r.targetHrHigh, JSON.stringify(r.targetZoneIds ?? []), r.rationale, r.gateAction,
         r.status, r.activityLogId, r.updatedAt, r.deletedAt],
      );
    }

    // ── Program structure (read-only mirror) ───────────────────────────────────
    // Parents upsert in place; children are replaced wholesale for any changed
    // program/style (delete-then-insert by parent id) so renames/removals propagate.
    for (const r of delta.programs ?? []) {
      await runSQL(
        `INSERT INTO local_programs
           (id, name, is_active, phase_mode, training_goal, started_at,
            sessions_per_cycle, total_weeks, auto_apply_prescriptions, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, is_active=excluded.is_active,
           phase_mode=excluded.phase_mode, training_goal=excluded.training_goal,
           started_at=excluded.started_at, sessions_per_cycle=excluded.sessions_per_cycle,
           total_weeks=excluded.total_weeks,
           auto_apply_prescriptions=excluded.auto_apply_prescriptions,
           created_at=excluded.created_at, updated_at=excluded.updated_at`,
        [r.id, r.name, r.isActive ? 1 : 0, r.phaseMode, r.trainingGoal, r.startedAt,
         r.sessionsPerCycle, r.totalWeeks, r.autoApplyPrescriptions ? 1 : 0, r.createdAt, r.updatedAt],
      );
    }

    const changedProgramIds = (delta.programs ?? []).map(p => p.id);
    if (changedProgramIds.length) {
      const ph = changedProgramIds.map(() => '?').join(',');
      await runSQL(
        `DELETE FROM session_exercises WHERE session_id IN
           (SELECT id FROM program_sessions WHERE program_id IN (${ph}))`,
        changedProgramIds,
      );
      await runSQL(
        `DELETE FROM schedule_days WHERE schedule_id IN
           (SELECT id FROM schedules WHERE program_id IN (${ph}))`,
        changedProgramIds,
      );
      await runSQL(`DELETE FROM program_sessions WHERE program_id IN (${ph})`, changedProgramIds);
      await runSQL(`DELETE FROM schedules WHERE program_id IN (${ph})`, changedProgramIds);
    }

    for (const r of delta.programSessions ?? []) {
      await runSQL(
        `INSERT OR REPLACE INTO program_sessions
           (id, program_id, name, position, icon, time_budget_minutes)
         VALUES (?,?,?,?,?,?)`,
        [r.id, r.programId, r.name, r.position, r.icon, r.timeBudgetMinutes],
      );
    }

    for (const r of delta.sessionExercises ?? []) {
      await runSQL(
        `INSERT OR REPLACE INTO session_exercises
           (id, session_id, exercise_name, style_id, muscle_groups, position, exercise_role, superset_group)
         VALUES (?,?,?,?,?,?,?,?)`,
        [r.id, r.sessionId, r.exerciseName, r.styleId,
         JSON.stringify(r.muscleGroups ?? []), r.position, r.exerciseRole, r.supersetGroup],
      );
    }

    for (const r of delta.schedules ?? []) {
      await runSQL(
        `INSERT OR REPLACE INTO schedules
           (id, program_id, type, rest_after_n, reminder_enabled, reminder_time)
         VALUES (?,?,?,?,?,?)`,
        [r.id, r.programId, r.type, r.restAfterN, r.reminderEnabled ? 1 : 0, r.reminderTime],
      );
    }

    for (const r of delta.scheduleDays ?? []) {
      await runSQL(
        `INSERT OR REPLACE INTO schedule_days (schedule_id, day_of_week, session_id)
         VALUES (?,?,?)`,
        [r.scheduleId, r.dayOfWeek, r.sessionId],
      );
    }

    for (const r of delta.progressionStyles ?? []) {
      await runSQL(
        `INSERT INTO local_progression_styles (id, name, updated_at)
         VALUES (?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
        [r.id, r.name, r.updatedAt],
      );
    }

    const changedStyleIds = (delta.progressionStyles ?? []).map(st => st.id);
    if (changedStyleIds.length) {
      const ph = changedStyleIds.map(() => '?').join(',');
      await runSQL(`DELETE FROM style_sets WHERE style_id IN (${ph})`, changedStyleIds);
    }

    for (const r of delta.styleSets ?? []) {
      await runSQL(
        `INSERT OR REPLACE INTO style_sets
           (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm)
         VALUES (?,?,?,?,?,?,?)`,
        [r.id, r.styleId, r.setNumber, r.pct, r.reps, r.restSec, r.useFor1rm ? 1 : 0],
      );
    }

    for (const r of delta.foodItems ?? []) {
      await this.upsertFoodItem(r);
    }

    for (const r of delta.foodLogs ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM food_logs WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        await runSQL(
          `INSERT INTO food_logs
             (id, date, meal_type_id, food_item_id, saved_meal_id, meal_group_id, meal_group_name,
              quantity_multiplier, logged_at, updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'synced')
           ON CONFLICT(id) DO UPDATE SET
             -- Q-325: this arm used to set only quantity_multiplier, updated_at and deleted_at, so a
             -- server-side change to any OTHER column never reached a device that already held the
             -- row. Found while shipping Q-413, whose whole point is correcting logged_at -- the
             -- correction would have stopped at the server. meal_type_id is the same story and is
             -- what Q-412's reassign will move. The sync_status='synced' guard below is what
             -- protects a pending local edit; the narrow SET was never the protection.
             date=excluded.date, meal_type_id=excluded.meal_type_id,
             food_item_id=excluded.food_item_id,
             -- BF-39, and Q-325's lesson applied rather than repeated: the narrow SET is exactly
             -- how a server-side change to a column stops at the server.
             saved_meal_id=excluded.saved_meal_id, meal_group_id=excluded.meal_group_id,
             meal_group_name=excluded.meal_group_name,
             quantity_multiplier=excluded.quantity_multiplier,
             logged_at=excluded.logged_at,
             updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
             sync_status='synced'
           WHERE food_logs.sync_status='synced'`,
          [r.id, r.date, r.mealTypeId, r.foodItemId,
           r.savedMealId ?? null, r.mealGroupId ?? null, r.mealGroupName ?? null, r.quantityMultiplier,
           r.loggedAt, r.updatedAt, r.deletedAt],
        );
      }
    }

    for (const r of delta.supplements ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM supplements WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        // Q-124: was `this.upsertSupplement(r)`, an unconditional full overwrite — the only
        // applyDelta arm with no clobber guard, so a rename made offline reverted to the server's
        // old value on the next pull. Same shape as the injuries arm above.
        await runSQL(
          `INSERT INTO supplements
             (id, name, dose, default_amount, unit, started_on, stopped_on, dose_prompt,
              reminder_enabled, reminder_time, sort_order, active,
              updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, dose=excluded.dose,
             default_amount=excluded.default_amount, unit=excluded.unit,
             started_on=excluded.started_on, stopped_on=excluded.stopped_on,
             dose_prompt=excluded.dose_prompt,
             reminder_enabled=excluded.reminder_enabled,
             reminder_time=excluded.reminder_time,
             sort_order=excluded.sort_order, active=excluded.active,
             updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
             sync_status='synced'
           WHERE supplements.sync_status='synced'`,
          [
            r.id, r.name, r.dose, r.defaultAmount ?? null, r.unit ?? null,
            r.startedOn ?? null, r.stoppedOn ?? null, r.dosePrompt ? 1 : 0,
            r.reminderEnabled ? 1 : 0, r.reminderTime,
            r.sortOrder, r.active ? 1 : 0, r.updatedAt, r.deletedAt ?? null,
          ],
        );
      }
    }

    // BF-69 — a day can hold several contributions now, so this arm can no longer address "the row
    // for that day". The two branches differ because the two kinds of contribution have different
    // identities:
    //
    //   MANUAL keeps the natural key `(supplement_id, log_date)`, matching the partial unique index,
    //   because a locally-created log and its server row have DIFFERENT ids — the server generates
    //   its own — and the natural-key merge is what has always reconciled them. Keying it on id
    //   instead would insert the server's row beside the local one and double the day.
    //
    //   MEAL has no natural key by construction (several can share a substance and a date, which is
    //   the case the old constraint made impossible), so the server's row id IS its identity.
    //
    // The manual branch is safe to address by natural key because the partial unique index covers
    // soft-deleted rows too: there is AT MOST ONE manual row per substance per day, ever, so a
    // tombstone cannot take a sibling with it.
    for (const r of delta.supplementLogs ?? []) {
      const isMeal = r.source === 'meal';
      if (r.deletedAt) {
        await runSQL(
          isMeal
            ? `DELETE FROM supplement_logs WHERE id=? AND sync_status='synced'`
            : `DELETE FROM supplement_logs WHERE supplement_id=? AND log_date=? AND source='manual' AND sync_status='synced'`,
          isMeal ? [r.id] : [r.supplementId, r.logDate],
        );
      } else {
        await runSQL(
          `INSERT INTO supplement_logs (id, supplement_id, log_date, amount, unit, dose_text, source, source_ref, updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,'synced')
           ${isMeal
             ? `ON CONFLICT(id) DO UPDATE SET`
             : `ON CONFLICT(supplement_id, log_date) WHERE source = 'manual' DO UPDATE SET
             id=excluded.id,`}
             amount=excluded.amount, unit=excluded.unit, dose_text=excluded.dose_text,
             source=excluded.source, source_ref=excluded.source_ref,
             updated_at=excluded.updated_at,
             deleted_at=excluded.deleted_at, sync_status='synced'
           WHERE supplement_logs.sync_status='synced'`,
          [r.id, r.supplementId, r.logDate, r.amount ?? null, r.unit ?? null, r.doseText ?? null,
           isMeal ? 'meal' : 'manual', r.sourceRef ?? null,
           r.updatedAt, r.deletedAt],
        );
      }
    }

    for (const r of delta.injuries ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM injuries WHERE id = ? AND sync_status='synced'`, [r.id]);
      } else {
        await runSQL(
          `INSERT INTO injuries
             (id, muscle_name, notes, severity, started_date, resolved_date,
              created_at, updated_at, deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,'synced')
           ON CONFLICT(id) DO UPDATE SET
             muscle_name=excluded.muscle_name, notes=excluded.notes,
             severity=excluded.severity, started_date=excluded.started_date,
             resolved_date=excluded.resolved_date, updated_at=excluded.updated_at,
             deleted_at=excluded.deleted_at, sync_status='synced'
           WHERE injuries.sync_status='synced'`,
          [r.id, r.muscleName, r.notes, r.severity, r.startedDate, r.resolvedDate,
           r.createdAt, r.updatedAt, r.deletedAt],
        );
      }
    }

    for (const r of delta.dayCheckins ?? []) {
      if (r.deletedAt) {
        await runSQL(`DELETE FROM day_checkins WHERE log_date=? AND phase=? AND sync_status='synced'`, [r.logDate, r.phase]);
      } else {
        await runSQL(
          `INSERT INTO day_checkins
             (log_date, phase, physical_tiredness, mental_drain, barely_moved,
              hydration, late_heavy_meal, wake_mood, perceived_recovery, motivation,
              sleep_quality_feel, resting_soreness, illness_context, perceived_recovery_touched,
              sleep_quality_feel_touched, sore_muscles, journal, food_logging_completed_at, updated_at,
              deleted_at, sync_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
           ON CONFLICT(log_date, phase) DO UPDATE SET
             physical_tiredness=excluded.physical_tiredness, mental_drain=excluded.mental_drain,
             barely_moved=excluded.barely_moved, hydration=excluded.hydration,
             late_heavy_meal=excluded.late_heavy_meal, wake_mood=excluded.wake_mood,
             perceived_recovery=excluded.perceived_recovery, motivation=excluded.motivation,
             sleep_quality_feel=excluded.sleep_quality_feel, resting_soreness=excluded.resting_soreness,
             illness_context=excluded.illness_context,
             perceived_recovery_touched=excluded.perceived_recovery_touched,
             sleep_quality_feel_touched=excluded.sleep_quality_feel_touched,
             sore_muscles=excluded.sore_muscles,
             journal=excluded.journal,
             food_logging_completed_at=excluded.food_logging_completed_at,
             updated_at=excluded.updated_at,
             deleted_at=excluded.deleted_at, sync_status='synced'
           WHERE day_checkins.sync_status='synced'
             AND excluded.updated_at > day_checkins.updated_at`,
          [r.logDate, r.phase, r.physicalTiredness, r.mentalDrain, r.barelyMoved,
           r.hydration, r.lateHeavyMeal, r.wakeMood, r.perceivedRecovery, r.motivation,
           r.sleepQualityFeel, r.restingSoreness, r.illnessContext,
           r.perceivedRecoveryTouched ? 1 : 0, r.sleepQualityFeelTouched ? 1 : 0,
           JSON.stringify(r.soreMuscles), r.journal, r.foodLoggingCompletedAt ?? null,
           r.updatedAt, r.deletedAt],
        );
      }
    }
  }

  async getFoodLogs(date: string): Promise<LocalFoodLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM food_logs WHERE date = ? AND deleted_at IS NULL ORDER BY logged_at`,
      [date],
    );
    return rows.map(r => ({
      id:                 String(r.id),
      date:               String(r.date),
      mealTypeId:         String(r.meal_type_id),
      foodItemId:         String(r.food_item_id),
      quantityMultiplier: Number(r.quantity_multiplier),
      loggedAt:           String(r.logged_at),
      updatedAt:          String(r.updated_at),
      deletedAt:          r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:         String(r.sync_status) as 'pending' | 'synced',
    }));
  }

  async upsertFoodLog(record: LocalFoodLog): Promise<void> {
    await runSQL(
      `INSERT INTO food_logs
         (id, date, meal_type_id, food_item_id, saved_meal_id, meal_group_id, meal_group_name,
          quantity_multiplier, logged_at, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         quantity_multiplier=excluded.quantity_multiplier,
         -- BF-39: on the update arm too. A local single-field save read-merges through this
         -- function, and omitting the meal columns here would strip a logged meal's grouping the
         -- first time its quantity was edited.
         saved_meal_id=excluded.saved_meal_id, meal_group_id=excluded.meal_group_id,
         meal_group_name=excluded.meal_group_name,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status=excluded.sync_status`,
      [
        record.id, record.date, record.mealTypeId, record.foodItemId,
        record.savedMealId ?? null, record.mealGroupId ?? null, record.mealGroupName ?? null,
        record.quantityMultiplier, record.loggedAt, record.updatedAt,
        record.deletedAt, record.syncStatus,
      ],
    );
  }

  async deleteFoodLog(id: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE food_logs SET deleted_at=?, sync_status='pending', updated_at=? WHERE id=?`,
      [now, now, id],
    );
  }

  // Mirrors this device's own render after the web PATCH/DELETE round-trip already
  // succeeded — local matches server at this exact instant, so these write
  // sync_status='synced' (not 'pending'). Marking them pending would strand the row:
  // every future pull is gated behind `WHERE sync_status='synced'` (SYNC-4), so a
  // never-flipped-back-to-synced row would permanently block re-syncing this record.
  async deleteExerciseLogLocally(exerciseLogId: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE exercise_logs SET deleted_at=?, sync_status='synced', updated_at=? WHERE id=?`,
      [now, now, exerciseLogId],
    );
    await runSQL(
      `UPDATE set_logs SET deleted_at=?, sync_status='synced' WHERE exercise_log_id=?`,
      [now, exerciseLogId],
    );
  }

  async updateExerciseLogLocally(
    exerciseLogId: string,
    sets: Array<{ setNumber: number; weightKg: number; reps: number; intensityPct?: number | null }>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(`UPDATE exercise_logs SET sync_status='synced', updated_at=? WHERE id=?`, [now, exerciseLogId]);
    for (const set of sets) {
      if (set.intensityPct === undefined) {
        // Omitted (not explicitly cleared) — preserve whatever the server recomputed
        // rather than clobbering it with a bare null (SYNC-4).
        await runSQL(
          `UPDATE set_logs SET weight_kg=?, reps=?, updated_at=?, sync_status='synced'
           WHERE exercise_log_id=? AND set_number=?`,
          [set.weightKg, set.reps, now, exerciseLogId, set.setNumber],
        );
      } else {
        await runSQL(
          `UPDATE set_logs SET weight_kg=?, reps=?, intensity_pct=?, updated_at=?, sync_status='synced'
           WHERE exercise_log_id=? AND set_number=?`,
          [set.weightKg, set.reps, set.intensityPct, now, exerciseLogId, set.setNumber],
        );
      }
    }
    // The web PATCH truncates tail sets server-side (SYNC-3) — mirror the same
    // truncation locally so this device's own render doesn't keep a set the edit
    // removed.
    const maxSetNumber = sets.length > 0 ? Math.max(...sets.map(s => s.setNumber)) : 0;
    await runSQL(
      `UPDATE set_logs SET deleted_at=?, sync_status='synced' WHERE exercise_log_id=? AND set_number>? AND deleted_at IS NULL`,
      [now, exerciseLogId, maxSetNumber],
    );
  }

  // Mirrors a whole-session delete (SYN-1/SYN-2) — called only after the awaited web
  // DELETE already succeeded, so 'synced' (not 'pending'), same reasoning as
  // deleteExerciseLogLocally above.
  async deleteWorkoutSessionLocally(workoutSessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE workout_sessions SET deleted_at=?, sync_status='synced', updated_at=? WHERE id=?`,
      [now, now, workoutSessionId],
    );
    await runSQL(
      `UPDATE exercise_logs SET deleted_at=?, sync_status='synced', updated_at=? WHERE workout_session_id=?`,
      [now, now, workoutSessionId],
    );
    await runSQL(
      `UPDATE set_logs SET deleted_at=?, sync_status='synced'
       WHERE exercise_log_id IN (SELECT id FROM exercise_logs WHERE workout_session_id=?)`,
      [now, workoutSessionId],
    );
  }

  async upsertExerciseLibrary(entries: LocalExerciseLibraryEntry[]): Promise<void> {
    for (const e of entries) {
      await runSQL(
        `INSERT INTO exercise_library
           (name_key, id, name, exercise_type, muscles, equipment, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(name_key) DO UPDATE SET
           id=excluded.id, name=excluded.name, exercise_type=excluded.exercise_type,
           muscles=excluded.muscles, equipment=excluded.equipment,
           updated_at=excluded.updated_at`,
        [e.nameKey, e.id, e.name, e.exerciseType, JSON.stringify(e.muscles ?? []),
         e.equipment, e.updatedAt],
      );
    }
  }

  async getExerciseLibrary(): Promise<LocalExerciseLibraryEntry[]> {
    const rows = await querySQL<Record<string, unknown>>(`SELECT * FROM exercise_library`, []);
    return rows.map(r => ({
      nameKey:      String(r.name_key),
      id:           r.id ? String(r.id) : null,
      name:         String(r.name),
      exerciseType: String(r.exercise_type) === 'bodyweight' ? 'bodyweight' : 'weighted',
      muscles:      JSON.parse(String(r.muscles ?? '[]')),
      equipment:    r.equipment ? String(r.equipment) : null,
      updatedAt:    String(r.updated_at),
    }));
  }

  // A read-only mirror keyed by the server's own row id — a full replace on every successful
  // GET is safe (no local edit can ever be pending to clobber) and avoids ever going stale on
  // a deleted/reordered row the way an upsert-only mirror would.
  async replaceMealTypes(entries: LocalMealType[]): Promise<void> {
    await beginTransaction();
    try {
      await runSQL(`DELETE FROM meal_types`, []);
      for (const e of entries) {
        await runSQL(
          `INSERT INTO meal_types
             (id, name, emoji, sort_order, time_start_hour, time_end_hour, reminders_enabled, required)
           VALUES (?,?,?,?,?,?,?,?)`,
          [e.id, e.name, e.emoji, e.sortOrder, e.timeStartHour, e.timeEndHour,
           e.remindersEnabled ? 1 : 0, e.required ? 1 : 0],
        );
      }
      await commitTransaction();
    } catch (err) {
      await rollbackTransaction();
      throw err;
    }
  }

  async getMealTypes(): Promise<LocalMealType[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM meal_types ORDER BY sort_order ASC`, [],
    );
    return rows.map(r => ({
      id:               String(r.id),
      name:             String(r.name),
      emoji:            String(r.emoji ?? '🍽️'),
      sortOrder:        Number(r.sort_order ?? 0),
      timeStartHour:    Number(r.time_start_hour ?? 0),
      timeEndHour:      Number(r.time_end_hour ?? 24),
      remindersEnabled: Number(r.reminders_enabled ?? 1) === 1,
      required:         Number(r.required ?? 1) === 1,
    }));
  }

  async upsertFoodItem(record: LocalFoodItem): Promise<void> {
    await runSQL(
      `INSERT INTO food_items
         (id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g,
          fiber_g, sugar_g, sodium_mg, sat_fat_g, source, image_data_uri, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, brand=excluded.brand, serving_size_g=excluded.serving_size_g,
         calories=excluded.calories, protein_g=excluded.protein_g, carbs_g=excluded.carbs_g,
         fat_g=excluded.fat_g, fiber_g=excluded.fiber_g, sugar_g=excluded.sugar_g,
         sodium_mg=excluded.sodium_mg, sat_fat_g=excluded.sat_fat_g, source=excluded.source,
         image_data_uri=excluded.image_data_uri,
         updated_at=excluded.updated_at`,
      [
        record.id, record.name, record.brand, record.servingSizeG, record.calories,
        record.proteinG, record.carbsG, record.fatG, record.fiberG, record.sugarG,
        record.sodiumMg, record.satFatG, record.source, record.imageDataUri, record.updatedAt,
      ],
    );
  }

  // Offline render source: food logs joined to their local item. Logs whose item
  // isn't in the local store yet (not created here and not yet hydrated from the
  // server) are omitted until hydration fills them in.
  async getFoodLogsWithItems(date: string): Promise<FoodLogWithItem[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT fl.id, fl.date, fl.meal_type_id, fl.food_item_id, fl.quantity_multiplier, fl.logged_at,
              fl.saved_meal_id, fl.meal_group_id, fl.meal_group_name,
              fi.name, fi.brand, fi.serving_size_g, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g,
              fi.fiber_g, fi.sugar_g, fi.sodium_mg, fi.sat_fat_g, fi.source
         FROM food_logs fl
         JOIN food_items fi ON fi.id = fl.food_item_id
        WHERE fl.date = ? AND fl.deleted_at IS NULL
        ORDER BY fl.logged_at`,
      [date],
    );
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return rows.map(r => {
      const qty = Number(r.quantity_multiplier);
      const cal = Number(r.calories), pro = Number(r.protein_g), car = Number(r.carbs_g), fat = Number(r.fat_g);
      return {
        id: String(r.id), userId: '', date: String(r.date),
        mealTypeId: String(r.meal_type_id), foodItemId: String(r.food_item_id),
        // BF-39. The local-first read carries the grouping too, or the device — which is the
        // canonical runtime — would be the one surface that cannot draw a logged meal as a meal.
        savedMealId: r.saved_meal_id ? String(r.saved_meal_id) : null,
        mealGroupId: r.meal_group_id ? String(r.meal_group_id) : null,
        // BF-97. A scanned group's name lives on the row, so the offline read can head the group
        // without the saved meal it does not have.
        mealGroupName: r.meal_group_name ? String(r.meal_group_name) : null,
        quantityMultiplier: qty, loggedAt: new Date(String(r.logged_at)),
        foodItem: {
          id: String(r.food_item_id), userId: '', name: String(r.name),
          brand: r.brand ? String(r.brand) : undefined,
          servingSizeG: Number(r.serving_size_g), calories: cal, proteinG: pro, carbsG: car, fatG: fat,
          fiberG: r.fiber_g != null ? Number(r.fiber_g) : undefined,
          sugarG: r.sugar_g != null ? Number(r.sugar_g) : undefined,
          sodiumMg: r.sodium_mg != null ? Number(r.sodium_mg) : undefined,
          satFatG: r.sat_fat_g != null ? Number(r.sat_fat_g) : undefined,
          source: (r.source ? String(r.source) : 'manual') as 'ai' | 'barcode' | 'manual' | 'text',
          region: '', createdAt: new Date(String(r.logged_at)),
        },
        calories: Math.round(cal * qty),
        proteinG: r1(pro * qty), carbsG: r1(car * qty), fatG: r1(fat * qty),
      } satisfies FoodLogWithItem;
    });
  }

  // Local-first food-library search over previously-logged/created items. Mirrors the
  // server route (`slices/nutrition.ts` searchFoodItems): name LIKE, %/_ escaped, LIMIT 20.
  // Empty query returns the most-recent items (the "browse all" path).
  async searchFoodItems(query: string): Promise<FoodItem[]> {
    const q = query.trim().toLowerCase();
    const rows = q
      ? await querySQL<Record<string, unknown>>(
          `SELECT * FROM food_items WHERE lower(name) LIKE ? ESCAPE '\\'
            ORDER BY updated_at DESC LIMIT 20`,
          [`%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`],
        )
      : await querySQL<Record<string, unknown>>(
          `SELECT * FROM food_items ORDER BY updated_at DESC LIMIT 20`,
          [],
        );
    return rows.map(foodItemRowToItem);
  }

  // BF-38. Every row the user already has at this exact calorie count — the candidate set the
  // duplicate check runs over, and the same prefilter the server uses
  // (`slices/nutrition.ts` createFoodItem). Calories is the one column that is exact on both sides
  // and needs no text normalisation, so the two paths cannot disagree about which rows to consider.
  //
  // NOT `searchFoodItems(name)`, which is capped at 20 and ordered newest-first: a short name like
  // "Rice" fills that cap with substring matches and can push the real duplicate out of the window,
  // which would make the check silently weaker on the device than on the web. Unbounded here on
  // purpose — the whole table is a few hundred rows and a calorie match is a handful of them.
  async findFoodItemsByCalories(calories: number): Promise<FoodItem[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM food_items WHERE calories = ? ORDER BY updated_at ASC`,
      [Math.round(calories)],
    );
    return rows.map(foodItemRowToItem);
  }

  // Recent distinct food items logged to a meal type — mirrors the server route
  // (`listRecentFoodItemsForMealType`): scan the last 100 logs, dedup by item, take N.
  async getRecentFoodItemsForMeal(mealTypeId: string, limit: number): Promise<FoodItem[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT fi.id, fi.name, fi.brand, fi.serving_size_g, fi.calories, fi.protein_g,
              fi.carbs_g, fi.fat_g, fi.fiber_g, fi.sugar_g, fi.sodium_mg, fi.sat_fat_g,
              fi.source, fi.updated_at
         FROM food_logs fl
         JOIN food_items fi ON fi.id = fl.food_item_id
        WHERE fl.meal_type_id = ? AND fl.deleted_at IS NULL
        ORDER BY fl.logged_at DESC LIMIT 100`,
      [mealTypeId],
    );
    const seen = new Set<string>();
    const items: FoodItem[] = [];
    for (const r of rows) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id, userId: '', name: String(r.name),
        brand: r.brand ? String(r.brand) : undefined,
        servingSizeG: Number(r.serving_size_g), calories: Number(r.calories),
        proteinG: Number(r.protein_g), carbsG: Number(r.carbs_g), fatG: Number(r.fat_g),
        fiberG: r.fiber_g != null ? Number(r.fiber_g) : undefined,
        sugarG: r.sugar_g != null ? Number(r.sugar_g) : undefined,
        sodiumMg: r.sodium_mg != null ? Number(r.sodium_mg) : undefined,
        satFatG: r.sat_fat_g != null ? Number(r.sat_fat_g) : undefined,
        source: (r.source ? String(r.source) : 'manual') as FoodItem['source'],
        region: '', createdAt: new Date(String(r.updated_at)),
      } satisfies FoodItem);
      if (items.length >= limit) break;
    }
    return items;
  }

  // ── Saved meals (offline-first: create/edit/delete offline, read local-first) ──

  // ── Meal Plan (Q-186) ────────────────────────────────────────────────────────
  // Assembled entirely from local rows so the Nutrition section renders with no network. The
  // pull-delta arm below is the only writer; there is no offline write path for plans yet, so
  // rows are always 'synced' and no clobber guard is needed.
  async getActiveMealPlan(): Promise<MealPlan | null> {
    const plans = await querySQL<Record<string, unknown>>(
      `SELECT * FROM meal_plans WHERE deleted_at IS NULL AND is_active = 1 LIMIT 1`, [],
    );
    const p = plans[0];
    if (!p) return null;
    const planId = String(p.id);

    const variants = await querySQL<Record<string, unknown>>(
      `SELECT * FROM meal_plan_variants WHERE meal_plan_id = ? ORDER BY day_type`, [planId],
    );
    const meals = variants.length === 0 ? [] : await querySQL<Record<string, unknown>>(
      `SELECT * FROM meal_plan_meals WHERE variant_id IN (${variants.map(() => '?').join(',')})
        ORDER BY position`,
      variants.map(v => String(v.id)),
    );

    const mealsByVariant = new Map<string, MealPlanMeal[]>();
    for (const m of meals) {
      const vid = String(m.variant_id);
      const list = mealsByVariant.get(vid) ?? [];
      list.push({
        id: String(m.id), variantId: vid, mealTypeId: null, savedMealId: null,
        position: Number(m.position), name: String(m.name),
        notes: m.notes == null ? null : String(m.notes),
        targetCalories: Number(m.target_calories), targetProteinG: Number(m.target_protein_g),
        targetCarbsG: Number(m.target_carbs_g), targetFatG: Number(m.target_fat_g),
        // Malformed JSON must not take the whole plan down with it — a meal that renders without
        // its ingredient list is far better than a screen that throws.
        ingredients: parseIngredients(m.ingredients),
        suggestedTime: m.suggested_time == null ? null : String(m.suggested_time),
      });
      mealsByVariant.set(vid, list);
    }

    return {
      id: planId, userId: '', name: String(p.name), isActive: true,
      mealsPerDay: Number(p.meals_per_day),
      targetCalories: Number(p.target_calories), targetProteinG: Number(p.target_protein_g),
      targetCarbsG: Number(p.target_carbs_g), targetFatG: Number(p.target_fat_g),
      trainingTime: p.training_time == null ? null : String(p.training_time),
      stores: [], excludedFoods: [], restrictionsSnapshot: [], avoidNote: null,
      generatedAt: new Date(String(p.generated_at)),
      lastReviewedAt: p.last_reviewed_at == null ? null : new Date(String(p.last_reviewed_at)),
      createdAt: new Date(String(p.generated_at)),
      updatedAt: new Date(String(p.updated_at)),
      variants: variants.map(v => ({
        id: String(v.id), mealPlanId: planId, dayType: String(v.day_type) as MealPlanDayType,
        targetCalories: Number(v.target_calories), targetProteinG: Number(v.target_protein_g),
        targetCarbsG: Number(v.target_carbs_g), targetFatG: Number(v.target_fat_g),
        meals: mealsByVariant.get(String(v.id)) ?? [],
      })),
    };
  }

  // ── Plan meal answers (Q-187 phase 2) ───────────────────────────────────
  //
  // Local-first: the prefill UI reads these, never the API. A decline made offline has to stay
  // declined across an app restart, or the prompt reappears — which is worse than no prefill.

  async getPlanMealAnswers(logDate: string): Promise<LocalPlanMealAnswer[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT id, plan_meal_id, log_date, answer, answered_at, updated_at, deleted_at
       FROM plan_meal_answers WHERE log_date = ? AND deleted_at IS NULL`, [logDate],
    );
    return rows.map(r => ({
      id: String(r.id),
      planMealId: String(r.plan_meal_id),
      logDate: String(r.log_date),
      answer: String(r.answer ?? 'no'),
      answeredAt: r.answered_at == null ? null : String(r.answered_at),
      updatedAt: r.updated_at == null ? null : String(r.updated_at),
      deletedAt: r.deleted_at == null ? null : String(r.deleted_at),
    }));
  }

  async upsertPlanMealAnswer(a: LocalPlanMealAnswer & { syncStatus?: string }): Promise<void> {
    await runSQL(
      `INSERT INTO plan_meal_answers (id, plan_meal_id, log_date, answer, answered_at, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         plan_meal_id=excluded.plan_meal_id, log_date=excluded.log_date, answer=excluded.answer,
         answered_at=excluded.answered_at, updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [a.id, a.planMealId, a.logDate, a.answer, a.answeredAt, a.updatedAt, a.deletedAt,
       a.syncStatus ?? 'pending'],
    );
  }

  // Soft, and flips sync_status back to 'pending' so the pull-clobber gate in applyDelta cannot
  // overwrite an undo that has not reached the server yet.
  async deletePlanMealAnswer(planMealId: string, logDate: string): Promise<void> {
    await runSQL(
      `UPDATE plan_meal_answers SET deleted_at = ?, updated_at = ?, sync_status = 'pending'
       WHERE plan_meal_id = ? AND log_date = ?`,
      [new Date().toISOString(), new Date().toISOString(), planMealId, logDate],
    );
  }

  // Read the non-deleted meals joined to their local food_items, computing totals the
  // same way the server does (computeLogMacros lives in a server-only slice, so the
  // per-item macro scaling is inlined here — same shape as getFoodLogsWithItems).
  async getSavedMeals(): Promise<SavedMeal[]> {
    const meals = await querySQL<Record<string, unknown>>(
      `SELECT id, name, servings, image_data_uri, created_at FROM saved_meals WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      [],
    );
    if (meals.length === 0) return [];
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT smi.id AS smi_id, smi.saved_meal_id, smi.food_item_id, smi.quantity_multiplier,
              fi.name, fi.brand, fi.serving_size_g, fi.calories, fi.protein_g, fi.carbs_g, fi.fat_g,
              fi.fiber_g, fi.sugar_g, fi.sodium_mg, fi.sat_fat_g, fi.source, fi.updated_at
         FROM saved_meal_items smi
         JOIN food_items fi ON fi.id = smi.food_item_id
        ORDER BY smi.id`,
      [],
    );
    // BF-11e. No join to a local `meal_types` mirror: there isn't one, and the soft-delete filter
    // that the server read applies has already been applied by the time these rows were hydrated.
    // Storing what the server resolved keeps one definition of "which tags are live".
    const tagRows = await querySQL<Record<string, unknown>>(
      `SELECT saved_meal_id, meal_type_id FROM saved_meal_meal_types`, [],
    );
    const tagsByMeal = new Map<string, string[]>();
    for (const t of tagRows) {
      const mealId = String(t.saved_meal_id);
      const list = tagsByMeal.get(mealId) ?? [];
      list.push(String(t.meal_type_id));
      tagsByMeal.set(mealId, list);
    }
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const itemsByMeal = new Map<string, SavedMealItem[]>();
    for (const r of rows) {
      const mealId = String(r.saved_meal_id);
      const qty = Number(r.quantity_multiplier);
      const foodItem: FoodItem = {
        id: String(r.food_item_id), userId: '', name: String(r.name),
        brand: r.brand ? String(r.brand) : undefined,
        servingSizeG: Number(r.serving_size_g), calories: Number(r.calories),
        proteinG: Number(r.protein_g), carbsG: Number(r.carbs_g), fatG: Number(r.fat_g),
        fiberG: r.fiber_g != null ? Number(r.fiber_g) : undefined,
        sugarG: r.sugar_g != null ? Number(r.sugar_g) : undefined,
        sodiumMg: r.sodium_mg != null ? Number(r.sodium_mg) : undefined,
        satFatG: r.sat_fat_g != null ? Number(r.sat_fat_g) : undefined,
        source: (r.source ? String(r.source) : 'manual') as FoodItem['source'],
        region: '', createdAt: new Date(String(r.updated_at)),
      };
      const list = itemsByMeal.get(mealId) ?? [];
      list.push({ id: String(r.smi_id), savedMealId: mealId, foodItemId: foodItem.id, quantityMultiplier: qty, foodItem });
      itemsByMeal.set(mealId, list);
    }
    return meals.map(m => {
      const id = String(m.id);
      const items = itemsByMeal.get(id) ?? [];
      const totals = items.reduce(
        (acc, i) => ({
          calories: acc.calories + Math.round(i.foodItem.calories * i.quantityMultiplier),
          proteinG: acc.proteinG + i.foodItem.proteinG * i.quantityMultiplier,
          carbsG:   acc.carbsG   + i.foodItem.carbsG   * i.quantityMultiplier,
          fatG:     acc.fatG     + i.foodItem.fatG     * i.quantityMultiplier,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      );
      return {
        id, userId: '', name: String(m.name),
        // A row written before v25 has no value; 1 is the only safe reading, and dividing by 0
        // would make one portion infinite.
        servings: Number(m.servings) > 0 ? Number(m.servings) : 1,
        imageDataUri: m.image_data_uri ? String(m.image_data_uri) : null,
        createdAt: new Date(String(m.created_at)),
        mealTypeIds: tagsByMeal.get(id) ?? [],
        items,
        totals: { calories: totals.calories, proteinG: r1(totals.proteinG), carbsG: r1(totals.carbsG), fatG: r1(totals.fatG) },
      } satisfies SavedMeal;
    });
  }

  // Write a meal + replace its items in one shot (offline create/edit). The caller sets
  // syncStatus: 'pending' for a local edit or 'synced' when hydrating from the server.
  async upsertSavedMeal(meal: LocalSavedMeal, items: LocalSavedMealItem[], mealTypeIds?: string[]): Promise<void> {
    // `imageDataUri` omitted means "this write is not about the image" and must NOT clear a stored
    // one — the standing rule that a local upsert overwrites every column by default is exactly how
    // a name edit would silently delete the photo. An explicit `null` still removes it, so the two
    // cases stay distinguishable here the same way they are on the server (Q-396).
    const keepImage = meal.imageDataUri === undefined
    await runSQL(
      `INSERT INTO saved_meals (id, name, servings, image_data_uri, created_at, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, servings=excluded.servings,
         image_data_uri=${keepImage ? 'COALESCE(excluded.image_data_uri, saved_meals.image_data_uri)' : 'excluded.image_data_uri'},
         updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [meal.id, meal.name, meal.servings ?? 1, meal.imageDataUri ?? null, meal.createdAt, meal.updatedAt, meal.deletedAt, meal.syncStatus],
    );
    await runSQL(`DELETE FROM saved_meal_items WHERE saved_meal_id=?`, [meal.id]);
    for (const it of items) {
      await runSQL(
        `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier) VALUES (?,?,?,?)`,
        [it.id, it.savedMealId, it.foodItemId, it.quantityMultiplier],
      );
    }
    // BF-11e. Omitted means "this write is not about the tags" and must NOT clear them — the same
    // reasoning as `keepImage` above, and the same standing rule it exists for: a local upsert
    // overwrites every column by default, which is exactly how a name edit silently deletes
    // something the caller never mentioned. An explicit `[]` still clears.
    if (mealTypeIds !== undefined) {
      await runSQL(`DELETE FROM saved_meal_meal_types WHERE saved_meal_id=?`, [meal.id]);
      for (const typeId of [...new Set(mealTypeIds)]) {
        await runSQL(
          `INSERT INTO saved_meal_meal_types (saved_meal_id, meal_type_id) VALUES (?,?)`,
          [meal.id, typeId],
        );
      }
    }
  }

  // Offline delete → soft-delete tombstone (pending) so getSavedMeals hides it and the
  // outbox can push the delete. markSavedMealSynced/hydration clean it up afterwards.
  async deleteSavedMealLocally(id: string, updatedAt: string): Promise<void> {
    await runSQL(
      `UPDATE saved_meals SET deleted_at=?, updated_at=?, sync_status='pending' WHERE id=?`,
      [updatedAt, updatedAt, id],
    );
  }

  async markSavedMealSynced(id: string): Promise<void> {
    await runSQL(`UPDATE saved_meals SET sync_status='synced' WHERE id=?`, [id]);
  }

  // Reconcile the local mirror with the authoritative server list (the page's own fetch).
  // Clobber-gate: never overwrite a pending local row; prune synced rows the server no
  // longer has (deletes made on another device).
  async hydrateSavedMeals(serverMeals: SavedMeal[]): Promise<void> {
    const now = new Date().toISOString();
    const serverIds = new Set(serverMeals.map(m => m.id));
    for (const m of serverMeals) {
      const local = await querySQL<{ sync_status: string }>(
        `SELECT sync_status FROM saved_meals WHERE id=?`, [m.id],
      );
      if (local.length > 0 && local[0].sync_status === 'pending') continue; // keep the local edit
      await this.upsertSavedMeal(
        // `?? null`, not omitted: the server list IS authoritative here, so a meal whose image was
        // removed on another device must lose it locally too (Q-396).
        { id: m.id, name: m.name, servings: m.servings ?? 1, imageDataUri: m.imageDataUri ?? null, createdAt: (m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt)), updatedAt: now, deletedAt: null, syncStatus: 'synced' },
        m.items.map(it => ({ id: it.id, savedMealId: m.id, foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier })),
        // `?? []`, not omitted: the server list IS authoritative here, so a meal whose tags were
        // cleared on another device must lose them locally too — the same call the image makes.
        m.mealTypeIds ?? [],
      );
    }
    // Prune synced local rows the server dropped (cross-device deletes).
    const localRows = await querySQL<{ id: string }>(
      `SELECT id FROM saved_meals WHERE sync_status='synced'`, [],
    );
    for (const row of localRows) {
      if (!serverIds.has(row.id)) {
        await runSQL(`DELETE FROM saved_meal_items WHERE saved_meal_id=?`, [row.id]);
        await runSQL(`DELETE FROM saved_meal_meal_types WHERE saved_meal_id=?`, [row.id]);
        await runSQL(`DELETE FROM saved_meals WHERE id=?`, [row.id]);
      }
    }
  }

  async getSupplements(): Promise<LocalSupplement[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM supplements WHERE active=1 AND deleted_at IS NULL ORDER BY sort_order`,
      [],
    );
    return rows.map(r => ({
      id:              String(r.id),
      name:            String(r.name),
      dose:            r.dose ? String(r.dose) : null,
      defaultAmount:   r.default_amount == null ? null : Number(r.default_amount),
      unit:            r.unit ? String(r.unit) : null,
      startedOn:       r.started_on ? String(r.started_on) : null,
      stoppedOn:       r.stopped_on ? String(r.stopped_on) : null,
      dosePrompt:      Number(r.dose_prompt) === 1,
      reminderEnabled: Number(r.reminder_enabled) === 1,
      reminderTime:    r.reminder_time ? String(r.reminder_time) : null,
      sortOrder:       Number(r.sort_order),
      active:          Number(r.active) === 1,
      updatedAt:       String(r.updated_at),
    }));
  }

  // Every caller is a local user edit (create/rename/toggle in the manage sheet, each paired with
  // a queueMutation), so the row is written 'pending' and the pull can no longer clobber it until
  // markSupplementSynced flips it back on push confirmation. applyDelta does NOT come through
  // here — it has its own 'synced' insert with the clobber guard (Q-124).
  async upsertSupplement(record: LocalSupplement): Promise<void> {
    await runSQL(
      `INSERT INTO supplements
         (id, name, dose, default_amount, unit, started_on, stopped_on, dose_prompt, reminder_enabled, reminder_time, sort_order, active, updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, dose=excluded.dose,
         default_amount=excluded.default_amount, unit=excluded.unit,
         started_on=excluded.started_on, stopped_on=excluded.stopped_on,
         dose_prompt=excluded.dose_prompt,
         reminder_enabled=excluded.reminder_enabled,
         reminder_time=excluded.reminder_time,
         sort_order=excluded.sort_order,
         active=excluded.active, updated_at=excluded.updated_at,
         sync_status='pending'`,
      [
        record.id, record.name, record.dose,
        record.defaultAmount ?? null, record.unit ?? null,
        record.startedOn ?? null, record.stoppedOn ?? null, record.dosePrompt ? 1 : 0,
        record.reminderEnabled ? 1 : 0, record.reminderTime,
        record.sortOrder, record.active ? 1 : 0, record.updatedAt,
      ],
    );
  }

  async markSupplementSynced(id: string): Promise<void> {
    await runSQL(`UPDATE supplements SET sync_status='synced' WHERE id=?`, [id]);
  }

  async getSupplementLogs(date: string): Promise<LocalSupplementLog[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM supplement_logs WHERE log_date = ? AND deleted_at IS NULL`,
      [date],
    );
    return rows.map(r => ({
      id:           String(r.id),
      supplementId: String(r.supplement_id),
      logDate:      String(r.log_date),
      amount:       r.amount == null ? null : Number(r.amount),
      unit:         r.unit ? String(r.unit) : null,
      doseText:     r.dose_text ? String(r.dose_text) : null,
      source:       r.source === 'meal' ? 'meal' : 'manual',
      sourceRef:    r.source_ref ? String(r.source_ref) : null,
      updatedAt:    String(r.updated_at),
      deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:   String(r.sync_status) as 'pending' | 'synced',
    }));
  }

  async upsertSupplementLog(record: LocalSupplementLog): Promise<void> {
    const now = new Date().toISOString();
    // BF-3 — stamp the dose HERE when the caller did not supply one, reading the local definition.
    // Doing it in the store rather than at the call site is what makes today's UI freeze the dose
    // with no change to the UI: `supplements-section.tsx` passes no dose and does not need to.
    // A caller that DOES pass one wins, which is how the sync engine replays a log at the dose it
    // was actually taken at rather than at whatever the definition says now.
    let dose = { amount: record.amount ?? null, unit: record.unit ?? null, doseText: record.doseText ?? null };
    if (dose.amount == null && dose.unit == null && dose.doseText == null) {
      const [def] = await querySQL<Record<string, unknown>>(
        `SELECT dose, default_amount, unit FROM supplements WHERE id = ?`, [record.supplementId]);
      if (def) {
        dose = {
          amount: def.default_amount == null ? null : Number(def.default_amount),
          unit: def.unit ? String(def.unit) : null,
          doseText: def.dose ? String(def.dose) : null,
        };
      }
    }
    // BF-69 — the conflict target is the PARTIAL index over manual contributions
    // (`idx_supplement_logs_manual_day`), not the table's old whole-day UNIQUE. A meal contribution
    // on the same day is a separate row and is untouched; a re-tick of the manual one still revives
    // the soft-deleted row rather than duplicating it, because the index covers soft-deleted rows
    // too. `source` defaults to 'manual' because that is what every writer today is — the
    // supplements page's tick.
    const source = record.source ?? 'manual';
    await runSQL(
      `INSERT INTO supplement_logs (id, supplement_id, log_date, amount, unit, dose_text, source, source_ref, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(supplement_id, log_date) WHERE source = 'manual' DO UPDATE SET
         id=excluded.id, amount=excluded.amount, unit=excluded.unit, dose_text=excluded.dose_text,
         source_ref=excluded.source_ref, updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [
        record.id, record.supplementId, record.logDate,
        dose.amount, dose.unit, dose.doseText,
        source, record.sourceRef ?? null,
        record.updatedAt ?? now, record.deletedAt, record.syncStatus,
      ],
    );
  }

  /**
   * BF-69 — removes the MANUAL contribution only, mirroring `unlogSupplement` server-side.
   *
   * Before contributions this soft-deleted the day's row with no notion of who wrote it, so
   * unticking on the supplements page would have wiped a dose a meal had contributed. That is the
   * silent data loss the contribution rows exist to prevent.
   */
  async deleteSupplementLog(supplementId: string, logDate: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE supplement_logs
       SET deleted_at=?, sync_status='pending', updated_at=?
       WHERE supplement_id=? AND log_date=? AND source='manual'`,
      [now, now, supplementId, logDate],
    );
  }

  async getInjuries(): Promise<LocalInjury[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM injuries WHERE deleted_at IS NULL ORDER BY started_date DESC`,
      [],
    );
    return rows.map(r => ({
      id:           String(r.id),
      muscleName:   String(r.muscle_name),
      notes:        r.notes ? String(r.notes) : null,
      severity:     String(r.severity) as LocalInjury['severity'],
      startedDate:  String(r.started_date),
      resolvedDate: r.resolved_date ? String(r.resolved_date) : null,
      createdAt:    String(r.created_at),
      updatedAt:    String(r.updated_at),
      deletedAt:    r.deleted_at ? String(r.deleted_at) : null,
      syncStatus:   String(r.sync_status) as 'pending' | 'synced',
    }));
  }

  async upsertInjury(record: LocalInjury): Promise<void> {
    await runSQL(
      `INSERT INTO injuries
         (id, muscle_name, notes, severity, started_date, resolved_date,
          created_at, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         muscle_name=excluded.muscle_name, notes=excluded.notes,
         severity=excluded.severity, started_date=excluded.started_date,
         resolved_date=excluded.resolved_date, updated_at=excluded.updated_at,
         deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
      [
        record.id, record.muscleName, record.notes, record.severity,
        record.startedDate, record.resolvedDate, record.createdAt,
        record.updatedAt, record.deletedAt, record.syncStatus,
      ],
    );
  }

  /**
   * The offline-capable activity delete (Q-328) — pair it with a
   * `queueMutation({ domain: 'activity_logs', payload: { id, deleted: true } })`.
   *
   * **`sync_status` is the whole point, and both values are correct at different moments.**
   * `'synced'` is load-bearing rather than incidental: `applyDelta` prunes an activity-log tombstone with
   * `DELETE FROM activity_logs WHERE id = ? AND sync_status='synced'`, so a row left `'pending'`
   * is skipped by that prune forever. A row awaiting a push MUST be `'pending'` anyway — that is
   * what stops the pull-clobber gate overwriting a delete that has not reached the server — so the
   * two states are both correct, at different moments. `markActivityLogSynced` is what moves the
   * row from one to the other, and it runs on push confirmation.
   *
   * **Never write `'pending'` without queueing the mutation behind it** — such a row is skipped by
   * the prune above forever. This shipped alongside a `deleteActivityLog` that wrote `'synced'`,
   * for the bare-`fetch` caller that has since been converted; that method is gone (Q-328).
   *
   * Do not "simplify" this into `upsertActivityLog` with a `deletedAt` field: that method's INSERT
   * column list and its ON CONFLICT DO UPDATE both omit `deleted_at` entirely, so the write would
   * compile, type-check, lint clean, and change nothing.
   */
  async softDeleteActivityLogPending(id: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE activity_logs SET deleted_at=?, sync_status='pending', updated_at=? WHERE id=?`,
      [now, now, id],
    );
  }

  /**
   * Flip a queued activity-log row to synced once its push is confirmed (Q-328).
   *
   * Deliberately its own method rather than the `upsertActivityLog` round-trip the confirm path
   * uses for an upsert, because that route cannot work for a delete on two counts: `getActivityLogs`
   * filters `deleted_at IS NULL` so the row is never found, and `upsertActivityLog`'s column list
   * omits `deleted_at` entirely. Same shape and same reason as `markSavedMealSynced`.
   */
  async markActivityLogSynced(id: string): Promise<void> {
    await runSQL(`UPDATE activity_logs SET sync_status='synced' WHERE id=?`, [id]);
  }

  async upsertActivityLog(record: LocalActivityLog): Promise<void> {
    await runSQL(
      `INSERT INTO activity_logs
         (id, date, activity_type, title, duration_min, distance_km, steps, avg_hr, max_hr, calories_burned,
          start_time, end_time, notes, route_polyline, splits, best_efforts, pace_series,
          avg_pace_sec_per_km, elevation_gain_m, elevation_loss_m, elevation_profile,
          cadence_spm, cadence_series, cadence_source, segments, updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         date=excluded.date, activity_type=excluded.activity_type,
         title=excluded.title, duration_min=excluded.duration_min,
         distance_km=excluded.distance_km, steps=excluded.steps,
         avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
         calories_burned=excluded.calories_burned, start_time=excluded.start_time,
         end_time=excluded.end_time, notes=excluded.notes,
         route_polyline=excluded.route_polyline, splits=excluded.splits,
         best_efforts=excluded.best_efforts, pace_series=excluded.pace_series,
         avg_pace_sec_per_km=excluded.avg_pace_sec_per_km,
         elevation_gain_m=excluded.elevation_gain_m, elevation_loss_m=excluded.elevation_loss_m,
         elevation_profile=excluded.elevation_profile,
         cadence_spm=excluded.cadence_spm, cadence_series=excluded.cadence_series,
         cadence_source=excluded.cadence_source, segments=excluded.segments,
         updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      [record.id, record.date, record.activityType, record.title,
       record.durationMin, record.distanceKm, record.steps, record.avgHr, record.maxHr,
       record.caloriesBurned, record.startTime,
       record.endTime, record.notes, record.routePolyline,
       record.splits ? JSON.stringify(record.splits) : null,
       record.bestEfforts ? JSON.stringify(record.bestEfforts) : null,
       record.paceSeries ? JSON.stringify(record.paceSeries) : null,
       record.avgPaceSecPerKm, record.elevationGainM, record.elevationLossM,
       record.elevationProfile ? JSON.stringify(record.elevationProfile) : null,
       record.cadenceSpm, record.cadenceSeries ? JSON.stringify(record.cadenceSeries) : null,
       record.cadenceSource,
       record.segments ? JSON.stringify(record.segments) : null,
       record.updatedAt, record.syncStatus],
    );
  }

  async deleteInjury(id: string): Promise<void> {
    const now = new Date().toISOString();
    await runSQL(
      `UPDATE injuries SET deleted_at=?, sync_status='pending', updated_at=? WHERE id=?`,
      [now, now, id],
    );
  }

  private mapMutation(r: Record<string, unknown>): PendingMutation {
    return {
      id:          String(r.id),
      userId:      String(r.user_id),
      domain:      String(r.domain) as PendingMutation['domain'],
      date:        String(r.date),
      payload:     JSON.parse(String(r.payload)),
      createdAt:   String(r.created_at),
      attempts:    Number(r.attempts ?? 0),
      lastError:   r.last_error ? String(r.last_error) : null,
      status:      (r.status as 'pending' | 'failed') ?? 'pending',
      nextRetryAt: r.next_retry_at ? String(r.next_retry_at) : null,
    };
  }

  async queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'status' | 'nextRetryAt'>): Promise<void> {
    await runSQL(
      `INSERT OR REPLACE INTO mutations_outbox (id, user_id, domain, date, payload, created_at, attempts, last_error, status, next_retry_at)
       VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),0,NULL,'pending',NULL)`,
      [crypto.randomUUID(), m.userId, m.domain, m.date, JSON.stringify(m.payload)],
    );
  }

  async getPendingMutations(userId: string): Promise<PendingMutation[]> {
    const nowIso = new Date().toISOString();
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mutations_outbox
        WHERE user_id = ? AND status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at`,
      [userId, nowIso],
    );
    return rows.map(r => this.mapMutation(r));
  }

  // BF-47. No `next_retry_at` clause and no status filter, unlike getPendingMutations above: a
  // delete waiting out a backoff, or quarantined after a failure, is still a row the user has
  // deleted locally — and a read path that forgets it re-renders the row from the server copy.
  async getQueuedMutationsForDomain(userId: string, domain: string): Promise<PendingMutation[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mutations_outbox WHERE user_id = ? AND domain = ? ORDER BY created_at`,
      [userId, domain],
    );
    return rows.map(r => this.mapMutation(r));
  }

  async getFailedMutations(userId: string): Promise<PendingMutation[]> {
    const rows = await querySQL<Record<string, unknown>>(
      `SELECT * FROM mutations_outbox WHERE user_id = ? AND status = 'failed' ORDER BY created_at`,
      [userId],
    );
    return rows.map(r => this.mapMutation(r));
  }

  async recordMutationFailures(failures: Array<{ id: string; error: string }>): Promise<void> {
    for (const f of failures) {
      const rows = await querySQL<{ attempts: number }>(
        `SELECT attempts FROM mutations_outbox WHERE id = ?`, [f.id],
      );
      if (!rows.length) continue;
      const attempts = Number(rows[0].attempts) + 1;
      const dead = attempts >= MAX_MUTATION_ATTEMPTS;
      const nextRetryAt = dead ? null : new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString();
      await runSQL(
        `UPDATE mutations_outbox
            SET attempts = ?, last_error = ?, status = ?, next_retry_at = ?
          WHERE id = ?`,
        [attempts, f.error.slice(0, 500), dead ? 'failed' : 'pending', nextRetryAt, f.id],
      );
    }
  }

  async retryFailedMutation(id: string): Promise<void> {
    await runSQL(
      `UPDATE mutations_outbox
          SET status = 'pending', attempts = 0, next_retry_at = NULL, last_error = NULL
        WHERE id = ?`,
      [id],
    );
  }

  async requeueStrandedFoodItems(userId: string): Promise<number> {
    // Dead-lettered food logs whose only blocker was the missing server-side
    // food item (the D-1 envelope drop): their FK check failed. Anything else
    // (quantity range, malformed payload) is left alone.
    const stranded = await querySQL<Record<string, unknown>>(
      `SELECT id, payload, date, created_at FROM mutations_outbox
        WHERE user_id = ? AND domain = 'food_logs' AND status = 'failed'
          AND last_error LIKE '%FK ownership check failed%'`,
      [userId],
    );
    let healed = 0;
    for (const row of stranded) {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(String(row.payload)); } catch { continue; }
      const foodItemId = typeof payload.foodItemId === 'string' ? payload.foodItemId : null;
      if (!foodItemId) continue;

      const items = await querySQL<Record<string, unknown>>(
        `SELECT * FROM food_items WHERE id = ?`, [foodItemId],
      );
      // No local item means the item data is gone — nothing to re-send. Leave the
      // log dead-lettered rather than pushing a log the server can never satisfy.
      if (!items.length) continue;
      const it = items[0];

      // Only queue the item once — a prior sweep (or the original log path) may
      // already have an outbox row for it.
      const existing = await querySQL<{ c: number }>(
        `SELECT COUNT(*) AS c FROM mutations_outbox
          WHERE user_id = ? AND domain = 'food_items' AND payload LIKE ?`,
        [userId, `%"id":"${foodItemId}"%`],
      );
      if (Number(existing[0]?.c ?? 0) === 0) {
        const itemPayload = {
          id: foodItemId,
          name: String(it.name),
          brand: it.brand != null ? String(it.brand) : undefined,
          servingSizeG: Number(it.serving_size_g),
          calories: Number(it.calories),
          proteinG: Number(it.protein_g),
          carbsG: Number(it.carbs_g),
          fatG: Number(it.fat_g),
          fiberG: it.fiber_g != null ? Number(it.fiber_g) : undefined,
          sugarG: it.sugar_g != null ? Number(it.sugar_g) : undefined,
          sodiumMg: it.sodium_mg != null ? Number(it.sodium_mg) : undefined,
          satFatG: it.sat_fat_g != null ? Number(it.sat_fat_g) : undefined,
          source: it.source != null ? String(it.source) : 'manual',
        };
        // Give the item the log's (older) timestamp so getPendingMutations, which
        // orders by created_at, always drains the item before the log it unblocks.
        await runSQL(
          `INSERT INTO mutations_outbox (id, user_id, domain, date, payload, created_at, attempts, last_error, status, next_retry_at)
           VALUES (?,?,?,?,?,?,0,NULL,'pending',NULL)`,
          [crypto.randomUUID(), userId, 'food_items', String(row.date),
           JSON.stringify(itemPayload), String(row.created_at)],
        );
      }
      // Re-open the log with a fresh (newer) timestamp so it sorts after the item.
      await runSQL(
        `UPDATE mutations_outbox
            SET status = 'pending', attempts = 0, next_retry_at = NULL, last_error = NULL,
                created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
        [String(row.id)],
      );
      healed++;
    }
    return healed;
  }

  async deleteMutations(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await runSQL(
      `DELETE FROM mutations_outbox WHERE id IN (${placeholders})`,
      ids,
    );
  }

  // Reuses the existing sync_meta table (migration v1)
  async getLastSyncAt(): Promise<Date> {
    const rows = await querySQL<{ value: string }>(
      `SELECT value FROM sync_meta WHERE key = 'lastSyncAt'`,
      [],
    );
    return rows.length ? new Date(rows[0].value) : new Date(0);
  }

  async setLastSyncAt(iso: string): Promise<void> {
    await runSQL(
      `INSERT INTO sync_meta (key, value) VALUES ('lastSyncAt', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [iso],
    );
  }
}
