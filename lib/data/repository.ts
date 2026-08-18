import type {
  User, Program, ProgressionStyle,
  WorkoutSession, ExerciseLog, SetLog, ExerciseHistoryLogRow,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, MoodLog,
  NextSessionRecommendation, GoalRecommendation,
} from '@trainingai/shared/types'
import type { ExerciseLibraryEntry, MuscleAssignment, ProgramPhase, ProgramPhaseType, PhaseSetWithPhases, ExerciseType } from '@trainingai/shared/types/program'
import type { HealthSource } from '@/lib/data/health-source'
import type { SetHrRow, RichSetMarker } from '@trainingai/shared/workout/set-hr-stats'
import type {
  MealType, FoodItem, FoodLog, FoodLogWithItem,
  SavedMeal, NutritionTargets,
  MealPlan, MealPlanMeal, DietaryRestriction, UserDietaryRestriction, DietarySeverity,
} from '@trainingai/shared/types/nutrition'
import type {
  CreateMealPlanInput, UpdateMealPlanInput, UpdateMealInput, ReplaceStructureInput, PlanMealAnswer,
} from './postgres/slices/meal-plans'
import type { Friendship, Season } from '@trainingai/shared/types/friends'
import type {
  SessionPeriodization, PeriodizationPhase, AiPrescription,
  Baseline1rmEntry, PendingTransition, PrescriptionStatus, ProgramVolumeTarget,
} from '@trainingai/shared/types/ai-periodization'
import type { TimeseriesCursor, TimeseriesPage, OuraHrDeltaRow, OuraBucketDeltaRow } from './postgres/slices/oura'

// Result of an upsert-by-client-id workout session write. `wasInserted` is false when a
// session with that id already existed — in that case the phase fields reflect what was
// already stamped on the row (from the first exercise logged into this session), not the
// caller's freshly-computed values, so every exercise in a session shares one phase.
export interface EnsuredWorkoutSession {
  id: string
  wasInserted: boolean
  phaseId?: string
  phaseType?: ProgramPhaseType
  isEarlyDeload: boolean
}

export interface OuraRawSampleInput {
  ringTimestampDs: number
  tag: number
  eventName: string
  bodyHex: string
  decoded: Record<string, unknown> | null
}

export type ScaleSampleStatus = 'confirmed' | 'pending' | 'dismissed'

export interface ScaleRawSampleInput {
  measuredAt: Date
  rawHex: string
  decoded: Record<string, unknown> | null
  status: ScaleSampleStatus
}

export interface ScalePendingSample {
  id: number
  measuredAt: Date
  decoded: Record<string, unknown> | null
}

/** Per-epoch staging detail for one BLE night — a tuning/diagnostic view of what the heuristic
 *  stager saw and decided, so the onset trim / wake detection / REM signal can be inspected against
 *  a real night's raw data (which only exists on-device). Populated only when aggregate is called
 *  with a matching `debugDate`. */
export interface SleepEpochDebug {
  epoch: number
  /** Local HH:mm of the epoch start. */
  time: string
  hr: number | null
  /** IBI beats binned into this epoch (drives whether hrVar is trustworthy). */
  beats: number
  movement: number | null
  hrv: number | null
  /** Within-epoch HR spread (SD of beat HRs) — the REM signal; null below 5 beats. */
  hrVar: number | null
  /** Breathing-rate irregularity (CV of breath timing from IBI) — a REM signal; null when sparse. */
  breathVar: number | null
  /** LF/HF frequency-domain HRV ratio — an independent REM signal; null when beats too sparse. */
  lfhf: number | null
  /** Within-epoch SpO₂ spread (SD, percentage points) — a REM/wake signal off the oximeter rather
   *  than the tachogram; null when the oximeter was too sparse in the epoch. */
  spo2Var: number | null
  stage: string
}
export interface SleepNightDebug {
  date: string
  windowStart: string
  windowEnd: string
  /** HR at/below which the onset trim counts an epoch as settled-asleep (median sleep HR + margin). */
  settleHr: number | null
  /** Index of the first epoch counted as asleep after the onset trim. */
  onsetEpoch: number
  epochs: SleepEpochDebug[]
  /** Neural SleepNet dump for the same night (admin device-validation harness); null if it fell back. */
  sleepNet?: import('@/lib/oura-models/sleepnet-assemble').SleepNetDump | null
}

export interface OuraRawAggregateResult {
  /** Sleep sessions written (bedtime windows found in the raw samples). */
  sleepSessions: number
  /** Distinct local days that received a body_metrics upsert. */
  bodyMetricDays: number
  /** The local days touched (YYYY-MM-DD). */
  daysWritten: string[]
  /** 5-min binned HR points materialized into oura_heartrate (source 'ble'). */
  hrSeriesPoints: number
  /** Local days that received a derived wear-time (non_wear_time_sec) upsert. */
  wearDays: number
  /** Per-step write failures (sleep/body_metrics/hr_series/wear); empty on success.
   *  Steps are isolated so one failing write never starves the others. */
  stepErrors: string[]
  /** Per-epoch staging detail for the night matching the requested `debugDate`, if any. */
  debugNight?: SleepNightDebug | null
}

/** One day the D0 historical step backfill (`allowStepsDecrease`) would change — a dry-run row, no
 *  write performed. Mirrors the real write's sourceMap rank protection exactly, so a listed day is
 *  guaranteed to actually change if the backfill runs, and an omitted day (e.g. `manual`-sourced)
 *  is guaranteed to be left untouched. */
export interface StepsBackfillPreviewRow {
  date: string
  oldSteps: number
  oldSource: string | null
  newSteps: number
}

export interface StepLiveWindow {
  id: number
  userId: string
  startDs: number
  endDs: number
  steps: number
  source: string
  createdAt: Date
}

export interface OuraRawSampleMetricTiming {
  /** Wall-clock time of the most recent sample of this metric (anchored). */
  latestAt: string | null
  /** Median seconds between consecutive events of this metric (measured cadence). */
  cadenceSec: number | null
  /** Number of events of this metric considered for the cadence estimate. */
  count: number
}

/** One newest decoded row per event type — the tester's "what exactly are we
 *  pulling" inspector. `decoded` is the full JSONB; `bodyHex` is the archival raw. */
export interface OuraRawSampleLatest {
  tag: number
  eventName: string
  measuredAt: string | null
  decoded: Record<string, unknown> | null
  bodyHex: string
}

/** A raw ring event row, for the tester's frame-dump diagnostic (cracking undecoded
 *  tags — e.g. hunting a step count across activity/step-feature frames). Ordered
 *  newest-first by ring clock; `bodyHex` is the archival raw the decode works from. */
export interface OuraRawSampleRow {
  ringTimestampDs: number
  tag: number
  eventName: string
  measuredAt: string | null
  decoded: Record<string, unknown> | null
  bodyHex: string
}

export interface OuraRawSampleSummary {
  totalEvents: number
  // Grouped by (tag, eventName) so undecoded tags stay distinct — all share the
  // eventName 'unknown', so the tag is what the tester renders (unknown_0x77).
  byEventName: { tag: number; eventName: string; count: number }[]
  latestHrBpm: number | null
  latestTempC: number | null
  latestHrvRmssd: number | null
  // Calibrated SpO₂ % (0x6f) only; r/PI (0x8b) is surfaced via the event
  // breakdown/inspector, not as a fake %.
  latestSpo2: { pct: number; calibrated: boolean } | null
  // Newest decoded row per event type, for the tester's field inspector.
  latestByTag: OuraRawSampleLatest[]
  newestRecordedAt: string | null
  // Wall-clock anchoring (the ring clock is monotonic deciseconds; the newest
  // drained event ≈ ingest time, so it anchors every older event to real time).
  clockAnchorDs: number | null
  clockAnchorUtc: string | null
  oldestMeasuredAt: string | null
  newestMeasuredAt: string | null
  hrTiming: OuraRawSampleMetricTiming
  tempTiming: OuraRawSampleMetricTiming
}

export interface WorkoutSensorProbe {
  sessionId: string
  windowStart: string
  windowEnd: string
  durationMin: number
  /** Continuous accel capture (oura_accel_chunks) overlapping the workout window. */
  accel: { chunks: number; samples: number; steps: number; coveragePct: number | null }
  /** oura_heartrate rows in the window. */
  hrSamples: number
  /** Raw BLE event tags present in the window (via the clock anchor), most frequent first. */
  rawByTag: { tag: string; count: number }[]
  hasAnchor: boolean
}

/**
 * Per-tag hour-of-day coverage of raw BLE samples — answers "does the ring stream daytime
 * motion/temp/MET when worn-idle, or only around sleep?" (the gate on the daytime-signal model
 * builds: steps, activity-detection, awake-HR, daytime stress). Read-only admin probe.
 */
