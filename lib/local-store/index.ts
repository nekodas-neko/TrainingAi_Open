import { isSQLiteAvailable, isLocalStoreDead, runSQL, querySQL } from '@/lib/sqlite/sqlite-service';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession, LocalWorkoutSession,
  LocalActivityLog, LocalFitnessTest, LocalPrescribedRun, LocalProgram, LocalProgressionStyle, PendingMutation,
  LocalFoodLog, LocalFoodItem, LocalDayCheckin, LocalSupplement, LocalSupplementLog, LocalInjury,
  LocalExerciseLog, LocalSetLog, LocalPersonalRecord, LocalOuraDaily,
  LocalOuraDailySummary, LocalOuraDailyDerived, LocalOuraBucket, LocalOuraHeartratePoint,
  LocalProgramSession, LocalSessionExercise, LocalSchedule, LocalScheduleDay,
  LocalStyleSet, LocalSavedMeal, LocalSavedMealItem,
  LocalMealPlan, LocalMealPlanVariant, LocalMealPlanMeal, LocalPlanMealAnswer,
  LocalExerciseLibraryEntry, LocalMealType,
} from './types';
import type { LocalActiveProgram } from './program-assembler';
import type { LogExercisePayload } from '@trainingai/shared/workout/log-exercise';
import type { FoodLogWithItem, FoodItem, SavedMeal, MealPlan } from '@trainingai/shared/types/nutrition';

export interface LocalWorkoutHistory {
  session:      LocalWorkoutSession;
  exerciseLogs: Array<LocalExerciseLog & { sets: LocalSetLog[] }>;
}

export interface LocalStore {
  // Reads
  getBodyMetrics(cutoffDate: string): Promise<LocalBodyMetric[]>;
  getMoodLogs(cutoffDate: string): Promise<LocalMoodLog[]>;
  getSleepSessions(cutoffDate: string): Promise<LocalSleepSession[]>;
  getWorkoutSessions(cutoffDate: string): Promise<LocalWorkoutSession[]>;
  getActivityLogs(cutoffDate: string): Promise<LocalActivityLog[]>;
  getFitnessTests(cutoffDate: string): Promise<LocalFitnessTest[]>;
  getPrescribedRuns(cutoffDate: string): Promise<LocalPrescribedRun[]>;
  getPrograms(): Promise<LocalProgram[]>;
  getProgressionStyles(): Promise<LocalProgressionStyle[]>;
  getActiveProgramLocal(): Promise<LocalActiveProgram | null>;
  getFoodLogs(date: string): Promise<LocalFoodLog[]>;
  // Food logs joined to their local food_items — the offline render source.
  getFoodLogsWithItems(date: string): Promise<FoodLogWithItem[]>;
  // Local-first food-library search: matches previously-logged/created items in the
  // local food_items table by name/brand. Empty query returns the most recent items.
  searchFoodItems(query: string): Promise<FoodItem[]>;
  // Recent distinct food items logged to a given meal type (the logger quick-pick).
  getRecentFoodItemsForMeal(mealTypeId: string, limit: number): Promise<FoodItem[]>;
  // Saved meals (offline-first: create/edit/delete offline, read local-first).
  getSavedMeals(): Promise<SavedMeal[]>;
  upsertSavedMeal(meal: LocalSavedMeal, items: LocalSavedMealItem[]): Promise<void>;
  /** The active plan assembled from local rows, so the Nutrition section renders with no network. */
  getActiveMealPlan(): Promise<MealPlan | null>;
  /** Planned meals declined on a day (Q-187 phase 2). Local-first: the UI reads this, not the API. */
  getPlanMealAnswers(logDate: string): Promise<LocalPlanMealAnswer[]>;
  upsertPlanMealAnswer(a: LocalPlanMealAnswer & { syncStatus?: string }): Promise<void>;
  deletePlanMealAnswer(planMealId: string, logDate: string): Promise<void>;
  deleteSavedMealLocally(id: string, updatedAt: string): Promise<void>;
  markSavedMealSynced(id: string): Promise<void>;
  hydrateSavedMeals(serverMeals: SavedMeal[]): Promise<void>;
  getSupplements(): Promise<LocalSupplement[]>;
  getSupplementLogs(date: string): Promise<LocalSupplementLog[]>;
  getInjuries(): Promise<LocalInjury[]>;
  getExerciseLogs(workoutSessionId: string): Promise<LocalExerciseLog[]>;
  getSetLogs(exerciseLogId: string): Promise<LocalSetLog[]>;
  getWorkoutHistory(cutoffDate: string): Promise<LocalWorkoutHistory[]>;
  getStrandedPendingWorkouts(cutoffIso: string): Promise<LocalWorkoutHistory[]>;
  getPersonalRecords(): Promise<LocalPersonalRecord[]>;
  getPersonalRecord(exerciseName: string): Promise<LocalPersonalRecord | null>;
  getOuraDaily(cutoffDay: string): Promise<LocalOuraDaily[]>;
  getDayCheckin(logDate: string, phase: string): Promise<LocalDayCheckin | null>;