export interface DaytimeTagCoverage {
  hasAnchor: boolean
  days: number
  tz: string
  /** Local hours [from, to) counted as "daytime" (the worn-idle window we care about). */
  daytimeHours: [number, number]
  tags: {
    tag: string          // '0x50'
    label: string        // 'MET'
    total: number
    daytime: number      // samples whose local hour ∈ daytimeHours
    night: number        // the rest
    byHour: number[]     // length 24 — sample count per local hour-of-day
  }[]
}

export interface SessionLoad {
  startedAt: Date
  isEarlyDeload: boolean
  phaseType: ProgramPhaseType | null
  volume: number
}

export interface YearReviewTotals {
  sessionCount: number
  totalSets: number
  totalVolumeKg: number
  totalMinutes: number
}

export interface YearReviewTopExercise {
  exerciseName: string
  setCount: number
  first1rm: number | null
  last1rm: number | null
  /** `'bodyweight'` means the 1RMs are a BW_REF-relative index, NOT kilograms — render via
   *  `displayOneRm`, never with a `kg` suffix. Null when the log has no library row. */
  exerciseType: string | null
}

export interface SyncDelta {
  programs:           unknown[];
  programSessions:    unknown[];
  sessionExercises:   unknown[];
  schedules:          unknown[];
  scheduleDays:       unknown[];
  progressionStyles:  unknown[];
  styleSets:          unknown[];
  bodyMetrics:        unknown[];
  sleepSessions:      unknown[];
  moodLogs:           unknown[];
  activityLogs:       unknown[];
  fitnessTests:       unknown[];
  prescribedRuns:     unknown[];
  workoutSessions:    unknown[];
  exerciseLogs:       unknown[];
  setLogs:            unknown[];
  personalRecords:    unknown[];
  ouraDaily:          unknown[];
  ouraDailySummary?:  unknown[];
  ouraDailyDerived?:  unknown[];
  foodItems?:         unknown[];
  foodLogs:           unknown[];
  supplements:        unknown[];
  supplementLogs:     unknown[];
  injuries:           unknown[];
  dayCheckins?:       unknown[];
  // Meal Plan (Q-186). Plans carry a tombstone so a delete reaches a device that has not synced;
  // variants and meals cascade with the plan and need none of their own.
  mealPlans?:         unknown[];
  mealPlanVariants?:  unknown[];
  mealPlanMeals?:     unknown[];
  // Q-187 phase 2. Carries its own tombstone, unlike variants/meals above: an answer is undoable
  // on its own, without the plan being deleted, so the reversal needs a channel of its own.
  planMealAnswers?:   unknown[];
  syncedAt:           string;
  hasMore?:           boolean;
}

export type MutationDomain =
  | 'body_metrics'
  | 'mood_logs'
  | 'food_logs'
  | 'food_items'
  | 'supplement_logs'
  | 'injuries'
  | 'supplements'
  | 'activity_logs'
  | 'fitness_tests'
  | 'prescribed_run'
  | 'workout_log'
  | 'day_checkins'
  | 'session_rpe'
  | 'complete_workout'
  | 'saved_meals'
  | 'oura_daily_summary'
  | 'oura_daily_derived'
  | 'sleep_session'
  | 'plan_meal_answers';

export interface FitnessTest {
  id: string
  userId: string
  testType: string
  date: string
  durationSec?: number
  distanceM?: number
  avgHr?: number
  maxHr?: number
  restingHr?: number
  hrr1Bpm?: number
  vo2maxEst?: number
  method?: string
  notes?: string
}

export interface RunningPlan {
  id: string; userId: string; goalKind: string; targetDistanceKm: number | null
  targetDate: string | null; frameworkKey: string; fitnessSnapshot: unknown
  timePerSessionMinutes: number | null
  isActive: boolean; createdAt: Date; updatedAt: Date
}
export interface RunningBaseline {
  id: string; userId: string; planId: string
  vo2max: number | null; maxHr: number | null; restingHr: number | null; thresholdHr: number | null
  weeklyBaseMinutes: number | null; easyPaceSecPerKm: number | null
  createdAt: Date
}
export interface PrescribedRun {
  id: string; userId: string; planId: string; date: string; runType: string
  durationMin: number | null; distanceKm: number | null
  targetHrLow: number | null; targetHrHigh: number | null; targetZoneIds: number[]
  rationale: string; gateAction: string; status: 'pending' | 'completed' | 'skipped'
  activityLogId: string | null; updatedAt: Date
}
export interface PrescribedRunUpdate {   // Zod-whitelisted PATCH body — never a raw request body into .set()
  status?: 'completed' | 'skipped'
  activityLogId?: string | null
}

export interface IncomingMutation {
  id?:     string;   // client outbox row id — echoed back in per-item errors
  domain:  MutationDomain;
  date:    string;
  payload: Record<string, unknown>;
}

export interface PushResult {
  processed: number;
  errors:    Array<{ id?: string; domain: string; date: string; error: string }>;
}

export interface UserGoals {
  stepsGoal: number | null
  stepsGoalType: 'daily' | 'weekly' | null
  sleepGoalHours: number | null
  calorieGoal: number | null
  calorieGoalType: 'daily' | 'weekly' | null
  waterGoalMl: number | null
  waterGoalType: 'daily' | 'weekly' | null
  targetWeightKg: number | null
  targetBfPct: number | null
}

export interface UnitFixSetChange {
  setNumber: number
  reps: number
  oldWeightKg: number
  newWeightKg: number
}

export interface UnitFixLogChange {
  exerciseLogId: string
  exerciseName: string
  loggedAt: Date
  oldEstimated1rm: number | null
  newEstimated1rm: number | null
  oldVolume: number | null
  newVolume: number | null
  sets: UnitFixSetChange[]
}

export interface UnitFixExerciseSummary {
  exerciseName: string
  oldPersonalRecord: number | null
  newPersonalRecord: number | null
}

export interface UnitFixResult {
  logs: UnitFixLogChange[]
  exercises: UnitFixExerciseSummary[]
}

// Daily Body Battery snapshot — see migration 100 + docs/body-battery-tuning.md.
export interface BodyBatteryDailyRow {
  date: string                 // 'YYYY-MM-DD' (user's local day)
  anchor: number
  anchorSource: string         // 'readiness' | 'sleep' | 'default'
  endValue: number
  dayMin: number
  dayMax: number
  totalCharged: number
  totalDrained: number
  restingHr: number
  hrMax: number
  hrMaxObserved: number | null
  hrSampleCount: number
  modelVersion: string
}

/** The prescription basis for one exercise: its last NON-DELOAD estimate, plus that same
 *  session's target-80 so the displayed target and the weight dial don't read a deload's 0. */
export interface LastRealOneRm {
  estimated1rm: number
  target80: number | null
}

export interface WorkoutRepository {
  // ── Users ──────────────────────────────────────────────────────────────────
  upsertUser(user: Omit<User, 'id' | 'createdAt' | 'isActive' | 'isAdmin'>, forceActive?: boolean): Promise<User>
  isUserActive(userId: string): Promise<boolean>
  listUsers(limit?: number, offset?: number): Promise<User[]>
  countInactiveUsers(): Promise<number>
  activateUser(userId: string): Promise<void>
  deactivateUser(userId: string): Promise<void>
  getUserById(userId: string): Promise<User | null>
  deleteUser(userId: string): Promise<void>
  getUserByEmail(email: string): Promise<(User & { passwordHash?: string }) | null>
  updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex' | 'activityLevel' | 'fitnessGoal'>>): Promise<User>
  touchLastGoalReviewAt(userId: string): Promise<void>
  updateUserAvatar(userId: string, avatar: string): Promise<User>
  updateUserPassword(userId: string, passwordHash: string): Promise<void>
  linkOAuthAccount(userId: string, oauthSub: string): Promise<void>
  getTimingBaselineDate(userId: string): Promise<string | null>
  setTimingBaselineDate(userId: string, date: string | null): Promise<void>
  createEmailUser(email: string, passwordHash: string, name?: string, isActive?: boolean): Promise<User>

  // ── Invites ────────────────────────────────────────────────────────────────
  listInvites(): Promise<string[]>
  addInvite(email: string): Promise<void>
  removeInvite(email: string): Promise<void>
  isInvited(email: string): Promise<boolean>

  // ── Programs ───────────────────────────────────────────────────────────────
  getActiveProgram(userId: string): Promise<Program | null>
  listPrograms(userId: string): Promise<Program[]>
  saveProgram(userId: string, program: Program): Promise<Program>
  deleteProgram(userId: string, programId: string): Promise<void>
  // Permanently remove a single session exercise (Workout Review "drop permanently").
  // Ownership is enforced by the query (the row's session must belong to a program the
  // user owns). Returns true if a row was deleted. Program structure is a synced pull
  // domain, so the deletion propagates to offline clients on their next pull.
  removeSessionExercise(userId: string, sessionExerciseId: string): Promise<boolean>

  // ── Scheduling ─────────────────────────────────────────────────────────────
  getNextSession(userId: string, timezone?: string): Promise<NextSessionRecommendation>