  // Local-first writes (write to store first, then queue for push)
  upsertBodyMetric(record: LocalBodyMetric): Promise<void>;
  upsertMoodLog(record: LocalMoodLog): Promise<void>;
  upsertFoodLog(record: LocalFoodLog): Promise<void>;
  upsertFoodItem(record: LocalFoodItem): Promise<void>;

  /** Mirror the exercise catalogue locally. Called from server responses that carry it, so
   *  the next offline read can type a row instead of assuming 'weighted' (Q-20). */
  upsertExerciseLibrary(entries: LocalExerciseLibraryEntry[]): Promise<void>;
  getExerciseLibrary(): Promise<LocalExerciseLibraryEntry[]>;

  /** Read-only meal-type mirror — full replace on every successful GET (editing is
   *  online-only, so there is never a pending local row a replace could clobber). */
  replaceMealTypes(entries: LocalMealType[]): Promise<void>;
  getMealTypes(): Promise<LocalMealType[]>;
  deleteFoodLog(id: string): Promise<void>;
  upsertSupplement(record: LocalSupplement): Promise<void>;
  markSupplementSynced(id: string): Promise<void>;
  upsertSupplementLog(record: LocalSupplementLog): Promise<void>;
  deleteSupplementLog(supplementId: string, logDate: string): Promise<void>;
  upsertInjury(record: LocalInjury): Promise<void>;
  deleteInjury(id: string): Promise<void>;
  upsertDayCheckin(record: LocalDayCheckin): Promise<void>;
  upsertActivityLog(record: LocalActivityLog): Promise<void>;
  /** Offline-capable delete — pair with a queued `activity_logs` `{ id, deleted: true }` (Q-328). */
  softDeleteActivityLogPending(id: string): Promise<void>;
  /** Confirm a queued activity-log mutation, so a tombstone becomes prunable (Q-328). */
  markActivityLogSynced(id: string): Promise<void>;
  upsertFitnessTest(record: LocalFitnessTest): Promise<void>;
  upsertPrescribedRun(record: LocalPrescribedRun): Promise<void>;
  logWorkoutLocally(payload: LogExercisePayload, syncStatus: 'pending' | 'synced'): Promise<void>;
  markWorkoutSynced(workoutSessionId: string, exerciseLogId: string): Promise<void>;
  setSessionRpe(workoutSessionId: string, rpe: number): Promise<void>;
  markSessionSynced(workoutSessionId: string): Promise<void>;
  // F4: flip sync_status for the three Oura push domains once a queued mutation is
  // server-confirmed. Narrow UPDATE-by-key (mirrors markSessionSynced), not a full
  // upsert — these domains have no local single-row write path yet (that's D2's
  // on-device rollup writer); flipping the flag doesn't need one. Currently inert:
  // nothing queues these mutations until D2 lands, but the arm is cheap+correct now.
  markSleepSessionSynced(id: string): Promise<void>;
  markOuraDailySummarySynced(day: string): Promise<void>;
  markOuraDailyDerivedSynced(day: string): Promise<void>;
  // D2 prep (Phase-1 Task 1): reads let anything local-first read Oura's device-computed
  // tables today; the upserts are the write path the future on-device rollup writer calls —
  // currently INERT (nothing local calls them yet, same "wired but unreachable" posture as
  // the F4 mark-synced arms above). A local write must go through queueMutation too once D2
  // registers these as real push domains — these upserts alone don't do that.
  getOuraDailySummary(fromDay: string, toDay: string): Promise<LocalOuraDailySummary[]>;
  upsertOuraDailySummary(record: LocalOuraDailySummary): Promise<void>;
  getOuraDailyDerived(fromDay: string, toDay: string): Promise<LocalOuraDailyDerived[]>;
  upsertOuraDailyDerived(record: LocalOuraDailyDerived): Promise<void>;
  getOuraBuckets(tier: string, fromMs: number, toMs: number): Promise<LocalOuraBucket[]>;
  upsertOuraBucket(record: LocalOuraBucket): Promise<void>;
  getOuraHeartrate(fromMs: number, toMs: number): Promise<LocalOuraHeartratePoint[]>;
  upsertOuraHeartrate(record: LocalOuraHeartratePoint): Promise<void>;
  completeWorkoutLocally(workoutSessionId: string, completedAt: string): Promise<void>;
  // Mirrors a server-confirmed history edit/delete into the local render source so
  // Stats/Health reflect it immediately instead of waiting for the next pull.
  deleteExerciseLogLocally(exerciseLogId: string): Promise<void>;
  updateExerciseLogLocally(exerciseLogId: string, sets: Array<{ setNumber: number; weightKg: number; reps: number; intensityPct?: number | null }>): Promise<void>;
  deleteWorkoutSessionLocally(workoutSessionId: string): Promise<void>;

  // Bulk write from delta sync
  applyDelta(delta: {
    bodyMetrics?:       LocalBodyMetric[];
    moodLogs?:          LocalMoodLog[];
    sleepSessions?:     LocalSleepSession[];
    workoutSessions?:   LocalWorkoutSession[];
    activityLogs?:      LocalActivityLog[];
    fitnessTests?:      LocalFitnessTest[];
    prescribedRuns?:    LocalPrescribedRun[];
    programs?:          LocalProgram[];
    programSessions?:   LocalProgramSession[];
    sessionExercises?:  LocalSessionExercise[];
    schedules?:         LocalSchedule[];
    scheduleDays?:      LocalScheduleDay[];
    progressionStyles?: LocalProgressionStyle[];
    styleSets?:         LocalStyleSet[];
    foodLogs?:          LocalFoodLog[];
    foodItems?:         LocalFoodItem[];
    supplements?:       LocalSupplement[];
    supplementLogs?:    LocalSupplementLog[];
    injuries?:          LocalInjury[];
    exerciseLogs?:      LocalExerciseLog[];
    setLogs?:           LocalSetLog[];
    personalRecords?:   LocalPersonalRecord[];
    ouraDaily?:         LocalOuraDaily[];
    ouraDailySummary?:  LocalOuraDailySummary[];
    ouraDailyDerived?:  LocalOuraDailyDerived[];
    dayCheckins?:       LocalDayCheckin[];
    mealPlans?:         LocalMealPlan[];
    mealPlanVariants?:  LocalMealPlanVariant[];
    mealPlanMeals?:     LocalMealPlanMeal[];
    planMealAnswers?:   LocalPlanMealAnswer[];
  }): Promise<void>;

  // Outbox
  queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'status' | 'nextRetryAt'>): Promise<void>;
  getPendingMutations(userId: string): Promise<PendingMutation[]>;
  getFailedMutations(userId: string): Promise<PendingMutation[]>;
  recordMutationFailures(failures: Array<{ id: string; error: string }>): Promise<void>;
  retryFailedMutation(id: string): Promise<void>;
  // One-shot heal for food logs stranded by the D-1 envelope bug: for each
  // dead-lettered food_logs mutation whose failure was the FK check, re-queue its
  // food_item (from the local row) ordered before the log, then reset the log to
  // pending. Idempotent and bounded. Returns the number of logs healed.
  requeueStrandedFoodItems(userId: string): Promise<number>;
  deleteMutations(ids: string[]): Promise<void>;

  // Sync meta
  getLastSyncAt(): Promise<Date>;
  setLastSyncAt(iso: string): Promise<void>;
}

// Per-user factory. Each call with the same userId returns the same instance.
const _stores = new Map<string, LocalStore>();

export function getLocalStore(userId: string): LocalStore | null {
  if (typeof window === 'undefined') return null;
  if (!isSQLiteAvailable()) return null;   // web users get online-only behavior
  // K4: the DB failed to open — a live (dead) store would silently no-op every
  // write. Return null so write sites take their API fallback (the same path web
  // uses) instead of losing data behind a success toast.
  if (isLocalStoreDead()) return null;
  if (!_stores.has(userId)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQLiteLocalStore } = require('./sqlite-backend') as typeof import('./sqlite-backend');
    _stores.set(userId, new SQLiteLocalStore());
  }
  return _stores.get(userId)!;
}

/**
 * Tables deliberately left alone on sign-out. Everything else is wiped, so a table added later is
 * cleared by default — the safe direction for a function whose whole job is not leaving one
 * account's data for the next.
 */
const KEEP_ON_SIGN_OUT = new Set([
  // The global exercise catalogue: identical for every account, and re-fetching it is a wasted
  // round-trip rather than a privacy question.
  'exercise_library',
  // Cleared by clearAllCache() in the same sign-out sequence, which also clears the
  // localStorage/sessionStorage mirrors this table alone would not reach.
  'api_cache',
]);

/**
 * Called on sign-out to prevent cross-user data leaks on shared devices.
 * On APK: clears every local data table. On web: SQLite unavailable, no-op.
 *
 * The table list is read from `sqlite_master` rather than hand-maintained. The hand-written version
 * had drifted to 27 of 37 tables (Q-172, measured 2026-08-10), leaving a previous account's
 * `oura_heartrate` samples, `oura_daily_summary`/`_derived`/`_bucket` rollups, `prescribed_runs`,
 * `meal_types` and `sync_outbox` on the device — the same drift `RECONCILE_TABLES` was once missing
 * 17 tables to. Reading the live schema also covers tables left behind by a partial upgrade, which
 * no static list can.
 */
export async function clearLocalStoreData(): Promise<void> {
  if (!isSQLiteAvailable()) return;
  const tables = await querySQL<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    [],
  );
  await Promise.all(
    tables
      .map(t => t.name)
      .filter(name => !KEEP_ON_SIGN_OUT.has(name))
      // Identifier interpolation is unavoidable — SQLite has no parameter form for a table name —
      // and safe here: every value comes from sqlite_master, never from user input.
      .map(name => runSQL(`DELETE FROM ${name}`, [])),
  );
  _stores.clear();
}