  // ── Progression Styles ─────────────────────────────────────────────────────
  listProgressionStyles(userId: string): Promise<ProgressionStyle[]>
  saveProgressionStyle(userId: string, style: ProgressionStyle): Promise<ProgressionStyle>
  deleteProgressionStyle(userId: string, styleId: string): Promise<void>

  // ── Block Periodization ────────────────────────────────────────────────────
  listProgramPhases(userId: string, programId: string): Promise<ProgramPhase[]>
  listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]>
  createPhaseSet(userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
  updatePhaseSet(phaseSetId: string, userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
  deletePhaseSet(phaseSetId: string, userId: string): Promise<void>
  createOwnedPhaseSetClone(userId: string, templateBaseName: string, programName: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
  linkPhaseSetOwnership(phaseSetId: string, programId: string, userId: string): Promise<void>
  updateProgramPhaseSettings(programId: string, userId: string, settings: {
    phaseMode?: 'manual' | 'automatic' | 'ai_dynamic'
    startedAt?: string | null
    sessionsPerCycle?: number | null
    phaseSetId?: string | null
  }): Promise<void>
  countSessionsSinceStart(userId: string, programId: string): Promise<number>
  // Map is keyed by program-session id (workout_sessions.session_id), not session name (WK-15).
  countAllSessionsSinceStart(userId: string, programId: string): Promise<Map<string, number>>
  autoRecalibrateCycleAnchor(userId: string, programId: string): Promise<void>
  getActiveProgramWithPhases(userId: string): Promise<{ program: Program; phases: ProgramPhase[] } | null>
  confirmEarlyDeload(userId: string, programId: string, today: string): Promise<void>

  // ── Workout Logging ────────────────────────────────────────────────────────
  createWorkoutSession(userId: string, sessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean): Promise<WorkoutSession>
  // Returns true if a new row was inserted, false if a session with this id already existed
  ensureWorkoutSession(userId: string, sessionId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date, phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload?: boolean, intensityMode?: 'full' | 'deload' | null, wasOverride?: boolean): Promise<EnsuredWorkoutSession>
  completeWorkoutSession(workoutSessionId: string, userId: string, completedAt: Date): Promise<void>
  setSessionRpe(userId: string, workoutSessionId: string, rpe: number): Promise<void>
  setWorkoutSessionWarmupEnd(userId: string, workoutSessionId: string, warmupEndedAt: Date): Promise<void>
  logExercise(log: Omit<ExerciseLog, 'id' | 'sets'>): Promise<ExerciseLog>
  logExerciseAndSets(
    userId: string,
    log: Omit<ExerciseLog, 'id' | 'sets'> & { exerciseLogId?: string },
    sets: (Omit<SetLog, 'id' | 'exerciseLogId'> & { id?: string })[],
  ): Promise<{ exerciseLog: ExerciseLog; setLogs: SetLog[] }>

  // ── Body & Activity ────────────────────────────────────────────────────────
  upsertBodyMetrics(userId: string, metrics: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[], source: HealthSource): Promise<void>
  listBodyMetrics(userId: string, from: string, to: string): Promise<BodyMetrics[]>
  // Earliest-ever logged weight/body-fat values — "starting point" for long-term goal progress.
  getBodyMetricsBaseline(userId: string): Promise<{ weightKg: number | null; bodyFatPct: number | null }>

  // ── Direct-BLE scale (docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md) ────────
  /** Most recent confirmed weight — the anomaly-check baseline for a new scale reading. */
  getMostRecentConfirmedWeightKg(userId: string): Promise<number | null>
  insertScaleRawSample(userId: string, sample: ScaleRawSampleInput): Promise<{ id: number }>
  listPendingScaleSamples(userId: string): Promise<ScalePendingSample[]>
  /** The scale-set body_metrics weight for a date, or null if no scale reading has set one.
   *  The day's **lowest** confirmed reading wins the trend (Q-69) — clothes only ever add weight,
   *  so a later nude reading coming in lower should replace an earlier clothed one. Callers need
   *  the value, not just its existence, to make that comparison. */
  getConfirmedScaleTrendForDate(userId: string, date: string): Promise<{ weightKg: number } | null>
  /** All of today's confirmed scale readings (full composition), oldest first, for a same-day
   *  "morning / evening" list. The trend is whichever is lowest, NOT the first — match on value. */
  listConfirmedScaleSamplesForDate(userId: string, date: string, tz: string): Promise<ScalePendingSample[]>
  /** Ownership-checked; returns the row (for the caller to run composition + upsertBodyMetrics)
   *  or null if no matching pending row exists for this user. */
  confirmScaleSample(userId: string, id: number): Promise<ScalePendingSample | null>
  /** Ownership-checked; returns whether a matching pending row was found and dismissed. */
  dismissScaleSample(userId: string, id: number): Promise<boolean>
  saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'> & { id?: string }, opts?: { overwrite?: boolean }): Promise<ActivityLog>
  listActivityLogs(userId: string, from: string, to: string): Promise<ActivityLog[]>
  /** Ownership-checked single row; the metrics PATCH needs the stored duration to rate-check a patch. */
  getActivityLogById(userId: string, id: string): Promise<ActivityLog | null>
  updateActivityLogMetrics(userId: string, id: string, patch: { distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number }): Promise<void>
  deleteActivityLog(userId: string, id: string): Promise<void>
  saveFitnessTest(userId: string, test: Omit<FitnessTest, 'userId'>): Promise<FitnessTest>
  listFitnessTests(userId: string, from: string, to: string): Promise<FitnessTest[]>
  deleteFitnessTest(userId: string, id: string): Promise<void>
  getActiveRunningPlan(userId: string): Promise<RunningPlan | null>
  saveRunningPlan(userId: string, plan: Omit<RunningPlan, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RunningPlan>
  saveRunningBaseline(userId: string, baseline: Omit<RunningBaseline, 'id' | 'userId' | 'createdAt'>): Promise<RunningBaseline>
  getRunningBaseline(userId: string, planId: string): Promise<RunningBaseline | null>
  getPrescribedRuns(userId: string, from: string, to: string): Promise<PrescribedRun[]>
  upsertPrescribedRun(userId: string, run: Omit<PrescribedRun, 'userId' | 'updatedAt'>): Promise<PrescribedRun>
  updatePrescribedRun(userId: string, id: string, patch: PrescribedRunUpdate): Promise<PrescribedRun | null>
  listActivityTypes(): Promise<ActivityType[]>
  createActivityType(data: { label: string; icon: string; isDistanceBased: boolean; sortOrder: number }): Promise<ActivityType>
  updateActivityType(id: string, patch: Partial<{ label: string; icon: string; isDistanceBased: boolean; sortOrder: number }>): Promise<ActivityType>
  deleteActivityType(id: string): Promise<void>
  /** `source` is required, not optional: it decides the per-field rank merge in `source_map`.
   *  A caller left on a default would silently write rank-0 and win over the ring forever. */
  saveSleepSession(userId: string, session: Omit<SleepSession, 'id' | 'userId' | 'createdAt'>, source: HealthSource): Promise<void>
  listSleepSessions(userId: string, from: string, to: string): Promise<SleepSession[]>
  listMoodLogs(userId: string, from: string, to: string): Promise<MoodLog[]>
  incrementWaterLog(userId: string, date: string, ml: number): Promise<void>
  getUserGoals(userId: string): Promise<UserGoals>
  updateUserGoals(userId: string, goals: Partial<UserGoals>): Promise<void>

  // ── Personal Records ───────────────────────────────────────────────────────
  getPersonalRecord(userId: string, exerciseName: string): Promise<{ estimated1rm: number } | null>
  // `upsertPersonalRecord` (unconditional, no IfBetter gate) is deliberately NOT on this
  // interface. It exists only inside the adapter, called by `reconcilePersonalRecord` after
  // it has derived the best value from the logs. Exposing it is what let a route rewrite a
  // personal record with a hand-typed number (Q-5).
  upsertExerciseEstimate(userId: string, exerciseName: string, estimated1rm: number): Promise<void>
  getExerciseEstimates(userId: string): Promise<{ exerciseName: string; estimated1rm: number }[]>
  upsertPersonalRecordIfBetter(userId: string, exerciseName: string, estimated1rm: number): Promise<boolean>
  // Recompute the all-time PR for an exercise from surviving exercise_logs (excluding
  // deload sessions) — corrects PRs downward after an edit/delete.
  reconcilePersonalRecord(userId: string, exerciseName: string): Promise<void>
  listRecentPersonalRecords(userId: string, from: Date, to: Date): Promise<{ exerciseName: string; estimated1rm: number; achievedAt: Date; exerciseType: string | null }[]>
  // All-time best estimated1rm per exercise, keyed by exercise name.
  listPersonalRecords(userId: string): Promise<Map<string, number>>
  // All-time max reps logged per exercise, keyed by exercise name.
  listMaxReps(userId: string): Promise<Map<string, number>>
  // Second-most-recent estimated 1RM per exercise, keyed by exercise name (for trend detection).
  listPrevious1rm(userId: string): Promise<Map<string, number>>

  // ── Data Tools ─────────────────────────────────────────────────────────────
  // Distinct exercise names the user has ever logged a set for.
  listLoggedExerciseNames(userId: string): Promise<string[]>
  // Converts set weights mistakenly logged as lbs-but-labelled-kg back to true kg,
  // for every exercise_log strictly before `beforeDate` (in `tz`). Recalculates
  // estimated1rm/target80/volume/intensity per affected log and the per-exercise
  // personal record. `previewLbsToKgFix` computes the change without writing;
  // `applyLbsToKgFix` persists it inside a single transaction.
  previewLbsToKgFix(userId: string, exerciseNames: string[], beforeDate: string, tz?: string): Promise<UnitFixResult>
  applyLbsToKgFix(userId: string, exerciseNames: string[], beforeDate: string, tz?: string): Promise<UnitFixResult>

  // ── Queries ────────────────────────────────────────────────────────────────
  getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
  getCalendarData(userId: string, year: number, month: number, timezone?: string): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>
  // Rolling-window trained-day map (not month-aligned) for streak/week-strip
  // widgets that must not lose data at calendar-month boundaries.
  getRecentTrainedDays(userId: string, days: number, timezone?: string): Promise<Record<string, string[]>>
  getDayLog(userId: string, date: string): Promise<WorkoutSession[]>
  // Lightweight alternative to getDayLog for "already logged today" checks —
  // single join, no nested exercises/sets.
  getDayExerciseNames(userId: string, date: string): Promise<{ sessionId?: string; exerciseName: string }[]>
  // Lightweight alternative to getDayLog for the HR-chart "Workout" overlay band —
  // session-columns-only, no nested exercise/set trees. Excludes sessions with zero
  // logged exercises (abandoned starts) via an EXISTS check, matching getDayLog's
  // existing consumer-side filter.
  getDaySessionSummaries(userId: string, date: string): Promise<{ sessionId?: string; sessionName: string; startedAt: Date; completedAt?: Date }[]>
  // Batched ownership lookups for sync-time IDOR checks — returns a map of
  // row id -> owning userId for whichever of the given ids already exist.
  getWorkoutSessionOwners(sessionIds: string[]): Promise<Map<string, string>>
  getExerciseLogOwners(exerciseLogIds: string[]): Promise<Map<string, string>>
  getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]>
  // Lightweight alternative to getWorkoutSessionsFrom for training-load aggregates —
  // sums exercise_logs.volume in SQL instead of hydrating full exercise/set_log trees.
  getSessionLoadsFrom(userId: string, from: Date): Promise<SessionLoad[]>
  // Year-in-review aggregates — session/set/volume/minute totals and top-5
  // exercises by set count, each one grouped SQL query (no full-tree hydration).
  getYearReviewTotals(userId: string, from: Date): Promise<YearReviewTotals>
  getYearReviewTopExercises(userId: string, from: Date, limit: number): Promise<YearReviewTopExercise[]>
  getLastExerciseLog(userId: string, exerciseName: string): Promise<ExerciseLog | null>
  // programId optionally scopes to sessions belonging to that program only — used by the
  // ai_dynamic baseline auto-heal so a shared exercise name from a *different* program's
  // history can't skip a fresh cycle's AMRAP baseline week.
  getLastExerciseLogsBatch(userId: string, exerciseNames: string[], programId?: string): Promise<Map<string, ExerciseLog>>
  /** Last non-deload 1RM per exercise — the prescription basis (Q-202). Distinct from the
   *  method above, which still returns the genuinely most recent log for display. */
  getLastRealOneRmBatch(userId: string, exerciseNames: string[], programId?: string): Promise<Map<string, LastRealOneRm>>
  getExerciseSummary(userId: string): Promise<ExerciseLog[]>
  // Exercise-history sheet: the last `limit` logs for one exercise, filtered in SQL
  // against idx_el_name_date_ws instead of hydrating N days of full session trees.
  getExerciseHistoryRows(userId: string, exerciseName: string, limit: number): Promise<ExerciseHistoryLogRow[]>

  // ── Exercise Library ───────────────────────────────────────────────────────
  listExerciseLibrary(): Promise<ExerciseLibraryEntry[]>
  // Lightweight projection for muscle-recovery, which only ever reads name/muscles.
  listExerciseMuscleMap(): Promise<Pick<ExerciseLibraryEntry, 'name' | 'muscles'>[]>
  getExerciseType(exerciseName: string): Promise<ExerciseType>
  upsertExercise(entry: Omit<ExerciseLibraryEntry, 'id'> & { id?: string }): Promise<ExerciseLibraryEntry>
  deleteExercise(name: string): Promise<void>
  renameExerciseRefs(oldName: string, newName: string): Promise<void>
  createExercise(entry: { name: string; muscles: MuscleAssignment[]; equipment: string[]; instructions?: string; createdBy: string; exerciseType?: ExerciseType }): Promise<ExerciseLibraryEntry>
  renameExercise(userId: string, id: string, newName: string): Promise<ExerciseLibraryEntry>
  // Admin-only edit that may rename the exercise (any library entry, regardless of
  // who created it). If `name` differs from the current name, cascades the rename
  // across session_exercises, exercise_logs, personal_records and exercise_gif_cache
  // (all keyed by exercise name) in the same transaction, so program references and
  // historical PRs/1RM history follow the exercise under its new name. Throws if
  // `name` collides with a different existing library entry.
  adminUpdateExercise(entry: { id: string; name: string; muscles: MuscleAssignment[]; equipment: string[]; instructions?: string; exerciseType?: ExerciseType }): Promise<ExerciseLibraryEntry>
  getExerciseMuscleAssignments(names: string[]): Promise<Record<string, MuscleAssignment[]>>
  getExerciseEquipment(names: string[]): Promise<Record<string, string[]>>
  /** name -> exercise_type, so a prompt can render a bodyweight 1RM as reps rather than kg (Q-19b). */
  getExerciseTypes(names: string[]): Promise<Record<string, string>>
  getTimingAuditData(userId: string, sinceDays: number): Promise<{
    sets: import('@trainingai/shared/workout/time-audit').TimingSetRow[]
    exercises: import('@trainingai/shared/workout/time-audit').TimingExerciseRow[]
    sessions: import('@trainingai/shared/workout/time-audit').TimingSessionRow[]
  }>

  // ── Mood ──────────────────────────────────────────────────────────────────
  getMoodLog(userId: string, date: string): Promise<import('@trainingai/shared/types/mood').MoodLog | null>
  saveMoodLog(userId: string, log: Omit<import('@trainingai/shared/types/mood').MoodLog, 'id' | 'userId' | 'createdAt'>): Promise<import('@trainingai/shared/types/mood').MoodLog>

  // ── Day check-in (End of Day review) ────────────────────────────────────────
  getDayCheckin(userId: string, logDate: string, phase: string): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin | null>
  listDayCheckins(userId: string, from: string, to: string, phase: string): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin[]>
  saveDayCheckin(userId: string, checkin: Omit<import('@trainingai/shared/types/day-checkin').DayCheckin, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin>

  countWorkoutSessions(userId: string): Promise<number>

  // ── Nutrition ──────────────────────────────────────────────────────────────
  listMealTypes(userId: string): Promise<MealType[]>
  createMealType(userId: string, data: Omit<MealType, 'id' | 'userId' | 'createdAt'>): Promise<MealType>
  updateMealType(id: string, userId: string, data: Partial<Omit<MealType, 'id' | 'userId' | 'createdAt'>>): Promise<MealType>
  deleteMealType(id: string, userId: string): Promise<void>
  reorderMealTypes(userId: string, orderedIds: string[]): Promise<void>
  seedDefaultMealTypes(userId: string): Promise<void>

  createFoodItem(userId: string, data: Omit<FoodItem, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<FoodItem>
  searchFoodItems(userId: string, query: string): Promise<FoodItem[]>

  listFoodLogs(userId: string, date: string): Promise<FoodLogWithItem[]>
  listFoodLogsSummary(userId: string, from: string, to: string): Promise<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>
  listLatestMealTimes(userId: string, from: string, to: string): Promise<{ date: string; latestLoggedAt: Date }[]>
  // Per-day count of distinct *required* meal types logged, for the nutrition
  // adherence metric — pairs with computeAdherenceRatio in lib/nutrition/adherence.ts.
  getRequiredMealTypeLogDays(userId: string, from: string, to: string): Promise<{ requiredMealTypeCount: number; loggedByDay: { date: string; requiredMealTypesLogged: number }[] }>
  listRecentFoodItemsForMealType(userId: string, mealTypeId: string, limit: number): Promise<FoodItem[]>
  createFoodLog(userId: string, data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'> & { id?: string; loggedAt?: Date }): Promise<FoodLog>
  foodLogRefsValid(userId: string, mealTypeId: string, foodItemId: string): Promise<boolean>
  updateFoodLog(id: string, userId: string, quantityMultiplier: number): Promise<FoodLog>
  deleteFoodLog(id: string, userId: string): Promise<void>

  listSavedMeals(userId: string): Promise<SavedMeal[]>
  createSavedMeal(userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], id?: string, servings?: number): Promise<SavedMeal>
  updateSavedMeal(id: string, userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], servings?: number): Promise<SavedMeal>
  deleteSavedMeal(id: string, userId: string): Promise<void>

  // ── Meal Plan (Q-186) ────────────────────────────────────────────────────────
  // Variants and meals carry no user_id; every write below proves ownership by joining back to
  // meal_plans (two levels deep for a meal) rather than trusting the id from the request.
  listMealPlans(userId: string): Promise<MealPlan[]>
  getMealPlan(id: string, userId: string): Promise<MealPlan | null>
  getActiveMealPlan(userId: string): Promise<MealPlan | null>
  createMealPlan(userId: string, input: CreateMealPlanInput): Promise<MealPlan>
  updateMealPlan(id: string, userId: string, input: UpdateMealPlanInput): Promise<MealPlan | null>
  setMealPlanActive(id: string, userId: string, active: boolean): Promise<MealPlan | null>
  /** Soft delete — a hard DELETE never reaches a device that has not synced. */
  deleteMealPlan(id: string, userId: string): Promise<boolean>
  getMealPlanMeal(mealId: string, userId: string): Promise<MealPlanMeal | null>
  updateMealPlanMeal(mealId: string, userId: string, input: UpdateMealInput): Promise<MealPlanMeal | null>
  /** Rebuild a plan's variants and meals after a meal-count or training-time change. */
  replaceMealPlanStructure(id: string, userId: string, input: ReplaceStructureInput): Promise<MealPlan | null>
  markMealPlanReviewed(id: string, userId: string): Promise<boolean>
  mealPlanNeedsReview(userId: string, days: number): Promise<boolean>
  /**
   * Record that a planned meal was NOT eaten on a day (Q-187 phase 2).
   *
   * Only declines are stored — "I ate it" is derivable from the food log, and storing both would be
   * two sources of truth for one fact. Returns null when the plan meal is not the caller's, which
   * the route answers as a 404 rather than revealing whether the id exists.
   */
  savePlanMealAnswer(userId: string, input: { id?: string; planMealId: string; logDate: string }): Promise<PlanMealAnswer | null>
  /** Undo a decline. Soft, so the reversal reaches a device that has not synced. */
  deletePlanMealAnswer(userId: string, planMealId: string, logDate: string): Promise<boolean>
  listPlanMealAnswers(userId: string, logDate: string): Promise<PlanMealAnswer[]>
  listDietaryRestrictions(): Promise<DietaryRestriction[]>
  listUserDietaryRestrictions(userId: string): Promise<UserDietaryRestriction[]>
  replaceUserDietaryRestrictions(userId: string, entries: { restrictionId: string; severity: DietarySeverity }[]): Promise<UserDietaryRestriction[]>

  getNutritionTargets(userId: string): Promise<NutritionTargets | null>
  upsertNutritionTargets(userId: string, data: Omit<NutritionTargets, 'id' | 'userId' | 'updatedAt'>): Promise<NutritionTargets>

  // ── Goal Recommendations ───────────────────────────────────────────────────
  createGoalRecommendation(userId: string, data: Omit<GoalRecommendation, 'id' | 'userId' | 'createdAt' | 'status' | 'appliedAt' | 'dismissedAt'>): Promise<GoalRecommendation>
  getGoalRecommendation(userId: string, id: string): Promise<GoalRecommendation | null>
  updateGoalRecommendationStatus(userId: string, id: string, status: 'applied' | 'dismissed'): Promise<void>

  // ── Friends ────────────────────────────────────────────────────────────────
  listFriendships(userId: string): Promise<Friendship[]>
  sendFriendRequest(requesterId: string, emailOrCode: string): Promise<Friendship>
  acceptFriendRequest(friendshipId: string, userId: string): Promise<Friendship>
  declineFriendRequest(friendshipId: string, userId: string): Promise<void>
  removeFriend(friendshipId: string, userId: string): Promise<void>
  getFriendIds(userId: string): Promise<string[]>
  updateEquippedTitle(userId: string, titleId: string | null): Promise<void>

  // ── Seasons ────────────────────────────────────────────────────────────────
  listSeasonsWithResults(userId: string): Promise<Season[]>

  // ── AI Health Insights ─────────────────────────────────────────────────────
  getAiHealthInsight(userId: string, section: string, date: string): Promise<string | null>
  // contextHash lets a non-forced request recompute the cheap deterministic context and only
  // serve the cache when it matches — see NUT-7 (daily-digest staleness).
  getAiHealthInsightWithHash(userId: string, section: string, date: string): Promise<{ insight: string; contextHash: string | null } | null>
  upsertAiHealthInsight(userId: string, section: string, date: string, insight: string, contextHash?: string): Promise<void>
  deleteAiHealthInsight(userId: string, section: string): Promise<void>

  // ── Sync ───────────────────────────────────────────────────────────────────
  // windowDays: number = recent floor (default 90); null = full history (restore path), honouring `since`.
  getSyncDelta(userId: string, since: Date, windowDays?: number | null, pageLimit?: number): Promise<SyncDelta>;
  pushMutations(userId: string, mutations: IncomingMutation[]): Promise<PushResult>;

  // ── Feedback ───────────────────────────────────────────────────────────────
  createFeedback(userId: string, data: { type: string; title: string; description?: string | null; screenshotData?: string | null }): Promise<void>
  listFeedback(): Promise<{ id: string; type: string; title: string; description: string | null; screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null }[]>
  deleteFeedback(id: string): Promise<void>
  countFeedback(): Promise<number>

  // ── Error events ─────────────────────────────────────────────────────────────
  insertErrorEvent(event: { userId: string | null; source: 'client' | 'server'; message: string; stack?: string | null; url?: string | null; userAgent?: string | null }): Promise<void>
  listErrorEvents(limit: number): Promise<{ id: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null; createdAt: string; userEmail: string | null }[]>

  // ── AI call observability (ai_call_log) ──────────────────────────────────────
  insertAiCallLog(row: AiCallLogInput): Promise<void>
  getAiCallUsageSummary(sinceHours: number, windowSeconds: number, bucketHours: number): Promise<AiCallUsageSummary>

  // ── Direct-BLE raw ring samples (Phase 3+4) ──────────────────────────────────
  insertOuraRawSamples(userId: string, rows: OuraRawSampleInput[]): Promise<number>
  getOuraRawSampleSummary(userId: string): Promise<OuraRawSampleSummary>
  /** Recent raw rows for the given event tags, newest-first by ring clock — the
   *  frame-dump diagnostic for cracking undecoded tags (all frames, not the
   *  inspector's newest-per-tag). Empty tags returns []. */
  getOuraRawSamplesByTags(userId: string, tags: number[], limit: number): Promise<OuraRawSampleRow[]>
  /** Decoded raw samples for the given tags over the last `days`, ordered by measured_at ASC.
   *  Windowed on the ingest-stamped measured_at (no anchor math) — feeds the admin device-metrics
   *  compute-on-read route. Rows with a null decoded/measured_at are excluded. */
  getOuraRawSamplesForTags(userId: string, tags: number[], days: number): Promise<OuraRawSampleRow[]>
  /** Phase-B feasibility probe: what motion/HR the ring captured during one workout's window
   *  (accel-chunk coverage, HR count, raw tags present) — tells us whether the neural energy
   *  model's inputs are capturable during waking workouts. Read-only diagnostic. */
  getWorkoutSensorProbe(userId: string, sessionId?: string): Promise<WorkoutSensorProbe | null>
  /** Per-tag hour-of-day coverage of raw BLE samples over the last `days`, for confirming whether
   *  the ring streams daytime motion/temp/MET when worn-idle. Read-only admin probe. */
  getDaytimeTagCoverage(userId: string, tz: string, days: number): Promise<DaytimeTagCoverage>
  /** oura_heartrate rows in a wall-clock window, filtered by source ('ble' = ring, 'chest_strap' =
   *  Polar H10). D6 comparison-harness read — both sources already land in this one table. */
  getOuraHeartrateBySource(userId: string, source: string, from: Date, to: Date): Promise<{ timestamp: Date; bpm: number }[]>
  /** Daytime skin-temperature (0x46/0x69 → temps_c) and MET (0x50 → met) samples in a wall-clock
   *  window, for the daytime-stress engine. Empty when the ring has no clock anchor. */
  getOuraDaytimeSignals(userId: string, from: Date, to: Date): Promise<{
    temp: { tsMs: number; valueC: number }[]
    met: { tsMs: number; value: number }[]
  }>
  /** Decoded 0x61 battery telemetry (level changes + charging-time) in a wall-clock window,
   *  anchored via the ring clock. Empty when the ring has no clock anchor. Read-only. */
  getOuraBatteryEvents(userId: string, from: Date, to: Date): Promise<Array<{
    tsMs: number
    kind: 'battery_level_changed' | 'charging_time'
    batteryPct: number | null
    voltageMv: number | null
    chargingTimeSec: number | null
  }>>
  /** Persist one live keepalive battery poll (migration 133) — fine-grained drain telemetry
   *  captured only while the app holds the BLE link. measured_at is server-stamped. */
  insertOuraBatteryPoll(userId: string, percent: number, charging: boolean | null): Promise<void>
  getOuraBatteryPolls(userId: string, from: Date, to: Date): Promise<Array<{ tsMs: number; percent: number; charging: boolean | null }>>
  /** Re-run the event decoders over stored body_hex (new/fixed decoders backfill
   *  retroactively without re-syncing the ring). Returns scan/update counts. */
  /** `restamped` counts rows whose `measured_at` actually CHANGED. It must fall to ~0 on a second
   *  pass — a non-zero count on an unchanged anchor means the write guard has regressed, and this
   *  table's indexes bloat by ~4 entries per needless row (Q-46). */
  redecodeOuraRawSamples(userId: string): Promise<{ scanned: number; updated: number; restamped: number }>
  /** Roll decoded raw samples up into body_metrics + sleep_sessions for the
   *  ring-clock window [sinceDs, +∞) (pass 0 to aggregate everything). */
  // allowStepsDecrease: one-time owner-gated backfill lever (D0 historical correction). The steps
  // step normally only ever RAISES a stored day's count (never regresses another source's value);
  // this bypasses that magnitude guard so a corrected (lower) step_counter total can overwrite an
  // old, inflated flat-30-estimate value. Safe: the downstream upsertBodyMetrics(..., 'oura_ble')
  // still applies the per-field sourceMap rank merge, so a higher-ranked `manual` entry is preserved
  // regardless of this flag — only oura_ble/oura_cloud/health_connect/unset steps can be overwritten.
  /** `sinceDs`: narrow the read window to the span an ingest touched. Omit to re-derive the whole
   *  35-day window — the caller must do that at least once per process before it starts narrowing,
   *  or a batch ingested before this process started could never be rolled up (Q-213). */
  aggregateOuraRawSamples(userId: string, timezone: string, opts?: { debugDate?: string; disableNeuralStager?: boolean; fullHistory?: boolean; dumpOnly?: boolean; allowStepsDecrease?: boolean; sinceDs?: number }): Promise<OuraRawAggregateResult>
  // Read-only dry-run for the D0 historical step backfill — no write performed. Returns every day
  // whose stored steps would actually change if `allowStepsDecrease` ran, computed the same way
  // (same pipeline, same sourceMap rank protection), so the owner can review before firing it.
  previewStepsBackfill(userId: string, timezone: string): Promise<StepsBackfillPreviewRow[]>
  /** Latest ring-clock anchor for the user (one row per epoch; newest wins). Used to
   *  convert wall-clock time to ring deciseconds for callers with no ring ds of their
   *  own (e.g. the accel-only live step tester). */
  getOuraClockAnchor(userId: string): Promise<{ id: number; anchorDs: number; anchorUtc: Date } | null>
  /** Every clock-anchor observation, oldest ds first (migration 161). A ds resolves against
   *  the observation nearest *it*, which bounds the lag to one drain interval instead of
   *  "time since the last sync" — see `resolveDsToMs` in lib/oura-ble/clock.ts. */
  getOuraClockAnchors(userId: string): Promise<import('@/lib/oura-ble/clock').ClockAnchor[]>
  /** Store (or idempotently re-confirm) a live-counted step window — Tier 2 of the step
   *  orchestration plan. ON CONFLICT (user_id, start_ds) DO UPDATE, so a client retry of
   *  the same window is a no-op rather than a duplicate. */
  upsertStepLiveWindow(userId: string, window: { startDs: number; endDs: number; steps: number; source?: string }): Promise<StepLiveWindow>
  /** Store a raw accel-magnitude chunk from the continuous daytime capture (already
   *  gait-counted by the caller). ON CONFLICT (user_id, started_at) DO NOTHING —
   *  `inserted: false` means a client retry of an already-stored chunk. Also prunes the
   *  user's chunks older than 7 days (no cron layer; ingest-time housekeeping). */
  insertOuraAccelChunk(userId: string, chunk: { startedAt: Date; sampleRate: number; magnitudes: number[]; steps: number }): Promise<{ inserted: boolean }>

  // ── Injuries ───────────────────────────────────────────────────────────────
  listInjuries(userId: string): Promise<import('@trainingai/shared/types/injury').Injury[]>
  createInjury(userId: string, data: Omit<import('@trainingai/shared/types/injury').Injury, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<import('@trainingai/shared/types/injury').Injury>
  updateInjury(id: string, userId: string, data: Partial<Omit<import('@trainingai/shared/types/injury').Injury, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<import('@trainingai/shared/types/injury').Injury>
  deleteInjury(id: string, userId: string): Promise<void>

  // ── Supplements ────────────────────────────────────────────────────────────
  listSupplements(userId: string, date: string): Promise<import('@trainingai/shared/types/supplement').SupplementWithStatus[]>
  createSupplement(userId: string, data: Omit<import('@trainingai/shared/types/supplement').Supplement, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<import('@trainingai/shared/types/supplement').Supplement>
  updateSupplement(id: string, userId: string, data: Partial<Omit<import('@trainingai/shared/types/supplement').Supplement, 'id' | 'userId' | 'createdAt'>>): Promise<import('@trainingai/shared/types/supplement').Supplement>
  deleteSupplement(id: string, userId: string): Promise<void>
  logSupplement(supplementId: string, userId: string, date: string): Promise<void>
  unlogSupplement(supplementId: string, userId: string, date: string): Promise<void>

  // ── AI Periodization ───────────────────────────────────────────────────────
  getSessionPeriodization(userId: string, programSessionId: string): Promise<SessionPeriodization | null>
  // Creates the row if it doesn't exist yet; otherwise returns the existing row unchanged.
  ensureSessionPeriodization(userId: string, programSessionId: string): Promise<SessionPeriodization>
  setBaselineComplete(userId: string, programSessionId: string, baseline1rm: Record<string, Baseline1rmEntry>): Promise<SessionPeriodization>
  advancePhase(userId: string, programSessionId: string, newPhase: PeriodizationPhase): Promise<SessionPeriodization>
  /** `status` is written atomically with the prescription — see the slice for why (Q-54). */
  storePrescription(userId: string, programSessionId: string, prescription: AiPrescription, expiresAt: Date, status?: PrescriptionStatus): Promise<void>
  clearProgramPrescriptions(userId: string, programId: string): Promise<void>
  updatePrescriptionStatus(userId: string, programSessionId: string, status: PrescriptionStatus): Promise<void>
  updatePrescriptionExercisesCache(userId: string, programSessionId: string, prescription: AiPrescription): Promise<void>
  storePendingTransition(userId: string, programSessionId: string, transition: PendingTransition | null): Promise<void>
  incrementSessionsInPhase(userId: string, programSessionId: string): Promise<void>
  setLastSessionRanPrescription(userId: string, programSessionId: string, ranPrescription: boolean): Promise<void>

  // `program_volume_targets` has no user_id column, so these take the userId and scope through
  // `programs` themselves rather than trusting the caller to have checked (Q-174).
  listVolumeTargets(userId: string, programId: string): Promise<ProgramVolumeTarget[]>
  replaceVolumeTargets(userId: string, programId: string, targets: { muscleGroup: string; targetSetsPerWeek: number }[]): Promise<void>

  getWorkoutSessionProgramSessionId(userId: string, workoutSessionId: string): Promise<string | null>
  getRecentSessionsOfType(userId: string, programSessionId: string, limit: number): Promise<Array<{
    id: string; startedAt: Date; completedAt: Date | null; sessionName: string
  }>>
  getSetLogsForSessions(workoutSessionIds: string[]): Promise<Array<{
    workoutSessionId: string; exerciseName: string; setNumber: number;
    rpe: number | null; reps: number; intensityPct: number | null; setTimeSec: number | null
  }>>
  getSetTimingRows(userId: string, exerciseNames: string[]): Promise<import('@trainingai/shared/workout/time-profile').TimingRow[]>
  getExercise1rmHistory(userId: string, exerciseNames: string[], tz: string): Promise<Record<string, { date: string; rm: number }[]>>
  getWeeklySetsByMuscleGroup(userId: string, programId: string, weekStart: string, weekEnd: string, tz: string): Promise<Record<string, number>>
  listSessionPeriodizationForProgram(userId: string, programId: string): Promise<SessionPeriodization[]>
  reconcileSessionsInPhase(userId: string, programId: string): Promise<void>
  reconcileUserStats(userId: string): Promise<void>

  // ── Oura Ring ──────────────────────────────────────────────────────────────
  upsertOuraDaily(userId: string, rows: OuraDailyRow[], source: HealthSource): Promise<void>
  getOuraDaily(userId: string, startDate: string, endDate: string): Promise<OuraDailyRow[]>
  /** The app's own derived scores for one local day (`oura_daily_derived`), or null if never
   *  scored. Never reads `oura_daily`'s frozen Cloud columns. One query — safe on a per-day screen. */
  getDerivedScoresForDay(userId: string, day: string): Promise<{ sleepScore: number | null; readinessScore: number | null; activityScore: number | null } | null>
  getLatestOuraCloudVitals(userId: string): Promise<{ date: string; vo2Max: number | null; vascularAge: number | null } | null>
  /** Newest `measured_at` across the user's BLE raw samples — the ring's freshness truth. */
  getLatestOuraBleMeasuredAt(userId: string): Promise<Date | null>
  /** Has the ring ever reported? Answers "is it connected" without needing a resolvable clock
   *  anchor — see the note on the implementation for why those are different questions. */
  hasOuraBleSamples(userId: string): Promise<boolean>
  /** Q-314 — the owner declares a deliberate ring re-key; the next ingest batch opens the epoch.
   *  Idempotent: declaring twice returns the pending one rather than queueing a second. */
  declareOuraRekey(userId: string, note: string | null): Promise<{ id: number; declaredAt: Date; alreadyPending: boolean }>
  getPendingRekeyDeclaration(userId: string): Promise<{ id: number; declaredAt: Date } | null>
  consumeRekeyDeclaration(id: number, epoch: number): Promise<void>
  cancelPendingRekeyDeclaration(userId: string): Promise<boolean>
  listOuraTags(userId: string, startDay: string, endDay: string): Promise<OuraTagRow[]>

  // ── Body Battery (daily snapshots for model tuning) ──────────────────────────
  upsertBodyBatteryDaily(userId: string, row: BodyBatteryDailyRow): Promise<void>
  getBodyBatteryHistory(userId: string, startDate: string, endDate: string): Promise<BodyBatteryDailyRow[]>
  upsertOuraSleep(userId: string, sessions: OuraSleepUpsertRow[], source: HealthSource): Promise<void>
  upsertOuraHeartrate(userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]): Promise<void>
  getHrForWindow(userId: string, from: Date, to: Date): Promise<{ timestamp: Date; bpm: number; source: string | null }[]>
  /** Per-day time-in-HR-zone (seconds per zone) over a local-date range, reconcile-on-read cached
   *  in daily_zone_minutes. `today` is always recomputed (partial day). Server-derived, not synced. */
  getZoneMinutesRange(
    userId: string, fromDay: string, toDay: string, tz: string,
    profile: { maxHr: number; restingHr: number },
  ): Promise<{ day: string; seconds: [number, number, number, number, number] }[]>
  insertRrIntervals(userId: string, rows: { at: Date; rrMs: number }[]): Promise<void>
  getRrForWindow(userId: string, from: Date, to: Date): Promise<{ at: Date; rrMs: number }[]>
  /** D5 — own daytime-HRV: the user's fitted per-user regression, or null before the first
   *  successful refit (cold start — caller falls back to no daytime-stress contribution). */
  getDaytimeHrvModel(userId: string): Promise<DaytimeHrvModelRow | null>
  upsertDaytimeHrvModel(userId: string, model: {
    intercept: number; hrCoef: number; tempCoef: number; residualStd: number; nSamples: number
  }): Promise<void>
  // Per-workout HR summary snapshot (H-3 / Lever W) — durable Tier-2 record that outlives the
  // 180d oura_heartrate / 90d rr_intervals prunes.
  upsertWorkoutHrStats(userId: string, sessionId: string, stats: WorkoutHrStatsInput): Promise<void>
  getWorkoutHrStats(userId: string, sessionId: string): Promise<WorkoutHrStatsRow | null>
  listSessionsMissingHrStats(userId: string, since: Date, limit: number): Promise<{ id: string; startedAt: Date; completedAt: Date | null }[]>
  // Per-SET HR metric snapshot (migration 139) — durable per-set record for per-exercise HR trends,
  // sibling of workout_hr_stats. getSetDetailsForSession feeds the formula; the rest persist/read it.
  getSetDetailsForSession(workoutSessionId: string): Promise<import('@trainingai/shared/workout/set-hr-stats').RichSetMarker[]>
  upsertSetHrStats(userId: string, workoutSessionId: string, rows: import('@trainingai/shared/workout/set-hr-stats').SetHrRow[]): Promise<void>
  getSetHrStatsForSession(userId: string, workoutSessionId: string): Promise<SetHrStatsRow[]>
  getSetHrStatsForExercise(userId: string, opts: { exerciseId?: string | null; exerciseName?: string; since: Date }): Promise<SetHrStatsRow[]>
  getSetHrStatsSince(userId: string, since: Date, limit?: number): Promise<SetHrStatsRow[]>
  listSessionsMissingSetHrStats(userId: string, since: Date, limit: number): Promise<{ id: string; startedAt: Date; completedAt: Date | null }[]>
  getOuraWorkouts(userId: string, opts: { unreviewed?: boolean; from?: string; to?: string; timezone?: string }): Promise<{
    id: string; day: string; activity: string; startDatetime: Date; endDatetime: Date;
    calories: number | null; distanceM: number | null; intensity: string | null;
    source: string | null; reviewed: boolean;
  }[]>
  markOuraWorkoutReviewed(userId: string, id: string): Promise<void>
  getSetTimestampsForSession(workoutSessionId: string): Promise<{ exerciseName: string; setNumber: number; setStartMs: number | null; setEndMs: number | null; loggedAt: Date | null }[]>
  markHrSynced(workoutSessionId: string): Promise<void>
  getUnsyncedHrSessionsForDay(userId: string, day: string): Promise<{ id: string; startedAt: Date; completedAt: Date | null }[]>
  getUnsyncedHrSessions(userId: string, from: Date, to: Date): Promise<{ id: string; startedAt: Date; completedAt: Date | null }[]>
  getWorkoutSessionById(userId: string, id: string): Promise<{ id: string; startedAt: Date; completedAt: Date | null } | null>
  // Full session detail (exercises + sets) for a single workout session — used by the
  // post-session recap, which needs the same hydrated shape as getWorkoutSessionsFrom
  // but scoped to one id instead of a whole window.
  getWorkoutSessionDetail(userId: string, id: string): Promise<WorkoutSession | null>

  // ── Oura BLE Phase 5 — per-night daily summary + rolling personal baselines ───
  // Full replace per user: the baseline EMAs are replayed sequentially from all
  // available nights on every rollup pass (same derive-don't-drift pattern as the
  // sleep/HR-series rollup steps), so the whole table is deleted and reinserted.
  replaceOuraDailySummary(userId: string, rows: OuraDailySummaryRow[]): Promise<void>
  // Window-scoped single-row upsert (Phase-2 A1): the offline-sync push path writes one pushed
  // night in place without the full delete+reinsert (which would wipe history on every push).
  upsertOuraDailySummary(userId: string, rows: OuraDailySummaryRow[]): Promise<void>
  getOuraDailySummary(userId: string, from: string, to: string): Promise<OuraDailySummaryRow[]>

  // Completed-form derived metrics (Oura on-device-models program, Sub-plan A). Idempotent
  // per-day upsert: only the fields present in `patch` are written, via COALESCE so a partial
  // recompute never nulls an existing good value. Read by range for the readiness/health routes.
  upsertOuraDailyDerived(userId: string, day: string, patch: OuraDailyDerivedPatch): Promise<void>
  getOuraStorageStats(): Promise<OuraStorageStats>
  nullHistoricalDecoded(userId: string, maxRows?: number): Promise<{ nulled: number; remaining: number }>
  vacuumOuraRawSamples(): Promise<{ beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number }>
  /** Q-315 — `VACUUM FULL` on an allowlisted table. The name is interpolated into the statement
   *  (VACUUM takes no bind parameter), so the allowlist is the safety boundary, not validation. */
  vacuumTableFull(table: import('./postgres/slices/oura').VacuumFullTable): Promise<{
    table: string; liveRows: number; beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number
  }>
  /** Q-541 Task 4 — move sealed buckets of raw frames into `oura_raw_packed`. Bounded per call,
   *  idempotent, resumable; deletes a hot row only after re-reading its blob and proving the frames
   *  equal. Admin-triggered only — never runs on deploy. */
  packOuraRawBuckets(userId: string, maxBuckets?: number): Promise<import('./postgres/slices/oura-raw-pack').PackRunResult>
  countPackableBuckets(userId: string): Promise<{ buckets: number; sealBelowDs: number | null }>
  /**
   * Track-B dedicated timeseries pull (B2). Serves `oura_heartrate` + coarse `oura_bucket`
   * on a SINGLE pooled connection (never the shared getSyncDelta fan-out) with an exact
   * keyset `(updated_at, id)` cursor per domain. Bounded per-domain page (TIMESERIES_ROW_BUDGET);
   * `hasMore` drives the restore drain loop. HR is a rolling 180-day window; coarse buckets forever.
   */
  getOuraTimeseriesDelta(
    userId: string,
    opts: { heartrate?: TimeseriesCursor | null; bucket?: TimeseriesCursor | null; budget?: number },
  ): Promise<{ heartrate: TimeseriesPage<OuraHrDeltaRow>; bucket: TimeseriesPage<OuraBucketDeltaRow> }>
  getOuraDailyDerived(userId: string, from: string, to: string): Promise<OuraDailyDerivedRow[]>
  /** Derive + persist body-composition snapshots from every logged weight+body-fat row. Returns count written. */
  persistBodyCompFromMetrics(userId: string): Promise<number>
}

// ── Oura shared types ─────────────────────────────────────────────────────────

export interface OuraDailyRow {
  date: string  // YYYY-MM-DD
  readinessScore?: number | null
  temperatureDeviation?: number | null
  temperatureTrendDeviation?: number | null
  readinessContributors?: Record<string, number | null> | null
  sleepScore?: number | null
  sleepContributors?: Record<string, number | null> | null
  activityScore?: number | null
  activeCalories?: number | null
  totalCalories?: number | null
  equivalentWalkingDistance?: number | null
  highActivityTimeSec?: number | null
  mediumActivityTimeSec?: number | null
  lowActivityTimeSec?: number | null
  sedentaryTimeSec?: number | null
  nonWearTimeSec?: number | null
  activityContributors?: Record<string, number | null> | null
  stressHigh?: number | null
  recoveryHigh?: number | null
  daySummary?: string | null
  vo2Max?: number | null
  vascularAge?: number | null
  pulseWaveVelocity?: number | null
  resilienceLevel?: string | null
  resilienceContributors?: Record<string, number | null> | null
  // sleep_time endpoint (migration 090)
  recommendedBedtimeStart?: number | null   // minutes from midnight UTC
  recommendedBedtimeEnd?: number | null     // minutes from midnight UTC
  sleepTimeStatus?: string | null
  sleepTimeRecommendation?: string | null
  breathingDisturbanceIndex?: number | null
  // migration 112
  restingTimeSec?: number | null
  avgMetMinutes?: number | null
  highActivityMetMinutes?: number | null
  mediumActivityMetMinutes?: number | null
  lowActivityMetMinutes?: number | null
}

export interface OuraTagRow {
  ouraId: string
  source: 'enhanced_tag' | 'session' | 'rest_mode'
  tagType: string | null
  customName: string | null
  comment: string | null
  mood: string | null
  startDay: string
  endDay: string | null
  startTime: Date | null
  endTime: Date | null
}

export interface OuraSleepUpsertRow {
  /** The vendor's own row id, when the write came from a source that has one. Absent for
   *  Health Connect / manual writes, which dedup on (user_id, sleep_start) like every other
   *  source. */
  ouraId?: string | null
  date: string            // YYYY-MM-DD of wake-up
  sleepStart: Date
  sleepEnd: Date
  durationHours?: number | null
  deepSleepHours?: number | null
  remSleepHours?: number | null
  lightSleepHours?: number | null
  awakHours?: number | null
  efficiency?: number | null
  onsetLatencySec?: number | null
  averageHrvMs?: number | null
  avgHeartRate?: number | null
  lowestHeartRate?: number | null
  restlessPeriods?: number | null
  sleepScore?: number | null
  respiratoryRate?: number | null
  sleepPhase5Min?: string | null
  timeInBedHours?: number | null
}

// A metric's rolling personal baseline, ×8 fixed-point (see lib/health/personal-baseline.ts).
export interface BaselineStateRow {
  meanX8: number
  devX8: number
}

export interface OuraDailySummaryRow {
  date: string // wake day, YYYY-MM-DD
  sleepDurationHours: number | null
  sleepEfficiency: number | null
  deepSleepHours: number | null
  remSleepHours: number | null
  restlessPeriods: number | null
  sleepLatencySec: number | null
  hrvAvgMs: number | null
  rhrLowBpm: number | null
  rhrAvgBpm: number | null
  recoveryIndexHours: number | null
  tempMeanC: number | null
  tempDevC: number | null
  metAvg: number | null
  breathAvgRpm: number | null
  hrvBaseline: BaselineStateRow | null
  rhrBaseline: BaselineStateRow | null
  tempBaseline: BaselineStateRow | null
  sleepBaseline: BaselineStateRow | null
  metBaseline: BaselineStateRow | null
  breathBaseline: BaselineStateRow | null
  nHistory: number
}

// Completed-form derived metrics — one row per user per local day (Oura on-device-models
// program, Sub-plan A). Every field nullable; a metric absent for a day is null. `day` is the
// local day (YYYY-MM-DD). JSONB payloads are typed `unknown` at the repo boundary — callers
// narrow them.
export interface OuraDailyDerivedRow {
  day: string
  source: string | null
  modelVersions: unknown | null
  sleepScore: number | null
  sleepContributors: unknown | null
  readinessScore: number | null
  readinessContributors: unknown | null
  readinessSource: string | null
  activityScore: number | null
  activityContributors: unknown | null
  activeCaloriesEst: number | null
  trainingLoadOts: number | null
  trainingLoadHigh: boolean | null
  recoveryIndexHours: number | null
  wornHoursBle: number | null
  nightHrvBaselineMs: number | null
  illnessFlag: string | null
  illnessScore: number | null
  illnessBiomarkers: unknown | null
  daytimeStressScaled: number | null
  stressHighMinutes: number | null
  recoveryHighMinutes: number | null
  chronicStressScore: number | null
  chronicStressContributors: unknown | null
  resilienceLevel: number | null
  resilienceDailyStress: number | null
  resilienceDailyRestorativeTime: number | null
  resilienceDailySleepRecovery: number | null
  resilienceGranular: number | null
  resilienceConfidence: number | null
  bdiDerived: number | null
  vascularAge: number | null
  pwv: number | null
  bodyComp: unknown | null
}

/** Partial write for {@link OuraDailyDerivedRow} — only present fields are upserted (COALESCE). */
export type OuraDailyDerivedPatch = Partial<Omit<OuraDailyDerivedRow, 'day'>>

/** Per-workout HR summary snapshot (H-3 / Lever W). Scalars recomputed live from oura_heartrate +
 *  rr_intervals on every recap today; persisted here so old recaps survive the 180d/90d prunes. */
export interface WorkoutHrStatsInput {
  avgBpm: number | null
  peakBpm: number | null
  hrr1Best: number | null
  workoutHrvMs: number | null
  readingsCount: number
  source: string | null
}
export interface WorkoutHrStatsRow extends WorkoutHrStatsInput {
  computedAt: Date
}

// D5 — own daytime-HRV (migration 145). See lib/health/daytime-hrv-model.ts for the fit/evaluate math.
export interface DaytimeHrvModelRow {
  intercept: number
  hrCoef: number
  tempCoef: number
  residualStd: number
  nSamples: number
  fittedAt: Date
}

// Per-SET HR metric snapshot (migration 139). The row shapes live with the formula in
// lib/workout/set-hr-stats.ts (SetHrRow = the computed/persisted row; RichSetMarker = the set-detail
// query result the formula consumes). Re-exported here as the repository's currency.
export type { SetHrRow, RichSetMarker }
export interface SetHrStatsRow extends SetHrRow {
  workoutSessionId: string
  computedAt: Date
}

/** DB-footprint readout for the admin console (Sub-plan G-2). Table sizes are planner estimates;
 *  the raw-sample split is exact. `decodedBytes` is the reclaimable-going-forward figure (Lever 1),
 *  `bodyHexBytes` the archival cost (Lever 5). */
export interface OuraStorageStats {
  tables: { table: string; rows: number; bytes: number }[]
  rawSamples: { totalRows: number; decodedRows: number; decodedBytes: number; bodyHexBytes: number }
}

// ── AI call observability ──────────────────────────────────────────────────────
export interface AiCallLogInput {
  userId?: string | null
  section: string
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  latencyMs?: number | null
  ok: boolean
  fingerprint?: string | null
}
export interface AiCallSectionStat {
  section: string
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgLatencyMs: number
}
export interface AiCallTimeBucket { bucket: string; calls: number; totalTokens: number }
export interface AiDoubleTrip { section: string; redundantCalls: number; affectedFingerprints: number }
export interface AiCallUsageSummary {
  sinceHours: number
  windowSeconds: number
  totalCalls: number
  totalErrors: number
  totalTokens: number
  sections: AiCallSectionStat[]
  timeline: AiCallTimeBucket[]
  doubleTrips: AiDoubleTrip[]
}
