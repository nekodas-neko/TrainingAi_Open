import { randomUUID } from 'crypto'
import { rejectMealImage, mealImageRejectionMessage, FOOD_ITEM_IMAGE_MAX_BYTES } from '@trainingai/shared/nutrition/meal-image'
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors'
import { formatInTimeZone } from 'date-fns-tz'
import { eq, and, or, inArray, gt, gte, lt, lte, asc, desc, sql, ne, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from './client'
import { estWorkoutKcal } from '@trainingai/shared/health/workout-energy'
import { ouraIdForActivityType } from '@trainingai/shared/health/daily-energy'
import { ageFromDob } from '@trainingai/shared/date-utils'
import { mergePreferences, type UserPreferences } from '@trainingai/shared/user/preferences'
import * as s from './schema'
import { collapseOnConflict, keepLatestNonNull } from './collapse-conflicts'
import { invitedEmails } from './schema'
import { resolveSyncCursor } from '@trainingai/shared/sync/cursor'
import { isRetryableWriteError } from '@trainingai/shared/sync/retryable-error'
import { shouldPrune } from './retention-throttle'
import { inSequence } from './in-sequence'

/** Q-481 — at most one `applied_mutations` prune per day per process. */
const APPLIED_MUTATIONS_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000
import { measuredAtMs, dsFromMeasuredAtMs, cadenceSecFromDs, decodeEventBody, hexToBytes, eventName } from '@/lib/oura-ble/decode'

/** Hard cap on `getOuraRawSamplesForTags`' lookback — the scan is over the biggest table in the DB
 *  (812k rows). Exported so callers size their own lookback against it rather than asking for more
 *  and being silently clamped, which is what `maybeRefitDaytimeHrvModel` was doing at 60 days. */
export const MAX_RAW_SAMPLE_WINDOW_DAYS = 31
import { classifyClockRegression, resolveDsToMs, resolveMsToDs, type ClockAnchor } from '@/lib/oura-ble/clock'
import { spo2PctFromR } from '@/lib/oura-ble/spo2'
import { STEP_FEATURE_TAGS, STEP_MOTION_TAG } from '@/lib/oura-ble/rollup-consumed-tags'
import { mergeStepCounterWithLive, type StepCountWindow } from '@trainingai/shared/health/step-estimate'
import { runStepCounterPipeline, type RawFrame } from '@/lib/oura-ble/step-counter-pipeline'
import { computeStepsByDay } from '@/lib/oura-ble/step-day-buckets'
import { numericField as numArr } from '@trainingai/shared/health/night-vitals'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { liveReadinessForDay } from '@trainingai/shared/health/live-readiness'
import { extractNightlyTrainingSamples, fitDaytimeHrvModel, MIN_TRAINING_SAMPLES } from '@trainingai/shared/health/daytime-hrv-model'
import { sleepDurationTrend } from '@trainingai/shared/health/sleep-trend'
import { DayCheckinScalesSchema, DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'
import { MoodFieldsSchema } from '@trainingai/shared/validation/mood-log'
import { FoodItemPushSchema } from '@trainingai/shared/validation/food-item'
import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { OuraDailySummaryPushSchema, OuraDailyDerivedPushSchema } from '@trainingai/shared/validation/oura-summary'
import { SessionRpeSchema } from '@trainingai/shared/validation/session-rpe'
import {
  validMeasurementCmOrNull,
  validWeightKgOrNull,
  validBodyFatPctOrNull,
  validCaloriesOrNull,
  validMacroGOrNull,
  validStepsOrNull,
  validDistanceKmOrNull,
  validRestingHrOrNull,
  validHrvMsOrNull,
  validSpo2PctOrNull,
  validWaterMlOrNull,
  validWaterMlDeltaOrNull,
} from '@trainingai/shared/validation/body-metrics'
import { sleepImplausibleReason } from '@trainingai/shared/validation/plausibility'
import { ActivityLogBody, deriveEndTime } from '@trainingai/shared/validation/activity-log'
import { describeZodFailure } from './push-error-detail'
import type { WorkoutRepository, UserGoals, EnsuredWorkoutSession, SessionLoad, YearReviewTotals, YearReviewTopExercise, UnitFixResult, SyncDelta, IncomingMutation, PushResult, OuraRawSampleInput, OuraRawSampleSummary, OuraRawSampleLatest, OuraRawSampleRow, FitnessTest, RunningPlan, PrescribedRun, PrescribedRunUpdate, AiCallLogInput, AiCallUsageSummary, ScaleRawSampleInput, ScalePendingSample, LastRealOneRm } from '../repository'
import { FitnessTestBody } from '@trainingai/shared/validation/fitness-test'
import { PrescribedRunPatchBody } from '@trainingai/shared/validation/prescribed-run'
import type {
  User, Program, ProgramSession, SessionExercise, Schedule, ScheduleDay,
  ProgressionStyle, StyleSet,
  WorkoutSession, ExerciseLog, SetLog, ExerciseHistoryLogRow,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, NextSessionRecommendation,
  ActivityLevel, FitnessGoal, MoodLog, GoalRecommendation,
} from '@trainingai/shared/types'
import type { ExerciseLibraryEntry, MuscleAssignment, ProgramPhase, ProgramPhaseType, PhaseSetWithPhases, ExerciseType } from '@trainingai/shared/types/program'
import type {
  MealType, FoodItem, FoodLog, NutritionTargets,
  DietarySeverity,
} from '@trainingai/shared/types/nutrition'
import type { Injury } from '@trainingai/shared/types/injury'
import type { Supplement, SupplementWithStatus } from '@trainingai/shared/types/supplement'
import * as n from './slices/nutrition'
import * as mp from './slices/meal-plans'
import * as social from './slices/social'
import * as prog from './slices/programs'
import * as period from './slices/periodization'
import * as userStatsSlice from './slices/user-stats'
import * as oura from './slices/oura'
import { readRawFrames, readRecentRawFrames, DS_BUCKET_SPAN } from './slices/oura-raw-frames'
import { runOuraRollup } from '@/lib/oura-ble/rollup/run'
import { createPostgresRollupIO } from './rollup-io'
import { nodeModelRuntime } from '@/lib/oura-models/inference/runtime-node'
import { ensureServerOuraConstants } from '@/lib/oura-models/constants-inject'
import { packOuraRawBuckets, countPackableBuckets, claimAutoPackSlot, AUTOPACK_MAX_BUCKETS } from './slices/oura-raw-pack'
import * as bodyBattery from './slices/body-battery'
import { mergeSet, initialSourceMap, HEALTH_SOURCES, sourceRank, type HealthSource, type SourceColumn } from '@/lib/data/health-source'
import type {
  SessionPeriodization, PeriodizationPhase, AiPrescription,
  Baseline1rmEntry, PendingTransition, PrescriptionStatus, ProgramVolumeTarget,
} from '@trainingai/shared/types/ai-periodization'

// Per-field provenance columns for body_metrics (migration 120). One place; shared with the merge.
const BODY_METRICS_SOURCE_COLS: SourceColumn[] = [
  { prop: 'weightKg', col: 'weight_kg' }, { prop: 'bodyFatPct', col: 'body_fat_pct' },
  { prop: 'calories', col: 'calories' }, { prop: 'proteinG', col: 'protein_g' },
  { prop: 'carbsG', col: 'carbs_g' }, { prop: 'fatG', col: 'fat_g' },
  { prop: 'steps', col: 'steps' }, { prop: 'distanceKm', col: 'distance_km' },
  { prop: 'restingHeartRate', col: 'resting_heart_rate' }, { prop: 'hrvMs', col: 'hrv_ms' },
  { prop: 'spo2Pct', col: 'spo2_pct' }, { prop: 'waterMl', col: 'water_ml' },
  { prop: 'activeCalories', col: 'active_calories' }, { prop: 'waistCm', col: 'waist_cm' },
  { prop: 'chestCm', col: 'chest_cm' }, { prop: 'armCm', col: 'arm_cm' },
  { prop: 'thighCm', col: 'thigh_cm' }, { prop: 'hipCm', col: 'hip_cm' },
  { prop: 'neckCm', col: 'neck_cm' },
  { prop: 'skeletalMusclePct', col: 'skeletal_muscle_pct' }, { prop: 'fatFreeMassKg', col: 'fat_free_mass_kg' },
  { prop: 'subcutaneousFatPct', col: 'subcutaneous_fat_pct' }, { prop: 'visceralFatIndex', col: 'visceral_fat_index' },
  { prop: 'bodyWaterPct', col: 'body_water_pct' }, { prop: 'muscleMassKg', col: 'muscle_mass_kg' },
  { prop: 'boneMassKg', col: 'bone_mass_kg' }, { prop: 'proteinPct', col: 'protein_pct' },
  { prop: 'bmrKcal', col: 'bmr_kcal' }, { prop: 'metabolicAge', col: 'metabolic_age' },
]
import { aestMidnight, toAestDay, todayInTz, todayDayOfWeek, todayMidnightUtc, dateStrMidnightInTz, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { clampWindowStart } from '@trainingai/shared/workout/time-audit'
import { computeAiDynamicNextSession, TEMP_ALERT_THRESHOLD_C, type AiDynamicInput } from '@trainingai/shared/ai-periodization/ai-dynamic'
import { computeMuscleRecovery } from '@trainingai/shared/ai-periodization/muscle-recovery'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { mround } from '@trainingai/shared/1rm'
import { computeSetAggregates, computeIntensityPct } from '@trainingai/shared/workout/set-aggregates'

// 1 lb = 0.45359237 kg exactly. Used to correct dumbbell weights that were
// logged in lbs but recorded in the weight_kg column as if they were kg.
const LBS_TO_KG = 0.45359237

interface LbsToKgLogRow {
  id: string
  exerciseName: string
  loggedAt: Date
  estimated1rm: number | null
  target80: number | null
  volume: number | null
}

interface LbsToKgSetRow {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number
  reps: number
}

interface LbsToKgFixSet {
  id: string
  setNumber: number
  reps: number
  oldWeightKg: number
  newWeightKg: number
  newIntensityPct: number | null
}

interface LbsToKgFixLog {
  exerciseLogId: string
  exerciseName: string
  loggedAt: Date
  oldEstimated1rm: number | null
  newEstimated1rm: number | null
  oldTarget80: number | null
  newTarget80: number | null
  oldVolume: number | null
  newVolume: number | null
  sets: LbsToKgFixSet[]
}

interface LbsToKgFixExercise {
  exerciseName: string
  oldPersonalRecord: number | null
  newPersonalRecord: number | null
  newPersonalRecordAchievedAt: Date | null
}

interface LbsToKgFix {
  logs: LbsToKgFixLog[]
  exercises: LbsToKgFixExercise[]
}

// Pure computation shared by preview and apply — converts each affected set's
// weight from lbs (mistakenly stored as kg) to true kg, rounds to the nearest
// 0.5kg dumbbell increment, and rescales the derived estimated1rm/target80/
// volume/intensity figures by the same factor. The per-exercise personal
// record is then recomputed as the max estimated1rm across both the
// (rescaled) in-range logs and the untouched out-of-range logs.
function computeLbsToKgFix(
  exerciseNames: string[],
  allLogs: LbsToKgLogRow[],
  allSets: LbsToKgSetRow[],
  currentPRs: Map<string, number>,
  cutoff: Date,
): LbsToKgFix {
  const inRangeLogs = allLogs.filter(l => l.loggedAt < cutoff)
  const outOfRangeLogs = allLogs.filter(l => l.loggedAt >= cutoff)

  const setsByLog = new Map<string, LbsToKgSetRow[]>()
  for (const set of allSets) {
    const arr = setsByLog.get(set.exerciseLogId) ?? []
    arr.push(set)
    setsByLog.set(set.exerciseLogId, arr)
  }

  const logs: LbsToKgFixLog[] = inRangeLogs.map(log => {
    const sets: LbsToKgFixSet[] = (setsByLog.get(log.id) ?? []).map(set => ({
      id: set.id,
      setNumber: set.setNumber,
      reps: set.reps,
      oldWeightKg: set.weightKg,
      newWeightKg: mround(set.weightKg * LBS_TO_KG, 0.5),
      newIntensityPct: null,
    }))

    const newEstimated1rm = log.estimated1rm && log.estimated1rm > 0
      ? mround(log.estimated1rm * LBS_TO_KG, 0.25)
      : log.estimated1rm
    const newTarget80 = newEstimated1rm && newEstimated1rm > 0
      ? mround(newEstimated1rm * 0.8, 0.25)
      : log.target80
    const newVolume = sets.length > 0
      ? computeSetAggregates(sets.map(set => set.newWeightKg), sets.map(set => set.reps)).volume
      : log.volume

    for (const set of sets) {
      set.newIntensityPct = newEstimated1rm ? computeIntensityPct(set.newWeightKg, newEstimated1rm) : null
    }

    return {
      exerciseLogId: log.id,
      exerciseName: log.exerciseName,
      loggedAt: log.loggedAt,
      oldEstimated1rm: log.estimated1rm,
      newEstimated1rm,
      oldTarget80: log.target80,
      newTarget80,
      oldVolume: log.volume,
      newVolume,
      sets,
    }
  })

  const exercises: LbsToKgFixExercise[] = exerciseNames.map(exerciseName => {
    const candidates: { value: number; achievedAt: Date }[] = []
    for (const log of outOfRangeLogs) {
      if (log.exerciseName === exerciseName && log.estimated1rm && log.estimated1rm > 0) {
        candidates.push({ value: log.estimated1rm, achievedAt: log.loggedAt })
      }
    }
    for (const log of logs) {
      if (log.exerciseName === exerciseName && log.newEstimated1rm && log.newEstimated1rm > 0) {
        candidates.push({ value: log.newEstimated1rm, achievedAt: log.loggedAt })
      }
    }
    const best = candidates.reduce<{ value: number; achievedAt: Date } | null>(
      (max, c) => (!max || c.value > max.value) ? c : max, null,
    )

    return {
      exerciseName,
      oldPersonalRecord: currentPRs.get(exerciseName) ?? null,
      newPersonalRecord: best?.value ?? null,
      newPersonalRecordAchievedAt: best?.achievedAt ?? null,
    }
  })

  return { logs, exercises }
}

function toUnitFixResult(fix: LbsToKgFix): UnitFixResult {
  return {
    logs: fix.logs.map(log => ({
      exerciseLogId: log.exerciseLogId,
      exerciseName: log.exerciseName,
      loggedAt: log.loggedAt,
      oldEstimated1rm: log.oldEstimated1rm,
      newEstimated1rm: log.newEstimated1rm,
      oldVolume: log.oldVolume,
      newVolume: log.newVolume,
      sets: log.sets.map(set => ({
        setNumber: set.setNumber, reps: set.reps,
        oldWeightKg: set.oldWeightKg, newWeightKg: set.newWeightKg,
      })),
    })),
    exercises: fix.exercises.map(ex => ({
      exerciseName: ex.exerciseName,
      oldPersonalRecord: ex.oldPersonalRecord,
      newPersonalRecord: ex.newPersonalRecord,
    })),
  }
}

// Throttled retention prune for error_events — fires at most once per 24h,
// fire-and-forget, mirroring the oura_heartrate prune pattern.
let lastErrorEventPrune = 0
const ERROR_EVENT_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

// Throttled retention prune for app_load_metrics (BF-19, same pattern). Kept **14 days**, not 30:
// this is one row per page load rather than one per exception, so it is the highest-volume
// observability table in the app, and its whole question — "is this route slower this week than
// last" — needs two weeks, not four. The entry asked for a cap "from day one, not later" because
// error_events reached 52 MB before anyone looked.
let lastAppLoadPrune = 0
const APP_LOAD_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

// Throttled retention prune for ai_call_log (same pattern) — observability
// metadata, kept 30 days like error_events.
let lastAiCallLogPrune = 0
const AI_CALL_LOG_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

// step_live_windows retention (Oura data-culling, Sub-plan A Lever 3): the table was unbounded
// (schema comment claimed 7-day but nothing enforced it). Their steps are folded into
// body_metrics/oura_daily_derived long before this, so 30 days is ample. Throttled once/24h.
let lastStepWindowPrune = 0
const STEP_WINDOW_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

// Live battery-poll retention (migration 133): 90 days of 5-min-while-connected samples is
// ample for drain-rate analytics; throttled once/24h.
let lastBatteryPollPrune = 0
const BATTERY_POLL_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

// oura_accel_chunks retention (7-day recount/calibration window). Was awaited on every insert (H-5c)
// — a transient delete lock would 500 an accel POST that already succeeded semantically; now
// throttled + fire-and-forget like its siblings.
let lastAccelChunkPrune = 0
const ACCEL_CHUNK_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

export class PostgresWorkoutRepository implements WorkoutRepository {
  /** Last daytime-HRV refit ATTEMPT per user (see maybeRefitDaytimeHrvModel). Static because the
   *  throttle must outlive any single repository instance within the process. */
  private static readonly lastHrvRefitAttemptMs = new Map<string, number>()

  /** Q-481 — last opportunistic `applied_mutations` prune. Static for the same reason. */
  private static lastAppliedMutationsPrune = 0

  private get db() { return getDb() }

  // ── Users ─────────────────────────────────────────────────────────────────
  private rowToUser(r: typeof s.users.$inferSelect): User {
    return {
      id: r.id,
      oauthSub: r.oauthSub ?? undefined,
      email: r.email,
      name: r.name ?? undefined,
      isActive: r.isActive,
      isAdmin: r.isAdmin,
      createdAt: r.createdAt,
      displayName: r.displayName ?? undefined,
      heightCm: r.heightCm ?? undefined,
      dateOfBirth: r.dateOfBirth ?? undefined,
      weightGoalKg: r.weightGoalKg ?? undefined,
      avatar: r.avatar ?? undefined,
      timezone: r.timezone ?? DEFAULT_TZ,
      sex: r.sex ?? undefined,
      friendCode: r.friendCode ?? null,
      equippedTitle: r.equippedTitle ?? null,
      activityLevel: (r.activityLevel as ActivityLevel | null) ?? undefined,
      fitnessGoal: (r.fitnessGoal as FitnessGoal | null) ?? undefined,
      lastGoalReviewAt: r.lastGoalReviewAt ?? undefined,
    }
  }

  private rowToGoalRecommendation(r: typeof s.goalRecommendations.$inferSelect): GoalRecommendation {
    return {
      id: r.id,
      userId: r.userId,
      createdAt: r.createdAt,
      source: r.source as GoalRecommendation['source'],
      recommendedStepsGoal: r.recommendedStepsGoal ?? undefined,
      recommendedCalories: r.recommendedCalories ?? undefined,
      recommendedProteinG: r.recommendedProteinG ?? undefined,
      recommendedCarbsG: r.recommendedCarbsG ?? undefined,
      recommendedFatG: r.recommendedFatG ?? undefined,
      recommendedWaterMl: r.recommendedWaterMl ?? undefined,
      recommendedActivityLevel: (r.recommendedActivityLevel as ActivityLevel | null) ?? null,
      reasoning: r.reasoning ?? undefined,
      insights: r.insights ?? undefined,
      dataQualityNote: r.dataQualityNote ?? undefined,
      status: r.status as GoalRecommendation['status'],
      appliedAt: r.appliedAt ?? undefined,
      dismissedAt: r.dismissedAt ?? undefined,
    }
  }

  private async generateUniqueFriendCode(): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      const code = 'TAI-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
      const existing = await this.db.select({ id: s.users.id }).from(s.users).where(eq(s.users.friendCode, code)).limit(1)
      if (existing.length === 0) return code
    }
    throw new Error('Could not generate unique friend code')
  }

  async upsertUser(user: Omit<User, 'id' | 'createdAt' | 'isActive' | 'isAdmin'>, forceActive?: boolean): Promise<User> {
    const invited = forceActive ?? await this.isInvited(user.email)
    const [r] = await this.db.insert(s.users)
      .values({ oauthSub: user.oauthSub ?? null, email: user.email, name: user.name ?? null, isActive: invited })
      .onConflictDoUpdate({
        // Conflict on email — works for both OAuth and password users.
        // oauthSub UNIQUE doesn't fire when oauthSub is NULL (NULL != NULL in Postgres).
        target: s.users.email,
        set: {
          name: sql`EXCLUDED.name`,
          oauthSub: sql`COALESCE(EXCLUDED.oauth_sub, ${s.users.oauthSub})`,
        },
      })
      .returning()

    // Generate friend code if the user doesn't have one yet
    if (!r.friendCode) {
      const code = await this.generateUniqueFriendCode()
      await this.db.update(s.users).set({ friendCode: code }).where(eq(s.users.id, r.id))
      r.friendCode = code
    }

    const returnedUser = this.rowToUser(r)

    // Gate all seeding behind a single existence check — established users skip 4+ queries per login.
    const [hasStyles] = await this.db
      .select({ id: s.progressionStyles.id })
      .from(s.progressionStyles)
      .where(eq(s.progressionStyles.userId, returnedUser.id))
      .limit(1)

    if (!hasStyles) {
      const uid = returnedUser.id
      const allStyleDefs = [
        { name: 'Hypertrophy', sets: [
          { setNumber: 1, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 2, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 3, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 4, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
        ]},
        { name: 'Strength', sets: [
          { setNumber: 1, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 2, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 3, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 4, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 5, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
        ]},
        { name: 'Peak', sets: [
          { setNumber: 1, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 2, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 3, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
        ]},
        { name: 'Deload', sets: [
          { setNumber: 1, pct: 50, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 2, pct: 50, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 3, pct: 50, reps: 10, restSec: 60,  useFor1rm: false },
        ]},
        { name: 'General', sets: [
          { setNumber: 1, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
          { setNumber: 2, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
          { setNumber: 3, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
        ]},
        { name: 'Hypertrophy 3-set', sets: [
          { setNumber: 1, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 2, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
          { setNumber: 3, pct: 65, reps: 10, restSec: 60,  useFor1rm: false },
        ]},
        { name: 'Strength 3-set', sets: [
          { setNumber: 1, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 2, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 3, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
        ]},
        { name: 'Strength 4-set', sets: [
          { setNumber: 1, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 2, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 3, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
          { setNumber: 4, pct: 80, reps: 5,  restSec: 120, useFor1rm: true },
        ]},
        { name: 'Peak 4-set', sets: [
          { setNumber: 1, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 2, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 3, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 4, pct: 90, reps: 3,  restSec: 180, useFor1rm: true },
        ]},
        { name: 'General 4-set', sets: [
          { setNumber: 1, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
          { setNumber: 2, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
          { setNumber: 3, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
          { setNumber: 4, pct: 60, reps: 12, restSec: 60,  useFor1rm: false },
        ]},
        { name: 'Powerbuilding', sets: [
          { setNumber: 1, pct: 80, reps: 6,  restSec: 120, useFor1rm: true },
          { setNumber: 2, pct: 80, reps: 6,  restSec: 120, useFor1rm: true },
          { setNumber: 3, pct: 80, reps: 6,  restSec: 120, useFor1rm: true },
          { setNumber: 4, pct: 80, reps: 6,  restSec: 120, useFor1rm: true },
        ]},
        { name: 'Hypertrophy Plus', sets: [
          { setNumber: 1, pct: 70, reps: 8,  restSec: 75,  useFor1rm: false },
          { setNumber: 2, pct: 70, reps: 8,  restSec: 75,  useFor1rm: false },
          { setNumber: 3, pct: 70, reps: 8,  restSec: 75,  useFor1rm: false },
          { setNumber: 4, pct: 70, reps: 8,  restSec: 75,  useFor1rm: false },
        ]},
        { name: 'Heavy Strength', sets: [
          { setNumber: 1, pct: 85, reps: 5,  restSec: 180, useFor1rm: true },
          { setNumber: 2, pct: 85, reps: 5,  restSec: 180, useFor1rm: true },
          { setNumber: 3, pct: 85, reps: 5,  restSec: 180, useFor1rm: true },
          { setNumber: 4, pct: 85, reps: 5,  restSec: 180, useFor1rm: true },
          { setNumber: 5, pct: 85, reps: 5,  restSec: 180, useFor1rm: true },
        ]},
        { name: 'Strength Plus', sets: [
          { setNumber: 1, pct: 87, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 2, pct: 87, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 3, pct: 87, reps: 3,  restSec: 180, useFor1rm: true },
          { setNumber: 4, pct: 87, reps: 3,  restSec: 180, useFor1rm: true },
        ]},
        { name: 'Max Strength', sets: [
          { setNumber: 1, pct: 92, reps: 3,  restSec: 240, useFor1rm: true },
          { setNumber: 2, pct: 92, reps: 3,  restSec: 240, useFor1rm: true },
          { setNumber: 3, pct: 92, reps: 3,  restSec: 240, useFor1rm: true },
        ]},
        { name: 'Testing', sets: [
          { setNumber: 1, pct: 55, reps: 5,  restSec: 90,  useFor1rm: false },
          { setNumber: 2, pct: 70, reps: 3,  restSec: 120, useFor1rm: false },
          { setNumber: 3, pct: 87, reps: 5,  restSec: 180, useFor1rm: true  },
        ]},
      ]

      // Generate IDs upfront so sets can reference them without extra queries.
      const styleIdMap: Record<string, string> = {}
      const styleRows = allStyleDefs.map(def => {
        const id = randomUUID()
        styleIdMap[def.name] = id
        return { id, userId: uid, name: def.name }
      })
      await this.db.insert(s.progressionStyles).values(styleRows)

      const setRows = allStyleDefs.flatMap(def =>
        def.sets.map(set => ({
          id: randomUUID(),
          styleId: styleIdMap[def.name],
          setNumber: set.setNumber, pct: set.pct, reps: set.reps,
          restSec: set.restSec, useFor1rm: set.useFor1rm,
        }))
      )
      await this.db.insert(s.styleSets).values(setRows)

      // Phase sets — wrapped in try-catch so a partially-applied migration doesn't crash login.
      try {
        const find = (name: string) => styleIdMap[name] ?? null

        const phaseSetId = randomUUID()
        await this.db.insert(s.phaseSets).values({ id: phaseSetId, userId: uid, name: 'Phase-Based Progression', isDefault: true })
        await this.db.insert(s.programPhases).values([
          { phaseSetId, position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'), secondaryStyleId: find('Hypertrophy') },
          { phaseSetId, position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Strength'),    secondaryStyleId: find('Strength') },
          { phaseSetId, position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),        secondaryStyleId: null },
          { phaseSetId, position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),     secondaryStyleId: find('Testing') },
          { phaseSetId, position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),      secondaryStyleId: null },
          { phaseSetId, position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),     secondaryStyleId: null },
        ])

        const builtInSets = [
          { name: 'Baselining', phases: [
            { position: 0, name: 'Accumulation',    durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'),      secondaryStyleId: find('Hypertrophy') },
            { position: 1, name: 'Intensification', durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Strength'),         secondaryStyleId: find('Strength') },
            { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),             secondaryStyleId: null },
            { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
            { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
            { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
          ]},
          { name: 'Linear Progression', phases: [
            { position: 0, name: 'Build',     durationCycles: 8, phaseType: 'normal',    primaryStyleId: find('Strength'),  secondaryStyleId: find('Strength') },
            { position: 1, name: 'Testing',   durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),   secondaryStyleId: find('Testing') },
            { position: 2, name: 'Deload',    durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),    secondaryStyleId: null },
            { position: 3, name: 'Accessory', durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),   secondaryStyleId: null },
          ]},
          { name: 'Hypertrophy Progression', phases: [
            { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('General 4-set'),    secondaryStyleId: find('General 4-set') },
            { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'),      secondaryStyleId: find('Hypertrophy') },
            { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Hypertrophy Plus'), secondaryStyleId: find('Hypertrophy Plus') },
            { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
            { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
            { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
          ]},
          { name: 'S+H Progression', phases: [
            { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'),      secondaryStyleId: find('Hypertrophy') },
            { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Hypertrophy Plus'), secondaryStyleId: find('Hypertrophy Plus') },
            { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'normal',    primaryStyleId: find('Strength 4-set'),  secondaryStyleId: find('Strength 4-set') },
            { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
            { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
            { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
          ]},
          { name: 'Powerbuilding Progression', phases: [
            { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Powerbuilding'),    secondaryStyleId: find('Powerbuilding') },
            { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Heavy Strength'),   secondaryStyleId: find('Heavy Strength') },
            { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),             secondaryStyleId: null },
            { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
            { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
            { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
          ]},
          { name: 'Strength Progression', phases: [
            { position: 0, name: 'Accumulation',    durationCycles: 5, phaseType: 'normal',    primaryStyleId: find('Strength'),         secondaryStyleId: find('Strength') },
            { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Strength Plus'),    secondaryStyleId: find('Strength Plus') },
            { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Max Strength'),     secondaryStyleId: null },
            { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),          secondaryStyleId: find('Testing') },
            { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),           secondaryStyleId: null },
            { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),          secondaryStyleId: null },
          ]},
        ]

        for (const builtIn of builtInSets) {
          const setId = randomUUID()
          await this.db.insert(s.phaseSets).values({ id: setId, userId: uid, name: builtIn.name, isDefault: true })
          if (builtIn.phases.length > 0) {
            await this.db.insert(s.programPhases).values(builtIn.phases.map(p => ({ phaseSetId: setId, ...p })))
          }
        }
      } catch (err) {
        console.warn('[upsertUser] phase-set seeding skipped (migration pending?):', (err as Error).message?.slice(0, 200))
      }
    }

    return returnedUser
  }

  async listUsers(limit = 100, offset = 0): Promise<User[]> {
    const rows = await this.db.select().from(s.users).orderBy(asc(s.users.createdAt)).limit(limit).offset(offset)
    return rows.map(r => this.rowToUser(r))
  }

  async countInactiveUsers(): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM users WHERE is_active = false`)
    return Number(result.rows[0]?.count ?? 0)
  }

  async activateUser(userId: string): Promise<void> {
    await this.db.update(s.users).set({ isActive: true }).where(eq(s.users.id, userId))
  }

  async deactivateUser(userId: string): Promise<void> {
    await this.db.update(s.users).set({ isActive: false }).where(eq(s.users.id, userId))
  }

  async getUserById(userId: string): Promise<User | null> {
    const [r] = await this.db.select().from(s.users).where(eq(s.users.id, userId)).limit(1)
    return r ? this.rowToUser(r) : null
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(s.users).where(eq(s.users.id, userId))
  }

  async getUserByEmail(email: string): Promise<(User & { passwordHash?: string }) | null> {
    const [r] = await this.db.select().from(s.users).where(eq(s.users.email, email)).limit(1)
    if (!r) return null
    return { ...this.rowToUser(r), passwordHash: r.passwordHash ?? undefined }
  }

  async updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex' | 'activityLevel' | 'fitnessGoal'>>): Promise<User> {
    const set: Record<string, unknown> = {
      displayName: profile.displayName ?? null,
      heightCm: profile.heightCm ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      weightGoalKg: profile.weightGoalKg ?? null,
    }
    if (profile.timezone) set.timezone = profile.timezone
    if ('sex' in profile) set.sex = profile.sex ?? null
    if ('activityLevel' in profile) set.activityLevel = profile.activityLevel ?? null
    if ('fitnessGoal' in profile) set.fitnessGoal = profile.fitnessGoal ?? null
    const [r] = await this.db.update(s.users)
      .set(set)
      .where(eq(s.users.id, userId))
      .returning()
    return this.rowToUser(r)
  }

  async touchLastGoalReviewAt(userId: string): Promise<void> {
    await this.db.update(s.users).set({ lastGoalReviewAt: new Date() }).where(eq(s.users.id, userId))
  }

  async updateUserAvatar(userId: string, avatar: string): Promise<User> {
    const [r] = await this.db.update(s.users)
      .set({ avatar })
      .where(eq(s.users.id, userId))
      .returning()
    return this.rowToUser(r)
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.update(s.users).set({ passwordHash }).where(eq(s.users.id, userId))
  }

  async getTimingBaselineDate(userId: string): Promise<string | null> {
    const [r] = await this.db.select({ timingBaselineDate: s.users.timingBaselineDate }).from(s.users).where(eq(s.users.id, userId)).limit(1)
    return r?.timingBaselineDate ?? null
  }

  async setTimingBaselineDate(userId: string, date: string | null): Promise<void> {
    await this.db.update(s.users).set({ timingBaselineDate: date }).where(eq(s.users.id, userId))
  }

  async linkOAuthAccount(userId: string, oauthSub: string): Promise<void> {
    await this.db.update(s.users).set({ oauthSub }).where(eq(s.users.id, userId))
  }

  async createEmailUser(email: string, passwordHash: string, name?: string, isActive?: boolean): Promise<User> {
    const active = isActive ?? await this.isInvited(email)
    const [r] = await this.db.insert(s.users)
      .values({ email, passwordHash, name: name ?? null, isActive: active })
      .returning()
    return this.rowToUser(r)
  }

  // ── Invites ───────────────────────────────────────────────────────────────
  async listInvites(): Promise<string[]> {
    const rows = await this.db.select().from(invitedEmails).orderBy(asc(invitedEmails.createdAt))
    return rows.map(r => r.email)
  }

  async addInvite(email: string): Promise<void> {
    await this.db.insert(invitedEmails).values({ email }).onConflictDoNothing()
  }

  async removeInvite(email: string): Promise<void> {
    await this.db.delete(invitedEmails).where(eq(invitedEmails.email, email))
  }

  async isInvited(email: string): Promise<boolean> {
    const [r] = await this.db.select().from(invitedEmails).where(eq(invitedEmails.email, email)).limit(1)
    return !!r
  }

  // ── Programs ──────────────────────────────────────────────────────────────
  async getActiveProgram(userId: string): Promise<Program | null> { return prog.getActiveProgram(this.db, userId) }
  async listPrograms(userId: string): Promise<Program[]> { return prog.listPrograms(this.db, userId) }
  async saveProgram(userId: string, program: Program): Promise<Program> { return prog.saveProgram(this.db, userId, program) }
  async deleteProgram(userId: string, programId: string): Promise<void> { return prog.deleteProgram(this.db, userId, programId) }
  async removeSessionExercise(userId: string, sessionExerciseId: string): Promise<boolean> { return prog.removeSessionExercise(this.db, userId, sessionExerciseId) }

  // ── Block Periodization ───────────────────────────────────────────────────
  async listProgramPhases(userId: string, programId: string): Promise<ProgramPhase[]> { return prog.listProgramPhases(this.db, userId, programId) }
  async listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]> { return prog.listPhaseSets(this.db, userId) }
  async createPhaseSet(userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases> { return prog.createPhaseSet(this.db, userId, name, phases) }

  async createOwnedPhaseSetClone(userId: string, templateBaseName: string, programName: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases> { return prog.createOwnedPhaseSetClone(this.db, userId, templateBaseName, programName, phases) }
  async linkPhaseSetOwnership(phaseSetId: string, programId: string, userId: string): Promise<void> { return prog.linkPhaseSetOwnership(this.db, phaseSetId, programId, userId) }
  async updatePhaseSet(phaseSetId: string, userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases> { return prog.updatePhaseSet(this.db, phaseSetId, userId, name, phases) }
  async deletePhaseSet(phaseSetId: string, userId: string): Promise<void> { return prog.deletePhaseSet(this.db, phaseSetId, userId) }
  async updateProgramPhaseSettings(programId: string, userId: string, settings: { phaseMode?: 'manual' | 'automatic' | 'ai_dynamic'; startedAt?: string | null; sessionsPerCycle?: number | null; phaseSetId?: string | null }): Promise<void> { return prog.updateProgramPhaseSettings(this.db, programId, userId, settings) }
  async countSessionsSinceStart(userId: string, programId: string): Promise<number> { return prog.countSessionsSinceStart(this.db, userId, programId) }
  async countAllSessionsSinceStart(userId: string, programId: string): Promise<Map<string, number>> { return prog.countAllSessionsSinceStart(this.db, userId, programId) }
  async autoRecalibrateCycleAnchor(userId: string, programId: string): Promise<void> { return prog.autoRecalibrateCycleAnchor(this.db, userId, programId) }
  async getActiveProgramWithPhases(userId: string) { return prog.getActiveProgramWithPhases(this.db, userId) }
  async confirmEarlyDeload(userId: string, programId: string, today: string, timezone = DEFAULT_TZ): Promise<void> { return prog.confirmEarlyDeload(this.db, userId, programId, today, timezone) }

  // ── Progression Styles ────────────────────────────────────────────────────
  async listProgressionStyles(userId: string): Promise<ProgressionStyle[]> { return prog.listProgressionStyles(this.db, userId) }
  async progressionStyleIdsOwned(userId: string, ids: (string | null | undefined)[]): Promise<boolean> { return prog.progressionStyleIdsOwned(this.db, userId, ids) }
  async saveProgressionStyle(userId: string, style: ProgressionStyle): Promise<ProgressionStyle> { return prog.saveProgressionStyle(this.db, userId, style) }
  async deleteProgressionStyle(userId: string, styleId: string): Promise<void> { return prog.deleteProgressionStyle(this.db, userId, styleId) }

  // ── Logging ───────────────────────────────────────────────────────────────
  async createWorkoutSession(
    userId: string, programSessionId: string | undefined, sessionName: string, startedAt: Date,
    phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload = false,
  ): Promise<WorkoutSession> {
    const [r] = await this.db.insert(s.workoutSessions)
      .values({ userId, programSessionId: programSessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, phaseType: phaseType ?? null, isEarlyDeload })
      .returning()
    return {
      id: r.id, userId: r.userId, sessionId: r.programSessionId ?? undefined,
      sessionName: r.sessionName, startedAt: r.startedAt,
      phaseId: r.phaseId ?? undefined, phaseType: (r.phaseType as ProgramPhaseType | null) ?? undefined,
      isEarlyDeload: r.isEarlyDeload,
      wasOverride: r.wasOverride,
      intensityMode: (r.intensityMode as 'full' | 'deload' | null) ?? null,
      sessionRpe: r.sessionRpe ?? null,
      exercises: [],
    }
  }

  async ensureWorkoutSession(
    userId: string, workoutSessionId: string, programSessionId: string | undefined,
    sessionName: string, startedAt: Date,
    phaseId?: string, phaseType?: ProgramPhaseType, isEarlyDeload = false,
    intensityMode?: 'full' | 'deload' | null, wasOverride = false,
  ): Promise<EnsuredWorkoutSession> {
    const inserted = await this.db.insert(s.workoutSessions)
      .values({ id: workoutSessionId, userId, programSessionId: programSessionId ?? null, sessionName, startedAt, phaseId: phaseId ?? null, phaseType: phaseType ?? null, isEarlyDeload, wasOverride, intensityMode: intensityMode ?? null })
      .onConflictDoNothing()
      .returning({ id: s.workoutSessions.id, phaseId: s.workoutSessions.phaseId, phaseType: s.workoutSessions.phaseType, isEarlyDeload: s.workoutSessions.isEarlyDeload })
    if (inserted.length > 0) {
      const r = inserted[0]
      return { id: r.id, wasInserted: true, phaseId: r.phaseId ?? undefined, phaseType: (r.phaseType as ProgramPhaseType | null) ?? undefined, isEarlyDeload: r.isEarlyDeload }
    }
    // Row already existed (re-sync or a later exercise in the same session) — return its
    // already-stamped phase context instead of the (possibly different) values just computed,
    // so every exercise in a session is scored against the same phase the session was created in.
    // Scoped to user_id: a sessionId belonging to another user must never be silently adopted
    // (the caller would go on to log exercise/set rows into someone else's session).
    const [existing] = await this.db
      .select({ phaseId: s.workoutSessions.phaseId, phaseType: s.workoutSessions.phaseType, isEarlyDeload: s.workoutSessions.isEarlyDeload })
      .from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId), isNull(s.workoutSessions.deletedAt)))
    if (!existing) {
      // Q-462: typed, so the route can answer 404 instead of 500. The block itself is correct and
      // unchanged — nothing is written — but a permanent, correctly-refused condition was reported
      // as a transient server error and logged with a full stack trace as though the server faulted.
      //
      // 404 rather than 403, for the same reason `meal-plans/[id]` gives: a session owned by someone
      // else must not be distinguishable from one that does not exist, or the route becomes a
      // membership oracle for other users' session ids. The id stays in the message for the log; the
      // client sees only "Workout session not found".
      throw new NotFoundError('Workout session')
    }
    return {
      id: workoutSessionId, wasInserted: false,
      phaseId: existing.phaseId ?? undefined,
      phaseType: (existing.phaseType as ProgramPhaseType | null) ?? undefined,
      isEarlyDeload: existing.isEarlyDeload ?? false,
    }
  }

  /**
   * Q-473 — returns whether this call is the one that stamped `completed_at`.
   *
   * The `isNull(completedAt)` guard already made exactly one concurrent request the winner; the
   * affected-row count that says *which* one was thrown away. `completeWorkoutFromPayload` was
   * therefore deciding idempotence from a read taken before the write, so four simultaneous
   * completions of one session each believed they were first and `sessions_in_phase` advanced up
   * to three times off a single workout.
   *
   * Note this is the opposite reading of zero rows from `setSessionRpe` above: there it means "no
   * such session for this user" and is an error; here the guard makes it mean "someone else got
   * there first", which is the normal idempotent path.
   */
  async completeWorkoutSession(workoutSessionId: string, userId: string, completedAt: Date): Promise<boolean> {
    const rows = await this.db.update(s.workoutSessions)
      .set({ completedAt })
      .where(and(
        eq(s.workoutSessions.id, workoutSessionId),
        eq(s.workoutSessions.userId, userId),
        isNull(s.workoutSessions.completedAt),
      ))
      .returning({ id: s.workoutSessions.id })
    return rows.length > 0
  }

  /**
   * Q-460 — returns whether a row was actually updated.
   *
   * The UPDATE is user-scoped, which is correct and is why a cross-account call changes nothing.
   * What was missing is that **both callers treated "matched nothing" as success**: the route
   * answered `200 {"success":true}` for a fabricated session id, and `pushMutations` counted the
   * mutation processed and removed it from the outbox. Local kept the RPE, the server never got it,
   * and nothing retried.
   *
   * Zero rows here is an error, not idempotence. Contrast `setWorkoutSessionWarmupEnd` below, which
   * carries `isNull(warmupEndedAt)` — zero rows there means "already set" and must stay silent. The
   * question to ask of any user-scoped UPDATE is which of the two it is; do not copy this shape
   * without answering it.
   */
  async setSessionRpe(userId: string, workoutSessionId: string, rpe: number): Promise<boolean> {
    const rows = await this.db.update(s.workoutSessions)
      .set({ sessionRpe: rpe, updatedAt: new Date() })
      .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId)))
      .returning({ id: s.workoutSessions.id })
    return rows.length > 0
  }

  async setWorkoutSessionWarmupEnd(userId: string, workoutSessionId: string, warmupEndedAt: Date): Promise<void> {
    await this.db.update(s.workoutSessions)
      .set({ warmupEndedAt })
      .where(and(
        eq(s.workoutSessions.id, workoutSessionId),
        eq(s.workoutSessions.userId, userId),
        isNull(s.workoutSessions.warmupEndedAt),
      ))
  }

  async logExerciseWithId(log: Omit<ExerciseLog, 'sets'> & { id: string }): Promise<void> {
    await this.db.insert(s.exerciseLogs)
      .values({
        id: log.id,
        workoutSessionId: log.workoutSessionId,
        exerciseName: log.exerciseName,
        styleId: log.styleId ?? null,
        styleName: log.styleName ?? null,
        estimated1rm: log.estimated1rm ?? null,
        target80: log.target80 ?? null,
        volume: log.volume ?? null,
        avgReps: log.avgReps ?? null,
        timeToComplete: log.timeToComplete ?? null,
        muscleGroups: log.muscleGroups,
        loggedAt: log.loggedAt,
        interExerciseRestSec: log.interExerciseRestSec ?? null,
        prepTimeSec: log.prepTimeSec ?? null,
      })
      .onConflictDoNothing()
  }

  async logSets(exerciseLogId: string, sets: Omit<SetLog, 'id' | 'exerciseLogId'>[]): Promise<SetLog[]> {
    if (sets.length === 0) return []
    // A payload naming one set_number twice rejects the whole INSERT (21000) and loses every set in
    // the exercise, not just the repeat. Bare EXCLUDED arm → last wins. See `collapse-conflicts.ts`.
    // Collapsed once and reused: the `.returning()` rows are zipped against this array by index
    // below, so collapsing inline would misalign every set after the first duplicate.
    const deduped = collapseOnConflict(sets, set => set.setNumber)
    const rows = await this.db.insert(s.setLogs)
      .values(deduped.map(set => ({
        exerciseLogId, setNumber: set.setNumber, weightKg: set.weightKg,
        reps: set.reps, setTimeSec: set.setTimeSec ?? null,
        restTimeSec: set.restTimeSec ?? null, intensityPct: set.intensityPct ?? null,
        useFor1rm: set.useFor1rm,
        setStartMs: set.setStartMs ?? null,
        setEndMs: set.setEndMs ?? null,
        rpe: set.rpe ?? null,
      })))
      .onConflictDoUpdate({
        target: [s.setLogs.exerciseLogId, s.setLogs.setNumber],
        set: {
          weightKg: sql`EXCLUDED.weight_kg`, reps: sql`EXCLUDED.reps`,
          setTimeSec: sql`EXCLUDED.set_time_sec`, restTimeSec: sql`EXCLUDED.rest_time_sec`,
          intensityPct: sql`EXCLUDED.intensity_pct`, useFor1rm: sql`EXCLUDED.use_for_1rm`,
          setStartMs: sql`EXCLUDED.set_start_ms`, setEndMs: sql`EXCLUDED.set_end_ms`,
          rpe: sql`EXCLUDED.rpe`,
        },
      })
      .returning()
    return rows.map((r, i) => ({ ...deduped[i], id: r.id, exerciseLogId }))
  }

  async logExerciseAndSets(
    userId: string,
    log: Omit<ExerciseLog, 'id' | 'sets'> & { exerciseLogId?: string },
    sets: (Omit<SetLog, 'id' | 'exerciseLogId'> & { id?: string })[],
  ): Promise<{ exerciseLog: ExerciseLog; setLogs: SetLog[] }> {
    return this.db.transaction(async tx => {
      // Resolve exercise_id from library (best-effort; NULL for custom exercises)
      const [libRow] = await tx.select({ id: s.exerciseLibrary.id })
        .from(s.exerciseLibrary)
        .where(eq(s.exerciseLibrary.name, log.exerciseName))
        .limit(1)

      const clientExerciseLogId = log.exerciseLogId ?? crypto.randomUUID()
      // Replay detection AND ownership: an existing exercise_log id must belong to a
      // workout_session owned by this user. A colliding id under someone else's session
      // would otherwise be overwritten (and reassigned into this user's session) by the
      // bare-id upsert below — a cross-user row theft. exercise_logs has no user_id, so
      // ownership is via the workout_sessions join (the assertOwnership pattern).
      const [existing] = await tx.select({ ownerId: s.workoutSessions.userId })
        .from(s.exerciseLogs)
        .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
        .where(eq(s.exerciseLogs.id, clientExerciseLogId))
        .limit(1)
      if (existing && existing.ownerId !== userId) {
        throw new Error('exercise log not owned by user')
      }
      const isReplay = !!existing

      // Same guard for client-supplied set ids: reject any that already exist under
      // another user's exercise log.
      const clientSetIds = sets.map(st => st.id).filter((v): v is string => !!v)
      if (clientSetIds.length > 0) {
        const foreign = await tx.select({ id: s.setLogs.id })
          .from(s.setLogs)
          .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
          .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
          .where(and(inArray(s.setLogs.id, clientSetIds), ne(s.workoutSessions.userId, userId)))
          .limit(1)
        if (foreign.length > 0) throw new Error('set log not owned by user')
      }

      const [r] = await tx.insert(s.exerciseLogs)
        .values({
          id: clientExerciseLogId,
          workoutSessionId: log.workoutSessionId,
          exerciseName: log.exerciseName,
          exerciseId: libRow?.id ?? null,
          styleId: log.styleId ?? null,
          styleName: log.styleName ?? null,
          estimated1rm: log.estimated1rm ?? null,
          target80: log.target80 ?? null,
          volume: log.volume ?? null,
          avgReps: log.avgReps ?? null,
          timeToComplete: log.timeToComplete ?? null,
          muscleGroups: log.muscleGroups,
          loggedAt: log.loggedAt,
          interExerciseRestSec: log.interExerciseRestSec ?? null,
          prepTimeSec: log.prepTimeSec ?? null,
          exerciseDeloaded: log.exerciseDeloaded ?? false,
        })
        .onConflictDoUpdate({
          target: s.exerciseLogs.id,
          set: {
            workoutSessionId: sql`EXCLUDED.workout_session_id`,
            exerciseName: sql`EXCLUDED.exercise_name`,
            exerciseId: sql`EXCLUDED.exercise_id`,
            styleId: sql`EXCLUDED.style_id`,
            styleName: sql`EXCLUDED.style_name`,
            estimated1rm: sql`EXCLUDED.estimated_1rm`,
            target80: sql`EXCLUDED.target_80`,
            volume: sql`EXCLUDED.volume`,
            avgReps: sql`EXCLUDED.avg_reps`,
            timeToComplete: sql`EXCLUDED.time_to_complete`,
            muscleGroups: sql`EXCLUDED.muscle_groups`,
            loggedAt: sql`EXCLUDED.logged_at`,
            interExerciseRestSec: sql`EXCLUDED.inter_exercise_rest_sec`,
            prepTimeSec: sql`EXCLUDED.prep_time_sec`,
            exerciseDeloaded: sql`EXCLUDED.exercise_deloaded`,
          },
        })
        .returning()
      const exerciseLogId = r.id
      const exerciseLog: ExerciseLog = { ...log, id: exerciseLogId, sets: [] }
      if (sets.length === 0) return { exerciseLog, setLogs: [] }
      // Collapsed once and reused: `.returning()` is zipped against this array by index below, and
      // `total_sets` is counted from it — collapsing inline would misalign the first and inflate
      // the second whenever a payload repeats a set id.
      const deduped = collapseOnConflict(
        sets.map(set => ({ ...set, id: set.id ?? crypto.randomUUID() })),
        set => set.id,
      )
      const setRows = await tx.insert(s.setLogs)
        .values(deduped.map(set => ({
          id: set.id,
          exerciseLogId, setNumber: set.setNumber, weightKg: set.weightKg,
          reps: set.reps, setTimeSec: set.setTimeSec ?? null,
          restTimeSec: set.restTimeSec ?? null, intensityPct: set.intensityPct ?? null,
          useFor1rm: set.useFor1rm,
          setStartMs: set.setStartMs ?? null,
          setEndMs: set.setEndMs ?? null,
          rpe: set.rpe ?? null,
          plannedPct: set.plannedPct ?? null,
          plannedReps: set.plannedReps ?? null,
          plannedRestSec: set.plannedRestSec ?? null,
        })))
        .onConflictDoUpdate({
          target: s.setLogs.id,
          set: {
            exerciseLogId: sql`EXCLUDED.exercise_log_id`,
            setNumber: sql`EXCLUDED.set_number`,
            weightKg: sql`EXCLUDED.weight_kg`,
            reps: sql`EXCLUDED.reps`,
            setTimeSec: sql`EXCLUDED.set_time_sec`,
            restTimeSec: sql`EXCLUDED.rest_time_sec`,
            intensityPct: sql`EXCLUDED.intensity_pct`,
            useFor1rm: sql`EXCLUDED.use_for_1rm`,
            setStartMs: sql`EXCLUDED.set_start_ms`,
            setEndMs: sql`EXCLUDED.set_end_ms`,
            rpe: sql`EXCLUDED.rpe`,
            plannedPct: sql`EXCLUDED.planned_pct`,
            plannedReps: sql`EXCLUDED.planned_reps`,
            plannedRestSec: sql`EXCLUDED.planned_rest_sec`,
          },
        })
        .returning()
      const setLogs: SetLog[] = setRows.map((sr, i) => ({ ...deduped[i], id: sr.id, exerciseLogId }))

      // Maintain running totals — count exercise_logs for this session before our insert
      // to detect first exercise (increments total_sessions once per session).
      const [{ prevExCount }] = await tx.select({ prevExCount: sql<number>`COUNT(*)::int` })
        .from(s.exerciseLogs)
        .where(and(
          eq(s.exerciseLogs.workoutSessionId, log.workoutSessionId),
          ne(s.exerciseLogs.id, exerciseLogId),
          isNull(s.exerciseLogs.deletedAt),
        ))
      const [ws] = await tx.select({ userId: s.workoutSessions.userId })
        .from(s.workoutSessions)
        .where(and(eq(s.workoutSessions.id, log.workoutSessionId), isNull(s.workoutSessions.deletedAt)))
        .limit(1)
      if (ws && !isReplay) {
        const sessionDelta = Number(prevExCount) === 0 ? 1 : 0
        const volumeDelta = log.volume ?? 0
        const setsDelta = deduped.length
        await tx.execute(sql`
          INSERT INTO user_stats (user_id, total_sessions, total_volume_kg, total_sets, updated_at)
          VALUES (${ws.userId}::uuid, ${sessionDelta}, ${volumeDelta}, ${setsDelta}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            total_sessions  = user_stats.total_sessions  + ${sessionDelta},
            total_volume_kg = user_stats.total_volume_kg + ${volumeDelta},
            total_sets      = user_stats.total_sets      + ${setsDelta},
            updated_at      = NOW()
        `)
      }

      return { exerciseLog, setLogs }
    })
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  async getCalendarData(userId: string, year: number, month: number, timezone: string = DEFAULT_TZ): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }> {
    // Boundaries are local midnight in the user's own zone, so a session logged in the evening
    // doesn't land on the next calendar day. `aestMidnight` normalises month overflow, so
    // `month + 1` rolls December → January safely (the hand-rolled `Date.UTC(...) - 10h` this
    // replaced also hardcoded the AEST offset).
    const from = aestMidnight(year, month, 1, timezone)
    const to   = aestMidnight(year, month + 1, 1, timezone)
    const rows = await this.db.select({
      dateKey: sql<string>`to_char(${s.workoutSessions.startedAt} AT TIME ZONE ${timezone}, 'YYYY/MM/DD')`,
      // Use current program session name (via FK) so renames are reflected; fall back to stored name
      sessionName: sql<string>`COALESCE(${s.programSessions.name}, ${s.workoutSessions.sessionName})`,
    })
      .from(s.workoutSessions)
      .leftJoin(s.programSessions, eq(s.workoutSessions.programSessionId, s.programSessions.id))
      // Only include sessions that have at least one logged exercise
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
        isNull(s.workoutSessions.deletedAt),
        isNull(s.exerciseLogs.deletedAt),
      ))

    const trainedDays: Record<string, string[]> = {}
    for (const r of rows) {
      if (!trainedDays[r.dateKey]) trainedDays[r.dateKey] = []
      if (!trainedDays[r.dateKey].includes(r.sessionName)) trainedDays[r.dateKey].push(r.sessionName)
    }

    // activity_logs.date is a plain 'YYYY-MM-DD' already in the user's local day
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear  = month === 12 ? year + 1 : year
    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`
    const toDate   = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
    const activityRows = await this.db.select({
      date: s.activityLogs.date,
      activityType: s.activityLogs.activityType,
    })
      .from(s.activityLogs)
      .where(and(
        eq(s.activityLogs.userId, userId),
        gte(s.activityLogs.date, fromDate),
        lt(s.activityLogs.date, toDate),
        isNull(s.activityLogs.deletedAt),
      ))

    const activityDays: Record<string, string[]> = {}
    for (const r of activityRows) {
      const dateKey = r.date.replace(/-/g, '/')
      if (!activityDays[dateKey]) activityDays[dateKey] = []
      if (!activityDays[dateKey].includes(r.activityType)) activityDays[dateKey].push(r.activityType)
    }

    return { trainedDays, activityDays }
  }

  async getRecentTrainedDays(userId: string, days: number, timezone: string = DEFAULT_TZ): Promise<Record<string, string[]>> {
    // Use today's local midnight as a fixed anchor and offset by milliseconds —
    // avoids constructing invalid "YYYY-MM-DD" strings when (day-of-month - days) is negative.
    const todayMidnight = todayMidnightUtc(timezone)
    const from = new Date(todayMidnight.getTime() - days * 24 * 60 * 60 * 1000)
    const to   = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000)

    const rows = await this.db.select({
      dateKey: sql<string>`to_char(${s.workoutSessions.startedAt} AT TIME ZONE ${timezone}, 'YYYY/MM/DD')`,
      sessionName: sql<string>`COALESCE(${s.programSessions.name}, ${s.workoutSessions.sessionName})`,
    })
      .from(s.workoutSessions)
      .leftJoin(s.programSessions, eq(s.workoutSessions.programSessionId, s.programSessions.id))
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
        isNull(s.workoutSessions.deletedAt),
        isNull(s.exerciseLogs.deletedAt),
      ))

    const trainedDays: Record<string, string[]> = {}
    for (const r of rows) {
      if (!trainedDays[r.dateKey]) trainedDays[r.dateKey] = []
      if (!trainedDays[r.dateKey].includes(r.sessionName)) trainedDays[r.dateKey].push(r.sessionName)
    }
    return trainedDays
  }

  private async buildWorkoutSessions(wsRows: typeof s.workoutSessions.$inferSelect[]): Promise<WorkoutSession[]> {
    if (!wsRows.length) return []
    const wsIds = wsRows.map(r => r.id)

    const elRows = await this.db.select().from(s.exerciseLogs)
      .where(and(inArray(s.exerciseLogs.workoutSessionId, wsIds), isNull(s.exerciseLogs.deletedAt)))
      .orderBy(asc(s.exerciseLogs.loggedAt))
    const elIds = elRows.map(r => r.id)

    const setRows = elIds.length
      ? await this.db.select().from(s.setLogs)
          .where(and(inArray(s.setLogs.exerciseLogId, elIds), isNull(s.setLogs.deletedAt)))
          .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))
      : []

    return wsRows.map(ws => ({
      id: ws.id, userId: ws.userId, sessionId: ws.programSessionId ?? undefined,
      sessionName: ws.sessionName, startedAt: ws.startedAt,
      completedAt: ws.completedAt ?? undefined,
      phaseId: ws.phaseId ?? undefined,
      phaseType: (ws.phaseType as ProgramPhaseType | null) ?? undefined,
      isEarlyDeload: ws.isEarlyDeload,
      wasOverride: ws.wasOverride,
      intensityMode: (ws.intensityMode as 'full' | 'deload' | null) ?? null,
      sessionRpe: ws.sessionRpe ?? null,
      exercises: elRows
        .filter(e => e.workoutSessionId === ws.id)
        .map<ExerciseLog>(e => ({
          id: e.id, workoutSessionId: e.workoutSessionId,
          exerciseName: e.exerciseName, styleId: e.styleId ?? undefined,
          styleName: e.styleName ?? undefined, estimated1rm: e.estimated1rm ?? undefined,
          target80: e.target80 ?? undefined, volume: e.volume ?? undefined,
          avgReps: e.avgReps ?? undefined, timeToComplete: e.timeToComplete ?? undefined,
          muscleGroups: e.muscleGroups ?? [], loggedAt: e.loggedAt,
          interExerciseRestSec: e.interExerciseRestSec ?? undefined,
          prepTimeSec: e.prepTimeSec ?? undefined,
          sets: setRows
            .filter(ss => ss.exerciseLogId === e.id)
            .map<SetLog>(ss => ({
              id: ss.id, exerciseLogId: ss.exerciseLogId, setNumber: ss.setNumber,
              weightKg: ss.weightKg, reps: ss.reps,
              setTimeSec: ss.setTimeSec ?? undefined, restTimeSec: ss.restTimeSec ?? undefined,
              intensityPct: ss.intensityPct ?? undefined, useFor1rm: ss.useFor1rm,
              rpe: ss.rpe ?? undefined, plannedRestSec: ss.plannedRestSec ?? undefined,
            })),
        })),
    }))
  }

  async getDayLog(userId: string, date: string, timezone = DEFAULT_TZ): Promise<WorkoutSession[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d, timezone)
    const to   = aestMidnight(y, m, d + 1, timezone)
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
        isNull(s.workoutSessions.deletedAt),
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }

  async getDayExerciseNames(userId: string, date: string, timezone = DEFAULT_TZ): Promise<{ sessionId?: string; exerciseName: string }[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d, timezone)
    const to   = aestMidnight(y, m, d + 1, timezone)
    const rows = await this.db.select({
      sessionId: s.workoutSessions.programSessionId,
      exerciseName: s.exerciseLogs.exerciseName,
    })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
        isNull(s.workoutSessions.deletedAt),
        isNull(s.exerciseLogs.deletedAt),
      ))
    return rows.map(r => ({ sessionId: r.sessionId ?? undefined, exerciseName: r.exerciseName }))
  }

  async getDaySessionSummaries(userId: string, date: string, timezone = DEFAULT_TZ): Promise<{ sessionId?: string; sessionName: string; startedAt: Date; completedAt?: Date }[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d, timezone)
    const to   = aestMidnight(y, m, d + 1, timezone)
    const rows = await this.db.select({
      sessionId:   s.workoutSessions.programSessionId,
      sessionName: s.workoutSessions.sessionName,
      startedAt:   s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    })
      .from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
        isNull(s.workoutSessions.deletedAt),
        sql`EXISTS (SELECT 1 FROM exercise_logs el WHERE el.workout_session_id = ${s.workoutSessions.id} AND el.deleted_at IS NULL)`,
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return rows.map(r => ({ sessionId: r.sessionId ?? undefined, sessionName: r.sessionName, startedAt: r.startedAt, completedAt: r.completedAt ?? undefined }))
  }

  async getWorkoutSessionsFrom(userId: string, from: Date): Promise<WorkoutSession[]> {
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from), isNull(s.workoutSessions.deletedAt)))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }

  async getWorkoutSessionDetail(userId: string, id: string): Promise<WorkoutSession | null> {
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), eq(s.workoutSessions.id, id), isNull(s.workoutSessions.deletedAt)))
    const sessions = await this.buildWorkoutSessions(wsRows)
    return sessions[0] ?? null
  }

  async getSessionLoadsFrom(userId: string, from: Date): Promise<SessionLoad[]> {
    const rows = await this.db
      .select({
        startedAt: s.workoutSessions.startedAt,
        isEarlyDeload: s.workoutSessions.isEarlyDeload,
        phaseType: s.workoutSessions.phaseType,
        volume: sql<number>`COALESCE(SUM(${s.exerciseLogs.volume}), 0)`,
      })
      .from(s.workoutSessions)
      .leftJoin(s.exerciseLogs, and(eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id), isNull(s.exerciseLogs.deletedAt)))
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from), isNull(s.workoutSessions.deletedAt)))
      .groupBy(s.workoutSessions.id)
      .orderBy(asc(s.workoutSessions.startedAt))
    return rows.map(r => ({
      startedAt: r.startedAt,
      isEarlyDeload: r.isEarlyDeload,
      phaseType: (r.phaseType as ProgramPhaseType | null) ?? null,
      volume: Number(r.volume),
    }))
  }

  async getYearReviewTotals(userId: string, from: Date): Promise<YearReviewTotals> {
    const [sessionRow] = await this.db
      .select({
        sessionCount: sql<number>`COUNT(*)`,
        totalMinutes: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${s.workoutSessions.completedAt} - ${s.workoutSessions.startedAt})) / 60), 0)`,
      })
      .from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from), isNull(s.workoutSessions.deletedAt)))

    const [setRow] = await this.db
      .select({
        totalSets: sql<number>`COUNT(${s.setLogs.id})`,
        totalVolumeKg: sql<number>`COALESCE(SUM(${s.setLogs.weightKg} * ${s.setLogs.reps}), 0)`,
      })
      .from(s.setLogs)
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(
        eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from),
        isNull(s.workoutSessions.deletedAt), isNull(s.exerciseLogs.deletedAt), isNull(s.setLogs.deletedAt),
      ))

    return {
      sessionCount: Number(sessionRow?.sessionCount ?? 0),
      totalSets: Number(setRow?.totalSets ?? 0),
      totalVolumeKg: Number(setRow?.totalVolumeKg ?? 0),
      totalMinutes: Math.round(Number(sessionRow?.totalMinutes ?? 0)),
    }
  }

  async getYearReviewTopExercises(userId: string, from: Date, limit: number): Promise<YearReviewTopExercise[]> {
    const rows = await this.db
      .select({
        exerciseName: s.exerciseLogs.exerciseName,
        setCount: sql<number>`COUNT(${s.setLogs.id})`,
        // `> 0`, not `IS NOT NULL`: a deloaded exercise stores estimated_1rm = 0 on purpose
        // (`estimateOneRm` returns 0 when `deloaded`), and 0 passes an IS NOT NULL filter — so a
        // deload landing on the last logged session rendered the year's headline lift as
        // "92.75 → 0 kg". Every sibling reader already guards this way (`getExercise1rmHistory`,
        // `reconcilePersonalRecord`); this was the one that did not.
        first1rm: sql<number | null>`(array_agg(${s.exerciseLogs.estimated1rm} ORDER BY ${s.exerciseLogs.loggedAt} ASC) FILTER (WHERE ${s.exerciseLogs.estimated1rm} > 0))[1]`,
        last1rm: sql<number | null>`(array_agg(${s.exerciseLogs.estimated1rm} ORDER BY ${s.exerciseLogs.loggedAt} DESC) FILTER (WHERE ${s.exerciseLogs.estimated1rm} > 0))[1]`,
        // Grouped by name, and a name maps to one library row, so max() just picks that row's value.
        exerciseType: sql<string | null>`max(${s.exerciseLibrary.exerciseType})`,
      })
      .from(s.setLogs)
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .leftJoin(s.exerciseLibrary, eq(s.exerciseLibrary.id, s.exerciseLogs.exerciseId))
      .where(and(
        eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, from),
        isNull(s.workoutSessions.deletedAt), isNull(s.exerciseLogs.deletedAt), isNull(s.setLogs.deletedAt),
      ))
      .groupBy(s.exerciseLogs.exerciseName)
      .orderBy(desc(sql`COUNT(${s.setLogs.id})`))
      .limit(limit)

    return rows.map(r => ({
      exerciseName: r.exerciseName,
      setCount: Number(r.setCount),
      first1rm: r.first1rm != null ? Number(r.first1rm) : null,
      last1rm: r.last1rm != null ? Number(r.last1rm) : null,
      exerciseType: r.exerciseType ?? null,
    }))
  }

  /**
   * Last NON-DELOAD 1RM per exercise — the prescription basis since Q-202.
   *
   * Deliberately separate from `getLastExerciseLogsBatch`, which must keep returning the
   * genuinely most recent log: the screen still shows what you actually lifted last time,
   * deload or not. Only the *prescribed* weight skips deloads.
   *
   * `estimated_1rm > 0` IS the deload test, not a proxy for one. `estimateOneRm` returns
   * `{ estimated1rm: 0 }` for any deliberately submaximal effort — a static deload phase, an
   * early-deload week, or the AI's per-exercise deload — and stores that 0. So this one
   * predicate covers all three markers without having to keep them in sync, and it also
   * excludes a garbage log that produced no usable estimate. A baseline test during a deload
   * window stores a real value and correctly still counts.
   *
   * Carries `target80` for the same reason: it is the displayed target AND the weight the dial
   * pre-fills to (`workout-screen.tsx`), and a deload row stores 0 there too — so reading it off
   * the last log showed "0 kg" and started the dial at zero for the whole session after a deload.
   */
  async getLastRealOneRmBatch(userId: string, exerciseNames: string[], programId?: string): Promise<Map<string, LastRealOneRm>> {
    if (!exerciseNames.length) return new Map()
    const nameList = sql.join(exerciseNames.map(n => sql`${n}`), sql`, `)
    const programFilter = programId
      ? sql`AND ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ${programId})`
      : sql``
    const result = await this.db.execute<{ exercise_name: string; estimated_1rm: number; target_80: number | null }>(sql`
      SELECT DISTINCT ON (el.exercise_name) el.exercise_name, el.estimated_1rm, el.target_80
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      WHERE ws.user_id = ${userId}
        AND el.exercise_name IN (${nameList})
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
        AND el.estimated_1rm > 0
        -- Mirrors reconcilePersonalRecord's gate, and for the same reason (Q-228). The
        -- estimated_1rm > 0 predicate alone trusts the write-time invariant that a deload set
        -- always stores 0 — and that invariant has been violated in production: the whole-session
        -- deload of 2026-08-06 left one log at estimated_1rm = 85.75 with exercise_deloaded = true,
        -- which this query then handed to resolveWorkingBasis as a real max. Without this filter
        -- there is no read-time backstop for the next write-time regression.
        AND el.exercise_deloaded = false
        ${programFilter}
      ORDER BY el.exercise_name, el.logged_at DESC
    `)
    const map = new Map<string, LastRealOneRm>()
    for (const r of result.rows) {
      if (r.estimated_1rm > 0) {
        map.set(r.exercise_name, {
          estimated1rm: Number(r.estimated_1rm),
          target80: r.target_80 != null && r.target_80 > 0 ? Number(r.target_80) : null,
        })
      }
    }
    return map
  }

  async getLastExerciseLogsBatch(userId: string, exerciseNames: string[], programId?: string): Promise<Map<string, ExerciseLog>> {
    if (!exerciseNames.length) return new Map()

    type SummaryRow = {
      id: string; workout_session_id: string; exercise_name: string;
      style_id: string | null; style_name: string | null;
      estimated_1rm: number | null; target_80: number | null;
      volume: number | null; avg_reps: number | null; time_to_complete: number | null;
      muscle_groups: string[]; logged_at: Date;
    }
    const nameList = sql.join(exerciseNames.map(n => sql`${n}`), sql`, `)
    const programFilter = programId
      ? sql`AND ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ${programId})`
      : sql``
    const result = await this.db.execute<SummaryRow>(sql`
      SELECT DISTINCT ON (el.exercise_name)
        el.id, el.workout_session_id, el.exercise_name, el.style_id, el.style_name,
        el.estimated_1rm, el.target_80, el.volume, el.avg_reps, el.time_to_complete,
        el.muscle_groups, el.logged_at
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      WHERE ws.user_id = ${userId}
        AND el.exercise_name IN (${nameList})
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
        ${programFilter}
      ORDER BY el.exercise_name, el.logged_at DESC
    `)
    const rows = result.rows
    if (!rows.length) return new Map()

    const elIds = rows.map(r => r.id)
    const setRows = await this.db.select().from(s.setLogs)
      .where(and(inArray(s.setLogs.exerciseLogId, elIds), isNull(s.setLogs.deletedAt)))
      .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))

    const map = new Map<string, ExerciseLog>()
    for (const r of rows) {
      map.set(r.exercise_name, {
        id: r.id, workoutSessionId: r.workout_session_id,
        exerciseName: r.exercise_name, styleId: r.style_id ?? undefined,
        styleName: r.style_name ?? undefined, estimated1rm: r.estimated_1rm ?? undefined,
        target80: r.target_80 ?? undefined, volume: r.volume ?? undefined,
        avgReps: r.avg_reps ?? undefined, timeToComplete: r.time_to_complete ?? undefined,
        muscleGroups: r.muscle_groups ?? [], loggedAt: new Date(r.logged_at),
        sets: setRows
          .filter(ss => ss.exerciseLogId === r.id)
          .map(ss => ({
            id: ss.id, exerciseLogId: ss.exerciseLogId, setNumber: ss.setNumber,
            weightKg: ss.weightKg, reps: ss.reps,
            setTimeSec: ss.setTimeSec ?? undefined, restTimeSec: ss.restTimeSec ?? undefined,
            intensityPct: ss.intensityPct ?? undefined, useFor1rm: ss.useFor1rm,
          })),
      })
    }
    return map
  }

  async getExerciseSummary(userId: string): Promise<ExerciseLog[]> {
    // DISTINCT ON is Postgres-specific; use raw SQL via Drizzle's sql tag
    type SummaryRow = {
      id: string; workout_session_id: string; exercise_name: string;
      style_id: string | null; style_name: string | null;
      estimated_1rm: number | null; target_80: number | null;
      volume: number | null; avg_reps: number | null; time_to_complete: number | null;
      muscle_groups: string[]; logged_at: Date;
    }
    const result = await this.db.execute<SummaryRow>(sql`
      SELECT DISTINCT ON (el.exercise_name)
        el.id, el.workout_session_id, el.exercise_name, el.style_id, el.style_name,
        el.estimated_1rm, el.target_80, el.volume, el.avg_reps, el.time_to_complete,
        el.muscle_groups, el.logged_at
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      WHERE ws.user_id = ${userId}
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
      ORDER BY el.exercise_name, el.logged_at DESC
    `)
    const rows = result.rows
    if (!rows.length) return []

    const elIds = rows.map(r => r.id)
    const setRows = await this.db.select().from(s.setLogs)
      .where(and(inArray(s.setLogs.exerciseLogId, elIds), isNull(s.setLogs.deletedAt)))
      .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))

    return rows.map(r => ({
      id: r.id, workoutSessionId: r.workout_session_id,
      exerciseName: r.exercise_name, styleId: r.style_id ?? undefined,
      styleName: r.style_name ?? undefined, estimated1rm: r.estimated_1rm ?? undefined,
      target80: r.target_80 ?? undefined, volume: r.volume ?? undefined,
      avgReps: r.avg_reps ?? undefined, timeToComplete: r.time_to_complete ?? undefined,
      muscleGroups: r.muscle_groups ?? [], loggedAt: new Date(r.logged_at),
      sets: setRows
        .filter(ss => ss.exerciseLogId === r.id)
        .map(ss => ({
          id: ss.id, exerciseLogId: ss.exerciseLogId, setNumber: ss.setNumber,
          weightKg: ss.weightKg, reps: ss.reps,
          setTimeSec: ss.setTimeSec ?? undefined, restTimeSec: ss.restTimeSec ?? undefined,
          intensityPct: ss.intensityPct ?? undefined, useFor1rm: ss.useFor1rm,
        })),
    }))
  }

  async getExerciseHistoryRows(userId: string, exerciseName: string, limit: number): Promise<ExerciseHistoryLogRow[]> {
    type HistoryRow = {
      id: string; logged_at: Date; session_name: string;
      estimated_1rm: number | null; volume: number | null;
      is_early_deload: boolean; phase_type: string | null;
    }
    const result = await this.db.execute<HistoryRow>(sql`
      SELECT el.id, el.logged_at, ws.session_name, el.estimated_1rm, el.volume,
        ws.is_early_deload, ws.phase_type
      FROM exercise_logs el
      JOIN workout_sessions ws ON ws.id = el.workout_session_id
      WHERE ws.user_id = ${userId} AND el.exercise_name = ${exerciseName}
        AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
      ORDER BY el.logged_at DESC
      LIMIT ${limit}
    `)
    const rows = result.rows
    if (!rows.length) return []

    const elIds = rows.map(r => r.id)
    const setRows = await this.db.select({
      exerciseLogId: s.setLogs.exerciseLogId, weightKg: s.setLogs.weightKg, reps: s.setLogs.reps,
      intensityPct: s.setLogs.intensityPct, rpe: s.setLogs.rpe,
    })
      .from(s.setLogs)
      .where(and(inArray(s.setLogs.exerciseLogId, elIds), isNull(s.setLogs.deletedAt)))
      .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))

    return rows.map(r => ({
      id: r.id, loggedAt: new Date(r.logged_at), sessionName: r.session_name,
      estimated1rm: r.estimated_1rm ?? undefined, volume: r.volume ?? undefined,
      isEarlyDeload: r.is_early_deload, phaseType: (r.phase_type as ProgramPhaseType | null) ?? undefined,
      sets: setRows.filter(ss => ss.exerciseLogId === r.id).map(ss => ({
        weightKg: ss.weightKg, reps: ss.reps,
        intensityPct: ss.intensityPct ?? undefined, rpe: ss.rpe ?? undefined,
      })),
    }))
  }

  async listPrevious1rm(userId: string): Promise<Map<string, number>> {
    type Row = { exercise_name: string; estimated_1rm: number }
    const result = await this.db.execute<Row>(sql`
      SELECT exercise_name, estimated_1rm
      FROM (
        SELECT el.exercise_name, el.estimated_1rm,
          ROW_NUMBER() OVER (PARTITION BY el.exercise_name ORDER BY el.logged_at DESC) AS rn
        FROM exercise_logs el
        JOIN workout_sessions ws ON ws.id = el.workout_session_id
        -- \`> 0\`, not \`IS NOT NULL\` (Q-298). A deloaded exercise stores estimated_1rm = 0 **on
        -- purpose** — deload work is submaximal and must not read as a max — so \`IS NOT NULL\`
        -- admitted it as the previous estimate whenever the last-but-one session was a deload.
        --
        -- That produced a signal pair that contradicted itself, and both halves go to the AI:
        -- \`oneRmTrendStatus\` guards \`previous <= 0\` and so reported **flat**, while
        -- \`signals.ts\`'s \`rm1ChangeKg\` (\`current - prev\`) has no such guard and reported the
        -- lifter's **entire 1RM as a gain since last time**. Every sibling query already gates on
        -- \`> 0\`; this was the one that did not.
        WHERE ws.user_id = ${userId} AND el.estimated_1rm > 0
          AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
      ) ranked
      WHERE rn = 2
    `)
    return new Map(result.rows.map(r => [r.exercise_name, r.estimated_1rm]))
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────
  async getNextSession(userId: string, timezone = DEFAULT_TZ): Promise<NextSessionRecommendation> {
    const program = await this.getActiveProgram(userId)
    if (!program || !program.sessions.length) {
      return { isRestDay: false, reason: 'No active program configured', reminderEnabled: false, reminderTime: null }
    }

    const sessions = [...program.sessions].sort((a, b) => a.position - b.position)
    const schedule = program.schedule
    const rem = {
      reminderEnabled: schedule?.reminderEnabled ?? false,
      reminderTime: schedule?.reminderTime ?? null,
    }

    // Fetch recent workout sessions with their stored session name.
    // Using session name (not FK) avoids mismatches after program edits/renames.
    // Only include sessions that have at least one logged exercise — orphaned sessions
    // (opened but no sets logged) would otherwise skew the "most overdue" calculation.
    const recentWsWithName = await this.db.select({
      startedAt:   s.workoutSessions.startedAt,
      sessionName: s.workoutSessions.sessionName,
    })
      .from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        isNull(s.workoutSessions.deletedAt),
        sql`EXISTS (SELECT 1 FROM ${s.exerciseLogs} WHERE ${s.exerciseLogs.workoutSessionId} = ${s.workoutSessions.id} AND ${s.exerciseLogs.deletedAt} IS NULL)`,
      ))
      .orderBy(desc(s.workoutSessions.startedAt))
      .limit(30)

    const lastWs = recentWsWithName[0] ?? null
    const todayAest = todayInTz(timezone)

    // Always show today's actual session first — overrides rest-day rules
    if (lastWs && toAestDay(lastWs.startedAt, timezone) === todayAest) {
      const todaySession = sessions.find(sess => sess.name.toLowerCase() === lastWs.sessionName?.toLowerCase())
      if (todaySession) return { isRestDay: false, session: todaySession, reason: `Already trained: ${todaySession.name}`, ...rem }
    }

    // Compute most-overdue session using name-based last-done lookup
    // (reliable even when workout_sessions.session_id FK is stale after program edits).
    const sessionLastDone = new Map<string, Date | null>()
    for (const sess of sessions) {
      const ws = recentWsWithName.find(w => w.sessionName?.toLowerCase() === sess.name.toLowerCase())
      sessionLastDone.set(sess.id, ws?.startedAt ?? null)
    }
    const nextSession = [...sessions].sort((a, b) => {
      const aDate = sessionLastDone.get(a.id)
      const bDate = sessionLastDone.get(b.id)
      if (!aDate && !bDate) return a.position - b.position
      if (!aDate) return -1
      if (!bDate) return 1
      return aDate.getTime() - bDate.getTime()
    })[0]

    // ── AI Dynamic mode ────────────────────────────────────────────────────────
    if (program.phaseMode === 'ai_dynamic') {
      const todayIso = todayInTz(timezone)
      const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      // Q-489: a calendar day is derived by shifting the date STRING, never by subtracting
      // milliseconds. On a 25-hour DST fall-back day `now − 24h` lands back on today, so the
      // "yesterday" below silently became "today" and dropped a real row from the range.
      const from14dStr = shiftDateStr(todayIso, -14)

      const [muscleAssignmentsMap, ouraRows, moodLog, recentWorkouts, exerciseLibrary, sleepSessions, bodyMetrics, derivedRows, summaryRows, morningCheckin] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
        this.getMoodLog(userId, todayIso),
        this.getWorkoutSessionsFrom(userId, from7d),
        this.listExerciseLibrary(),
        this.listSleepSessions(userId, from14dStr, todayIso),
        this.listBodyMetrics(userId, from14dStr, todayIso),
        this.getOuraDailyDerived(userId, shiftDateStr(todayIso, -1), todayIso),
        this.getOuraDailySummary(userId, todayIso, todayIso),
        this.getDayCheckin(userId, todayIso, 'morning'),
      ])

      const ouraToday = ouraRows[0] ?? null
      const todaySummary = summaryRows[0] ?? null
      const illnessFlag = latestIllnessFromDerived(derivedRows)?.flag ?? null
      // Daytime stress is a same-day signal, so it must read TODAY's row — not
      // derivedRows[0], which is the earliest (yesterday) since the range is
      // [yesterday, today] ASC-sorted. (Illness above intentionally keeps its
      // latest-available fallback.) Mirrors the readiness route's `find(day === todayIso)`.
      const todayDerived = derivedRows.find(r => r.day === todayIso) ?? null
      const history: AiDynamicInput['history'] = recentWsWithName.map(w => ({
        sessionName: w.sessionName ?? '',
        startedAt: w.startedAt,
        hasExercises: true,
      }))

      // Sleep trend: recent-3-vs-baseline duration ratio — shared helper, same formula
      // signals.ts uses (One Formula, One Place). AI-dynamic keeps duration semantics:
      // its 0.85 low-sleep threshold was tuned on hours, not score.
      const sleepTrend = sleepDurationTrend(sleepSessions, timezone)

      // HRV trend: ratio of recent 3 days vs older baseline
      let hrvTrend: number | null = null
      const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)
      if (hrvRows.length >= 4) {
        const sorted = [...hrvRows].sort((a, b) => b.date.localeCompare(a.date))
        const recent3 = sorted.slice(0, 3)
        const older = sorted.slice(3, 10)
        if (older.length > 0) {
          const recentAvg = recent3.reduce((s, m) => s + m.hrvMs!, 0) / recent3.length
          const olderAvg = older.reduce((s, m) => s + m.hrvMs!, 0) / older.length
          hrvTrend = olderAvg > 0 ? recentAvg / olderAvg : null
        }
      }

      const muscleRecovery = computeMuscleRecovery(recentWorkouts, exerciseLibrary)

      // Live BLE-derived readiness — the frozen Cloud column (ouraToday.readinessScore) has been
      // null since the 2026-07-07 re-key. Computed once and reused for BOTH the scoring engine and
      // the signals block below, so the "Why this?" explain page shows the same number the
      // recommendation was actually computed from (W3 §3.2 — the signals read the dead column).
      const liveReadiness = liveReadinessForDay(todayIso, derivedRows, ouraRows)

      // Live temp deviation (from the derived summary), never the frozen Cloud columns (dead
      // since the 2026-07-07 re-key). Cloud stays an explicit pre-re-key fallback only. Computed
      // once and reused for both the scoring engine and the signals block below, so the "Why
      // this?" explain page shows the same numbers the recommendation was actually computed from
      // (Q-105 — previously only the derived boolean `temperatureAlert` reached the UI).
      const temperatureDeviation = todaySummary?.tempDevC ?? ouraToday?.temperatureDeviation ?? null
      // Baseline maturity for the elevated-temp deload gate (≥30 nights). Only our own summary
      // carries a real accrued baseline; the frozen Cloud fallback reports 0 so it can't fire.
      const temperatureBaselineDays = todaySummary?.nHistory ?? 0

      const result = computeAiDynamicNextSession({
        sessions,
        muscleAssignments: muscleAssignmentsMap,
        muscleRecovery,
        history,
        soreMuscles: moodLog?.soreMuscles ?? [],
        // Live BLE-derived readiness, never the frozen Cloud column (dead since the 2026-07-07
        // re-key — the readiness-graded deloads were unreachable, E2-12).
        readinessScore: liveReadiness,
        temperatureDeviation,
        temperatureBaselineDays,
        daySummary: ouraToday?.daySummary ?? null,
        sleepTrend,
        energyLevel: moodLog?.energyLevel ?? null,
        selfReportedSick: resolveSelfReportedSick(moodLog?.bodyState, morningCheckin?.illnessContext),
        hrvTrend,
        illnessFlag,
        stressHighMinutes: todayDerived?.stressHighMinutes ?? null,
        timezone,
        ...rem,
      })

      return {
        ...result,
        signals: {
          muscleRecovery,
          ouraReadiness: liveReadiness,
          sleepTrend,
          hrvTrend,
          energyLevel: moodLog?.energyLevel ?? null,
          soreMuscles: moodLog?.soreMuscles ?? [],
          temperatureDeviation,
          temperatureBaselineDays,
          temperatureAlertThresholdC: TEMP_ALERT_THRESHOLD_C,
        },
      }
    }

    if (schedule?.type === 'weekly' && schedule.days?.length) {
      const dow = todayDayOfWeek(timezone)
      const todayEntry = schedule.days.find(d => d.dayOfWeek === dow)
      if (!todayEntry) {
        // Only show rest day if the user has actually been training recently.
        // Without this, new users (no workouts yet) see "Rest Day" instead of a session prompt.
        const hasTrainedRecently = recentWsWithName.some(ws => {
          const age = Date.now() - ws.startedAt.getTime()
          return age < 7 * 86_400_000
        })
        if (hasTrainedRecently) {
          return { isRestDay: true, reason: 'Rest day — not a scheduled training day', ...rem }
        }
        // Fall through to rotation logic below (shows next session)
      } else if (todayEntry.sessionId) {
        const pinned = sessions.find(sess => sess.id === todayEntry.sessionId)
        return pinned
          ? { isRestDay: false, session: pinned, reason: `Scheduled: ${pinned.name}`, ...rem }
          : { isRestDay: false, session: nextSession, reason: `Scheduled day — rotate: ${nextSession.name}`, ...rem }
      }
      return { isRestDay: false, session: nextSession, reason: `Scheduled day — rotate: ${nextSession.name}`, ...rem }
    }

    // Build a per-day map of session names done (for rest-day detection)
    const midnight = todayMidnightUtc(timezone)
    const recentDays = new Map<string, Set<string>>()
    for (const ws of recentWsWithName) {
      const d = toAestDay(ws.startedAt, timezone)
      if (!recentDays.has(d)) recentDays.set(d, new Set())
      const name = ws.sessionName?.toLowerCase()
      if (name) recentDays.get(d)!.add(name)
    }

    // Walk backwards from yesterday. Count consecutive training days and collect
    // which session types were done — stop at the first rest day (cycle boundary).
    const restAfterN = (schedule?.type === 'rotation' && schedule.restAfterN)
      ? schedule.restAfterN
      : sessions.length
    const isDefaultRotation = !(schedule?.type === 'rotation' && schedule.restAfterN)

    let consecutiveDays = 0
    const currentCycleTypes = new Set<string>()
    for (let i = 1; i <= Math.max(restAfterN, sessions.length) + 1; i++) {
      const d = toAestDay(new Date(midnight.getTime() - i * 86_400_000), timezone)
      const dayData = recentDays.get(d)
      if (dayData && dayData.size > 0) {
        consecutiveDays++
        dayData.forEach(name => currentCycleTypes.add(name))
      } else {
        break
      }
    }

    // Rest if trained restAfterN consecutive days, OR (default mode) completed full cycle.
    // Guard: only show rest day if the user has trained recently — prevents perpetual
    // rest day for users who haven't opened the app in a week or more.
    const hasTrainedRecentlyForRotation = recentWsWithName.some(ws => {
      const age = Date.now() - ws.startedAt.getTime()
      return age < 7 * 86_400_000
    })
    const allSessionsDone = sessions.every(s => currentCycleTypes.has(s.name.toLowerCase()))
    if (hasTrainedRecentlyForRotation && (consecutiveDays >= restAfterN || (isDefaultRotation && allSessionsDone))) {
      const reason = allSessionsDone
        ? `Rest day — full ${sessions.length}-session cycle complete`
        : `Rest day — ${consecutiveDays} days in a row`
      return { isRestDay: true, reason, ...rem }
    }

    if (!lastWs) return { isRestDay: false, session: nextSession, reason: `Starting with ${nextSession.name}`, ...rem }

    return { isRestDay: false, session: nextSession, reason: `Next up: ${nextSession.name}`, ...rem }
  }

  // ── Body & Activity ────────────────────────────────────────────────────────
  async upsertBodyMetrics(userId: string, metrics: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[], source: HealthSource): Promise<void> {
    if (metrics.length === 0) return
    await this.db.insert(s.bodyMetrics)
      // Health Connect ingest and the sync push both send batches keyed only by `date`; one repeat
      // rejects every metric in the batch (21000). The rank arm keeps a stored value when the
      // incoming one is NULL and every row here shares `source`, so `keepLatestNonNull` is that arm.
      .values(collapseOnConflict(metrics, m => m.date, keepLatestNonNull).map(m => {
        const v = {
          userId, date: m.date,
          weightKg: m.weightKg ?? null, bodyFatPct: m.bodyFatPct ?? null,
          calories: m.calories ?? null, proteinG: m.proteinG ?? null,
          carbsG: m.carbsG ?? null, fatG: m.fatG ?? null,
          steps: m.steps ?? null, distanceKm: m.distanceKm ?? null,
          restingHeartRate: m.restingHeartRate ?? null, hrvMs: m.hrvMs ?? null,
          spo2Pct: m.spo2Pct ?? null, waterMl: m.waterMl ?? null,
          activeCalories: (m as BodyMetrics).activeCalories ?? null,
          waistCm: m.waistCm ?? null, chestCm: m.chestCm ?? null, armCm: m.armCm ?? null,
          thighCm: m.thighCm ?? null, hipCm: m.hipCm ?? null, neckCm: m.neckCm ?? null,
          skeletalMusclePct: m.skeletalMusclePct ?? null, fatFreeMassKg: m.fatFreeMassKg ?? null,
          subcutaneousFatPct: m.subcutaneousFatPct ?? null, visceralFatIndex: m.visceralFatIndex ?? null,
          bodyWaterPct: m.bodyWaterPct ?? null, muscleMassKg: m.muscleMassKg ?? null,
          boneMassKg: m.boneMassKg ?? null, proteinPct: m.proteinPct ?? null,
          bmrKcal: m.bmrKcal ?? null, metabolicAge: m.metabolicAge ?? null,
        }
        return { ...v, sourceMap: initialSourceMap(BODY_METRICS_SOURCE_COLS, v, source) }
      }))
      .onConflictDoUpdate({
        target: [s.bodyMetrics.userId, s.bodyMetrics.date],
        set: mergeSet('body_metrics', BODY_METRICS_SOURCE_COLS, source),
      })
  }

  async listBodyMetrics(userId: string, from: string, to: string): Promise<BodyMetrics[]> {
    const rows = await this.db.select().from(s.bodyMetrics)
      .where(and(
        eq(s.bodyMetrics.userId, userId),
        gte(s.bodyMetrics.date, from),
        lte(s.bodyMetrics.date, to),
      ))
      .orderBy(desc(s.bodyMetrics.date))
    return rows.map(r => ({
      id: r.id, userId: r.userId, date: r.date,
      weightKg: r.weightKg ?? undefined, bodyFatPct: r.bodyFatPct ?? undefined,
      calories: r.calories ?? undefined, proteinG: r.proteinG ?? undefined,
      carbsG: r.carbsG ?? undefined, fatG: r.fatG ?? undefined,
      steps: r.steps ?? undefined, distanceKm: r.distanceKm ?? undefined,
      restingHeartRate: r.restingHeartRate ?? undefined,
      hrvMs: r.hrvMs ?? undefined,
      spo2Pct: r.spo2Pct ?? undefined,
      waterMl: r.waterMl ?? undefined,
      activeCalories: r.activeCalories ?? undefined,
      waistCm: r.waistCm ?? undefined, chestCm: r.chestCm ?? undefined, armCm: r.armCm ?? undefined,
      thighCm: r.thighCm ?? undefined, hipCm: r.hipCm ?? undefined, neckCm: r.neckCm ?? undefined,
      skeletalMusclePct: r.skeletalMusclePct ?? undefined, fatFreeMassKg: r.fatFreeMassKg ?? undefined,
      subcutaneousFatPct: r.subcutaneousFatPct ?? undefined, visceralFatIndex: r.visceralFatIndex ?? undefined,
      bodyWaterPct: r.bodyWaterPct ?? undefined, muscleMassKg: r.muscleMassKg ?? undefined,
      boneMassKg: r.boneMassKg ?? undefined, proteinPct: r.proteinPct ?? undefined,
      bmrKcal: r.bmrKcal ?? undefined, metabolicAge: r.metabolicAge ?? undefined,
      createdAt: r.createdAt,
    }))
  }

  async getBodyMetricsBaseline(userId: string): Promise<{ weightKg: number | null; bodyFatPct: number | null }> {
    const [weightRow] = await this.db
      .select({ weightKg: s.bodyMetrics.weightKg })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
      .orderBy(asc(s.bodyMetrics.date)).limit(1)
    const [bfRow] = await this.db
      .select({ bodyFatPct: s.bodyMetrics.bodyFatPct })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.bodyFatPct)))
      .orderBy(asc(s.bodyMetrics.date)).limit(1)
    return { weightKg: weightRow?.weightKg ?? null, bodyFatPct: bfRow?.bodyFatPct ?? null }
  }

  // ── Direct-BLE scale ─────────────────────────────────────────────────────────
  async getMostRecentConfirmedWeightKg(userId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ weightKg: s.bodyMetrics.weightKg })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
      .orderBy(desc(s.bodyMetrics.date)).limit(1)
    return row?.weightKg ?? null
  }

  async insertScaleRawSample(userId: string, sample: ScaleRawSampleInput): Promise<{ id: number }> {
    const [row] = await this.db.insert(s.scaleRawSamples)
      .values({
        userId, measuredAt: sample.measuredAt, rawHex: sample.rawHex,
        decoded: sample.decoded, status: sample.status,
      })
      .returning({ id: s.scaleRawSamples.id })
    return { id: row.id }
  }

  async getConfirmedScaleTrendForDate(userId: string, date: string): Promise<{ weightKg: number } | null> {
    const [row] = await this.db
      .select({ weightKg: s.bodyMetrics.weightKg })
      .from(s.bodyMetrics)
      .where(and(
        eq(s.bodyMetrics.userId, userId),
        eq(s.bodyMetrics.date, date),
        sql`${s.bodyMetrics.sourceMap}->>'weight_kg' = 'scale_ble'`,
      ))
      .limit(1)
    // The source_map filter is what makes the null meaningful: a row whose weight came from
    // `manual` is not a scale trend and must read as absent, so the rank merge keeps owning that
    // case rather than this comparison second-guessing it.
    return row?.weightKg != null ? { weightKg: row.weightKg } : null
  }

  async listConfirmedScaleSamplesForDate(userId: string, date: string, tz: string): Promise<ScalePendingSample[]> {
    const start = dateStrMidnightInTz(date, tz)
    const end = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
    const rows = await this.db.select({
      id: s.scaleRawSamples.id, measuredAt: s.scaleRawSamples.measuredAt, decoded: s.scaleRawSamples.decoded,
    })
      .from(s.scaleRawSamples)
      .where(and(
        eq(s.scaleRawSamples.userId, userId),
        eq(s.scaleRawSamples.status, 'confirmed'),
        gte(s.scaleRawSamples.measuredAt, start),
        lt(s.scaleRawSamples.measuredAt, end),
      ))
      .orderBy(asc(s.scaleRawSamples.measuredAt))
    return rows.map(r => ({ id: r.id, measuredAt: r.measuredAt, decoded: r.decoded as Record<string, unknown> | null }))
  }

  async listPendingScaleSamples(userId: string): Promise<ScalePendingSample[]> {
    const rows = await this.db.select({
      id: s.scaleRawSamples.id, measuredAt: s.scaleRawSamples.measuredAt, decoded: s.scaleRawSamples.decoded,
    })
      .from(s.scaleRawSamples)
      .where(and(eq(s.scaleRawSamples.userId, userId), eq(s.scaleRawSamples.status, 'pending')))
      .orderBy(desc(s.scaleRawSamples.measuredAt))
    return rows.map(r => ({ id: r.id, measuredAt: r.measuredAt, decoded: r.decoded as Record<string, unknown> | null }))
  }

  async confirmScaleSample(userId: string, id: number): Promise<ScalePendingSample | null> {
    const [row] = await this.db.update(s.scaleRawSamples)
      .set({ status: 'confirmed' })
      .where(and(eq(s.scaleRawSamples.id, id), eq(s.scaleRawSamples.userId, userId), eq(s.scaleRawSamples.status, 'pending')))
      .returning({ id: s.scaleRawSamples.id, measuredAt: s.scaleRawSamples.measuredAt, decoded: s.scaleRawSamples.decoded })
    if (!row) return null
    return { id: row.id, measuredAt: row.measuredAt, decoded: row.decoded as Record<string, unknown> | null }
  }

  async dismissScaleSample(userId: string, id: number): Promise<boolean> {
    const result = await this.db.update(s.scaleRawSamples)
      .set({ status: 'dismissed' })
      .where(and(eq(s.scaleRawSamples.id, id), eq(s.scaleRawSamples.userId, userId), eq(s.scaleRawSamples.status, 'pending')))
      .returning({ id: s.scaleRawSamples.id })
    return result.length > 0
  }

  /**
   * A logged activity's calorie estimate, derived here because it cannot be derived anywhere else.
   *
   * Every writer stored `calories_burned` as null (Q-230), two of them behind a comment asserting
   * the server computed it — nothing did, so the column was empty forever and only the Body tab's
   * aggregate, which recomputes the same estimate from the same inputs, ever showed a number.
   *
   * It has to be server-side: `estWorkoutKcal` reads its MET table through `lib/oura-models/
   * constants`, which resolves files with `node:path`. Importing it into a client component drags
   * `node:path` into the browser bundle and fails the build — that is how the first attempt at this
   * was caught, and it is why the fix lives in the one function both the web route and the outbox's
   * `pushMutations` branch already call rather than at each save site.
   *
   * Only ever fills a missing value. A caller that supplies its own kcal keeps it.
   */
  private async deriveActivityKcal(userId: string, activityType: string, durationMin: number | null): Promise<number | null> {
    if (durationMin == null || !(durationMin > 0)) return null
    const [user, weightRow] = await Promise.all([
      this.getUserById(userId),
      this.db.select({ weightKg: s.bodyMetrics.weightKg })
        .from(s.bodyMetrics)
        .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
        .orderBy(desc(s.bodyMetrics.date)).limit(1),
    ])
    const ageYears = ageFromDob(user?.dateOfBirth ?? null, new Date())
    const weightKg = weightRow[0]?.weightKg ?? null
    const sex = user?.sex === 'male' || user?.sex === 'female' ? user.sex : null
    if (ageYears == null || weightKg == null || sex == null) return null
    // Same estimator, same 'moderate' intensity as computeActiveEnergy — a row and the day's total
    // must not disagree about one walk.
    const kcal = estWorkoutKcal({
      durationMin, ageYears, weightKg, sex,
      activityId: ouraIdForActivityType(activityType), intensity: 'moderate',
    })
    if (kcal == null) return null
    // The wire schema declares caloriesBurned .positive(); a rounded-to-zero estimate must stay null.
    const rounded = Math.round(kcal)
    return rounded > 0 ? rounded : null
  }

  async saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'> & { id?: string }, opts?: { overwrite?: boolean }): Promise<ActivityLog> {
    const { id, ...data } = log
    const caloriesBurned = data.caloriesBurned ?? await this.deriveActivityKcal(userId, data.activityType, data.durationMin ?? null)
    // Q-307: pace was read from the column and never derived, so it was absent on 32 of 39 logs
    // that carried both inputs — a client either sends it or leaves it null forever. Same shape as
    // caloriesBurned above: derive server-side when the client didn't supply one, from the two
    // fields that are already present far more often than pace is.
    const avgPaceSecPerKm = data.avgPaceSecPerKm
      ?? (data.durationMin != null && data.distanceKm != null && data.distanceKm > 0
        ? (data.durationMin * 60) / data.distanceKm
        : null)
    const values = {
      ...(id ? { id } : {}),
      userId, date: data.date, activityType: data.activityType, title: data.title,
      startTime: data.startTime ?? null, endTime: data.endTime ?? null,
      durationMin: data.durationMin ?? null, distanceKm: data.distanceKm ?? null,
      caloriesBurned,
      avgHr: data.avgHr ?? null, maxHr: data.maxHr ?? null,
      steps: data.steps ?? null,
      notes: data.notes ?? null,
      routePolyline: data.routePolyline ?? null,
      splits: data.splits ?? null,
      bestEfforts: data.bestEfforts ?? null,
      paceSeries: data.paceSeries ?? null,
      avgPaceSecPerKm,
      elevationGainM: data.elevationGainM ?? null,
      elevationLossM: data.elevationLossM ?? null,
      elevationProfile: data.elevationProfile ?? null,
      cadenceSpm: data.cadenceSpm ?? null,
      cadenceSeries: data.cadenceSeries ?? null,
      cadenceSource: data.cadenceSource ?? null,
      segments: data.segments ?? null,
    }

    if (opts?.overwrite) {
      // Outbox replay: the user's own explicit save wins (last-write-wins), and the
      // updated_at bump makes the merge visible to getSyncDelta. activity_logs has two
      // unique constraints — the PK on `id` and a partial index on
      // (user_id, date, start_time) WHERE start_time IS NOT NULL. If another source
      // (Health Connect / Oura) already logged an activity at this minute, an id-only
      // conflict target throws a duplicate-key error, which strands the mutation in
      // the client outbox forever. When start_time is present, target the
      // natural-identity index so a same-minute collision merges instead of failing.
      const set = {
        title: values.title,
        startTime: values.startTime, endTime: values.endTime,
        durationMin: values.durationMin, distanceKm: values.distanceKm,
        caloriesBurned: values.caloriesBurned,
        avgHr: values.avgHr, maxHr: values.maxHr,
        steps: values.steps,
        notes: values.notes,
        routePolyline: values.routePolyline,
        splits: values.splits,
        bestEfforts: values.bestEfforts,
        paceSeries: values.paceSeries,
        avgPaceSecPerKm: values.avgPaceSecPerKm,
        elevationGainM: values.elevationGainM,
        elevationLossM: values.elevationLossM,
        elevationProfile: values.elevationProfile,
        cadenceSpm: values.cadenceSpm,
        cadenceSeries: values.cadenceSeries,
        cadenceSource: values.cadenceSource,
        segments: values.segments,
        updatedAt: new Date(),
      }
      const [r] = data.startTime
        ? await this.db.insert(s.activityLogs).values(values).onConflictDoUpdate({
            target: [s.activityLogs.userId, s.activityLogs.date, s.activityLogs.startTime],
            targetWhere: isNotNull(s.activityLogs.startTime),
            set,
          }).returning()
        : await this.db.insert(s.activityLogs).values(values).onConflictDoUpdate({
            target: s.activityLogs.id,
            set,
            setWhere: eq(s.activityLogs.userId, userId),
          }).returning()
      return this.rowToActivityLog(r)
    }

    // Default (web create, Health Connect ingest): first-write-wins — an external
    // re-ingest must not clobber a row the user may have edited.
    const [r] = await this.db.insert(s.activityLogs)
      .values(values)
      .onConflictDoNothing()
      .returning()

    if (!r) {
      const [existing] = await this.db.select().from(s.activityLogs)
        .where(and(
          eq(s.activityLogs.userId, userId),
          eq(s.activityLogs.date, data.date),
          data.startTime
            ? eq(s.activityLogs.startTime, data.startTime)
            : isNull(s.activityLogs.startTime),
        ))
        .limit(1)
      return this.rowToActivityLog(existing)
    }
    return this.rowToActivityLog(r)
  }

  private rowToActivityLog(r: typeof s.activityLogs.$inferSelect): ActivityLog {
    return {
      id: r.id, userId: r.userId, date: r.date, activityType: r.activityType, title: r.title,
      startTime: r.startTime ?? undefined, endTime: r.endTime ?? undefined,
      durationMin: r.durationMin ?? undefined, distanceKm: r.distanceKm ?? undefined,
      caloriesBurned: r.caloriesBurned ?? undefined,
      avgHr: r.avgHr ?? undefined, maxHr: r.maxHr ?? undefined,
      steps: r.steps ?? undefined,
      notes: r.notes ?? undefined,
      routePolyline: r.routePolyline ?? undefined,
      splits: r.splits ?? undefined,
      bestEfforts: r.bestEfforts ?? undefined,
      paceSeries: r.paceSeries ?? undefined,
      avgPaceSecPerKm: r.avgPaceSecPerKm ?? undefined,
      elevationGainM: r.elevationGainM ?? undefined,
      elevationLossM: r.elevationLossM ?? undefined,
      elevationProfile: r.elevationProfile ?? undefined,
      cadenceSpm: r.cadenceSpm ?? undefined,
      cadenceSeries: r.cadenceSeries ?? undefined,
      cadenceSource: r.cadenceSource ?? undefined,
      segments: r.segments ?? undefined,
      createdAt: r.createdAt,
    }
  }

  async listExerciseLibrary(): Promise<ExerciseLibraryEntry[]> {
    // Kept unfiltered: exercise_library is global (shared across users), and other consumers of
    // this list (digests, history, muscle-map lookups) resolve metadata for exercises another
    // user may still have logged or configured — a data migration merging one owner's history
    // doesn't retire the catalogue entry for everyone. `mergedInto` is exposed so the exercise
    // PICKER specifically can filter it out (Q-26) without narrowing this shared method.
    const rows = await this.db.select().from(s.exerciseLibrary).orderBy(asc(s.exerciseLibrary.name))
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      muscles: (r.muscles as MuscleAssignment[]) ?? [],
      equipment: r.equipment ?? [],
      instructions: r.instructions ?? undefined,
      exerciseType: (r.exerciseType as ExerciseType) ?? 'weighted',
      mergedInto: r.mergedInto ?? undefined,
    }))
  }

  async listExerciseMuscleMap(): Promise<Pick<ExerciseLibraryEntry, 'name' | 'muscles'>[]> {
    const rows = await this.db
      .select({ name: s.exerciseLibrary.name, muscles: s.exerciseLibrary.muscles })
      .from(s.exerciseLibrary)
    return rows.map(r => ({ name: r.name, muscles: (r.muscles as MuscleAssignment[]) ?? [] }))
  }

  async getExerciseType(exerciseName: string): Promise<ExerciseType> {
    const rows = await this.db
      .select({ exerciseType: s.exerciseLibrary.exerciseType })
      .from(s.exerciseLibrary)
      .where(sql`LOWER(${s.exerciseLibrary.name}) = LOWER(${exerciseName})`)
      .limit(1)
    return (rows[0]?.exerciseType as ExerciseType) ?? 'weighted'
  }

  async upsertExercise(entry: Omit<ExerciseLibraryEntry, 'id'> & { id?: string }): Promise<ExerciseLibraryEntry> {
    const [row] = await this.db.insert(s.exerciseLibrary)
      .values({
        ...(entry.id ? { id: entry.id } : {}),
        name: entry.name,
        muscles: entry.muscles,
        equipment: entry.equipment,
        instructions: entry.instructions ?? null,
        exerciseType: entry.exerciseType ?? 'weighted',
      })
      .onConflictDoUpdate({
        target: s.exerciseLibrary.name,
        set: {
          muscles: sql`EXCLUDED.muscles`,
          equipment: sql`EXCLUDED.equipment`,
          instructions: sql`COALESCE(EXCLUDED.instructions, ${s.exerciseLibrary.instructions})`,
          exerciseType: sql`EXCLUDED.exercise_type`,
        },
      })
      .returning()
    return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [], instructions: row.instructions ?? undefined, exerciseType: (row.exerciseType as ExerciseType) ?? 'weighted' }
  }

  async deleteExercise(name: string): Promise<void> {
    await this.db.delete(s.exerciseLibrary).where(eq(s.exerciseLibrary.name, name))
  }

  async createExercise(entry: { name: string; muscles: MuscleAssignment[]; equipment: string[]; instructions?: string; createdBy: string; exerciseType?: ExerciseType }): Promise<ExerciseLibraryEntry> {
    const [row] = await this.db.insert(s.exerciseLibrary)
      .values({
        name: entry.name,
        muscles: entry.muscles,
        equipment: entry.equipment,
        instructions: entry.instructions ?? null,
        createdBy: entry.createdBy,
        exerciseType: entry.exerciseType ?? 'weighted',
      })
      .returning()
    return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [], instructions: row.instructions ?? undefined, createdBy: row.createdBy ?? undefined, exerciseType: (row.exerciseType as ExerciseType) ?? 'weighted' }
  }

  async renameExercise(userId: string, id: string, newName: string): Promise<ExerciseLibraryEntry> {
    return await this.db.transaction(async tx => {
      const [existing] = await tx.select().from(s.exerciseLibrary).where(eq(s.exerciseLibrary.id, id))
      if (!existing) throw new NotFoundError('Exercise')
      if (existing.createdBy !== userId) throw new UserFacingError('Not authorized to rename this exercise', 403)
      const oldName = existing.name
      await tx.update(s.sessionExercises).set({ exerciseName: newName }).where(eq(s.sessionExercises.exerciseName, oldName))
      await tx.update(s.exerciseLogs).set({ exerciseName: newName }).where(eq(s.exerciseLogs.exerciseName, oldName))
      await tx.update(s.personalRecords).set({ exerciseName: newName }).where(eq(s.personalRecords.exerciseName, oldName))
      const [row] = await tx.update(s.exerciseLibrary).set({ name: newName }).where(eq(s.exerciseLibrary.id, id)).returning()
      return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [], instructions: row.instructions ?? undefined, createdBy: row.createdBy ?? undefined, exerciseType: (row.exerciseType as ExerciseType) ?? 'weighted' }
    })
  }

  async adminUpdateExercise(entry: { id: string; name: string; muscles: MuscleAssignment[]; equipment: string[]; instructions?: string; exerciseType?: ExerciseType }): Promise<ExerciseLibraryEntry> {
    return await this.db.transaction(async tx => {
      const [existing] = await tx.select().from(s.exerciseLibrary).where(eq(s.exerciseLibrary.id, entry.id))
      if (!existing) throw new NotFoundError('Exercise')

      const oldName = existing.name
      const newName = entry.name

      if (newName !== oldName) {
        const [conflict] = await tx.select({ id: s.exerciseLibrary.id }).from(s.exerciseLibrary)
          .where(and(eq(s.exerciseLibrary.name, newName), ne(s.exerciseLibrary.id, entry.id)))
        if (conflict) throw new UserFacingError(`An exercise named "${newName}" already exists`, 409)

        await tx.update(s.sessionExercises).set({ exerciseName: newName }).where(eq(s.sessionExercises.exerciseName, oldName))
        await tx.update(s.exerciseLogs).set({ exerciseName: newName }).where(eq(s.exerciseLogs.exerciseName, oldName))
        await tx.update(s.personalRecords).set({ exerciseName: newName }).where(eq(s.personalRecords.exerciseName, oldName))
        // Old name's cached GIF is now orphaned — the route re-sets or clears the cache for
        // the new name based on the submitted gifUrl.
        await tx.delete(s.exerciseGifCache).where(eq(s.exerciseGifCache.exerciseName, oldName))
      }

      const [row] = await tx.update(s.exerciseLibrary)
        .set({
          name: newName,
          muscles: entry.muscles,
          equipment: entry.equipment,
          instructions: entry.instructions !== undefined ? entry.instructions : existing.instructions,
          exerciseType: entry.exerciseType ?? 'weighted',
        })
        .where(eq(s.exerciseLibrary.id, entry.id))
        .returning()
      return { id: row.id, name: row.name, muscles: row.muscles as MuscleAssignment[], equipment: row.equipment ?? [], instructions: row.instructions ?? undefined, exerciseType: (row.exerciseType as ExerciseType) ?? 'weighted' }
    })
  }

  async listActivityLogs(userId: string, from: string, to: string): Promise<ActivityLog[]> {
    const rows = await this.db.select().from(s.activityLogs)
      .where(and(
        eq(s.activityLogs.userId, userId),
        gte(s.activityLogs.date, from),
        lte(s.activityLogs.date, to),
        isNull(s.activityLogs.deletedAt),
      ))
      .orderBy(desc(s.activityLogs.date))
    return rows.map(r => this.rowToActivityLog(r))
  }

  async getActivityLogById(userId: string, id: string): Promise<ActivityLog | null> {
    const [row] = await this.db.select().from(s.activityLogs)
      .where(and(
        eq(s.activityLogs.id, id),
        eq(s.activityLogs.userId, userId),
        isNull(s.activityLogs.deletedAt),
      ))
      .limit(1)
    return row ? this.rowToActivityLog(row) : null
  }

  async updateActivityLogMetrics(userId: string, id: string, patch: { distanceKm?: number; caloriesBurned?: number; avgHr?: number; maxHr?: number }): Promise<void> {
    const set: Record<string, unknown> = {}
    if (patch.distanceKm !== undefined) set.distanceKm = sql`COALESCE(${s.activityLogs.distanceKm}, ${patch.distanceKm})`
    if (patch.caloriesBurned !== undefined) set.caloriesBurned = sql`COALESCE(${s.activityLogs.caloriesBurned}, ${patch.caloriesBurned})`
    if (patch.avgHr !== undefined) set.avgHr = sql`COALESCE(${s.activityLogs.avgHr}, ${patch.avgHr})`
    if (patch.maxHr !== undefined) set.maxHr = sql`COALESCE(${s.activityLogs.maxHr}, ${patch.maxHr})`
    if (Object.keys(set).length === 0) return
    await this.db.update(s.activityLogs)
      .set(set)
      .where(and(eq(s.activityLogs.id, id), eq(s.activityLogs.userId, userId)))
  }

  // Returns whether the (id, user) pair matched anything, so the route can stop reporting success
  // for a delete that touched nothing (Q-556). The WHERE deliberately does NOT filter
  // `deleted_at IS NULL`: a re-delete of a row you already deleted still matches and still reports
  // `true`, which is what keeps the operation idempotent for a double-tap or a row already deleted
  // on another device. `false` means genuinely absent or not yours — and those two stay
  // indistinguishable, which is the enumeration property the review's control pass verified.
  async deleteActivityLog(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.update(s.activityLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.activityLogs.id, id), eq(s.activityLogs.userId, userId)))
      .returning({ id: s.activityLogs.id })
    return rows.length > 0
  }

  async saveFitnessTest(userId: string, test: Omit<FitnessTest, 'userId'>): Promise<FitnessTest> {
    const values = {
      id: test.id, userId, testType: test.testType, date: test.date,
      durationSec: test.durationSec ?? null, distanceM: test.distanceM ?? null,
      avgHr: test.avgHr ?? null, maxHr: test.maxHr ?? null,
      restingHr: test.restingHr ?? null, hrr1Bpm: test.hrr1Bpm ?? null,
      vo2maxEst: test.vo2maxEst ?? null, method: test.method ?? null,
      notes: test.notes ?? null,
    }
    // Client-minted id; last-write-wins on replay (bump updated_at so getSyncDelta
    // re-emits). No external source writes fitness_tests, so an id-only conflict
    // target is safe (unlike activity_logs' same-minute collision case).
    const [r] = await this.db.insert(s.fitnessTests).values(values)
      .onConflictDoUpdate({
        target: s.fitnessTests.id,
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(s.fitnessTests.userId, userId),
      })
      .returning()
    return this.rowToFitnessTest(r)
  }

  async listFitnessTests(userId: string, from: string, to: string): Promise<FitnessTest[]> {
    const rows = await this.db.select().from(s.fitnessTests)
      .where(and(
        eq(s.fitnessTests.userId, userId),
        gte(s.fitnessTests.date, from),
        lte(s.fitnessTests.date, to),
        isNull(s.fitnessTests.deletedAt),
      ))
      .orderBy(desc(s.fitnessTests.date))
    return rows.map(r => this.rowToFitnessTest(r))
  }

  async deleteFitnessTest(userId: string, id: string): Promise<void> {
    await this.db.update(s.fitnessTests)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.fitnessTests.id, id), eq(s.fitnessTests.userId, userId)))
  }

  private rowToFitnessTest(r: typeof s.fitnessTests.$inferSelect): FitnessTest {
    return {
      id: r.id, userId: r.userId, testType: r.testType, date: r.date,
      durationSec: r.durationSec ?? undefined, distanceM: r.distanceM ?? undefined,
      avgHr: r.avgHr ?? undefined, maxHr: r.maxHr ?? undefined,
      restingHr: r.restingHr ?? undefined, hrr1Bpm: r.hrr1Bpm ?? undefined,
      vo2maxEst: r.vo2maxEst ?? undefined, method: r.method ?? undefined,
      notes: r.notes ?? undefined,
    }
  }

  async getActiveRunningPlan(userId: string): Promise<RunningPlan | null> {
    const [r] = await this.db.select().from(s.runningPlans)
      .where(and(eq(s.runningPlans.userId, userId), eq(s.runningPlans.isActive, true)))
      .limit(1)
    return r ? this.rowToRunningPlan(r) : null
  }

  async saveRunningPlan(userId: string, plan: Omit<RunningPlan, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RunningPlan> {
    // A new plan supersedes the previous one — deactivate any active plan first
    // (scoped to the user) so the partial-unique index never collides.
    await this.db.update(s.runningPlans)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(s.runningPlans.userId, userId), eq(s.runningPlans.isActive, true)))
    const values = {
      id: plan.id, userId,
      goalKind: plan.goalKind,
      targetDistanceKm: plan.targetDistanceKm ?? null,
      targetDate: plan.targetDate ?? null,
      frameworkKey: plan.frameworkKey,
      timePerSessionMinutes: plan.timePerSessionMinutes ?? null,
      fitnessSnapshot: plan.fitnessSnapshot ?? {},
      isActive: plan.isActive,
    }
    const [r] = await this.db.insert(s.runningPlans).values(values).returning()
    return this.rowToRunningPlan(r)
  }

  async getPrescribedRuns(userId: string, from: string, to: string): Promise<PrescribedRun[]> {
    const rows = await this.db.select().from(s.prescribedRuns)
      .where(and(
        eq(s.prescribedRuns.userId, userId),
        gte(s.prescribedRuns.date, from),
        lte(s.prescribedRuns.date, to),
        isNull(s.prescribedRuns.deletedAt),
      ))
      .orderBy(asc(s.prescribedRuns.date))
    return rows.map(r => this.rowToPrescribedRun(r))
  }

  async upsertPrescribedRun(userId: string, run: Omit<PrescribedRun, 'userId' | 'updatedAt'>): Promise<PrescribedRun> {
    const values = {
      id: run.id, userId, planId: run.planId, date: run.date, runType: run.runType,
      durationMin: run.durationMin ?? null, distanceKm: run.distanceKm ?? null,
      targetHrLow: run.targetHrLow ?? null, targetHrHigh: run.targetHrHigh ?? null,
      targetZoneIds: run.targetZoneIds, rationale: run.rationale, gateAction: run.gateAction,
      status: run.status, activityLogId: run.activityLogId ?? null,
    }
    const [r] = await this.db.insert(s.prescribedRuns).values(values)
      .onConflictDoUpdate({
        target: [s.prescribedRuns.userId, s.prescribedRuns.planId, s.prescribedRuns.date],
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(s.prescribedRuns.userId, userId),
      })
      .returning()
    return this.rowToPrescribedRun(r)
  }

  async updatePrescribedRun(userId: string, id: string, patch: PrescribedRunUpdate): Promise<PrescribedRun | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.activityLogId !== undefined) set.activityLogId = patch.activityLogId
    const [r] = await this.db.update(s.prescribedRuns)
      .set(set)
      .where(and(eq(s.prescribedRuns.id, id), eq(s.prescribedRuns.userId, userId)))
      .returning()
    return r ? this.rowToPrescribedRun(r) : null
  }

  private rowToRunningPlan(r: typeof s.runningPlans.$inferSelect): RunningPlan {
    return {
      id: r.id, userId: r.userId, goalKind: r.goalKind,
      targetDistanceKm: r.targetDistanceKm ?? null, targetDate: r.targetDate ?? null,
      frameworkKey: r.frameworkKey, fitnessSnapshot: r.fitnessSnapshot,
      timePerSessionMinutes: r.timePerSessionMinutes ?? null,
      isActive: r.isActive, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  }

  private rowToPrescribedRun(r: typeof s.prescribedRuns.$inferSelect): PrescribedRun {
    return {
      id: r.id, userId: r.userId, planId: r.planId, date: r.date, runType: r.runType,
      durationMin: r.durationMin ?? null, distanceKm: r.distanceKm ?? null,
      targetHrLow: r.targetHrLow ?? null, targetHrHigh: r.targetHrHigh ?? null,
      targetZoneIds: (r.targetZoneIds as number[] | null) ?? [],
      rationale: r.rationale, gateAction: r.gateAction,
      status: r.status as PrescribedRun['status'], activityLogId: r.activityLogId ?? null,
      updatedAt: r.updatedAt,
    }
  }

  async listActivityTypes(): Promise<ActivityType[]> {
    const rows = await this.db.select().from(s.activityTypes).orderBy(asc(s.activityTypes.sortOrder))
    return rows.map(r => ({
      id: r.id, label: r.label, icon: r.icon,
      isDistanceBased: r.isDistanceBased, sortOrder: r.sortOrder,
    }))
  }

  async createActivityType(data: { label: string; icon: string; isDistanceBased: boolean; sortOrder: number }): Promise<ActivityType> {
    const base = data.label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'activity'
    let id = base
    let suffix = 1
    while ((await this.db.select({ id: s.activityTypes.id }).from(s.activityTypes).where(eq(s.activityTypes.id, id)))[0]) {
      suffix++
      id = `${base}-${suffix}`
    }
    const [row] = await this.db.insert(s.activityTypes)
      .values({ id, label: data.label, icon: data.icon, isDistanceBased: data.isDistanceBased, sortOrder: data.sortOrder })
      .returning()
    return { id: row.id, label: row.label, icon: row.icon, isDistanceBased: row.isDistanceBased, sortOrder: row.sortOrder }
  }

  async updateActivityType(id: string, patch: Partial<{ label: string; icon: string; isDistanceBased: boolean; sortOrder: number }>): Promise<ActivityType> {
    const [row] = await this.db.update(s.activityTypes).set(patch).where(eq(s.activityTypes.id, id)).returning()
    if (!row) throw new NotFoundError('Activity type')
    return { id: row.id, label: row.label, icon: row.icon, isDistanceBased: row.isDistanceBased, sortOrder: row.sortOrder }
  }

  async deleteActivityType(id: string): Promise<void> {
    const [inUse] = await this.db.select({ id: s.activityLogs.id }).from(s.activityLogs).where(eq(s.activityLogs.activityType, id)).limit(1)
    if (inUse) throw new Error('Activity type is in use')
    await this.db.delete(s.activityTypes).where(eq(s.activityTypes.id, id))
  }

  // One write function per domain: this goes through the same rank-merge upsert as the ring's
  // own sleep write, so a Health Connect night and a ring night for the same sleep_start merge
  // per-field instead of first-write-wins. Before this it was a bare onConflictDoNothing with no
  // source_map, which made every Health Connect night a rank-0 writer (Q-43).
  async saveSleepSession(userId: string, session: Omit<SleepSession, 'id' | 'userId' | 'createdAt'>, source: HealthSource): Promise<void> {
    await oura.upsertOuraSleep(this.db, userId, [{
      date:             session.date,
      sleepStart:       session.sleepStart,
      sleepEnd:         session.sleepEnd,
      durationHours:    session.durationHours    ?? null,
      deepSleepHours:   session.deepSleepHours   ?? null,
      remSleepHours:    session.remSleepHours    ?? null,
      lightSleepHours:  session.lightSleepHours  ?? null,
      awakHours:        session.awakHours        ?? null,
      sleepPhase5Min:   session.sleepPhase5Min   ?? null,
    }], source)
  }

  async listSleepSessions(userId: string, from: string, to: string): Promise<SleepSession[]> {
    const rows = await this.db.select().from(s.sleepSessions)
      .where(and(
        eq(s.sleepSessions.userId, userId),
        gte(s.sleepSessions.date, from),
        lte(s.sleepSessions.date, to),
      ))
      .orderBy(desc(s.sleepSessions.date))
    return rows.map(r => ({
      id: r.id, userId: r.userId, date: r.date,
      sleepStart:      r.sleepStart,
      sleepEnd:        r.sleepEnd,
      durationHours:   r.durationHours   ?? undefined,
      deepSleepHours:  r.deepSleepHours  ?? undefined,
      remSleepHours:   r.remSleepHours   ?? undefined,
      lightSleepHours: r.lightSleepHours ?? undefined,
      awakHours:       r.awakHours       ?? undefined,
      createdAt:       r.createdAt,
      ouraId:          r.ouraId          ?? null,
      efficiency:      r.efficiency      ?? undefined,
      onsetLatencySec: r.onsetLatencySec ?? undefined,
      averageHrvMs:    r.averageHrvMs    ?? undefined,
      avgHeartRate:    r.avgHeartRate    ?? undefined,
      lowestHeartRate: r.lowestHeartRate ?? undefined,
      restlessPeriods: r.restlessPeriods ?? undefined,
      sleepScore:      r.sleepScore      ?? undefined,
      respiratoryRate: r.respiratoryRate ?? undefined,
      sleepPhase5Min:  r.sleepPhase5Min  ?? undefined,
      timeInBedHours:  r.timeInBedHours  ?? undefined,
    }))
  }

  async getExerciseMuscleAssignments(names: string[]): Promise<Record<string, MuscleAssignment[]>> {
    if (names.length === 0) return {}
    const rows = await this.db
      .select({ name: s.exerciseLibrary.name, muscles: s.exerciseLibrary.muscles })
      .from(s.exerciseLibrary)
      .where(inArray(s.exerciseLibrary.name, names))
    const result: Record<string, MuscleAssignment[]> = {}
    for (const row of rows) {
      result[row.name] = (row.muscles as MuscleAssignment[]) ?? []
    }
    return result
  }

  async getExerciseTypes(names: string[]): Promise<Record<string, string>> {
    if (names.length === 0) return {}
    const rows = await this.db
      .select({ name: s.exerciseLibrary.name, exerciseType: s.exerciseLibrary.exerciseType })
      .from(s.exerciseLibrary)
      .where(inArray(s.exerciseLibrary.name, names))
    const result: Record<string, string> = {}
    for (const row of rows) {
      if (row.exerciseType) result[row.name] = row.exerciseType
    }
    return result
  }

  async getExerciseEquipment(names: string[]): Promise<Record<string, string[]>> {
    if (names.length === 0) return {}
    const rows = await this.db
      .select({ name: s.exerciseLibrary.name, equipment: s.exerciseLibrary.equipment })
      .from(s.exerciseLibrary)
      .where(inArray(s.exerciseLibrary.name, names))
    const result: Record<string, string[]> = {}
    for (const row of rows) {
      result[row.name] = row.equipment ?? []
    }
    return result
  }

  async getTimingAuditData(userId: string, sinceDays: number) {
    const baselineDateStr = await this.getTimingBaselineDate(userId)
    const baselineMidnight = baselineDateStr ? dateStrMidnightInTz(baselineDateStr) : null
    const since = clampWindowStart(new Date(Date.now() - sinceDays * 86_400_000), baselineMidnight)
    const wsRows = await this.db
      .select({
        id: s.workoutSessions.id,
        startedAt: s.workoutSessions.startedAt,
        completedAt: s.workoutSessions.completedAt,
        warmupEndedAt: s.workoutSessions.warmupEndedAt,
      })
      .from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), gte(s.workoutSessions.startedAt, since), isNull(s.workoutSessions.deletedAt)))
    const wsIds = wsRows.map(r => r.id)
    if (wsIds.length === 0) return { sets: [], exercises: [], sessions: [] }

    const elRows = await this.db
      .select({
        id: s.exerciseLogs.id,
        workoutSessionId: s.exerciseLogs.workoutSessionId,
        exerciseName: s.exerciseLogs.exerciseName,
        interExerciseRestSec: s.exerciseLogs.interExerciseRestSec,
        equipment: s.exerciseLibrary.equipment,
      })
      .from(s.exerciseLogs)
      .leftJoin(s.exerciseLibrary, eq(s.exerciseLogs.exerciseName, s.exerciseLibrary.name))
      .where(and(inArray(s.exerciseLogs.workoutSessionId, wsIds), isNull(s.exerciseLogs.deletedAt)))

    const elIds = elRows.map(r => r.id)
    const setRows = elIds.length
      ? await this.db
          .select({
            exerciseLogId: s.setLogs.exerciseLogId,
            setNumber: s.setLogs.setNumber,
            reps: s.setLogs.reps,
            setTimeSec: s.setLogs.setTimeSec,
            restTimeSec: s.setLogs.restTimeSec,
            setStartMs: s.setLogs.setStartMs,
          })
          .from(s.setLogs)
          .where(and(inArray(s.setLogs.exerciseLogId, elIds), isNull(s.setLogs.deletedAt)))
      : []

    const elById = new Map(elRows.map(r => [r.id, r]))
    return {
      sessions: wsRows.map(r => ({
        workoutSessionId: r.id,
        startedAt: r.startedAt.getTime(),
        completedAt: r.completedAt?.getTime() ?? null,
        warmupEndedAt: r.warmupEndedAt?.getTime() ?? null,
      })),
      exercises: elRows.map(r => ({
        workoutSessionId: r.workoutSessionId,
        exerciseName: r.exerciseName,
        equipment: r.equipment ?? [],
        interExerciseRestSec: r.interExerciseRestSec ?? null,
      })),
      sets: setRows.map(r => {
        const el = elById.get(r.exerciseLogId)!
        return {
          workoutSessionId: el.workoutSessionId,
          exerciseName: el.exerciseName,
          equipment: el.equipment ?? [],
          setNumber: r.setNumber,
          reps: r.reps,
          setTimeSec: r.setTimeSec ?? null,
          restTimeSec: r.restTimeSec ?? null,
          setStartMs: r.setStartMs ?? null,
        }
      }),
    }
  }

  async listMoodLogs(userId: string, from: string, to: string): Promise<MoodLog[]> {
    const rows = await this.db.select().from(s.moodLogs)
      .where(and(
        eq(s.moodLogs.userId, userId),
        gte(s.moodLogs.logDate, from),
        lte(s.moodLogs.logDate, to),
        isNull(s.moodLogs.deletedAt),
      ))
      .orderBy(desc(s.moodLogs.logDate))
    return rows.map(r => ({
      id: r.id, userId: r.userId, logDate: r.logDate,
      energyLevel: r.energyLevel as import('@trainingai/shared/types/mood').EnergyLevel,
      sleepQuality: r.sleepQuality as import('@trainingai/shared/types/mood').SleepQuality,
      bodyState: (r.bodyState ?? []) as import('@trainingai/shared/types/mood').BodyState[],
      soreMuscles: r.soreMuscles ?? [],
      createdAt: r.createdAt,
    }))
  }

  async incrementWaterLog(userId: string, date: string, ml: number): Promise<void> {
    await this.db.insert(s.bodyMetrics)
      .values({ userId, date, waterMl: ml })
      .onConflictDoUpdate({
        target: [s.bodyMetrics.userId, s.bodyMetrics.date],
        set: { waterMl: sql`COALESCE(${s.bodyMetrics.waterMl}, 0) + ${ml}` },
      })
  }

  /**
   * Q-481 — the same increment, but at most once per outbox mutation id.
   *
   * The outbox delivers at-least-once: a push that reaches the server and commits but whose response
   * is lost stays `pending` on the device and is re-pushed. Every other push branch upserts on
   * `(user_id, date)` or a client-supplied row id and survives that; this one adds, so three
   * deliveries of one 250 ml quick-add measured 750 ml.
   *
   * Claim-then-apply rather than check-then-apply. `ON CONFLICT DO NOTHING … RETURNING` makes the
   * claim itself the exclusion, so two concurrent replays of one id cannot both read "not applied"
   * and both add — the same reason `completeWorkoutSession` reads its own affected-row count
   * (Q-473) instead of a prior SELECT. Both statements share a transaction, so a failed increment
   * releases the claim and the mutation is retried rather than silently swallowed.
   *
   * Note this does NOT make the *write* idempotent, and must not be changed to: an absolute set
   * would reintroduce SYNC-P7, where two genuinely distinct concurrent adds clobber instead of
   * summing. Distinct adds still sum; only a repeat of the same id is refused.
   */
  async incrementWaterLogOnce(userId: string, date: string, ml: number, mutationId: string): Promise<boolean> {
    // Opportunistic prune off the write path — this app has no cron layer, so that is the
    // established shape (`retention-throttle.ts`, and the two oura_heartrate/rr_intervals sites).
    // A ledger with no caller for its prune is the Q-538 mistake, and this table would grow one row
    // per quick-add forever.
    //
    // 90 days is far past anything that can still be replayed: a replay only happens because the
    // device lost the *response* to a push the server already committed, and it re-pushes on the
    // next sync after reconnect. The row is only load-bearing between those two moments.
    const now = Date.now()
    if (shouldPrune(PostgresWorkoutRepository.lastAppliedMutationsPrune, now, APPLIED_MUTATIONS_PRUNE_THROTTLE_MS)) {
      PostgresWorkoutRepository.lastAppliedMutationsPrune = now
      this.db.execute(sql`DELETE FROM applied_mutations WHERE applied_at < now() - interval '90 days'`)
        .catch(err => console.error('[prune] applied_mutations failed:', err))
    }

    return this.db.transaction(async tx => {
      const claimed = await tx.insert(s.appliedMutations)
        .values({ userId, mutationId })
        .onConflictDoNothing()
        .returning({ mutationId: s.appliedMutations.mutationId })
      if (claimed.length === 0) return false

      await tx.insert(s.bodyMetrics)
        .values({ userId, date, waterMl: ml })
        .onConflictDoUpdate({
          target: [s.bodyMetrics.userId, s.bodyMetrics.date],
          set: { waterMl: sql`COALESCE(${s.bodyMetrics.waterMl}, 0) + ${ml}` },
        })
      return true
    })
  }

  async getUserGoals(userId: string): Promise<UserGoals> {
    const [row] = await this.db
      .select({
        stepsGoal:       s.users.stepsGoal,
        stepsGoalType:   s.users.stepsGoalType,
        sleepGoalHours:  s.users.sleepGoalHours,
        calorieGoal:     s.users.calorieGoal,
        calorieGoalType: s.users.calorieGoalType,
        waterGoalMl:     s.users.waterGoalMl,
        waterGoalType:   s.users.waterGoalType,
        targetWeightKg:  s.users.targetWeightKg,
        targetBfPct:     s.users.targetBfPct,
      })
      .from(s.users)
      .where(eq(s.users.id, userId))
    return {
      stepsGoal:       row?.stepsGoal       ?? null,
      stepsGoalType:   (row?.stepsGoalType   as 'daily' | 'weekly' | null) ?? null,
      sleepGoalHours:  row?.sleepGoalHours   ?? null,
      calorieGoal:     row?.calorieGoal      ?? null,
      calorieGoalType: (row?.calorieGoalType as 'daily' | 'weekly' | null) ?? null,
      waterGoalMl:     row?.waterGoalMl      ?? null,
      waterGoalType:   (row?.waterGoalType   as 'daily' | 'weekly' | null) ?? null,
      targetWeightKg:  row?.targetWeightKg   ?? null,
      targetBfPct:     row?.targetBfPct      ?? null,
    }
  }

  async updateUserGoals(userId: string, goals: Partial<UserGoals>): Promise<void> {
    const set: Record<string, unknown> = {}
    if (goals.stepsGoal       !== undefined) set.stepsGoal       = goals.stepsGoal
    if (goals.stepsGoalType   !== undefined) set.stepsGoalType   = goals.stepsGoalType
    if (goals.sleepGoalHours  !== undefined) set.sleepGoalHours  = goals.sleepGoalHours
    if (goals.calorieGoal     !== undefined) set.calorieGoal     = goals.calorieGoal
    if (goals.calorieGoalType !== undefined) set.calorieGoalType = goals.calorieGoalType
    if (goals.waterGoalMl     !== undefined) set.waterGoalMl     = goals.waterGoalMl
    if (goals.waterGoalType   !== undefined) set.waterGoalType   = goals.waterGoalType
    if (goals.targetWeightKg  !== undefined) set.targetWeightKg  = goals.targetWeightKg
    if (goals.targetBfPct     !== undefined) set.targetBfPct     = goals.targetBfPct
    if (Object.keys(set).length === 0) return
    await this.db.update(s.users).set(set).where(eq(s.users.id, userId))
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const [row] = await this.db
      .select({ preferences: s.users.preferences })
      .from(s.users)
      .where(eq(s.users.id, userId))
    return (row?.preferences ?? {}) as UserPreferences
  }

  async updateUserPreferences(userId: string, patch: Record<string, unknown>): Promise<UserPreferences> {
    // Read-modify-write under a row lock, not a bare read then update: the whole point of this
    // feature is two devices holding the same account, and an unlocked read-modify-write there
    // silently drops whichever device's key lost the race — the exact failure the feature exists
    // to remove. The lock is held for one merge of a small object.
    return this.db.transaction(async tx => {
      const [row] = await tx
        .select({ preferences: s.users.preferences })
        .from(s.users)
        .where(eq(s.users.id, userId))
        .for('update')
      if (!row) throw new Error('User not found')
      const merged = mergePreferences((row.preferences ?? {}) as UserPreferences, patch)
      await tx.update(s.users).set({ preferences: merged }).where(eq(s.users.id, userId))
      return merged
    })
  }

  // ── Mood ──────────────────────────────────────────────────────────────────
  async getMoodLog(userId: string, date: string): Promise<import('@trainingai/shared/types/mood').MoodLog | null> {
    const [r] = await this.db.select().from(s.moodLogs)
      .where(and(eq(s.moodLogs.userId, userId), eq(s.moodLogs.logDate, date), isNull(s.moodLogs.deletedAt)))
      .limit(1)
    if (!r) return null
    return {
      id: r.id, userId: r.userId, logDate: r.logDate,
      energyLevel: r.energyLevel as import('@trainingai/shared/types/mood').EnergyLevel,
      sleepQuality: r.sleepQuality as import('@trainingai/shared/types/mood').SleepQuality,
      bodyState: (r.bodyState ?? []) as import('@trainingai/shared/types/mood').BodyState[],
      soreMuscles: r.soreMuscles ?? [],
      createdAt: r.createdAt,
    }
  }

  async saveMoodLog(userId: string, log: Omit<import('@trainingai/shared/types/mood').MoodLog, 'id' | 'userId' | 'createdAt'>): Promise<import('@trainingai/shared/types/mood').MoodLog> {
    const [r] = await this.db.insert(s.moodLogs)
      .values({
        userId, logDate: log.logDate,
        energyLevel: log.energyLevel,
        sleepQuality: log.sleepQuality,
        bodyState: log.bodyState,
        soreMuscles: log.soreMuscles,
      })
      .onConflictDoUpdate({
        target: [s.moodLogs.userId, s.moodLogs.logDate],
        set: {
          energyLevel:  sql`EXCLUDED.energy_level`,
          sleepQuality: sql`EXCLUDED.sleep_quality`,
          bodyState:    sql`EXCLUDED.body_state`,
          soreMuscles:  sql`EXCLUDED.sore_muscles`,
        },
      })
      .returning()
    return {
      id: r.id, userId: r.userId, logDate: r.logDate,
      energyLevel: r.energyLevel as import('@trainingai/shared/types/mood').EnergyLevel,
      sleepQuality: r.sleepQuality as import('@trainingai/shared/types/mood').SleepQuality,
      bodyState: (r.bodyState ?? []) as import('@trainingai/shared/types/mood').BodyState[],
      soreMuscles: r.soreMuscles ?? [],
      createdAt: r.createdAt,
    }
  }

  async getDayCheckin(userId: string, logDate: string, phase: string): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin | null> {
    const [r] = await this.db.select().from(s.dayCheckins)
      .where(and(eq(s.dayCheckins.userId, userId), eq(s.dayCheckins.logDate, logDate),
                 eq(s.dayCheckins.phase, phase), isNull(s.dayCheckins.deletedAt)))
      .limit(1)
    if (!r) return null
    return {
      id: r.id, userId: r.userId, logDate: r.logDate, phase: r.phase as 'evening' | 'morning',
      physicalTiredness: r.physicalTiredness, mentalDrain: r.mentalDrain, barelyMoved: r.barelyMoved,
      hydration: r.hydration, lateHeavyMeal: r.lateHeavyMeal,
      wakeMood: r.wakeMood, perceivedRecovery: r.perceivedRecovery, motivation: r.motivation,
      sleepQualityFeel: r.sleepQualityFeel, restingSoreness: r.restingSoreness,
      illnessContext: r.illnessContext as import('@trainingai/shared/types/day-checkin').IllnessContext | null,
      perceivedRecoveryTouched: r.perceivedRecoveryTouched, sleepQualityFeelTouched: r.sleepQualityFeelTouched,
      soreMuscles: r.soreMuscles ?? [],
      journal: r.journal, foodLoggingCompletedAt: r.foodLoggingCompletedAt,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  }

  async listDayCheckins(userId: string, from: string, to: string, phase: string): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin[]> {
    const rows = await this.db.select().from(s.dayCheckins)
      .where(and(eq(s.dayCheckins.userId, userId), gte(s.dayCheckins.logDate, from), lte(s.dayCheckins.logDate, to),
                 eq(s.dayCheckins.phase, phase), isNull(s.dayCheckins.deletedAt)))
      .orderBy(asc(s.dayCheckins.logDate))
    return rows.map(r => ({
      id: r.id, userId: r.userId, logDate: r.logDate, phase: r.phase as 'evening' | 'morning',
      physicalTiredness: r.physicalTiredness, mentalDrain: r.mentalDrain, barelyMoved: r.barelyMoved,
      hydration: r.hydration, lateHeavyMeal: r.lateHeavyMeal,
      wakeMood: r.wakeMood, perceivedRecovery: r.perceivedRecovery, motivation: r.motivation,
      sleepQualityFeel: r.sleepQualityFeel, restingSoreness: r.restingSoreness,
      illnessContext: r.illnessContext as import('@trainingai/shared/types/day-checkin').IllnessContext | null,
      perceivedRecoveryTouched: r.perceivedRecoveryTouched, sleepQualityFeelTouched: r.sleepQualityFeelTouched,
      soreMuscles: r.soreMuscles ?? [],
      journal: r.journal, foodLoggingCompletedAt: r.foodLoggingCompletedAt,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }))
  }

  /**
   * Q-387: `foodLoggingCompletedAt` is deliberately OPTIONAL here and is left alone when omitted.
   * Finishing your food log and filling in the evening wellness check-in are separate acts on the
   * same row, and this upsert overwrites every column it names — so listing it unconditionally
   * would clear the flag every time the check-in was saved or edited. Pass `null` explicitly to
   * undo; pass nothing to leave it as it is.
   */
  async saveDayCheckin(userId: string, checkin: Omit<import('@trainingai/shared/types/day-checkin').DayCheckin, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'foodLoggingCompletedAt'> & { foodLoggingCompletedAt?: Date | null }): Promise<import('@trainingai/shared/types/day-checkin').DayCheckin> {
    const [r] = await this.db.insert(s.dayCheckins)
      .values({
        userId,
        logDate:           checkin.logDate,
        phase:             checkin.phase,
        physicalTiredness: checkin.physicalTiredness,
        mentalDrain:       checkin.mentalDrain,
        barelyMoved:       checkin.barelyMoved,
        hydration:         checkin.hydration,
        lateHeavyMeal:     checkin.lateHeavyMeal,
        wakeMood:          checkin.wakeMood,
        perceivedRecovery: checkin.perceivedRecovery,
        motivation:        checkin.motivation,
        sleepQualityFeel:  checkin.sleepQualityFeel,
        restingSoreness:   checkin.restingSoreness,
        illnessContext:            checkin.illnessContext,
        perceivedRecoveryTouched:  checkin.perceivedRecoveryTouched,
        sleepQualityFeelTouched:   checkin.sleepQualityFeelTouched,
        soreMuscles:       checkin.soreMuscles,
        journal:           checkin.journal,
        foodLoggingCompletedAt: checkin.foodLoggingCompletedAt ?? null,
        updatedAt:         new Date(),
      })
      .onConflictDoUpdate({
        target: [s.dayCheckins.userId, s.dayCheckins.logDate, s.dayCheckins.phase],
        set: {
          physicalTiredness: sql`EXCLUDED.physical_tiredness`,
          mentalDrain:       sql`EXCLUDED.mental_drain`,
          barelyMoved:       sql`EXCLUDED.barely_moved`,
          hydration:         sql`EXCLUDED.hydration`,
          lateHeavyMeal:     sql`EXCLUDED.late_heavy_meal`,
          wakeMood:          sql`EXCLUDED.wake_mood`,
          perceivedRecovery: sql`EXCLUDED.perceived_recovery`,
          motivation:        sql`EXCLUDED.motivation`,
          sleepQualityFeel:  sql`EXCLUDED.sleep_quality_feel`,
          restingSoreness:   sql`EXCLUDED.resting_soreness`,
          illnessContext:            sql`EXCLUDED.illness_context`,
          perceivedRecoveryTouched:  sql`EXCLUDED.perceived_recovery_touched`,
          sleepQualityFeelTouched:   sql`EXCLUDED.sleep_quality_feel_touched`,
          soreMuscles:       sql`EXCLUDED.sore_muscles`,
          journal:           sql`EXCLUDED.journal`,
          // Only when the caller supplied one — otherwise keep whatever is stored (see the note
          // above; an unconditional EXCLUDED here clears the flag on every check-in save).
          ...(checkin.foodLoggingCompletedAt !== undefined
            ? { foodLoggingCompletedAt: sql`EXCLUDED.food_logging_completed_at` }
            : {}),
          updatedAt:         new Date(),
        },
      })
      .returning()
    return {
      id: r.id, userId: r.userId, logDate: r.logDate, phase: r.phase as 'evening' | 'morning',
      physicalTiredness: r.physicalTiredness, mentalDrain: r.mentalDrain, barelyMoved: r.barelyMoved,
      hydration: r.hydration, lateHeavyMeal: r.lateHeavyMeal,
      wakeMood: r.wakeMood, perceivedRecovery: r.perceivedRecovery, motivation: r.motivation,
      sleepQualityFeel: r.sleepQualityFeel, restingSoreness: r.restingSoreness,
      illnessContext: r.illnessContext as import('@trainingai/shared/types/day-checkin').IllnessContext | null,
      perceivedRecoveryTouched: r.perceivedRecoveryTouched, sleepQualityFeelTouched: r.sleepQualityFeelTouched,
      soreMuscles: r.soreMuscles ?? [],
      journal: r.journal, foodLoggingCompletedAt: r.foodLoggingCompletedAt,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }
  }

  async countWorkoutSessions(userId: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text as count FROM workout_sessions WHERE user_id = ${userId} AND completed_at IS NOT NULL AND deleted_at IS NULL`
    )
    const r = result.rows[0]
    return parseInt(r?.count ?? '0', 10)
  }

  async getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null> {
    if (!programSessionIds.length) return null
    const rows = await this.db.select({ startedAt: s.workoutSessions.startedAt })
      .from(s.workoutSessions)
      .where(
        and(
          eq(s.workoutSessions.userId, userId),
          inArray(s.workoutSessions.programSessionId, programSessionIds),
          isNull(s.workoutSessions.deletedAt),
        )
      )
      .orderBy(asc(s.workoutSessions.startedAt))
      .limit(1)
    return rows[0]?.startedAt ?? null
  }

  // ── Personal Records ───────────────────────────────────────────────────────
  async getPersonalRecord(userId: string, exerciseName: string): Promise<{ estimated1rm: number } | null> {
    const [r] = await this.db.select({ estimated1rm: s.personalRecords.estimated1rm })
      .from(s.personalRecords)
      .where(and(eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
      .limit(1)
    return r ?? null
  }

  private async resolveExerciseId(exerciseName: string): Promise<string | null> {
    const [row] = await this.db.select({ id: s.exerciseLibrary.id })
      .from(s.exerciseLibrary)
      .where(eq(s.exerciseLibrary.name, exerciseName))
      .limit(1)
    return row?.id ?? null
  }

  // `achievedAt` defaults to now (a genuinely-new PR happened now). The reconcile
  // path passes the surviving best log's own loggedAt so a delete/edit doesn't
  // re-date a months-old PR to today (E1-6 — phantom "new PR" in digests/recaps).
  async upsertPersonalRecord(userId: string, exerciseName: string, estimated1rm: number, achievedAt: Date = new Date()): Promise<void> {
    const exerciseId = await this.resolveExerciseId(exerciseName)
    await this.db.insert(s.personalRecords)
      .values({ userId, exerciseName, exerciseId, estimated1rm, achievedAt })
      .onConflictDoUpdate({
        target: [s.personalRecords.userId, s.personalRecords.exerciseName],
        set: { estimated1rm, achievedAt, exerciseId },
      })
  }

  /** The user-entered starting 1RM. Unconditional by design — unlike a personal record this
   *  is the user restating their own estimate, so a lower value is a correction, not a
   *  regression to be rejected. */
  async upsertExerciseEstimate(userId: string, exerciseName: string, estimated1rm: number): Promise<void> {
    const exerciseId = await this.resolveExerciseId(exerciseName)
    await this.db.insert(s.exerciseEstimates)
      .values({ userId, exerciseName, exerciseId, estimated1rm })
      .onConflictDoUpdate({
        target: [s.exerciseEstimates.userId, s.exerciseEstimates.exerciseName],
        set: { estimated1rm, exerciseId, updatedAt: new Date() },
      })
  }

  async getExerciseEstimates(userId: string): Promise<{ exerciseName: string; estimated1rm: number }[]> {
    return this.db
      .select({ exerciseName: s.exerciseEstimates.exerciseName, estimated1rm: s.exerciseEstimates.estimated1rm })
      .from(s.exerciseEstimates)
      .where(eq(s.exerciseEstimates.userId, userId))
  }

  async upsertPersonalRecordIfBetter(userId: string, exerciseName: string, estimated1rm: number): Promise<boolean> {
    const exerciseId = await this.resolveExerciseId(exerciseName)
    return this.db.transaction(async tx => {
      const [existing] = await tx
        .select({ best: s.personalRecords.estimated1rm })
        .from(s.personalRecords)
        .where(and(eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
        .for('update')
      if (existing && estimated1rm <= existing.best) return false
      await tx.insert(s.personalRecords)
        .values({ userId, exerciseName, exerciseId, estimated1rm, achievedAt: new Date() })
        .onConflictDoUpdate({
          target: [s.personalRecords.userId, s.personalRecords.exerciseName],
          set: { estimated1rm, achievedAt: new Date(), exerciseId },
        })
      return true
    })
  }

  // Recompute the all-time PR for an exercise from surviving exercise_logs (excluding
  // deload sessions — mirrors the log path's PR gate) after an edit or delete may have
  // invalidated the row personal_records currently points at. Corrects PRs downward.
  async reconcilePersonalRecord(userId: string, exerciseName: string): Promise<void> {
    const [best] = await this.db
      .select({ estimated1rm: s.exerciseLogs.estimated1rm, loggedAt: s.exerciseLogs.loggedAt })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        eq(s.exerciseLogs.exerciseName, exerciseName),
        gt(s.exerciseLogs.estimated1rm, 0),
        isNull(s.exerciseLogs.deletedAt),
        isNull(s.workoutSessions.deletedAt),
        // Mirrors shouldCountTowardPr's per-exercise deload gate — unconditional, no
        // baseline exception (the exercise itself was cut, unlike a whole-session deload).
        eq(s.exerciseLogs.exerciseDeloaded, false),
        // Mirrors log-exercise.ts's isAnyDeload gate exactly, including NULL phase_type
        // (manual-mode programs never set it) counting as "not deload" — a plain `ne()`
        // comparison against NULL is unknown in SQL and would wrongly exclude those rows.
        or(
          eq(s.workoutSessions.phaseType, 'baseline'),
          and(
            or(isNull(s.workoutSessions.phaseType), ne(s.workoutSessions.phaseType, 'deload')),
            eq(s.workoutSessions.isEarlyDeload, false),
          ),
        ),
      ))
      .orderBy(desc(s.exerciseLogs.estimated1rm), asc(s.exerciseLogs.loggedAt))
      .limit(1)

    if (!best?.estimated1rm) {
      await this.db.delete(s.personalRecords).where(and(
        eq(s.personalRecords.userId, userId), eq(s.personalRecords.exerciseName, exerciseName)))
      return
    }
    await this.upsertPersonalRecord(userId, exerciseName, best.estimated1rm, best.loggedAt ?? new Date())
  }

  // personal_records holds one row per exercise (the all-time best). This returns
  // exercises whose all-time-best estimated1rm was achieved within the window —
  // not every workout set logged in that window.
  async listRecentPersonalRecords(userId: string, from: Date, to: Date): Promise<{ exerciseName: string; estimated1rm: number; achievedAt: Date; exerciseType: string | null }[]> {
    return this.db
      .select({
        exerciseName: s.personalRecords.exerciseName,
        estimated1rm: s.personalRecords.estimated1rm,
        achievedAt: s.personalRecords.achievedAt,
        // A bodyweight record's estimated1rm is a BW_REF-relative index, not kilograms. Without
        // this the caller cannot tell the two apart, and comparing them ranks a 6-rep pull-up
        // above a 96 kg bench press.
        exerciseType: s.exerciseLibrary.exerciseType,
      })
      .from(s.personalRecords)
      .leftJoin(s.exerciseLibrary, eq(s.exerciseLibrary.id, s.personalRecords.exerciseId))
      .where(and(
        eq(s.personalRecords.userId, userId),
        gte(s.personalRecords.achievedAt, from),
        lte(s.personalRecords.achievedAt, to),
      ))
      .orderBy(desc(s.personalRecords.achievedAt))
  }

  async listPersonalRecords(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ exerciseName: s.personalRecords.exerciseName, estimated1rm: s.personalRecords.estimated1rm })
      .from(s.personalRecords)
      .where(eq(s.personalRecords.userId, userId))
    return new Map(rows.map(r => [r.exerciseName, r.estimated1rm]))
  }

  async listMaxReps(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        exerciseName: s.exerciseLogs.exerciseName,
        maxReps: sql<number>`max(${s.setLogs.reps})`,
      })
      .from(s.setLogs)
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.id, s.setLogs.exerciseLogId))
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(eq(s.workoutSessions.userId, userId), isNull(s.setLogs.deletedAt), isNull(s.exerciseLogs.deletedAt), isNull(s.workoutSessions.deletedAt)))
      .groupBy(s.exerciseLogs.exerciseName)
    return new Map(rows.map(r => [r.exerciseName, Number(r.maxReps)]))
  }

  // ── Data Tools ───────────────────────────────────────────────────────────
  async listLoggedExerciseNames(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ name: s.exerciseLogs.exerciseName })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(eq(s.workoutSessions.userId, userId), isNull(s.exerciseLogs.deletedAt), isNull(s.workoutSessions.deletedAt)))
      .orderBy(asc(s.exerciseLogs.exerciseName))
    return rows.map(r => r.name)
  }

  async previewLbsToKgFix(userId: string, exerciseNames: string[], beforeDate: string, tz = DEFAULT_TZ): Promise<UnitFixResult> {
    if (exerciseNames.length === 0) return { logs: [], exercises: [] }
    const [y, m, d] = beforeDate.split('-').map(Number)
    const cutoff = aestMidnight(y, m, d, tz)

    const allLogs = await this.db.select({
      id: s.exerciseLogs.id,
      exerciseName: s.exerciseLogs.exerciseName,
      loggedAt: s.exerciseLogs.loggedAt,
      estimated1rm: s.exerciseLogs.estimated1rm,
      target80: s.exerciseLogs.target80,
      volume: s.exerciseLogs.volume,
    })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        inArray(s.exerciseLogs.exerciseName, exerciseNames),
        isNull(s.exerciseLogs.deletedAt),
        isNull(s.workoutSessions.deletedAt),
      ))
      .orderBy(asc(s.exerciseLogs.loggedAt))

    const inRangeIds = allLogs.filter(l => l.loggedAt < cutoff).map(l => l.id)
    const allSets = inRangeIds.length > 0
      ? await this.db.select({
          id: s.setLogs.id,
          exerciseLogId: s.setLogs.exerciseLogId,
          setNumber: s.setLogs.setNumber,
          weightKg: s.setLogs.weightKg,
          reps: s.setLogs.reps,
        })
          .from(s.setLogs)
          .where(and(inArray(s.setLogs.exerciseLogId, inRangeIds), isNull(s.setLogs.deletedAt)))
          .orderBy(asc(s.setLogs.setNumber))
      : []

    const prRows = await this.db.select({
      exerciseName: s.personalRecords.exerciseName,
      estimated1rm: s.personalRecords.estimated1rm,
    })
      .from(s.personalRecords)
      .where(and(eq(s.personalRecords.userId, userId), inArray(s.personalRecords.exerciseName, exerciseNames)))

    const fix = computeLbsToKgFix(exerciseNames, allLogs, allSets, new Map(prRows.map(r => [r.exerciseName, r.estimated1rm])), cutoff)
    return toUnitFixResult(fix)
  }

  async applyLbsToKgFix(userId: string, exerciseNames: string[], beforeDate: string, tz = DEFAULT_TZ): Promise<UnitFixResult> {
    if (exerciseNames.length === 0) return { logs: [], exercises: [] }
    const [y, m, d] = beforeDate.split('-').map(Number)
    const cutoff = aestMidnight(y, m, d, tz)

    return this.db.transaction(async tx => {
      const allLogs = await tx.select({
        id: s.exerciseLogs.id,
        exerciseName: s.exerciseLogs.exerciseName,
        loggedAt: s.exerciseLogs.loggedAt,
        estimated1rm: s.exerciseLogs.estimated1rm,
        target80: s.exerciseLogs.target80,
        volume: s.exerciseLogs.volume,
      })
        .from(s.exerciseLogs)
        .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
        .where(and(
          eq(s.workoutSessions.userId, userId),
          inArray(s.exerciseLogs.exerciseName, exerciseNames),
        ))
        .orderBy(asc(s.exerciseLogs.loggedAt))

      const inRangeIds = allLogs.filter(l => l.loggedAt < cutoff).map(l => l.id)
      const allSets = inRangeIds.length > 0
        ? await tx.select({
            id: s.setLogs.id,
            exerciseLogId: s.setLogs.exerciseLogId,
            setNumber: s.setLogs.setNumber,
            weightKg: s.setLogs.weightKg,
            reps: s.setLogs.reps,
          })
            .from(s.setLogs)
            .where(and(inArray(s.setLogs.exerciseLogId, inRangeIds), isNull(s.setLogs.deletedAt)))
            .orderBy(asc(s.setLogs.setNumber))
        : []

      const prRows = await tx.select({
        exerciseName: s.personalRecords.exerciseName,
        estimated1rm: s.personalRecords.estimated1rm,
      })
        .from(s.personalRecords)
        .where(and(eq(s.personalRecords.userId, userId), inArray(s.personalRecords.exerciseName, exerciseNames)))

      const fix = computeLbsToKgFix(exerciseNames, allLogs, allSets, new Map(prRows.map(r => [r.exerciseName, r.estimated1rm])), cutoff)

      for (const log of fix.logs) {
        for (const set of log.sets) {
          await tx.update(s.setLogs)
            .set({ weightKg: set.newWeightKg, intensityPct: set.newIntensityPct })
            .where(eq(s.setLogs.id, set.id))
        }
        await tx.update(s.exerciseLogs)
          .set({ estimated1rm: log.newEstimated1rm, target80: log.newTarget80, volume: log.newVolume })
          .where(eq(s.exerciseLogs.id, log.exerciseLogId))
      }

      for (const ex of fix.exercises) {
        if (ex.newPersonalRecord != null && ex.newPersonalRecord > 0) {
          await tx.insert(s.personalRecords)
            .values({
              userId, exerciseName: ex.exerciseName,
              estimated1rm: ex.newPersonalRecord,
              achievedAt: ex.newPersonalRecordAchievedAt ?? new Date(),
            })
            .onConflictDoUpdate({
              target: [s.personalRecords.userId, s.personalRecords.exerciseName],
              set: { estimated1rm: ex.newPersonalRecord, achievedAt: ex.newPersonalRecordAchievedAt ?? new Date() },
            })
        }
      }

      return toUnitFixResult(fix)
    })
  }

  // ── Nutrition (delegated to slices/nutrition.ts) ───────────────────────────

  async listMealTypes(userId: string) { return n.listMealTypes(this.db, userId) }
  async createMealType(userId: string, data: Omit<MealType, 'id' | 'userId' | 'createdAt'>) { return n.createMealType(this.db, userId, data) }
  async updateMealType(id: string, userId: string, data: Partial<Omit<MealType, 'id' | 'userId' | 'createdAt'>>) { return n.updateMealType(this.db, id, userId, data) }
  async deleteMealType(id: string, userId: string) { return n.deleteMealType(this.db, id, userId) }
  async countLiveFoodLogsForMealType(userId: string, mealTypeId: string) { return n.countLiveFoodLogsForMealType(this.db, userId, mealTypeId) }
  async reassignAndDeleteMealType(userId: string, fromId: string, toId: string) { return n.reassignAndDeleteMealType(this.db, userId, fromId, toId) }
  async reorderMealTypes(userId: string, orderedIds: string[]) { return n.reorderMealTypes(this.db, userId, orderedIds) }
  async seedDefaultMealTypes(userId: string) { return n.seedDefaultMealTypes(this.db, userId) }
  async createFoodItem(userId: string, data: Omit<FoodItem, 'id' | 'userId' | 'createdAt'> & { id?: string }) { return n.createFoodItem(this.db, userId, data) }
  async searchFoodItems(userId: string, query: string) { return n.searchFoodItems(this.db, userId, query) }
  async listFoodLogs(userId: string, date: string) { return n.listFoodLogs(this.db, userId, date) }
  async createFoodLog(userId: string, data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'> & { id?: string; loggedAt?: Date }) { return n.createFoodLog(this.db, userId, data) }
  async foodLogRefsValid(userId: string, mealTypeId: string, foodItemId: string) { return n.foodLogRefsValid(this.db, userId, mealTypeId, foodItemId) }
  async updateFoodLog(id: string, userId: string, quantityMultiplier: number) { return n.updateFoodLog(this.db, id, userId, quantityMultiplier) }
  async deleteFoodLog(id: string, userId: string) { return n.deleteFoodLog(this.db, id, userId) }
  async listFoodLogsSummary(userId: string, from: string, to: string) { return n.listFoodLogsSummary(this.db, userId, from, to) }
  async getRequiredMealTypeLogDays(userId: string, from: string, to: string) { return n.getRequiredMealTypeLogDays(this.db, userId, from, to) }
  async listLatestMealTimes(userId: string, from: string, to: string) { return n.listLatestMealTimes(this.db, userId, from, to) }
  async listRecentFoodItemsForMealType(userId: string, mealTypeId: string, limit: number) { return n.listRecentFoodItemsForMealType(this.db, userId, mealTypeId, limit) }
  async listSavedMeals(userId: string) { return n.listSavedMeals(this.db, userId) }
  async createSavedMeal(userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], id?: string, servings?: number, imageDataUri?: string | null, mealTypeIds?: string[]) { return n.createSavedMeal(this.db, userId, name, items, id, servings, imageDataUri, mealTypeIds) }
  async updateSavedMeal(id: string, userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[], servings?: number, imageDataUri?: string | null, mealTypeIds?: string[]) { return n.updateSavedMeal(this.db, id, userId, name, items, servings, imageDataUri, mealTypeIds) }
  async deleteSavedMeal(id: string, userId: string) { return n.deleteSavedMeal(this.db, id, userId) }
  async getNutritionTargets(userId: string) { return n.getNutritionTargets(this.db, userId) }
  async upsertNutritionTargets(userId: string, data: Omit<NutritionTargets, 'id' | 'userId' | 'updatedAt'>) { return n.upsertNutritionTargets(this.db, userId, data) }

  // ── Meal Plan (Q-186) ────────────────────────────────────────────────────────
  async listMealPlans(userId: string) { return mp.listMealPlans(this.db, userId) }
  async getMealPlan(id: string, userId: string) { return mp.getMealPlan(this.db, id, userId) }
  async getActiveMealPlan(userId: string) { return mp.getActiveMealPlan(this.db, userId) }
  async createMealPlan(userId: string, input: mp.CreateMealPlanInput) { return mp.createMealPlan(this.db, userId, input) }
  async updateMealPlan(id: string, userId: string, input: mp.UpdateMealPlanInput) { return mp.updateMealPlan(this.db, id, userId, input) }
  async setMealPlanActive(id: string, userId: string, active: boolean) { return mp.setMealPlanActive(this.db, id, userId, active) }
  async deleteMealPlan(id: string, userId: string) { return mp.deleteMealPlan(this.db, id, userId) }
  async getMealPlanMeal(mealId: string, userId: string) { return mp.getMealPlanMeal(this.db, mealId, userId) }
  async updateMealPlanMeal(mealId: string, userId: string, input: mp.UpdateMealInput) { return mp.updateMealPlanMeal(this.db, mealId, userId, input) }
  async replaceMealPlanStructure(id: string, userId: string, input: mp.ReplaceStructureInput) { return mp.replaceMealPlanStructure(this.db, id, userId, input) }
  async markMealPlanReviewed(id: string, userId: string) { return mp.markMealPlanReviewed(this.db, id, userId) }
  async mealPlanNeedsReview(userId: string, days: number) { return mp.mealPlanNeedsReview(this.db, userId, days) }
  async savePlanMealAnswer(userId: string, input: { id?: string; planMealId: string; logDate: string }) { return mp.savePlanMealAnswer(this.db, userId, input) }
  async deletePlanMealAnswer(userId: string, planMealId: string, logDate: string) { return mp.deletePlanMealAnswer(this.db, userId, planMealId, logDate) }
  async listPlanMealAnswers(userId: string, logDate: string) { return mp.listPlanMealAnswers(this.db, userId, logDate) }
  async listDietaryRestrictions() { return mp.listDietaryRestrictions(this.db) }
  async listUserDietaryRestrictions(userId: string) { return mp.listUserDietaryRestrictions(this.db, userId) }
  async replaceUserDietaryRestrictions(userId: string, entries: { restrictionId: string; severity: DietarySeverity }[]) { return mp.replaceUserDietaryRestrictions(this.db, userId, entries) }

  // ── Goal Recommendations ─────────────────────────────────────────────────

  async createGoalRecommendation(userId: string, data: Omit<GoalRecommendation, 'id' | 'userId' | 'createdAt' | 'status' | 'appliedAt' | 'dismissedAt'>): Promise<GoalRecommendation> {
    const [r] = await this.db.insert(s.goalRecommendations)
      .values({
        userId,
        source: data.source,
        recommendedStepsGoal: data.recommendedStepsGoal ?? null,
        recommendedCalories: data.recommendedCalories ?? null,
        recommendedProteinG: data.recommendedProteinG ?? null,
        recommendedCarbsG: data.recommendedCarbsG ?? null,
        recommendedFatG: data.recommendedFatG ?? null,
        recommendedWaterMl: data.recommendedWaterMl ?? null,
        recommendedActivityLevel: data.recommendedActivityLevel ?? null,
        reasoning: data.reasoning ?? null,
        insights: data.insights ?? null,
        dataQualityNote: data.dataQualityNote ?? null,
      })
      .returning()
    return this.rowToGoalRecommendation(r)
  }

  async getGoalRecommendation(userId: string, id: string): Promise<GoalRecommendation | null> {
    const [r] = await this.db.select().from(s.goalRecommendations)
      .where(and(eq(s.goalRecommendations.id, id), eq(s.goalRecommendations.userId, userId)))
      .limit(1)
    return r ? this.rowToGoalRecommendation(r) : null
  }

  async updateGoalRecommendationStatus(userId: string, id: string, status: 'applied' | 'dismissed'): Promise<void> {
    const set: Record<string, unknown> = { status }
    if (status === 'applied') set.appliedAt = new Date()
    if (status === 'dismissed') set.dismissedAt = new Date()
    await this.db.update(s.goalRecommendations)
      .set(set)
      .where(and(eq(s.goalRecommendations.id, id), eq(s.goalRecommendations.userId, userId)))
  }

  // ── Friends + Seasons (delegated to slices/social.ts) ────────────────────
  async listFriendships(userId: string) { return social.listFriendships(this.db, userId) }
  async sendFriendRequest(requesterId: string, emailOrCode: string) { return social.sendFriendRequest(this.db, requesterId, emailOrCode) }
  async acceptFriendRequest(friendshipId: string, userId: string) { return social.acceptFriendRequest(this.db, friendshipId, userId) }
  async declineFriendRequest(friendshipId: string, userId: string) { return social.declineFriendRequest(this.db, friendshipId, userId) }
  async removeFriend(friendshipId: string, userId: string) { return social.removeFriend(this.db, friendshipId, userId) }
  async getFriendIds(userId: string) { return social.getFriendIds(this.db, userId) }
  async updateEquippedTitle(userId: string, titleId: string | null) { return social.updateEquippedTitle(this.db, userId, titleId) }
  async listSeasonsWithResults(userId: string) { return social.listSeasonsWithResults(this.db, userId) }

  // ── AI Health Insights ────────────────────────────────────────────────────

  async getAiHealthInsightWithHash(userId: string, section: string, date: string): Promise<{ insight: string; contextHash: string | null } | null> {
    const [row] = await this.db.select({ insight: s.aiHealthInsights.insight, contextHash: s.aiHealthInsights.contextHash })
      .from(s.aiHealthInsights)
      .where(and(
        eq(s.aiHealthInsights.userId, userId),
        eq(s.aiHealthInsights.section, section),
        eq(s.aiHealthInsights.date, date),
      ))
      .limit(1)
    return row ?? null
  }

  /**
   * Every insight already written for this user on this day, so one AI surface can see what another
   * has said (Q-291). Ordered by section for a stable prompt — an unordered read would change the
   * caller's context hash on row order alone and regenerate an unchanged insight.
   */
  async listAiHealthInsightsForDate(userId: string, date: string): Promise<{ section: string; insight: string }[]> {
    return this.db.select({ section: s.aiHealthInsights.section, insight: s.aiHealthInsights.insight })
      .from(s.aiHealthInsights)
      .where(and(
        eq(s.aiHealthInsights.userId, userId),
        eq(s.aiHealthInsights.date, date),
      ))
      .orderBy(s.aiHealthInsights.section)
  }

  async saveMeasuredRmr(userId: string, input: import('../repository').MeasuredRmrInput): Promise<void> {
    await this.db.insert(s.measuredRmr)
      .values({
        userId,
        measuredOn: input.measuredOn,
        rmrKcal: input.rmrKcal,
        ffmKgAtTest: input.ffmKgAtTest ?? null,
        weightKgAtTest: input.weightKgAtTest ?? null,
        method: input.method ?? null,
        provider: input.provider ?? null,
        notes: input.notes ?? null,
      })
      // Same test date = a correction, not a second test. A later date is a new row, which is what
      // makes "a second test sits beside the first" hold (BF-33). Scoped to the user by the unique
      // index's own columns, so the matched row is already this user's.
      .onConflictDoUpdate({
        target: [s.measuredRmr.userId, s.measuredRmr.measuredOn],
        set: {
          rmrKcal: input.rmrKcal,
          ffmKgAtTest: input.ffmKgAtTest ?? null,
          weightKgAtTest: input.weightKgAtTest ?? null,
          method: input.method ?? null,
          provider: input.provider ?? null,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        },
      })
  }

  async getLatestMeasuredRmr(userId: string): Promise<import('../repository').MeasuredRmrRow | null> {
    const [row] = await this.db.select()
      .from(s.measuredRmr)
      .where(eq(s.measuredRmr.userId, userId))
      .orderBy(desc(s.measuredRmr.measuredOn))
      .limit(1)
    return row ? this.rowToMeasuredRmr(row) : null
  }

  async listMeasuredRmr(userId: string): Promise<import('../repository').MeasuredRmrRow[]> {
    const rows = await this.db.select()
      .from(s.measuredRmr)
      .where(eq(s.measuredRmr.userId, userId))
      .orderBy(desc(s.measuredRmr.measuredOn))
    return rows.map(r => this.rowToMeasuredRmr(r))
  }

  private rowToMeasuredRmr(r: typeof s.measuredRmr.$inferSelect): import('../repository').MeasuredRmrRow {
    return {
      measuredOn: r.measuredOn,
      rmrKcal: r.rmrKcal,
      ffmKgAtTest: r.ffmKgAtTest,
      weightKgAtTest: r.weightKgAtTest,
      method: r.method,
      provider: r.provider,
      notes: r.notes,
    }
  }

  async upsertAiHealthInsight(userId: string, section: string, date: string, insight: string, contextHash?: string): Promise<void> {
    await this.db.insert(s.aiHealthInsights)
      .values({ userId, section, date, insight, contextHash: contextHash ?? null })
      .onConflictDoUpdate({
        target: [s.aiHealthInsights.userId, s.aiHealthInsights.section, s.aiHealthInsights.date],
        set: { insight, contextHash: contextHash ?? null, createdAt: new Date() },
      })
  }

  async deleteAiHealthInsight(userId: string, section: string): Promise<void> {
    await this.db.delete(s.aiHealthInsights)
      .where(and(
        eq(s.aiHealthInsights.userId, userId),
        eq(s.aiHealthInsights.section, section),
      ))
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  async getSyncDelta(userId: string, since: Date, windowDays: number | null = 90, pageLimit = 500): Promise<SyncDelta> {
    // `windowDays == null` skips the recent-window floor entirely and honours the caller's real
    // `since` — used by full-history restore (`?mode=restore` → since=epoch). The null MUST be
    // guarded before the arithmetic: `null * 86400000 === 0` would make windowStart = now and clamp
    // effectiveSince to now (worse than the 90d floor). Default path (windowDays=90) is byte-identical.
    const effectiveSince = windowDays == null
      ? since
      : (() => {
          const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
          return since > windowStart ? since : windowStart
        })()

    const foodItemCols = {
      id: s.foodItems.id, name: s.foodItems.name, brand: s.foodItems.brand,
      servingSizeG: s.foodItems.servingSizeG, calories: s.foodItems.calories,
      proteinG: s.foodItems.proteinG, carbsG: s.foodItems.carbsG, fatG: s.foodItems.fatG,
      fiberG: s.foodItems.fiberG, sugarG: s.foodItems.sugarG, sodiumMg: s.foodItems.sodiumMg,
      satFatG: s.foodItems.satFatG, source: s.foodItems.source,
      // BF-35. Absent here means the picture never reaches the device, which is the whole point of
      // storing bytes rather than a URL.
      imageDataUri: s.foodItems.imageDataUri,
      createdAt: s.foodItems.createdAt,
    }

    const [programs, progressionStyles, bodyMetrics, sleepSessions,
           moodLogs, activityLogs, fitnessTests, prescribedRuns, workoutSessions,
           foodLogs, supplements, supplementLogs, injuries,
           exerciseLogs, setLogs, personalRecords, ouraDaily, dayCheckins,
           foodItemsReferenced, foodItemsCreated, ouraDailySummary, ouraDailyDerived,
           mealPlanRows, planMealAnswerRows] = await inSequence([
      this.db.select().from(s.programs)
        .where(and(eq(s.programs.userId, userId), gt(s.programs.updatedAt, effectiveSince))),
      this.db.select().from(s.progressionStyles)
        .where(and(eq(s.progressionStyles.userId, userId), gt(s.progressionStyles.updatedAt, effectiveSince))),
      this.db.select().from(s.bodyMetrics)
        .where(and(eq(s.bodyMetrics.userId, userId), gt(s.bodyMetrics.updatedAt, effectiveSince)))
        .orderBy(asc(s.bodyMetrics.updatedAt)).limit(pageLimit),
      this.db.select().from(s.sleepSessions)
        .where(and(eq(s.sleepSessions.userId, userId), gt(s.sleepSessions.updatedAt, effectiveSince)))
        .orderBy(asc(s.sleepSessions.updatedAt)).limit(pageLimit),
      // Deliberately NOT filtered on `deleted_at`, unlike the two user-facing mood reads. This is
      // the tombstone channel: a delta that hid deleted rows could never tell a device a row went
      // away, so the delete would not propagate — the exact failure CLAUDE.md's sync rules exist to
      // prevent. `food_logs` below is unfiltered here for the same reason (Q-178).
      this.db.select().from(s.moodLogs)
        .where(and(eq(s.moodLogs.userId, userId), gt(s.moodLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.moodLogs.updatedAt)).limit(pageLimit),
      this.db.select().from(s.activityLogs)
        .where(and(eq(s.activityLogs.userId, userId), gt(s.activityLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.activityLogs.updatedAt)).limit(pageLimit),
      this.db.select().from(s.fitnessTests)
        .where(and(eq(s.fitnessTests.userId, userId), gt(s.fitnessTests.updatedAt, effectiveSince)))
        .orderBy(asc(s.fitnessTests.updatedAt)).limit(pageLimit),
      this.db.select().from(s.prescribedRuns)
        .where(and(eq(s.prescribedRuns.userId, userId), gt(s.prescribedRuns.updatedAt, effectiveSince)))
        .orderBy(asc(s.prescribedRuns.updatedAt)).limit(pageLimit),
      this.db.select().from(s.workoutSessions)
        .where(and(eq(s.workoutSessions.userId, userId), gt(s.workoutSessions.updatedAt, effectiveSince)))
        .orderBy(asc(s.workoutSessions.updatedAt)).limit(pageLimit),
      this.db.select({
        id: s.foodLogs.id, date: s.foodLogs.date, mealTypeId: s.foodLogs.mealTypeId,
        foodItemId: s.foodLogs.foodItemId, quantityMultiplier: s.foodLogs.quantityMultiplier,
        loggedAt: s.foodLogs.loggedAt, updatedAt: s.foodLogs.updatedAt, deletedAt: s.foodLogs.deletedAt,
      }).from(s.foodLogs)
        .where(and(eq(s.foodLogs.userId, userId), gt(s.foodLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.foodLogs.updatedAt)).limit(pageLimit),
      this.db.select({
        id: s.supplements.id, name: s.supplements.name, dose: s.supplements.dose,
        reminderEnabled: s.supplements.reminderEnabled, reminderTime: s.supplements.reminderTime,
        sortOrder: s.supplements.sortOrder, active: s.supplements.active,
        updatedAt: s.supplements.updatedAt, deletedAt: s.supplements.deletedAt,
      }).from(s.supplements)
        .where(and(eq(s.supplements.userId, userId), gt(s.supplements.updatedAt, effectiveSince))),
      this.db.select({
        id: s.supplementLogs.id, supplementId: s.supplementLogs.supplementId,
        logDate: s.supplementLogs.logDate, updatedAt: s.supplementLogs.updatedAt,
        deletedAt: s.supplementLogs.deletedAt,
      }).from(s.supplementLogs)
        .innerJoin(s.supplements, eq(s.supplementLogs.supplementId, s.supplements.id))
        .where(and(eq(s.supplements.userId, userId), gt(s.supplementLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.supplementLogs.updatedAt)).limit(pageLimit),
      this.db.select({
        id: s.injuries.id, muscleName: s.injuries.muscleName, notes: s.injuries.notes,
        severity: s.injuries.severity, startedDate: s.injuries.startedDate,
        resolvedDate: s.injuries.resolvedDate, createdAt: s.injuries.createdAt,
        updatedAt: s.injuries.updatedAt, deletedAt: s.injuries.deletedAt,
      }).from(s.injuries)
        .where(and(eq(s.injuries.userId, userId), gt(s.injuries.updatedAt, effectiveSince)))
        .orderBy(asc(s.injuries.updatedAt)).limit(pageLimit),
      // exercise_logs joined to the user's workout_sessions (avoids a userId FK on exercise_logs)
      this.db.select({
        id:                   s.exerciseLogs.id,
        workoutSessionId:     s.exerciseLogs.workoutSessionId,
        exerciseName:         s.exerciseLogs.exerciseName,
        styleId:              s.exerciseLogs.styleId,
        styleName:            s.exerciseLogs.styleName,
        estimated1rm:         s.exerciseLogs.estimated1rm,
        target80:             s.exerciseLogs.target80,
        volume:               s.exerciseLogs.volume,
        avgReps:              s.exerciseLogs.avgReps,
        timeToComplete:       s.exerciseLogs.timeToComplete,
        muscleGroups:         s.exerciseLogs.muscleGroups,
        loggedAt:             s.exerciseLogs.loggedAt,
        interExerciseRestSec: s.exerciseLogs.interExerciseRestSec,
        updatedAt:            s.exerciseLogs.updatedAt,
        deletedAt:            s.exerciseLogs.deletedAt,
      }).from(s.exerciseLogs)
        .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
        .where(and(eq(s.workoutSessions.userId, userId), gt(s.exerciseLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.exerciseLogs.updatedAt)).limit(pageLimit),
      // set_logs joined through exercise_logs → workout_sessions for user scope
      this.db.select({
        id:            s.setLogs.id,
        exerciseLogId: s.setLogs.exerciseLogId,
        setNumber:     s.setLogs.setNumber,
        weightKg:      s.setLogs.weightKg,
        reps:          s.setLogs.reps,
        setTimeSec:    s.setLogs.setTimeSec,
        restTimeSec:   s.setLogs.restTimeSec,
        intensityPct:  s.setLogs.intensityPct,
        useFor1rm:     s.setLogs.useFor1rm,
        setStartMs:    s.setLogs.setStartMs,
        setEndMs:      s.setLogs.setEndMs,
        rpe:           s.setLogs.rpe,
        plannedPct:    s.setLogs.plannedPct,
        plannedReps:   s.setLogs.plannedReps,
        plannedRestSec: s.setLogs.plannedRestSec,
        updatedAt:     s.setLogs.updatedAt,
        deletedAt:     s.setLogs.deletedAt,
      }).from(s.setLogs)
        .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
        .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
        .where(and(eq(s.workoutSessions.userId, userId), gt(s.setLogs.updatedAt, effectiveSince)))
        .orderBy(asc(s.setLogs.updatedAt)).limit(pageLimit),
      this.db.select({
        exerciseName: s.personalRecords.exerciseName,
        exerciseId:   s.personalRecords.exerciseId,
        estimated1rm: s.personalRecords.estimated1rm,
        achievedAt:   s.personalRecords.achievedAt,
      }).from(s.personalRecords)
        .where(and(
          eq(s.personalRecords.userId, userId),
          or(isNull(s.personalRecords.achievedAt), gt(s.personalRecords.achievedAt, effectiveSince)),
        )),
      this.db.select({
        day:                  s.ouraDaily.date,
        readinessScore:       s.ouraDaily.readinessScore,
        sleepScore:           s.ouraDaily.sleepScore,
        activityScore:        s.ouraDaily.activityScore,
        temperatureDeviation: s.ouraDaily.temperatureDeviation,
        activeCalories:       s.ouraDaily.activeCalories,
        contributors:         s.ouraDaily.readinessContributors,
        updatedAt:            s.ouraDaily.syncedAt,
      }).from(s.ouraDaily)
        .where(and(eq(s.ouraDaily.userId, userId), gt(s.ouraDaily.syncedAt, effectiveSince)))
        .orderBy(asc(s.ouraDaily.syncedAt)).limit(pageLimit),
      this.db.select().from(s.dayCheckins)
        .where(and(eq(s.dayCheckins.userId, userId), gt(s.dayCheckins.updatedAt, effectiveSince)))
        .orderBy(asc(s.dayCheckins.updatedAt)).limit(pageLimit),
      // food_items referenced by this user's food logs in the window — a log whose
      // item isn't local can't render offline (getFoodLogsWithItems JOINs and drops it)
      this.db.selectDistinct(foodItemCols).from(s.foodItems)
        .innerJoin(s.foodLogs, eq(s.foodLogs.foodItemId, s.foodItems.id))
        .where(and(eq(s.foodLogs.userId, userId), gt(s.foodLogs.updatedAt, effectiveSince))),
      // plus items the user created since the cutoff but hasn't logged yet
      this.db.select(foodItemCols).from(s.foodItems)
        .where(and(eq(s.foodItems.userId, userId), gt(s.foodItems.createdAt, effectiveSince))),
      // Phase-2 A1: oura_daily_summary backup pull (device-computed nightly physiology + rolling
      // EMA baselines). Server `date` → client `day`; cursor on `updated_at`. Selects every column
      // so the local mirror (incl. the *_baseline_*_x8 + n_history EMA state) restores intact.
      this.db.select({
        day:                  s.ouraDailySummary.date,
        sleepDurationHours:   s.ouraDailySummary.sleepDurationHours,
        sleepEfficiency:      s.ouraDailySummary.sleepEfficiency,
        deepSleepHours:       s.ouraDailySummary.deepSleepHours,
        remSleepHours:        s.ouraDailySummary.remSleepHours,
        restlessPeriods:      s.ouraDailySummary.restlessPeriods,
        sleepLatencySec:      s.ouraDailySummary.sleepLatencySec,
        hrvAvgMs:             s.ouraDailySummary.hrvAvgMs,
        rhrLowBpm:            s.ouraDailySummary.rhrLowBpm,
        rhrAvgBpm:            s.ouraDailySummary.rhrAvgBpm,
        recoveryIndexHours:   s.ouraDailySummary.recoveryIndexHours,
        tempMeanC:            s.ouraDailySummary.tempMeanC,
        tempDevC:             s.ouraDailySummary.tempDevC,
        metAvg:               s.ouraDailySummary.metAvg,
        breathAvgRpm:         s.ouraDailySummary.breathAvgRpm,
        hrvBaselineMeanX8:    s.ouraDailySummary.hrvBaselineMeanX8,
        hrvBaselineDevX8:     s.ouraDailySummary.hrvBaselineDevX8,
        rhrBaselineMeanX8:    s.ouraDailySummary.rhrBaselineMeanX8,
        rhrBaselineDevX8:     s.ouraDailySummary.rhrBaselineDevX8,
        tempBaselineMeanX8:   s.ouraDailySummary.tempBaselineMeanX8,
        tempBaselineDevX8:    s.ouraDailySummary.tempBaselineDevX8,
        sleepBaselineMeanX8:  s.ouraDailySummary.sleepBaselineMeanX8,
        sleepBaselineDevX8:   s.ouraDailySummary.sleepBaselineDevX8,
        metBaselineMeanX8:    s.ouraDailySummary.metBaselineMeanX8,
        metBaselineDevX8:     s.ouraDailySummary.metBaselineDevX8,
        breathBaselineMeanX8: s.ouraDailySummary.breathBaselineMeanX8,
        breathBaselineDevX8:  s.ouraDailySummary.breathBaselineDevX8,
        nHistory:             s.ouraDailySummary.nHistory,
        updatedAt:            s.ouraDailySummary.updatedAt,
      }).from(s.ouraDailySummary)
        .where(and(eq(s.ouraDailySummary.userId, userId), gt(s.ouraDailySummary.updatedAt, effectiveSince)))
        .orderBy(asc(s.ouraDailySummary.updatedAt)).limit(pageLimit),
      // Phase-2 A2: oura_daily_derived backup pull (device-computed scored/analysis outputs). Keyed
      // on `day` already (no date→day alias). The 7 JSONB columns are stringified below for the
      // client's TEXT mirror. Cursor on `updated_at`.
      this.db.select().from(s.ouraDailyDerived)
        .where(and(eq(s.ouraDailyDerived.userId, userId), gt(s.ouraDailyDerived.updatedAt, effectiveSince)))
        .orderBy(asc(s.ouraDailyDerived.updatedAt)).limit(pageLimit),
      // Meal Plan (Q-186): NOT filtered on deleted_at — this is the tombstone channel, same as
      // mood_logs and food_logs above. A delta that hid deleted plans could never tell a device a
      // plan went away.
      this.db.select().from(s.mealPlans)
        .where(and(eq(s.mealPlans.userId, userId), gt(s.mealPlans.updatedAt, effectiveSince)))
        .orderBy(asc(s.mealPlans.updatedAt)).limit(pageLimit),
      // NOT filtered on deleted_at — this is the tombstone channel, same as mood_logs and food_logs
      // above. Hiding a soft-deleted answer here would mean an undo never reaches another device.
      // (This makes the fan-out 24 queries. Its width was flagged as a pool-contention suspect by
      // Q-107; Q-308 measured it and the width is no longer the cost — `inSequence` issues these
      // one at a time, so the whole fan-out demands ONE connection rather than 24, and is faster
      // at p50 and p95 besides. Adding a 25th query here is now cheap; adding a `Promise.all` back
      // is not.)
      this.db.select().from(s.planMealAnswers)
        .where(and(eq(s.planMealAnswers.userId, userId), gt(s.planMealAnswers.updatedAt, effectiveSince)))
        .orderBy(asc(s.planMealAnswers.updatedAt)).limit(pageLimit),
    ])

    // Nested program/style structure. The flat parent rows above filter by
    // updatedAt > since; saveProgram/saveProgressionStyle bump the parent's
    // updatedAt on every edit, so a changed parent implies a changed subtree.
    // Re-send the full subtree for any changed program/style and let the client
    // replace its children on receipt (delete-then-insert by parent id).
    const programIds = (programs as { id: string }[]).map(p => p.id)
    const styleIds   = (progressionStyles as { id: string }[]).map(p => p.id)

    const [programSessions, sessionExercises, schedules, scheduleDays, styleSets] = await inSequence([
      programIds.length
        ? this.db.select({
            id:                s.programSessions.id,
            programId:         s.programSessions.programId,
            name:              s.programSessions.name,
            position:          s.programSessions.position,
            icon:              s.programSessions.icon,
            timeBudgetMinutes: s.programSessions.timeBudgetMinutes,
          }).from(s.programSessions)
            .where(inArray(s.programSessions.programId, programIds))
        : Promise.resolve([] as unknown[]),
      programIds.length
        ? this.db.select({
            id:           s.sessionExercises.id,
            sessionId:    s.sessionExercises.sessionId,
            exerciseName: s.sessionExercises.exerciseName,
            styleId:      s.sessionExercises.styleId,
            muscleGroups: s.sessionExercises.muscleGroups,
            position:     s.sessionExercises.position,
            exerciseRole: s.sessionExercises.exerciseRole,
            supersetGroup: s.sessionExercises.supersetGroup,
          }).from(s.sessionExercises)
            .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
            .where(inArray(s.programSessions.programId, programIds))
        : Promise.resolve([] as unknown[]),
      programIds.length
        ? this.db.select({
            id:              s.schedules.id,
            programId:       s.schedules.programId,
            type:            s.schedules.type,
            restAfterN:      s.schedules.restAfterN,
            reminderEnabled: s.schedules.reminderEnabled,
            reminderTime:    s.schedules.reminderTime,
          }).from(s.schedules)
            .where(inArray(s.schedules.programId, programIds))
        : Promise.resolve([] as unknown[]),
      programIds.length
        ? this.db.select({
            scheduleId: s.scheduleDays.scheduleId,
            dayOfWeek:  s.scheduleDays.dayOfWeek,
            sessionId:  s.scheduleDays.sessionId,
          }).from(s.scheduleDays)
            .innerJoin(s.schedules, eq(s.scheduleDays.scheduleId, s.schedules.id))
            .where(inArray(s.schedules.programId, programIds))
        : Promise.resolve([] as unknown[]),
      styleIds.length
        ? this.db.select({
            id:        s.styleSets.id,
            styleId:   s.styleSets.styleId,
            setNumber: s.styleSets.setNumber,
            pct:       s.styleSets.pct,
            reps:      s.styleSets.reps,
            restSec:   s.styleSets.restSec,
            useFor1rm: s.styleSets.useFor1rm,
          }).from(s.styleSets)
            .where(inArray(s.styleSets.styleId, styleIds))
        : Promise.resolve([] as unknown[]),
    ])

    const foodItemsById = new Map<string, (typeof foodItemsReferenced)[number]>()
    for (const fi of [...foodItemsReferenced, ...foodItemsCreated]) foodItemsById.set(fi.id, fi)

    // Children of the plans in this page. Variants and meals have no updated_at of their own and
    // cascade with the plan, so they are fetched by parent id rather than cursored — and they must
    // ride the SAME page as their plan, or a device receives a plan whose meals arrive never.
    const mealPlanIds = mealPlanRows.map(p => p.id)
    const mealPlanVariantRows = mealPlanIds.length
      ? await this.db.select().from(s.mealPlanVariants)
          .where(inArray(s.mealPlanVariants.mealPlanId, mealPlanIds))
      : []
    const mealPlanMealRows = mealPlanVariantRows.length
      ? await this.db.select().from(s.mealPlanMeals)
          .where(inArray(s.mealPlanMeals.variantId, mealPlanVariantRows.map(v => v.id)))
      : []
    const mealPlanDelta = {
      mealPlans: mealPlanRows.map(p => ({
        id: p.id, name: p.name, isActive: p.isActive, mealsPerDay: p.mealsPerDay,
        targetCalories: p.targetCalories, targetProteinG: p.targetProteinG,
        targetCarbsG: p.targetCarbsG, targetFatG: p.targetFatG,
        trainingTime: p.trainingTime,
        generatedAt: p.generatedAt.toISOString(),
        lastReviewedAt: p.lastReviewedAt ? p.lastReviewedAt.toISOString() : null,
        updatedAt: p.updatedAt.toISOString(),
        deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
      })),
      mealPlanVariants: mealPlanVariantRows,
      mealPlanMeals: mealPlanMealRows,
      planMealAnswers: planMealAnswerRows.map(a => ({
        id: a.id, planMealId: a.planMealId, logDate: a.logDate, answer: a.answer,
        answeredAt: a.answeredAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
      })),
    }

    const now = new Date()
    const page = (rows: { updatedAt: Date | string }[]) => ({
      hitLimit: rows.length === pageLimit,
      maxUpdatedAt: rows.length ? new Date(rows[rows.length - 1].updatedAt as string | Date) : null,
    })
    const { syncedAt, hasMore } = resolveSyncCursor([
      page(bodyMetrics), page(sleepSessions), page(moodLogs), page(activityLogs),
      page(fitnessTests), page(prescribedRuns), page(workoutSessions), page(foodLogs), page(supplementLogs), page(injuries),
      page(exerciseLogs), page(setLogs), page(dayCheckins), page(mealPlanRows), page(planMealAnswerRows),
      { hitLimit: ouraDaily.length === pageLimit,
        maxUpdatedAt: ouraDaily.length ? new Date(ouraDaily[ouraDaily.length - 1].updatedAt as unknown as string | Date) : null },
      { hitLimit: ouraDailySummary.length === pageLimit,
        maxUpdatedAt: ouraDailySummary.length ? new Date(ouraDailySummary[ouraDailySummary.length - 1].updatedAt as unknown as string | Date) : null },
      { hitLimit: ouraDailyDerived.length === pageLimit,
        maxUpdatedAt: ouraDailyDerived.length ? new Date(ouraDailyDerived[ouraDailyDerived.length - 1].updatedAt as unknown as string | Date) : null },
    ], now)

    return { programs, programSessions, sessionExercises, schedules, scheduleDays,
             progressionStyles, styleSets, bodyMetrics, sleepSessions,
             moodLogs, activityLogs, fitnessTests, prescribedRuns, workoutSessions,
             exerciseLogs, setLogs,
             personalRecords: personalRecords.map(r => ({
               ...r,
               updatedAt: r.achievedAt ?? new Date(0),
             })),
             ouraDaily: ouraDaily.map(r => ({
               ...r,
               contributors: r.contributors != null ? JSON.stringify(r.contributors) : null,
               updatedAt:    r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
             })),
             ouraDailySummary: ouraDailySummary.map(r => ({
               ...r,
               updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
             })),
             ouraDailyDerived: ouraDailyDerived.map(r => ({
               ...r,
               // 7 JSONB columns → stringified for the client's TEXT mirror (mirrors ouraDaily.contributors).
               modelVersions:             r.modelVersions             != null ? JSON.stringify(r.modelVersions)             : null,
               sleepContributors:         r.sleepContributors         != null ? JSON.stringify(r.sleepContributors)         : null,
               readinessContributors:     r.readinessContributors     != null ? JSON.stringify(r.readinessContributors)     : null,
               activityContributors:      r.activityContributors      != null ? JSON.stringify(r.activityContributors)      : null,
               illnessBiomarkers:         r.illnessBiomarkers         != null ? JSON.stringify(r.illnessBiomarkers)         : null,
               chronicStressContributors: r.chronicStressContributors != null ? JSON.stringify(r.chronicStressContributors) : null,
               bodyComp:                  r.bodyComp                  != null ? JSON.stringify(r.bodyComp)                  : null,
               updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
             })),
             // food_items has no updated_at; created_at stands in (same as personal_records)
             foodItems: [...foodItemsById.values()].map(fi => ({
               ...fi,
               updatedAt: fi.createdAt,
             })),
             foodLogs, supplements, supplementLogs, injuries, dayCheckins,
             ...mealPlanDelta,
             syncedAt, hasMore }
  }

  async pushMutations(userId: string, mutations: IncomingMutation[]): Promise<PushResult> {
    let processed = 0
    const errors: PushResult['errors'] = []
    // Q-485: values the server accepted the mutation for but silently discarded. Separate from
    // `errors` on purpose — an error dead-letters the mutation, and a discarded field is not a
    // reason to throw away the fields that landed.
    const warnings: NonNullable<PushResult['warnings']> = []

    // Resolve the user's timezone once — used by the workout_log branch.
    // Non-fatal: a transient DB error here must not 500 the whole batch
    // before any mutation is even tried.
    let userTz: string = DEFAULT_TZ
    if (mutations.some(m => m.domain === 'workout_log')) {
      try {
        const user = await this.getUserById(userId)
        userTz = user?.timezone ?? DEFAULT_TZ
      } catch (err) {
        console.error('[pushMutations] getUserById failed; defaulting timezone', err)
      }
    }

    for (const mut of mutations) {
      try {
        const { syncStatus, updatedAt, deletedAt, ...clean } = mut.payload as Record<string, unknown>
        void syncStatus; void updatedAt; void deletedAt

        if (mut.domain === 'body_metrics') {
          const p = clean as Record<string, unknown>
          // A waterMlDelta payload (water-log-sheet's quick-add) is an increment,
          // not an absolute set — route it through incrementWaterLog, the same
          // function the web route uses, so concurrent adds sum instead of
          // last-writer-wins clobbering each other (SYNC-P7).
          if (typeof p.waterMlDelta === 'number') {
            // Bounded and sign-checked to match the web route (0 < ml <= 5000). Unvalidated, a
            // -1e9 delta drove the day's hydration to minus a billion via the raw SQL add.
            const delta = validWaterMlDeltaOrNull(p.waterMlDelta)
            if (delta == null) throw new Error(`body_metrics: implausible waterMlDelta ${p.waterMlDelta}`)
            // Q-481: the one non-idempotent branch of the nineteen, so it is the one that dedupes on
            // the mutation id. A replay is counted as processed — it WAS processed, on an earlier
            // delivery — so the client confirms and drops it rather than retrying forever. An
            // id-less mutation (a pre-id client) cannot be deduped and keeps the old behaviour.
            if (mut.id) {
              await this.incrementWaterLogOnce(userId, mut.date, delta, mut.id)
            } else {
              await this.incrementWaterLog(userId, mut.date, delta)
            }
            processed++
            continue
          }
          // Matches the web route's (BodyMetadataPostSchema) numeric bounds — without
          // this a corrupted local payload could push an out-of-range value straight
          // past the push path, which only checked `typeof === 'number'`.
          //
          // Q-485: the bounds were never the problem — both paths import the same
          // `validation/body-metrics.ts`, so they cannot drift. What differed was the *answer*.
          // Same value, same field, same instant: `POST /api/body-metadata` → 400
          // `{"error":"Too big: expected number to be <=500"}`, `POST /api/sync/push` → 200
          // `{"processed":1,"errors":[]}` with `weight_kg` NULL. The drop was invisible in all three
          // places it could have been recorded — no `errors[]` entry, so the client confirmed and
          // deleted the mutation; no console line; no `error_events` row.
          //
          // `bounded` records what it discards. It does NOT throw: a throw quarantines the mutation,
          // and the poison-pill rule forbids retrying a validation failure forever, so twelve new
          // throw sites would trade an invisible failure for a queue of red badges over values the
          // user cannot correct from a badge. Deciding *per field* which values are "incomplete,
          // keep going" and which are "meaningless, quarantine" is a product call, not one to make
          // in passing — `waterMlDelta` and `sleep_session` throw today and both are defensible.
          const dropped: string[] = []
          const bounded = (name: string, v: unknown, validate: (n: number) => number | null): number | undefined => {
            if (typeof v !== 'number') return undefined
            const ok = validate(v)
            if (ok == null) { dropped.push(`${name}=${v}`); return undefined }
            return ok
          }
          const measurementField = (name: string, v: unknown): number | undefined =>
            bounded(name, v, validMeasurementCmOrNull)
          // Phase-2 A4: thread the payload's source instead of hardcoding 'manual'. An oura_ble /
          // health_connect body_metrics push must write at its real source rank so the per-field
          // mergeSet preserves higher-ranked values (a hardcoded 'manual' rank-4 would stomp genuine
          // manual weight with ring data). Whitelist to a known HealthSource; default 'manual' (the
          // web/hand-entry path sends no source, and manual is the correct default there).
          const pushSource: HealthSource =
            typeof p.source === 'string' && (HEALTH_SOURCES as readonly string[]).includes(p.source)
              ? (p.source as HealthSource) : 'manual'
          await this.upsertBodyMetrics(userId, [{
            date: mut.date,
            weightKg:         bounded('weightKg', p.weightKg, validWeightKgOrNull),
            bodyFatPct:       bounded('bodyFatPct', p.bodyFatPct, validBodyFatPctOrNull),
            calories:         bounded('calories', p.calories, validCaloriesOrNull),
            proteinG:         bounded('proteinG', p.proteinG, validMacroGOrNull),
            carbsG:           bounded('carbsG', p.carbsG, validMacroGOrNull),
            fatG:             bounded('fatG', p.fatG, validMacroGOrNull),
            steps:            bounded('steps', p.steps, validStepsOrNull),
            distanceKm:       bounded('distanceKm', p.distanceKm, validDistanceKmOrNull),
            // These four reach the DB ONLY here (the web schema doesn't accept them) and were
            // type-checked with no bounds while every sibling used a validator — so a 5,000% SpO2
            // at client-chosen rank `manual` overwrote the ring's real reading.
            waterMl:          bounded('waterMl', p.waterMl, validWaterMlOrNull),
            restingHeartRate: bounded('restingHeartRate', p.restingHeartRate, validRestingHrOrNull),
            hrvMs:            bounded('hrvMs', p.hrvMs, validHrvMsOrNull),
            spo2Pct:          bounded('spo2Pct', p.spo2Pct, validSpo2PctOrNull),
            waistCm:          measurementField('waistCm', p.waistCm),
            chestCm:          measurementField('chestCm', p.chestCm),
            armCm:            measurementField('armCm', p.armCm),
            thighCm:          measurementField('thighCm', p.thighCm),
            hipCm:            measurementField('hipCm', p.hipCm),
            neckCm:           measurementField('neckCm', p.neckCm),
          }], pushSource)
          // Q-485: the write succeeded, so this is not an error — but a value the web route refuses
          // with a message was discarded here without one. Recorded on both channels: the log line
          // makes it diagnosable at all, and the warning reaches the client without dead-lettering
          // the mutation (which `errors[]` would).
          if (dropped.length > 0) {
            console.warn('[pushMutations] body_metrics: discarded out-of-range value(s)', { date: mut.date, dropped })
            warnings.push({
              id: mut.id, domain: mut.domain, date: mut.date,
              warning: `Out-of-range value(s) discarded: ${dropped.join(', ')}`,
            })
          }
          processed++
        } else if (mut.domain === 'mood_logs') {
          // Q-131: this branch used to cast straight through — an arbitrary string reached the
          // NOT NULL energy_level column and every readiness/energy surface then rendered it as a
          // real check-in. Same schema the web route parses.
          const moodCheck = MoodFieldsSchema.safeParse(clean)
          if (!moodCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid mood_logs payload' })
            continue
          }
          const p = moodCheck.data
          await this.saveMoodLog(userId, {
            logDate:      mut.date,
            energyLevel:  p.energyLevel,
            // The mood check-in no longer collects sleep quality, so the queued
            // mutation omits it; default to 'ok' to match /api/mood and the local
            // store. Without this, the NOT NULL sleep_quality column rejects the
            // insert and the mood mutation is stranded in the outbox forever — so
            // the check-in reappears on every app open.
            sleepQuality: p.sleepQuality ?? 'ok',
            bodyState:    p.bodyState   ?? [],
            soreMuscles:  p.soreMuscles ?? [],
          })
          processed++
        } else if (mut.domain === 'day_checkins') {
          const p = clean as Record<string, unknown>
          const scaleCheck = DayCheckinScalesSchema.safeParse(p)
          if (!scaleCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid day_checkins scale value' })
            continue
          }
          // Matches the web route's journal max-length / soreMuscles element type
          // (SYNC-P4) — without this, an unbounded journal string or a non-string
          // soreMuscles entry could push straight past the outbox path.
          const extrasCheck = DayCheckinExtrasSchema.safeParse(p)
          if (!extrasCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid day_checkins journal/soreMuscles value' })
            continue
          }
          // Matches the web route's z.enum(['evening', 'morning']).default('evening'):
          // omitted defaults to 'evening', but a present-and-invalid value is rejected
          // rather than silently coerced — a plain text column with no DB check
          // constraint would otherwise happily store an arbitrary string.
          if (p.phase !== undefined && p.phase !== 'evening' && p.phase !== 'morning') {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid day_checkins phase value' })
            continue
          }
          // Q-465, mirroring the web route: a body with no answers writes a row indistinguishable
          // from a real check-in in which the user said nothing. Rejected per-item rather than
          // retried — a mutation carrying no information will never carry any, so retrying it
          // forever is the poison-pill shape the outbox exists to avoid.
          if (!dayCheckinHasAnswers(p)) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Day check-in carries no answers' })
            continue
          }
          const phase = (p.phase as 'evening' | 'morning' | undefined) ?? 'evening'
          const num = (v: unknown) => typeof v === 'number' ? v : null
          await this.saveDayCheckin(userId, {
            logDate:           mut.date,
            phase,
            physicalTiredness: num(p.physicalTiredness),
            mentalDrain:       num(p.mentalDrain),
            barelyMoved:       num(p.barelyMoved),
            hydration:         num(p.hydration),
            lateHeavyMeal:     num(p.lateHeavyMeal),
            wakeMood:          num(p.wakeMood),
            perceivedRecovery: num(p.perceivedRecovery),
            motivation:        num(p.motivation),
            sleepQualityFeel:  num(p.sleepQualityFeel),
            restingSoreness:   num(p.restingSoreness),
            illnessContext:            extrasCheck.data.illnessContext ?? null,
            perceivedRecoveryTouched:  extrasCheck.data.perceivedRecoveryTouched ?? false,
            sleepQualityFeelTouched:   extrasCheck.data.sleepQualityFeelTouched ?? false,
            soreMuscles:       extrasCheck.data.soreMuscles,
            journal:           extrasCheck.data.journal ?? null,
          })
          processed++
        } else if (mut.domain === 'food_items') {
          // Q-24 §5: this branch previously had NO schema — `id`/`name` were type-checked and
          // every nutrition field went through `typeof v === 'number' ? v : 0`, so queueing the
          // write offline bypassed the web route's caps entirely and a non-number silently
          // became 0. Both paths now parse the same shared schema.
          const parsed = FoodItemPushSchema.safeParse(clean)
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid food_items payload' })
            continue
          }
          const p = parsed.data
          // Same Atwater cross-check the web route applies (sibling-surface parity) — a
          // hallucinated/mistyped calorie-macro combo queued offline gets the same correction
          // it would get online, not a second, weaker path.
          const sanitised = sanitiseNutrition({
            calories: p.calories, proteinG: p.proteinG, carbsG: p.carbsG, fatG: p.fatG,
            servingSizeG: p.servingSizeG, fiberG: p.fiberG, sugarG: p.sugarG,
            sodiumMg: p.sodiumMg, satFatG: p.satFatG,
          })
          // BF-35. The web route REFUSES a bad image; this branch drops it and keeps the food.
          // That asymmetry is the RV-32 precedent and it is deliberate: a 4xx here is a poison pill
          // the outbox quarantines, so refusing would cost the user a whole food item over a
          // picture. Same validator, same cap — only the consequence differs.
          const imageRejection = rejectMealImage(p.imageDataUri, FOOD_ITEM_IMAGE_MAX_BYTES)
          const foodImage = imageRejection ? null : (p.imageDataUri ?? null)
          await this.createFoodItem(userId, {
            id: p.id,
            name: p.name,
            brand: p.brand,
            servingSizeG: sanitised.servingSizeG ?? 100,  // web route's default (Q-131) — 0 makes every per-serving calculation collapse
            calories: sanitised.calories ?? 0,
            proteinG: sanitised.proteinG ?? 0,
            carbsG: sanitised.carbsG ?? 0,
            fatG: sanitised.fatG ?? 0,
            fiberG: sanitised.fiberG,
            sugarG: sanitised.sugarG,
            sodiumMg: sanitised.sodiumMg,
            satFatG: sanitised.satFatG,
            source: p.source ?? 'manual',
            // Q-131: the push branch dropped barcode entirely and hardcoded region to '' while the
            // web route passes both through with an 'AU' default — so the same item saved offline
            // lost its barcode (no rescan match afterwards) and landed region-less.
            barcode: p.barcode,
            region: p.region ?? 'AU',
            imageDataUri: foodImage,
          })
          // Q-485: accepted the mutation, silently dropped a field the web route would have named.
          if (imageRejection) {
            console.warn('[pushMutations] food_items: discarded image', { date: mut.date, reason: imageRejection })
            warnings.push({
              id: mut.id, domain: mut.domain, date: mut.date,
              warning: mealImageRejectionMessage(imageRejection, FOOD_ITEM_IMAGE_MAX_BYTES),
            })
          }
          processed++
        } else if (mut.domain === 'food_logs') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.deleteFoodLog(String(p.id), userId)
          } else {
            // Matches the web route's `quantityMultiplier must be between 0.01 and 100`
            // check — without it a corrupted local payload could push an out-of-range
            // value straight past the push path.
            const qm = p.quantityMultiplier ?? 1.0
            if (typeof qm !== 'number' || qm < 0.01 || qm > 100) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'quantityMultiplier must be between 0.01 and 100' })
              continue
            }
            if (!(await this.foodLogRefsValid(userId, String(p.mealTypeId), String(p.foodItemId)))) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'FK ownership check failed' })
              continue
            }
            await this.createFoodLog(userId, {
              id:                 String(p.id),
              date:               mut.date,
              mealTypeId:         String(p.mealTypeId),
              foodItemId:         String(p.foodItemId),
              quantityMultiplier: qm,
              loggedAt:           p.loggedAt ? new Date(String(p.loggedAt)) : undefined,
            })
          }
          processed++
        } else if (mut.domain === 'supplement_logs') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.unlogSupplement(String(p.supplementId), userId, String(p.logDate))
          } else {
            await this.logSupplement(String(p.supplementId), userId, String(p.logDate))
          }
          processed++
        } else if (mut.domain === 'supplements') {
          const p = clean as Record<string, unknown>
          if (p.deleted) {
            await this.deleteSupplement(String(p.id), userId)
          } else {
            // A missing name previously stringified to the literal "undefined"
            // (SYNC-P4) — reject instead of storing a nonsense supplement name.
            const name = typeof p.name === 'string' ? p.name.trim() : ''
            if (!name) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid supplements payload: missing name' })
              continue
            }
            await this.createSupplement(userId, {
              id:              String(p.id),
              name,
              dose:            p.dose ? String(p.dose) : null,
              reminderEnabled: Boolean(p.reminderEnabled),
              reminderTime:    p.reminderTime ? String(p.reminderTime) : null,
              sortOrder:       typeof p.sortOrder === 'number' ? p.sortOrder : 0,
              active:          p.active !== false,
            })
          }
          processed++
        } else if (mut.domain === 'saved_meals') {
          const p = clean as Record<string, unknown>
          if (typeof p.id !== 'string') {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid saved_meals payload: missing id' })
            continue
          }
          if (p.deleted) {
            await this.deleteSavedMeal(p.id, userId)
          } else {
            const name = typeof p.name === 'string' ? p.name.trim() : ''
            if (!name) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid saved_meals payload: missing name' })
              continue
            }
            const rawItems = Array.isArray(p.items) ? p.items : []
            const items = rawItems
              .filter((it): it is { foodItemId: string; quantityMultiplier: number } =>
                !!it && typeof it === 'object'
                && typeof (it as Record<string, unknown>).foodItemId === 'string'
                && typeof (it as Record<string, unknown>).quantityMultiplier === 'number')
              .map(it => ({ foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier }))
            // createSavedMeal upserts idempotently on the client-minted id, so this
            // one branch replays both offline creates and edits (create+edit out of
            // order lands in place instead of duplicating or 404ing).
            // Mirrors the web route's default: an older client that predates `servings` sends
            // nothing, which must read as a single-portion meal rather than zero.
            const servings = typeof p.servings === 'number' && p.servings > 0 ? p.servings : 1
            // Same cap as the web route, re-checked here rather than trusted: this is the offline
            // replay path, and a client-side cap is not a cap (Q-396). `undefined` leaves a stored
            // image alone; an explicit null removes it; anything oversized quarantines the mutation
            // rather than wedging the queue behind it.
            const rawImage = p.imageDataUri
            let imageDataUri: string | null | undefined
            if (rawImage === null) imageDataUri = null
            else if (typeof rawImage === 'string') {
              const reject = rejectMealImage(rawImage)
              if (reject) {
                errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: mealImageRejectionMessage(reject) })
                continue
              }
              imageDataUri = rawImage
            }
            // BF-11e. Same `undefined` vs `[]` distinction as the web route and as `imageDataUri`
            // above: a mutation queued by an older bundle carries no `mealTypeIds` at all, and must
            // leave the stored tags alone rather than clearing them on replay. Non-string entries
            // are dropped here rather than trusted — this is the offline path, and the payload sat
            // in local SQLite since whenever the user acted.
            const rawTags = p.mealTypeIds
            const mealTypeIds = Array.isArray(rawTags)
              ? rawTags.filter((t): t is string => typeof t === 'string')
              : undefined
            await this.createSavedMeal(userId, name, items, p.id, servings, imageDataUri, mealTypeIds)
          }
          processed++
        } else if (mut.domain === 'activity_logs') {
          const p = clean as Record<string, unknown>
          if (typeof p.id !== 'string') {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid activity_logs payload: missing id' })
            continue
          }
          // Q-328. Delete was the one activity-log write with no outbox path, so it could not be
          // made offline at all — the client bare-`fetch`ed and simply failed. Same `deleted` flag
          // convention as `supplements` and `saved_meals` above, and the same repo function the web
          // route calls, so the two write paths cannot drift.
          //
          // A miss is NOT an error here. `deleteActivityLog` returns false for a row that is absent
          // or not yours, and quarantining on that would dead-letter the commonest benign replay —
          // a delete re-sent because its confirmation never landed. The row is gone either way,
          // which is what the mutation asked for.
          if (p.deleted) {
            await this.deleteActivityLog(userId, p.id)
            processed++
            continue
          }
          // Validate against the same schema as the web route (SYNC-P3) — without
          // this, a title-less/type-less local payload minted `String(undefined)`
          // ("undefined") straight into the DB instead of being rejected.
          const parsed = ActivityLogBody.safeParse({ ...p, date: mut.date })
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: `Invalid activity_logs payload — ${describeZodFailure(parsed.error)}` })
            continue
          }
          const { startTime, durationMin, endTime: providedEndTime } = parsed.data
          await this.saveActivityLog(userId, {
            ...parsed.data,
            id: p.id,
            endTime: deriveEndTime(startTime, durationMin, providedEndTime),
          }, { overwrite: true })
          processed++
        } else if (mut.domain === 'fitness_tests') {
          const p = clean as Record<string, unknown>
          if (typeof p.id !== 'string') {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid fitness_tests payload: missing id' })
            continue
          }
          const parsed = FitnessTestBody.safeParse({ ...p, date: mut.date })
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid fitness_tests payload' })
            continue
          }
          await this.saveFitnessTest(userId, { ...parsed.data, id: p.id })
          processed++
        } else if (mut.domain === 'prescribed_run') {
          const p = clean as Record<string, unknown>
          // Same shared schema + repo function as the web PATCH route — the two write
          // paths cannot drift. No this.db/raw sql here (CI check-push-mutations rule).
          const parsed = PrescribedRunPatchBody.safeParse(p)
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid prescribed_run payload' })
            continue
          }
          await this.updatePrescribedRun(userId, parsed.data.id, {
            status: parsed.data.status,
            activityLogId: parsed.data.activityLogId ?? null,
          })
          processed++
        } else if (mut.domain === 'injuries') {
          const p = clean as Record<string, unknown>
          type InjSeverity = import('@trainingai/shared/types/injury').Injury['severity']
          if (p.deleted) {
            await this.deleteInjury(String(p.id), userId)
          } else if (p.resolvedDate !== undefined) {
            // Preserve the existing branch order: any payload carrying resolvedDate
            // is a resolve/unresolve patch (full upserts from the outbox never set it).
            await this.updateInjury(String(p.id), userId, {
              resolvedDate: p.resolvedDate ? String(p.resolvedDate) : null,
            })
          } else {
            // Matches the web route's severity enum + muscleName presence check
            // (SYNC-P4) — without this, a corrupted local payload could cast an
            // arbitrary string straight into the `severity` column.
            const muscleName = typeof p.muscleName === 'string' ? p.muscleName.trim() : ''
            const severity = String(p.severity)
            if (!muscleName || !['mild', 'moderate', 'severe'].includes(severity)) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid injuries payload' })
              continue
            }
            await this.createInjury(userId, {
              id:           String(p.id),
              muscleName,
              notes:        p.notes ? String(p.notes) : null,
              severity:     severity as InjSeverity,
              startedDate:  String(p.startedDate),
              resolvedDate: null,
            })
          }
          processed++
        } else if (mut.domain === 'workout_log') {
          const { logExerciseFromPayload, LogExercisePayloadSchema } =
            await import('@trainingai/shared/workout/log-exercise')
          const parsed = LogExercisePayloadSchema.safeParse(mut.payload)
          if (!parsed.success) {
            console.error('[pushMutations] workout_log safeParse failed:', JSON.stringify(parsed.error.flatten()))
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid workout_log payload' })
            continue
          }
          await logExerciseFromPayload(userId, parsed.data, userTz)
          processed++
        } else if (mut.domain === 'session_rpe') {
          const rpeCheck = SessionRpeSchema.safeParse(mut.payload)
          if (!rpeCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid session_rpe payload' })
            continue
          }
          // Q-460: not `processed++` unconditionally. A session_rpe whose session row is absent
          // server-side — not yet synced, deleted from another device, or an id that drifted — used
          // to be counted as processed and dropped from the outbox, leaving the RPE on the device
          // forever with nothing to retry and no error surface.
          //
          // `errors` is the right channel and not a quarantine: the client gives a failed mutation
          // bounded retries with backoff (30 s → 2 m → 8 m → 32 m, `MAX_MUTATION_ATTEMPTS = 5`) and
          // then dead-letters it. So the common transient case — the RPE pushed before the session
          // that carries it — succeeds on a later attempt, and a genuinely orphaned one lands in the
          // dead-letter queue rather than vanishing.
          if (!await this.setSessionRpe(userId, rpeCheck.data.workoutSessionId, rpeCheck.data.sessionRpe)) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'No matching workout session for session_rpe' })
            continue
          }
          processed++
        } else if (mut.domain === 'complete_workout') {
          const { CompleteWorkoutPayloadSchema, completeWorkoutFromPayload } =
            await import('@trainingai/shared/workout/complete-workout')
          const parsed = CompleteWorkoutPayloadSchema.safeParse(mut.payload)
          if (!parsed.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid complete_workout payload' })
            continue
          }
          await completeWorkoutFromPayload(userId, parsed.data)
          // Same post-completion HR pipeline the web route runs — sync the Oura window, then
          // attribute it to the workout and its sets. This branch used to fire only the sync
          // half, and only when `ctx` carried an origin+cookie, so an offline-completed workout
          // never got per-set attribution: a silent regression of the Q-11 Defect B fix, which
          // landed on the web route alone. Sharing one function is what stops the two write
          // paths drifting again (Q-123a). Lazy import — this module reaches back into
          // `@/lib/data`, which is what constructs this adapter.
          const { syncAndAttributeSessionHr } = await import('@/lib/workout/post-completion-hr')
          syncAndAttributeSessionHr(userId, parsed.data.workoutSessionId, userTz).catch(() => {})
          // The next prescription is generated on demand when the session is next opened,
          // not eagerly here — see app/api/complete-workout/route.ts for why.
          processed++
        } else if (mut.domain === 'oura_daily_summary') {
          // Phase-2 A1: the device-computed nightly summary + rolling EMA baselines, backed up to
          // Railway. Delegates to the shared window-scoped upsert (NOT replaceOuraDailySummary,
          // which deletes all rows — that would wipe history on every pushed night). Payload keys
          // mirror the Drizzle column props (flat camelCase); the six baselines arrive flattened as
          // *BaselineMeanX8/*BaselineDevX8 and are reassembled into BaselineStateRow objects.
          // Q-24 §4: these are client-supplied ANALYSIS outputs, not raw readings — the six
          // rolling EMA baselines and their shared n_history age counter are carried forward
          // night to night and drive every baseline-relative readiness/illness contributor. A
          // poisoned push is not one bad day, it is the state the next weeks are measured
          // against. Bounds reject the physically impossible only.
          const summaryCheck = OuraDailySummaryPushSchema.safeParse(clean)
          if (!summaryCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Implausible oura_daily_summary value' })
            continue
          }
          const p = clean as Record<string, unknown>
          const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
          const baseline = (mean: unknown, dev: unknown) => {
            const m = int(mean)
            return m != null ? { meanX8: m, devX8: int(dev) ?? 0 } : null
          }
          await this.upsertOuraDailySummary(userId, [{
            date: mut.date,
            sleepDurationHours: num(p.sleepDurationHours),
            sleepEfficiency:    num(p.sleepEfficiency),
            deepSleepHours:     num(p.deepSleepHours),
            remSleepHours:      num(p.remSleepHours),
            restlessPeriods:    int(p.restlessPeriods),
            sleepLatencySec:    int(p.sleepLatencySec),
            hrvAvgMs:           num(p.hrvAvgMs),
            rhrLowBpm:          num(p.rhrLowBpm),
            rhrAvgBpm:          num(p.rhrAvgBpm),
            recoveryIndexHours: num(p.recoveryIndexHours),
            tempMeanC:          num(p.tempMeanC),
            tempDevC:           num(p.tempDevC),
            metAvg:             num(p.metAvg),
            breathAvgRpm:       num(p.breathAvgRpm),
            hrvBaseline:    baseline(p.hrvBaselineMeanX8, p.hrvBaselineDevX8),
            rhrBaseline:    baseline(p.rhrBaselineMeanX8, p.rhrBaselineDevX8),
            tempBaseline:   baseline(p.tempBaselineMeanX8, p.tempBaselineDevX8),
            sleepBaseline:  baseline(p.sleepBaselineMeanX8, p.sleepBaselineDevX8),
            metBaseline:    baseline(p.metBaselineMeanX8, p.metBaselineDevX8),
            breathBaseline: baseline(p.breathBaselineMeanX8, p.breathBaselineDevX8),
            nHistory:       int(p.nHistory) ?? 0,
          }])
          processed++
        } else if (mut.domain === 'oura_daily_derived') {
          // Phase-2 A2: the device-computed scored/analysis outputs (illness, resilience, chronic
          // stress, readiness/sleep/activity scores, body-comp, …), backed up to Railway. Delegates
          // to the shared COALESCE upsert (upsertOuraDailyDerived) — a null field never clobbers a
          // good stored value, so passing the whole patch with nulls for absent fields is safe. The
          // 7 JSONB columns arrive as TEXT from the local mirror and are JSON.parsed back to objects.
          // Q-24 §4: bound the fields whose range is definitional (scores are 0-100, minutes
          // cannot exceed a day). The open-ended research metrics stay unbounded on purpose —
          // see the schema's own note.
          const derivedCheck = OuraDailyDerivedPushSchema.safeParse(clean)
          if (!derivedCheck.success) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Implausible oura_daily_derived value' })
            continue
          }
          const p = clean as Record<string, unknown>
          const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
          const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
          const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
          const json = (v: unknown): unknown | null => {
            if (v == null) return null
            if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
            return v
          }
          await this.upsertOuraDailyDerived(userId, mut.date, {
            source:                str(p.source),
            modelVersions:         json(p.modelVersions),
            sleepScore:            int(p.sleepScore),
            sleepContributors:     json(p.sleepContributors),
            readinessScore:        int(p.readinessScore),
            readinessContributors: json(p.readinessContributors),
            readinessSource:       str(p.readinessSource),
            activityScore:         int(p.activityScore),
            activityContributors:  json(p.activityContributors),
            activeCaloriesEst:     int(p.activeCaloriesEst),
            trainingLoadOts:       num(p.trainingLoadOts),
            trainingLoadHigh:      bool(p.trainingLoadHigh),
            recoveryIndexHours:    num(p.recoveryIndexHours),
            wornHoursBle:          num(p.wornHoursBle),
            nightHrvBaselineMs:    num(p.nightHrvBaselineMs),
            illnessFlag:           str(p.illnessFlag),
            illnessScore:          int(p.illnessScore),
            illnessBiomarkers:     json(p.illnessBiomarkers),
            daytimeStressScaled:   num(p.daytimeStressScaled),
            stressHighMinutes:     int(p.stressHighMinutes),
            recoveryHighMinutes:   int(p.recoveryHighMinutes),
            chronicStressScore:    int(p.chronicStressScore),
            chronicStressContributors: json(p.chronicStressContributors),
            resilienceLevel:               num(p.resilienceLevel),
            resilienceDailyStress:         num(p.resilienceDailyStress),
            resilienceDailyRestorativeTime: num(p.resilienceDailyRestorativeTime),
            resilienceDailySleepRecovery:  num(p.resilienceDailySleepRecovery),
            resilienceGranular:            num(p.resilienceGranular),
            resilienceConfidence:          num(p.resilienceConfidence),
            bdiDerived:            num(p.bdiDerived),
            vascularAge:           num(p.vascularAge),
            pwv:                   num(p.pwv),
            bodyComp:              json(p.bodyComp),
          })
          processed++
        } else if (mut.domain === 'sleep_session') {
          // Phase-2 A3: device-derived BLE sleep, backed up to Railway. Delegates to the shared
          // upsertOuraSleep with source='oura_ble' — which does the sourceMap/mergeSet per-field
          // rank merge, so it never stomps a higher-ranked Samsung-Health/manual sleep row (a plain
          // upsert would). Natural key is (user_id, sleep_start); the dedup id is oura_id. Missing
          // ouraId/sleepStart/sleepEnd quarantines the mutation (throws → per-item error), never
          // wedging the queue or upserting a bad row.
          const p = clean as Record<string, unknown>
          const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
          const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
          const toDate = (v: unknown): Date | null => (typeof v === 'string' || typeof v === 'number' ? new Date(v) : null)
          const ouraId = str(p.ouraId)
          const sleepStart = toDate(p.sleepStart)
          const sleepEnd = toDate(p.sleepEnd)
          if (!ouraId || !sleepStart || !sleepEnd || Number.isNaN(sleepStart.getTime()) || Number.isNaN(sleepEnd.getTime())) {
            throw new Error('sleep_session: missing/invalid ouraId, sleepStart or sleepEnd')
          }
          // Cross-field: the two timestamps parsing was the ENTIRE check. `sleepEnd < sleepStart`
          // was allowed, and the stage hours were each unbounded and never summed against the
          // window — four ≤24 h stages could total 96 hours inside a one-hour night. This writes at
          // rank `oura_ble`, the same rank the server's own rollup uses, so newer-wins means a bad
          // row REPLACES the server-computed session including its SleepNet staging.
          const spanHours = (sleepEnd.getTime() - sleepStart.getTime()) / 3_600_000
          const sleepReason = sleepImplausibleReason({
            spanHours,
            durationHours:   num(p.durationHours),
            deepSleepHours:  num(p.deepSleepHours),
            remSleepHours:   num(p.remSleepHours),
            lightSleepHours: num(p.lightSleepHours),
            awakHours:       num(p.awakHours),
          })
          if (sleepReason) throw new Error(`sleep_session: implausible — ${sleepReason}`)
          await this.upsertOuraSleep(userId, [{
            ouraId, date: mut.date, sleepStart, sleepEnd,
            durationHours:   num(p.durationHours),
            deepSleepHours:  num(p.deepSleepHours),
            remSleepHours:   num(p.remSleepHours),
            lightSleepHours: num(p.lightSleepHours),
            awakHours:       num(p.awakHours),
            efficiency:      num(p.efficiency),
            onsetLatencySec: int(p.onsetLatencySec),
            averageHrvMs:    num(p.averageHrvMs),
            avgHeartRate:    num(p.avgHeartRate),
            lowestHeartRate: num(p.lowestHeartRate),
            restlessPeriods: int(p.restlessPeriods),
            sleepScore:      int(p.sleepScore),
            respiratoryRate: num(p.respiratoryRate),
            sleepPhase5Min:  str(p.sleepPhase5Min),
            timeInBedHours:  num(p.timeInBedHours),
          }], 'oura_ble')
          processed++
        } else if (mut.domain === 'plan_meal_answers') {
          // Q-187 phase 2. Calls the same `mp.savePlanMealAnswer` / `mp.deletePlanMealAnswer` the
          // web route calls, so the two write paths cannot drift — including the two-level ownership
          // join, which is the part a hand-rolled push branch would be most likely to skip.
          const p = clean as Record<string, unknown>
          const planMealId = typeof p.planMealId === 'string' ? p.planMealId : ''
          const logDate = typeof p.logDate === 'string' ? p.logDate : mut.date
          if (!planMealId) {
            errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid plan_meal_answers payload: missing planMealId' })
            continue
          }
          if (p.deleted) {
            await mp.deletePlanMealAnswer(this.db, userId, planMealId, logDate.replace(/\//g, '-'))
          } else {
            const saved = await mp.savePlanMealAnswer(this.db, userId, {
              id: typeof p.id === 'string' ? p.id : undefined,
              planMealId,
              logDate: logDate.replace(/\//g, '-'),
            })
            // A null means the plan meal is not this user's, or no longer exists. Quarantine rather
            // than retry: neither condition resolves by trying again, and a poison pill must never
            // block the mutations queued behind it.
            if (!saved) {
              errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'plan_meal_answers: unknown or non-owned plan meal' })
              continue
            }
          }
          processed++
        } else {
          // Unrecognized domain (SYNC-Q1): a newer client pushing against an older
          // server (mid-deploy) must not have its mutation silently confirmed and
          // dropped — falling through with neither `processed++` nor an error would
          // leave the mutation out of `errors`, so the client's `resolveFailedOutboxIds`
          // treats it as succeeded and deletes it forever. Report it as a retryable
          // failure instead: the client's existing bounded-retry/dead-letter path
          // (MAX_MUTATION_ATTEMPTS) already caps how long it survives, so a
          // genuinely-removed domain still can't wedge the queue forever.
          errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: `Unsupported domain: ${mut.domain}` })
        }
      } catch (err) {
        // Surface the real cause — per-mutation failures are otherwise only
        // returned in the 200 response body and never hit the server logs.
        console.error('[pushMutations] error', mut.domain, mut.date, err)
        // Q-475: this catch is the only place that still holds the driver error. `String(err)`
        // flattens a dead database and a rejected payload into the same sentence, and the client
        // was then dead-lettering the first as if it were the second. Classify here, while the
        // cause chain is intact.
        errors.push({
          id: mut.id, domain: mut.domain, date: mut.date, error: String(err),
          ...(isRetryableWriteError(err) ? { retryable: true } : {}),
        })
      }
    }

    return warnings.length > 0 ? { processed, errors, warnings } : { processed, errors }
  }

  private rowToInjury(r: typeof s.injuries.$inferSelect): Injury {
    return {
      id: r.id,
      userId: r.userId,
      muscleName: r.muscleName,
      notes: r.notes ?? null,
      severity: r.severity as Injury['severity'],
      startedDate: r.startedDate,
      resolvedDate: r.resolvedDate ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  private rowToSupplement(r: typeof s.supplements.$inferSelect): Supplement {
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      dose: r.dose ?? null,
      reminderEnabled: r.reminderEnabled,
      reminderTime: r.reminderTime ?? null,
      sortOrder: r.sortOrder,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }
  }

  async createFeedback(userId: string, data: { type: string; title: string; description?: string | null; screenshotData?: string | null }): Promise<void> {
    await this.db.insert(s.feedbackSubmissions).values({
      userId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      screenshotData: data.screenshotData ?? null,
    })
  }

  async listFeedback(): Promise<{ id: string; type: string; title: string; description: string | null; screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null }[]> {
    const rows = await this.db
      .select({
        id: s.feedbackSubmissions.id,
        type: s.feedbackSubmissions.type,
        title: s.feedbackSubmissions.title,
        description: s.feedbackSubmissions.description,
        screenshotData: s.feedbackSubmissions.screenshotData,
        createdAt: s.feedbackSubmissions.createdAt,
        userEmail: s.users.email,
        userName: s.users.displayName,
      })
      .from(s.feedbackSubmissions)
      .innerJoin(s.users, eq(s.feedbackSubmissions.userId, s.users.id))
      .orderBy(desc(s.feedbackSubmissions.createdAt))
    return rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  async insertAppLoadMetric(m: {
    userId: string; route: string; totalMs: number; cold: boolean
    responseStartMs?: number | null; domContentMs?: number | null; buildId?: string | null
  }): Promise<void> {
    await this.db.insert(s.appLoadMetrics).values({
      userId: m.userId,
      route: m.route,
      responseStartMs: m.responseStartMs ?? null,
      domContentMs: m.domContentMs ?? null,
      totalMs: m.totalMs,
      cold: m.cold,
      buildId: m.buildId ?? null,
    })

    const now = Date.now()
    if (shouldPrune(lastAppLoadPrune, now, APP_LOAD_PRUNE_THROTTLE_MS)) {
      lastAppLoadPrune = now
      this.db.execute(sql`DELETE FROM app_load_metrics WHERE created_at < now() - interval '14 days'`)
        .catch(err => console.error('[prune] app_load_metrics failed:', err))
    }
  }

  /**
   * p50/p95 per route over `days`, split cold vs warm.
   *
   * The split is the whole report. Every merge is a Railway deploy and the service worker's cache
   * name is stamped from the deploy SHA, so a day with 80 merges invalidates the device's shell 80
   * times — a percentile pooling cold and warm loads measures release cadence rather than the app.
   *
   * `percentile_cont` rather than an ordered fetch in JS: the whole point is to avoid pulling a
   * fortnight of per-navigation rows into the process to sort them. `worstMs` rides along because a
   * p95 hides the load the user actually complained about.
   */
  async getAppLoadReport(userId: string, days: number) {
    const rows = await this.db.execute(sql`
      SELECT route,
             cold,
             count(*)::int AS samples,
             percentile_cont(0.5)  WITHIN GROUP (ORDER BY total_ms)::int AS p50_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms)::int AS p95_ms,
             max(total_ms)::int AS worst_ms
        FROM app_load_metrics
       WHERE user_id = ${userId}::uuid
         AND created_at > now() - make_interval(days => ${days})
       GROUP BY route, cold
       ORDER BY p95_ms DESC
    `)
    return (rows.rows as Record<string, unknown>[]).map(r => ({
      route: String(r.route),
      cold: Boolean(r.cold),
      samples: Number(r.samples),
      p50Ms: Number(r.p50_ms),
      p95Ms: Number(r.p95_ms),
      worstMs: Number(r.worst_ms),
    }))
  }

  async insertErrorEvent(event: { userId: string | null; source: 'client' | 'server'; message: string; stack?: string | null; url?: string | null; userAgent?: string | null }): Promise<void> {
    await this.db.insert(s.errorEvents).values({
      userId: event.userId,
      source: event.source,
      message: event.message,
      stack: event.stack ?? null,
      url: event.url ?? null,
      userAgent: event.userAgent ?? null,
    })

    const now = Date.now()
    if (shouldPrune(lastErrorEventPrune, now, ERROR_EVENT_PRUNE_THROTTLE_MS)) {
      lastErrorEventPrune = now
      this.db.execute(sql`DELETE FROM error_events WHERE created_at < now() - interval '30 days'`).catch(err => console.error('[prune] error_events failed:', err))
    }
  }

  async listErrorEvents(limit: number): Promise<{ id: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null; createdAt: string; userEmail: string | null }[]> {
    const rows = await this.db
      .select({
        id: s.errorEvents.id,
        source: s.errorEvents.source,
        message: s.errorEvents.message,
        stack: s.errorEvents.stack,
        url: s.errorEvents.url,
        userAgent: s.errorEvents.userAgent,
        createdAt: s.errorEvents.createdAt,
        userEmail: s.users.email,
      })
      .from(s.errorEvents)
      .leftJoin(s.users, eq(s.errorEvents.userId, s.users.id))
      .orderBy(desc(s.errorEvents.createdAt))
      .limit(limit)
    return rows.map(r => ({ ...r, userEmail: r.userEmail ?? null, createdAt: r.createdAt.toISOString() }))
  }

  // ── AI call observability (ai_call_log) ─────────────────────────────────────
  async insertAiCallLog(row: AiCallLogInput): Promise<void> {
    await this.db.insert(s.aiCallLog).values({
      userId: row.userId ?? null,
      section: row.section,
      model: row.model,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      totalTokens: row.totalTokens ?? null,
      latencyMs: row.latencyMs ?? null,
      ok: row.ok,
      fingerprint: row.fingerprint ?? null,
      payloadBytes: row.payloadBytes ?? null,
      cachedInputTokens: row.cachedInputTokens ?? null,
    })

    const now = Date.now()
    if (shouldPrune(lastAiCallLogPrune, now, AI_CALL_LOG_PRUNE_THROTTLE_MS)) {
      lastAiCallLogPrune = now
      this.db.execute(sql`DELETE FROM ai_call_log WHERE created_at < now() - interval '30 days'`).catch(err => console.error('[prune] ai_call_log failed:', err))
    }
  }

  async getAiCallUsageSummary(sinceHours: number, windowSeconds: number, bucketHours: number): Promise<AiCallUsageSummary> {
    // Per-section totals, worst-first by token spend.
    const sectionRows = (await this.db.execute(sql`
      SELECT section,
             count(*)::bigint AS calls,
             count(*) FILTER (WHERE NOT ok)::bigint AS errors,
             COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
             COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
             COALESCE(sum(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(round(avg(latency_ms)), 0)::bigint AS avg_latency_ms
      FROM ai_call_log
      WHERE created_at > now() - make_interval(hours => ${sinceHours})
      GROUP BY section
      ORDER BY total_tokens DESC, calls DESC
    `)).rows as Record<string, string | number>[]

    // Calls over time — fixed-width buckets, newest first.
    const timelineRows = (await this.db.execute(sql`
      SELECT to_char(date_bin(make_interval(hours => ${bucketHours}), created_at, now()), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
             count(*)::bigint AS calls,
             COALESCE(sum(total_tokens), 0)::bigint AS total_tokens
      FROM ai_call_log
      WHERE created_at > now() - make_interval(hours => ${sinceHours})
      GROUP BY bucket
      ORDER BY bucket DESC
    `)).rows as Record<string, string | number>[]

    // Double-trip detection: consecutive calls sharing (user, section, fingerprint)
    // within windowSeconds are redundant repeats. Deterministic — a diagnostic count,
    // never gates behaviour.
    const dupRows = (await this.db.execute(sql`
      WITH gaps AS (
        SELECT section, fingerprint,
               EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (
                 PARTITION BY user_id, section, fingerprint ORDER BY created_at))) AS gap_sec
        FROM ai_call_log
        WHERE created_at > now() - make_interval(hours => ${sinceHours}) AND fingerprint IS NOT NULL
      )
      SELECT section,
             count(*) FILTER (WHERE gap_sec IS NOT NULL AND gap_sec <= ${windowSeconds})::bigint AS redundant_calls,
             count(DISTINCT fingerprint) FILTER (WHERE gap_sec IS NOT NULL AND gap_sec <= ${windowSeconds})::bigint AS affected_fingerprints
      FROM gaps
      GROUP BY section
      HAVING count(*) FILTER (WHERE gap_sec IS NOT NULL AND gap_sec <= ${windowSeconds}) > 0
      ORDER BY redundant_calls DESC
    `)).rows as Record<string, string | number>[]

    const sections = sectionRows.map(r => ({
      section: String(r.section),
      calls: Number(r.calls),
      errors: Number(r.errors),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      totalTokens: Number(r.total_tokens),
      avgLatencyMs: Number(r.avg_latency_ms),
    }))

    return {
      sinceHours,
      windowSeconds,
      totalCalls: sections.reduce((a, s2) => a + s2.calls, 0),
      totalErrors: sections.reduce((a, s2) => a + s2.errors, 0),
      totalTokens: sections.reduce((a, s2) => a + s2.totalTokens, 0),
      sections,
      timeline: timelineRows.map(r => ({ bucket: String(r.bucket), calls: Number(r.calls), totalTokens: Number(r.total_tokens) })),
      doubleTrips: dupRows.map(r => ({ section: String(r.section), redundantCalls: Number(r.redundant_calls), affectedFingerprints: Number(r.affected_fingerprints) })),
    }
  }

  /** Latest clock anchor observation for the user. */
  async getOuraClockAnchor(userId: string): Promise<{ id: number; anchorDs: number; anchorUtc: Date } | null> {
    const [a] = await this.db
      .select({ id: s.ouraBleClockAnchors.id, anchorDs: s.ouraBleClockAnchors.anchorDs, anchorUtc: s.ouraBleClockAnchors.anchorUtc })
      .from(s.ouraBleClockAnchors)
      .where(eq(s.ouraBleClockAnchors.userId, userId))
      .orderBy(desc(s.ouraBleClockAnchors.createdAt))
      .limit(1)
    return a ? { id: a.id, anchorDs: Number(a.anchorDs), anchorUtc: new Date(a.anchorUtc) } : null
  }

  /**
   * The newest epoch and its highest `anchor_ds`, in one aggregate row.
   *
   * This is all the ingest path needs — it asks only "which epoch are we in, and has this batch
   * gone backwards past its high-water mark". It used to answer that by loading **every** anchor
   * row and reducing in JS, on every batch: in production that made this the single hottest scan
   * in the database, 17,045 sequential scans reading 45.2M tuples from a 3,297-row table (Q-143).
   *
   * An index would not have helped — the old query returned all rows for the only user, so the
   * sequential scan was the correct plan for it. The cost was the call pattern, and it grew for
   * the life of the ring. This reads one row regardless of how many anchors accumulate.
   *
   * Equivalent to `currentEpoch(anchors)` plus the max `anchorDs` within that epoch, since
   * `currentEpoch` is `max(epoch)` (`lib/oura-ble/clock.ts`). Returns null when the user has no
   * anchors, matching `currentEpoch`'s null.
   */
  async getOuraClockEpochHead(userId: string): Promise<{ epoch: number; maxAnchorDs: number } | null> {
    const [row] = await this.db
      .select({
        epoch: s.ouraBleClockAnchors.epoch,
        maxAnchorDs: sql<string>`max(${s.ouraBleClockAnchors.anchorDs})`,
      })
      .from(s.ouraBleClockAnchors)
      .where(eq(s.ouraBleClockAnchors.userId, userId))
      .groupBy(s.ouraBleClockAnchors.epoch)
      .orderBy(desc(s.ouraBleClockAnchors.epoch))
      .limit(1)
    return row ? { epoch: row.epoch, maxAnchorDs: Number(row.maxAnchorDs) } : null
  }

  /**
   * The single most recently *observed* anchor, by `anchor_utc`.
   *
   * The ingest path stamps `measured_at` off this one specifically. Ordered by `anchor_utc`
   * rather than `created_at` (which `getOuraClockAnchor` uses) to preserve exactly what the
   * previous full-table `reduce` picked: the max `anchorUtcMs`. The two agree for anchors this
   * path writes — it sets both to the same instant — but only `anchor_utc` is the value the
   * reduce actually compared.
   */
  async getNewestOuraClockAnchorByUtc(userId: string): Promise<{ anchorDs: number; anchorUtcMs: number } | null> {
    const [row] = await this.db
      .select({ anchorDs: s.ouraBleClockAnchors.anchorDs, anchorUtc: s.ouraBleClockAnchors.anchorUtc })
      .from(s.ouraBleClockAnchors)
      .where(eq(s.ouraBleClockAnchors.userId, userId))
      .orderBy(desc(s.ouraBleClockAnchors.anchorUtc))
      .limit(1)
    return row ? { anchorDs: Number(row.anchorDs), anchorUtcMs: new Date(row.anchorUtc).getTime() } : null
  }

  /** Every clock-anchor observation for the user, oldest first (migration 161). Reads that
   *  convert a ds resolve it against the observation nearest *that frame*, not the newest.
   *  The ingest path deliberately does NOT use this — see `getOuraClockEpochHead`. */
  async getOuraClockAnchors(userId: string): Promise<ClockAnchor[]> {
    const rows = await this.db
      .select({
        epoch: s.ouraBleClockAnchors.epoch,
        anchorDs: s.ouraBleClockAnchors.anchorDs,
        anchorUtc: s.ouraBleClockAnchors.anchorUtc,
      })
      .from(s.ouraBleClockAnchors)
      .where(eq(s.ouraBleClockAnchors.userId, userId))
      .orderBy(asc(s.ouraBleClockAnchors.anchorDs))
    return rows.map(r => ({ epoch: r.epoch, anchorDs: Number(r.anchorDs), anchorUtcMs: new Date(r.anchorUtc).getTime() }))
  }

  async getWorkoutSensorProbe(userId: string, sessionId?: string): Promise<import('../repository').WorkoutSensorProbe | null> {
    const [ws] = await this.db
      .select({ id: s.workoutSessions.id, startedAt: s.workoutSessions.startedAt, completedAt: s.workoutSessions.completedAt })
      .from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        isNotNull(s.workoutSessions.completedAt),
        ...(sessionId ? [eq(s.workoutSessions.id, sessionId)] : []),
      ))
      .orderBy(desc(s.workoutSessions.completedAt))
      .limit(1)
    if (!ws || !ws.completedAt) return null
    const start = ws.startedAt
    const end = ws.completedAt
    const windowSec = (end.getTime() - start.getTime()) / 1000
    const durationMin = Math.round((windowSec / 60) * 10) / 10

    const chunks = await this.db
      .select({ n: s.ouraAccelChunks.n, sampleRate: s.ouraAccelChunks.sampleRate, steps: s.ouraAccelChunks.steps })
      .from(s.ouraAccelChunks)
      .where(and(eq(s.ouraAccelChunks.userId, userId), gte(s.ouraAccelChunks.startedAt, start), lte(s.ouraAccelChunks.startedAt, end)))
    const accelSamples = chunks.reduce((a, c) => a + c.n, 0)
    const accelSteps = chunks.reduce((a, c) => a + c.steps, 0)
    const accelSeconds = chunks.reduce((a, c) => a + (c.sampleRate > 0 ? c.n / c.sampleRate : 0), 0)
    const coveragePct = windowSec > 0 ? Math.round((accelSeconds / windowSec) * 1000) / 10 : null

    const [hrRow] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(s.ouraHeartrate)
      .where(and(eq(s.ouraHeartrate.userId, userId), gte(s.ouraHeartrate.timestamp, start), lte(s.ouraHeartrate.timestamp, end)))
    const hrSamples = hrRow?.c ?? 0

    let rawByTag: { tag: string; count: number }[] = []
    const anchor = await this.getOuraClockAnchor(userId)
    if (anchor) {
      const startDs = Math.floor(dsFromMeasuredAtMs(start.getTime(), anchor.anchorDs, anchor.anchorUtc.getTime()))
      const endDs = Math.ceil(dsFromMeasuredAtMs(end.getTime(), anchor.anchorDs, anchor.anchorUtc.getTime()))
      const rows = await readRawFrames(this.db, userId, { startDs, endDs })
      const counts = new Map<number, number>()
      for (const r of rows) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1)
      rawByTag = [...counts.entries()]
        .map(([tag, count]) => ({ tag: '0x' + tag.toString(16), count }))
        .sort((a, b) => b.count - a.count)
    }

    return {
      sessionId: ws.id,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      durationMin,
      accel: { chunks: chunks.length, samples: accelSamples, steps: accelSteps, coveragePct },
      hrSamples,
      rawByTag,
      hasAnchor: !!anchor,
    }
  }

  async getDaytimeTagCoverage(userId: string, tz: string, days: number): Promise<import('../repository').DaytimeTagCoverage> {
    // Tags that drive the daytime-signal model builds (plus HRV/IBI/SpO₂ for reference). The gate
    // is whether temp/MET/motion/steps show up during daytime hours or only cluster around sleep.
    const TAG_LABELS: Record<number, string> = {
      0x50: 'MET', 0x46: 'Temp', 0x69: 'Temp', 0x72: 'Motion', 0x7e: 'Steps', 0x7f: 'Steps',
      0x5d: 'HRV', 0x80: 'IBI', 0x60: 'IBI', 0x8b: 'SpO₂',
      // PPG (0x81) + bioimpedance (0x87 metadata, 0x88 raw) — the gate on the cva /
      // halite / atlas model builds. We decode+store these tags but the probe omitted
      // them, so "unreachable over BLE" was never actually measured. Included so an
      // on-device census (after SetFeatureMode CVA_PPG) can confirm whether they stream.
      0x81: 'PPG', 0x87: 'BioZ meta', 0x88: 'BioZ raw',
    }
    const daytimeHours: [number, number] = [9, 21]
    const clampedDays = Math.max(1, Math.min(30, Math.floor(days) || 7))
    const anchor = await this.getOuraClockAnchor(userId)
    if (!anchor) return { hasAnchor: false, days: clampedDays, tz, daytimeHours, tags: [] }

    const anchorUtcMs = anchor.anchorUtc.getTime()
    const nowMs = Date.now()
    const fromMs = nowMs - clampedDays * 86_400_000
    const startDs = Math.floor(dsFromMeasuredAtMs(fromMs, anchor.anchorDs, anchorUtcMs))
    const endDs = Math.ceil(dsFromMeasuredAtMs(nowMs, anchor.anchorDs, anchorUtcMs))
    const tagsOfInterest = Object.keys(TAG_LABELS).map(Number)

    const rows = await readRawFrames(this.db, userId, { tags: tagsOfInterest, startDs, endDs })

    const perTag = new Map<number, number[]>() // tag → 24-bucket hour histogram
    for (const r of rows) {
      const hist = perTag.get(r.tag) ?? new Array(24).fill(0)
      const tsMs = measuredAtMs(Number(r.ds), anchor.anchorDs, anchorUtcMs)
      const hour = Number(formatInTimeZone(new Date(tsMs), tz, 'H'))
      if (hour >= 0 && hour < 24) { hist[hour]++; perTag.set(r.tag, hist) }
    }

    const [dStart, dEnd] = daytimeHours
    const tags = [...perTag.entries()]
      .map(([tag, byHour]) => {
        const total = byHour.reduce((a, b) => a + b, 0)
        const daytime = byHour.reduce((a, c, h) => a + (h >= dStart && h < dEnd ? c : 0), 0)
        return { tag: '0x' + tag.toString(16).padStart(2, '0'), label: TAG_LABELS[tag], total, daytime, night: total - daytime, byHour }
      })
      .sort((a, b) => b.total - a.total)
    return { hasAnchor: true, days: clampedDays, tz, daytimeHours, tags }
  }

  async getOuraHeartrateBySource(userId: string, source: string, from: Date, to: Date): Promise<{ timestamp: Date; bpm: number }[]> {
    const rows = await this.db
      .select({ timestamp: s.ouraHeartrate.timestamp, bpm: s.ouraHeartrate.bpm })
      .from(s.ouraHeartrate)
      .where(and(
        eq(s.ouraHeartrate.userId, userId),
        eq(s.ouraHeartrate.source, source),
        gte(s.ouraHeartrate.timestamp, from),
        lte(s.ouraHeartrate.timestamp, to),
      ))
      .orderBy(asc(s.ouraHeartrate.timestamp))
    return rows
  }

  async getOuraDaytimeSignals(userId: string, from: Date, to: Date): Promise<{
    temp: { tsMs: number; valueC: number }[]
    met: { tsMs: number; value: number }[]
  }> {
    const anchor = await this.getOuraClockAnchor(userId)
    if (!anchor) return { temp: [], met: [] }
    const anchorUtcMs = anchor.anchorUtc.getTime()
    const startDs = Math.floor(dsFromMeasuredAtMs(from.getTime(), anchor.anchorDs, anchorUtcMs))
    const endDs = Math.ceil(dsFromMeasuredAtMs(to.getTime(), anchor.anchorDs, anchorUtcMs))
    const rows = await readRawFrames(this.db, userId, { tags: [0x46, 0x69, 0x50], startDs, endDs })
    const temp: { tsMs: number; valueC: number }[] = []
    const met: { tsMs: number; value: number }[] = []
    for (const r of rows) {
      const decoded = r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null)
      if (!decoded) continue
      const tsMs = measuredAtMs(Number(r.ds), anchor.anchorDs, anchorUtcMs)
      if (r.tag === 0x50) {
        for (const v of numArr(decoded, 'met')) met.push({ tsMs, value: v })
      } else {
        for (const c of numArr(decoded, 'temps_c')) temp.push({ tsMs, valueC: c })
      }
    }
    return { temp, met }
  }

  async getOuraBatteryEvents(userId: string, from: Date, to: Date): Promise<Array<{
    tsMs: number
    kind: 'battery_level_changed' | 'charging_time'
    batteryPct: number | null
    voltageMv: number | null
    chargingTimeSec: number | null
  }>> {
    const anchor = await this.getOuraClockAnchor(userId)
    if (!anchor) return []
    const anchorUtcMs = anchor.anchorUtc.getTime()
    const startDs = Math.floor(dsFromMeasuredAtMs(from.getTime(), anchor.anchorDs, anchorUtcMs))
    const endDs = Math.ceil(dsFromMeasuredAtMs(to.getTime(), anchor.anchorDs, anchorUtcMs))
    const rows = await readRawFrames(this.db, userId, { tags: [0x61], startDs, endDs })
    const out: Array<{ tsMs: number; kind: 'battery_level_changed' | 'charging_time'; batteryPct: number | null; voltageMv: number | null; chargingTimeSec: number | null }> = []
    for (const r of rows) {
      const decoded = (r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null)) as Record<string, unknown> | null
      const kind = decoded?.kind
      if (kind !== 'battery_level_changed' && kind !== 'charging_time') continue
      out.push({
        tsMs: measuredAtMs(Number(r.ds), anchor.anchorDs, anchorUtcMs),
        kind,
        batteryPct: typeof decoded!.battery_pct === 'number' ? decoded!.battery_pct : null,
        voltageMv: typeof decoded!.voltage_mv === 'number' ? decoded!.voltage_mv : null,
        chargingTimeSec: typeof decoded!.charging_time === 'number' ? decoded!.charging_time : null,
      })
    }
    return out
  }

  async insertOuraBatteryPoll(userId: string, percent: number, charging: boolean | null): Promise<void> {
    await this.db.insert(s.ouraBleBatteryPoll).values({ userId, percent, charging })
    const now = Date.now()
    if (shouldPrune(lastBatteryPollPrune, now, BATTERY_POLL_PRUNE_THROTTLE_MS)) {
      lastBatteryPollPrune = now
      this.db.execute(sql`DELETE FROM oura_ble_battery_poll WHERE measured_at < now() - interval '90 days'`).catch(err => console.error('[prune] oura_ble_battery_poll failed:', err))
    }
  }

  async getOuraBatteryPolls(userId: string, from: Date, to: Date): Promise<Array<{ tsMs: number; percent: number; charging: boolean | null }>> {
    const rows = await this.db
      .select({ measuredAt: s.ouraBleBatteryPoll.measuredAt, percent: s.ouraBleBatteryPoll.percent, charging: s.ouraBleBatteryPoll.charging })
      .from(s.ouraBleBatteryPoll)
      .where(and(
        eq(s.ouraBleBatteryPoll.userId, userId),
        gte(s.ouraBleBatteryPoll.measuredAt, from),
        lte(s.ouraBleBatteryPoll.measuredAt, to),
      ))
      .orderBy(asc(s.ouraBleBatteryPoll.measuredAt))
    return rows.map(r => ({ tsMs: r.measuredAt.getTime(), percent: r.percent, charging: r.charging }))
  }

  async insertOuraRawSamples(userId: string, rows: OuraRawSampleInput[]): Promise<number> {
    if (rows.length === 0) return 0

    // Clock-anchor maintenance (migrations 115 + 161): the newest ring ds in this batch was
    // drained ~seconds ago, so (batchMaxDs ↔ now) is a fresh correspondence. It is recorded
    // as a new **observation** rather than mutating the previous one — the old forward-only
    // update meant a single row's lag dated all of history, and that lag grew with time
    // since the last sync (see lib/oura-ble/clock.ts).
    //
    // A batch whose max ds sits below the epoch's high-water mark USED to be treated as a ring clock
    // reset outright. Q-314: a history re-drain produces exactly the same shape, and reading it as a
    // reset re-timed the owner's entire sleep history twice. `classifyClockRegression` decides now —
    // a declared re-key opens an epoch, a counter that genuinely restarted opens one as a net, and a
    // replay of history the ring already sent does not.
    const batchMaxDs = Math.max(...rows.map(r => r.ringTimestampDs))
    // Three single-row reads, not the whole anchor table — this runs on every ingest batch and was
    // the hottest scan in the database (Q-143). Everything below needs exactly these facts.
    const [head, storedNewest, pendingRekey] = await Promise.all([
      this.getOuraClockEpochHead(userId),
      this.getNewestOuraClockAnchorByUtc(userId),
      this.getPendingRekeyDeclaration(userId),
    ])
    const epochNow = head?.epoch ?? null
    const epochMaxDs = head?.maxAnchorDs ?? -Infinity

    let epoch = epochNow ?? 0
    let shouldObserve = epochNow == null || batchMaxDs > epochMaxDs
    if (epochNow != null) {
      const verdict = classifyClockRegression(batchMaxDs, epochMaxDs, pendingRekey != null)
      if (verdict.action === 'open-epoch') {
        epoch = epochNow + 1
        shouldObserve = true
        console.warn(`[oura-ble] opening clock epoch ${epoch} (${verdict.reason}; batchMaxDs=${batchMaxDs}, epoch ${epochNow} max ${epochMaxDs})`)
      } else if (verdict.reason === 'redrain') {
        // Deliberately loud but harmless. This is the case that used to corrupt the history, and it
        // is also the ordinary consequence of a re-pair — so it must be visible without being an
        // error, and the batch still extends the current epoch as it should.
        console.warn(`[oura-ble] ds regression treated as a history re-drain, NOT a reset (batchMaxDs=${batchMaxDs} is ${(batchMaxDs / epochMaxDs * 100).toFixed(0)}% of epoch ${epochNow} max ${epochMaxDs}); staying in epoch ${epochNow}. If the ring really was re-keyed, declare it: POST /api/oura-ble/rekey`)
      }
    }
    // Consumed only once the anchor for the new epoch is actually written, below.
    const consumeRekey = pendingRekey != null && epoch !== (epochNow ?? 0) ? pendingRekey.id : null
    let newest = storedNewest
    if (shouldObserve) {
      const anchorUtc = new Date()
      await this.db.insert(s.ouraBleClockAnchors)
        .values({ userId, anchorDs: batchMaxDs, anchorUtc, epoch, observedSource: 'drain' })
      // Stamped `now`, so it is necessarily the newest by anchor_utc — same row the old
      // full-table reduce would have selected after pushing it.
      newest = { anchorDs: batchMaxDs, anchorUtcMs: anchorUtc.getTime() }
      // After the anchor, never before: a declaration marked consumed without an epoch to point at
      // would be silently lost, and the owner would have no way to tell it had not taken effect.
      if (consumeRekey != null) await this.consumeRekeyDeclaration(consumeRekey, epoch)
    }

    // Reads still run on the single-newest-anchor path; only the recording changes here, so
    // this batch is stamped exactly as it would have been before (measured_at is a derived
    // convenience column, re-derivable from body_hex + anchors at any time).
    // `newest` cannot be null here: no anchors means epochNow == null, which forces
    // shouldObserve and the insert above.
    const anchor = newest!
    const measuredAt = (ds: number) => new Date(measuredAtMs(ds, anchor.anchorDs, anchor.anchorUtcMs))

    // Lever 1 (ingestion culling): stop persisting the `decoded` JSONB — it roughly
    // doubles per-row cost and is fully re-derivable from the archival body_hex. The
    // rollup and the diagnostic readers now decode from body_hex in-memory (coalescing
    // with any historical `decoded` still on older rows). body_hex stays untouched.
    const inserted = await this.db
      .insert(s.ouraRawSamples)
      .values(rows.map(r => ({
        userId,
        ringTimestampDs: r.ringTimestampDs,
        tag: r.tag,
        eventName: r.eventName,
        bodyHex: r.bodyHex,
        decoded: null,
        measuredAt: measuredAt(r.ringTimestampDs),
        epoch,
      })))
      .onConflictDoNothing()
      .returning({ id: s.ouraRawSamples.id })

    // Idempotent backfill: date any rows stored before the anchor existed (or
    // whose insert predates this migration). Cheap no-op once caught up.
    await this.db.execute(sql`
      UPDATE oura_raw_samples
      SET measured_at = ${new Date(anchor.anchorUtcMs)}::timestamptz
        + make_interval(secs => (ring_timestamp_ds - ${anchor.anchorDs}) * 0.1)
      WHERE user_id = ${userId} AND measured_at IS NULL
    `)

    // Q-541 Task 6 — retire sealed buckets to the cold tier. Fire-and-forget after the response's
    // work is done, throttled per user, and bounded; see `claimAutoPackSlot`.
    if (claimAutoPackSlot(userId, Date.now())) void this.autoPackRawSamples(userId)

    return inserted.length
  }

  /**
   * The unattended half of the packer.
   *
   * Everything here is about the fact that nobody is watching. A refused bucket is the packer
   * declining to delete frames it could not prove were stored — the single most important signal
   * this pipeline produces — and until Task 6 it was returned to whoever pressed the button. With no
   * caller it has to go somewhere a session will read, which is `error_events`, per the start-of-
   * session rule: a fault that stops on its own otherwise vanishes at the 30-day prune unrecorded.
   *
   * Never throws. It is invoked with `void` from an ingest path that has already done its real work,
   * and a packing failure must not turn a successful frame ingest into a 500.
   */
  private async autoPackRawSamples(userId: string): Promise<void> {
    try {
      const res = await packOuraRawBuckets(this.db, userId, AUTOPACK_MAX_BUCKETS)
      if (res.packed > 0) {
        console.info(`[oura-autopack] packed ${res.packed} bucket(s), ${res.framesMoved} frames -> ${res.bytesWritten} bytes in ${res.ms}ms; ${res.remaining} left`)
      }
      for (const b of res.buckets) {
        if (!b.refused) continue
        const where = `epoch ${b.epoch} tag 0x${b.tag.toString(16)} bucket ${b.dsBucket} (${b.frames} frames)`
        console.error(`[oura-autopack] REFUSED ${where}: ${b.refused}`)
        await this.insertErrorEvent({
          userId,
          source: 'server',
          message: `[oura-autopack] refused to pack ${where}: ${b.refused}`,
          url: 'oura-autopack',
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[oura-autopack] run failed:', err)
    }
  }

  /**
   * Formerly: re-stamp `measured_at` and refresh `event_name` over every stored row.
   *
   * **Both columns are dead as of Q-541 Task 7, so this pass has nothing to correct.** Every reader
   * now derives the event name from `tag` and the wall-clock time from the clock anchors, and a
   * packed frame carries neither column at all — so re-stamping wrote values nothing reads.
   *
   * That it is now a no-op is not a tidy-up. **This loop caused the 2026-08-17 `disk_full`
   * outage**: `measured_at` was indexed, so writing back a changed value could never be a HOT
   * update and rewrote an entry in all four of the table's indexes. Production reached 1,324,792
   * updates against 740,966 rows with **19** HOT, and a single full re-stamp rewrote 681,005 rows
   * without adding one frame. Q-46's `IS DISTINCT FROM` guard bounded the damage but could not
   * remove it — the Q-71/Q-536 clock fixes changed every row's derived value, so every row was
   * genuinely distinct. Deriving at read time is what removes the operation, and with it the reason
   * the documented remedy for five failure modes (ops-doc I12, I14, I19, I20, I25) was a disk-fill
   * hazard.
   *
   * Kept as a no-op rather than deleted because `/api/oura-ble/samples/redecode` still exists and
   * still does the part that matters — re-aggregating from `body_hex`, which is untouched. The
   * counters are reported as 0 rather than removed so the admin readout keeps its shape; the route
   * now reports `restamped: 0` because there is nothing to re-stamp, not because it failed.
   */
  async redecodeOuraRawSamples(_userId: string): Promise<{ scanned: number; updated: number; restamped: number }> {
    return { scanned: 0, updated: 0, restamped: 0 }
  }

  /** D5 — own daytime-HRV: throttled per-user refit (fittedAt-gated, not an in-memory timer, so it
   *  survives process restarts and is correctly per-user). Pulls a 60-day lookback of decoded
   *  0x5d/0x46/0x69 raw samples + sleep windows, extracts night-time (hr,temp)→rmssd training
   *  tuples, fits the closed-form regression, and upserts. A no-op (not an error) when there isn't
   *  enough data yet — cold start returns null from `fitDaytimeHrvModel`, same contract as before. */
  private async maybeRefitDaytimeHrvModel(userId: string, timezone: string): Promise<void> {
    const REFIT_THROTTLE_MS = 24 * 60 * 60 * 1000
    // Was 60, which getOuraRawSamplesForTags silently clamped to 31 — so the sleep-window lookup
    // below spanned twice the range the samples could ever cover. Ask for what is actually served.
    const REFIT_LOOKBACK_DAYS = MAX_RAW_SAMPLE_WINDOW_DAYS
    const existing = await this.getDaytimeHrvModel(userId)
    if (existing && !shouldPrune(existing.fittedAt.getTime(), Date.now(), REFIT_THROTTLE_MS)) return

    // Throttle ATTEMPTS, not just successes. The check above keys off the stored model's fittedAt,
    // so with no model yet it does nothing and the refit runs on EVERY rollup — which was free
    // while the query returned zero rows, and is a ~43k-row read + decode (503 KB, measured against
    // production 2026-08-05) now that it returns data. Without this, a user with no model yet — or
    // one whose fit keeps failing — pays that on every ingest drain, forever.
    // Per-process (the adapter is a singleton); a replica restart re-arms it, which is fine for a
    // once-a-day pass.
    const lastAttempt = PostgresWorkoutRepository.lastHrvRefitAttemptMs.get(userId)
    if (lastAttempt != null && Date.now() - lastAttempt < REFIT_THROTTLE_MS) return
    PostgresWorkoutRepository.lastHrvRefitAttemptMs.set(userId, Date.now())

    const rows = await this.getOuraRawSamplesForTags(userId, [0x5d, 0x46, 0x69], REFIT_LOOKBACK_DAYS)
    if (rows.length === 0) return // genuinely no ring data in the window — nothing to say
    const toIso = todayInTz(timezone)
    const fromIso = toAestDay(new Date(Date.now() - REFIT_LOOKBACK_DAYS * 86_400_000), timezone)
    const sleepSessions = await this.listSleepSessions(userId, fromIso, toIso)
    const samples = extractNightlyTrainingSamples(rows, sleepSessions)

    // Both bails below used to be a bare `return`, which is why this went unnoticed for the life of
    // the feature: the model was empty in production while the pipeline reported success every day.
    // Throwing routes the reason into the rollup's `stepErrors`, which the caller surfaces.
    // Deliberately NOT thrown for a genuine cold start (some samples, just not enough yet) — an
    // alert that fires during normal ramp-up is an alert nobody reads.
    if (samples.length === 0) {
      throw new Error(`no training samples from ${rows.length} raw rows over ${REFIT_LOOKBACK_DAYS}d `
        + `(${sleepSessions.length} sleep windows) — decode or sleep-window matching is failing, not cold start`)
    }
    const model = fitDaytimeHrvModel(samples)
    if (!model) {
      if (samples.length >= MIN_TRAINING_SAMPLES) {
        throw new Error(`fit returned null on ${samples.length} samples (>= ${MIN_TRAINING_SAMPLES}) — singular system`)
      }
      return // below the minimum: real cold start, stay quiet
    }
    await this.upsertDaytimeHrvModel(userId, model)
  }

  /** Roll decoded raw BLE samples up into the product tables the health screens
   *  read — sleep_sessions (bedtime windows + hypnogram + sleep HR/HRV) and
   *  body_metrics (HRV, RHR, SpO₂ per wake day). Reuses the same non-clobbering
   *  upserts as the Oura Cloud sync (one write function per domain). */
  async aggregateOuraRawSamples(userId: string, timezone: string, opts?: import('@/lib/oura-ble/rollup/run').RollupOptions): Promise<import('../repository').OuraRawAggregateResult> {
    ensureServerOuraConstants()
    return runOuraRollup(createPostgresRollupIO({
      db: this.db,
      userId,
      getOuraClockAnchor: id => this.getOuraClockAnchor(id),
      getOuraClockAnchors: id => this.getOuraClockAnchors(id),
      upsertBodyMetrics: (id, rows, source) => this.upsertBodyMetrics(id, rows, source),
      refitDaytimeHrvModel: (id, tz) => this.maybeRefitDaytimeHrvModel(id, tz),
    }), nodeModelRuntime, timezone, opts)
  }

  // Read-only dry-run for the D0 historical step backfill (`allowStepsDecrease`). Mirrors the
  // steps rollup step's query/pipeline/merge logic exactly (unbounded — full history, no
  // rollupCutoffDs), but never writes. A day is only reported if it would ACTUALLY change: the
  // stored steps value differs AND its current sourceMap rank is <= oura_ble's — the identical
  // condition `mergeSet` applies on the real write, so a `manual` day is correctly never listed.
  async previewStepsBackfill(userId: string, timezone: string): Promise<import('../repository').StepsBackfillPreviewRow[]> {
    const anchors = await this.getOuraClockAnchors(userId)
    if (anchors.length === 0) return []
    const [stepFrameRows, motionFrameRows, liveWindowRows] = await Promise.all([
      readRawFrames(this.db, userId, { tags: [...STEP_FEATURE_TAGS] }),
      readRawFrames(this.db, userId, { tags: [STEP_MOTION_TAG] }),
      this.db
        .select({ startDs: s.stepLiveWindows.startDs, endDs: s.stepLiveWindows.endDs, steps: s.stepLiveWindows.steps })
        .from(s.stepLiveWindows)
        .where(eq(s.stepLiveWindows.userId, userId)),
    ])

    // Same bucketing + merge the rollup uses — see lib/oura-ble/step-day-buckets.ts. This is a
    // read-only DRY RUN of the write, so it must not have its own copy: the owner authorises a
    // destructive backfill from these numbers.
    ensureServerOuraConstants()
    const stepsByDay = await computeStepsByDay({
      runtime: nodeModelRuntime,
      stepFrames: stepFrameRows,
      motionFrames: motionFrameRows,
      liveWindows: liveWindowRows,
      anchors,
      timezone,
    })
    const days = new Set(stepsByDay.keys())
    if (days.size === 0) return []

    const existing = await this.db
      .select({ date: s.bodyMetrics.date, steps: s.bodyMetrics.steps, sourceMap: s.bodyMetrics.sourceMap })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), inArray(s.bodyMetrics.date, Array.from(days))))
    const existingByDay = new Map(existing.map(r => [r.date, r]))

    const rows: import('../repository').StepsBackfillPreviewRow[] = []
    for (const [day, newSteps] of stepsByDay) {
      const ex = existingByDay.get(day)
      const oldSteps = ex?.steps ?? 0
      const oldSource = (ex?.sourceMap as Record<string, string> | null)?.steps ?? null
      const wouldChange = newSteps !== oldSteps && sourceRank(oldSource) <= sourceRank('oura_ble')
      if (wouldChange) rows.push({ date: day, oldSteps, oldSource, newSteps })
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date))
  }

  async upsertStepLiveWindow(
    userId: string,
    window: { startDs: number; endDs: number; steps: number; source?: string },
  ): Promise<import('../repository').StepLiveWindow> {
    const [row] = await this.db.insert(s.stepLiveWindows).values({
      userId,
      startDs: window.startDs,
      endDs: window.endDs,
      steps: window.steps,
      source: window.source ?? 'live-accel',
    }).onConflictDoUpdate({
      target: [s.stepLiveWindows.userId, s.stepLiveWindows.startDs],
      set: { endDs: window.endDs, steps: window.steps, source: window.source ?? 'live-accel' },
      setWhere: eq(s.stepLiveWindows.userId, userId),
    }).returning()

    // Lever 3 retention: prune windows older than 30 days (by wall-clock created_at — start_ds is
    // ring-relative and resets). Throttled, fire-and-forget; never fails the write.
    const now = Date.now()
    if (shouldPrune(lastStepWindowPrune, now, STEP_WINDOW_PRUNE_THROTTLE_MS)) {
      lastStepWindowPrune = now
      this.db.execute(sql`DELETE FROM step_live_windows WHERE created_at < now() - interval '30 days'`).catch(err => console.error('[prune] step_live_windows failed:', err))
    }

    return {
      id: row.id, userId: row.userId, startDs: Number(row.startDs), endDs: Number(row.endDs),
      steps: row.steps, source: row.source, createdAt: row.createdAt,
    }
  }

  async insertOuraAccelChunk(
    userId: string,
    chunk: { startedAt: Date; sampleRate: number; magnitudes: number[]; steps: number },
  ): Promise<{ inserted: boolean }> {
    const rows = await this.db.insert(s.ouraAccelChunks).values({
      userId,
      startedAt: chunk.startedAt,
      sampleRate: chunk.sampleRate,
      n: chunk.magnitudes.length,
      steps: chunk.steps,
      magnitudes: chunk.magnitudes,
    }).onConflictDoNothing({
      target: [s.ouraAccelChunks.userId, s.ouraAccelChunks.startedAt],
    }).returning({ id: s.ouraAccelChunks.id })
    // Raw retention is bounded at 7 days (recount/calibration window). No cron layer —
    // ingest-time housekeeping, user-scoped. Throttled + fire-and-forget: a transient delete
    // failure must not fail the accel POST that already stored its chunk (H-5c).
    const nowMs = Date.now()
    if (shouldPrune(lastAccelChunkPrune, nowMs, ACCEL_CHUNK_PRUNE_THROTTLE_MS)) {
      lastAccelChunkPrune = nowMs
      this.db.delete(s.ouraAccelChunks).where(and(
        eq(s.ouraAccelChunks.userId, userId),
        sql`${s.ouraAccelChunks.createdAt} < now() - interval '7 days'`,
      )).catch(err => console.error('[oura-ble] accel-chunk prune failed:', err))
    }
    return { inserted: rows.length > 0 }
  }

  async getOuraRawSampleSummary(userId: string): Promise<OuraRawSampleSummary> {
    const where = eq(s.ouraRawSamples.userId, userId)

    // The aggregates below count BOTH tiers. A packed bucket is still the owner's history, so a
    // total that silently reported "the last 7 days" would read as data loss on the one screen that
    // exists to answer whether the ring is delivering.
    //
    // The hot side is anti-joined against the packed side on `(epoch, tag, ds_bucket)`, because the
    // packer writes a blob, verifies it, and only THEN deletes the hot rows — so a bucket is
    // legitimately in both tiers for the width of that window, and permanently if the packer is
    // interrupted between the two. Measured on the dev server before this anti-join existed: 80
    // frames read as 120. A packed bucket is therefore counted from its blob and never from the hot
    // rows it duplicates, which is exact because the packer's unit is a whole bucket.
    const notAlreadyPacked = sql`NOT EXISTS (
      SELECT 1 FROM ${s.ouraRawPacked} p
       WHERE p.user_id = ${s.ouraRawSamples.userId}
         AND p.epoch = ${s.ouraRawSamples.epoch}
         AND p.tag = ${s.ouraRawSamples.tag}
         AND p.ds_bucket = ${s.ouraRawSamples.ringTimestampDs} / ${DS_BUCKET_SPAN}
    )`

    const [[hotTotals], [packedTotals]] = await Promise.all([
      this.db
        .select({
          total: sql<number>`count(*) FILTER (WHERE ${notAlreadyPacked})::int`,
          newest: sql<Date | null>`max(${s.ouraRawSamples.recordedAt})`,
        })
        .from(s.ouraRawSamples)
        .where(where),
      this.db
        .select({ frames: sql<number>`coalesce(sum(${s.ouraRawPacked.frameCount}), 0)::int` })
        .from(s.ouraRawPacked)
        .where(eq(s.ouraRawPacked.userId, userId)),
    ])
    const totals = { total: (hotTotals?.total ?? 0) + (packedTotals?.frames ?? 0), newest: hotTotals?.newest ?? null }

    const [hotByTag, packedByTag] = await Promise.all([
      this.db
        .select({ tag: s.ouraRawSamples.tag, count: sql<number>`count(*)::int` })
        .from(s.ouraRawSamples)
        .where(and(where, notAlreadyPacked))
        .groupBy(s.ouraRawSamples.tag),
      this.db
        .select({ tag: s.ouraRawPacked.tag, count: sql<number>`coalesce(sum(${s.ouraRawPacked.frameCount}), 0)::int` })
        .from(s.ouraRawPacked)
        .where(eq(s.ouraRawPacked.userId, userId))
        .groupBy(s.ouraRawPacked.tag),
    ])
    // Grouped by tag alone and named from `eventName(tag)` rather than the stored column: a packed
    // frame has no stored name, and grouping on a column one tier lacks would split one tag into
    // two rows.
    const countsByTag = new Map<number, number>()
    for (const r of [...hotByTag, ...packedByTag]) countsByTag.set(r.tag, (countsByTag.get(r.tag) ?? 0) + r.count)
    const byName = [...countsByTag.entries()]
      .map(([tag, count]) => ({ tag, eventName: eventName(tag), count }))
      .sort((a, b) => b.count - a.count)

    // One newest decoded row per event type for the tester's field inspector.
    // DISTINCT ON (tag) keeps the highest ring clock per tag — cheap (~1 row/tag). Hot-tier only,
    // then a per-tag cold lookup for any tag that has gone quiet for longer than the hot window —
    // without which a dormant tag reads as having no data rather than as stale.
    const summaryAnchors = await this.getOuraClockAnchors(userId)
    const derivedMeasuredAt = (ds: number): Date | null => {
      const ms = resolveDsToMs(ds, summaryAnchors)
      return ms != null ? new Date(ms) : null
    }
    const hotLatest = (await this.db
      .selectDistinctOn([s.ouraRawSamples.tag], {
        tag: s.ouraRawSamples.tag,
        ds: s.ouraRawSamples.ringTimestampDs,
        decoded: s.ouraRawSamples.decoded,
        bodyHex: s.ouraRawSamples.bodyHex,
      })
      .from(s.ouraRawSamples)
      .where(where)
      .orderBy(s.ouraRawSamples.tag, desc(s.ouraRawSamples.ringTimestampDs)))
      // Both metadata columns are derived rather than read (Q-541 Task 7). `measured_at` was the
      // last projection of a column that is now dead, and a packed frame carries neither — leaving
      // one branch reading and the other deriving is how a field starts disagreeing with itself.
      .map(r => ({ tag: r.tag, eventName: eventName(r.tag), measuredAt: derivedMeasuredAt(Number(r.ds)), decoded: r.decoded, bodyHex: r.bodyHex }))
    const hotLatestTags = new Set(hotLatest.map(r => r.tag))
    const dormantTags = [...countsByTag.keys()].filter(t => !hotLatestTags.has(t))
    const coldLatest = dormantTags.length === 0 ? [] : (await Promise.all(
      dormantTags.map(async tag => {
        const [newest] = await readRecentRawFrames(this.db, userId, [tag], 1)
        return newest
          ? { tag, eventName: eventName(tag), measuredAt: derivedMeasuredAt(newest.ds), decoded: newest.decoded, bodyHex: newest.bodyHex }
          : null
      }),
    )).filter((r): r is NonNullable<typeof r> => r != null)
    const latestRows = [...hotLatest, ...coldLatest]

    // Latest decoded values are pulled from the most recent candidate rows and
    // extracted in JS (the decoded arrays live in JSONB; a summary is low-volume).
    const lastArrayValue = (rows: { decoded: unknown }[], key: string): number | null => {
      for (const r of rows) {
        const arr = (r.decoded as Record<string, unknown> | null)?.[key]
        if (Array.isArray(arr) && arr.length > 0) {
          const v = arr[arr.length - 1]
          if (typeof v === 'number') return v
        }
      }
      return null
    }
    // Rows ordered newest-first by the ring's own clock; enough per metric to
    // estimate cadence. Includes ring_timestamp_ds so we can anchor to wall-clock.
    // Coalesce decoded ?? decode-from-hex (Lever 1: decoded no longer persisted).
    const recent = async (tags: number[]) => {
      const rows = await readRecentRawFrames(this.db, userId, tags, 200)
      return rows.map(r => ({ ds: r.ds, decoded: r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null) }))
    }

    // Clock anchor: the newest event by ring clock, and when we ingested it.
    // The newest drained event is measured ~seconds before ingest, so its
    // recorded_at anchors every older event's ring_timestamp_ds to real time.
    const anchorQuery = this.db
      .select({ ds: s.ouraRawSamples.ringTimestampDs, recordedAt: s.ouraRawSamples.recordedAt })
      .from(s.ouraRawSamples)
      .where(where)
      .orderBy(desc(s.ouraRawSamples.ringTimestampDs))
      .limit(1)

    // Both tiers, min-of-mins in JS rather than one query: the oldest frame is by definition the one
    // most likely to have been packed, so a hot-only MIN would report the history as starting 7 days
    // ago — and a join-shaped version returns no row at all once the hot tier is empty.
    const spanQuery = Promise.all([
      this.db
        .select({ minDs: sql<number | null>`min(${s.ouraRawSamples.ringTimestampDs})::bigint` })
        .from(s.ouraRawSamples)
        .where(where),
      this.db
        .select({ minDs: sql<number | null>`min(${s.ouraRawPacked.minDs})::bigint` })
        .from(s.ouraRawPacked)
        .where(eq(s.ouraRawPacked.userId, userId)),
    ]).then(([[hot], [packed]]) => {
      const candidates = [hot?.minDs, packed?.minDs]
        .map(v => (v == null ? null : Number(v)))
        .filter((v): v is number => v != null)
      return { minDs: candidates.length > 0 ? Math.min(...candidates) : null }
    })

    const [hrRows, tempRows, hrvRows, spo2Rows, spo2RPiRows, [anchor], span] = await Promise.all([
      recent([0x80, 0x60, 0x5d]),
      recent([0x46, 0x69, 0x75]),
      recent([0x5d]),
      recent([0x6f]),
      recent([0x8b]),
      anchorQuery,
      spanQuery,
    ])

    // Anchor conversion: ring_timestamp_ds → wall-clock ISO string.
    const anchorDs = anchor ? Number(anchor.ds) : null
    const anchorUtcMs = anchor?.recordedAt ? new Date(anchor.recordedAt).getTime() : null
    const measuredAt = (ds: number | null): string | null =>
      ds != null && anchorDs != null && anchorUtcMs != null
        ? new Date(measuredAtMs(ds, anchorDs, anchorUtcMs)).toISOString()
        : null

    const timing = (rows: { ds: number }[]): OuraRawSampleSummary['hrTiming'] => ({
      latestAt: rows.length > 0 ? measuredAt(Number(rows[0].ds)) : null,
      cadenceSec: cadenceSecFromDs(rows.map(r => Number(r.ds))),
      count: rows.length,
    })

    const latestSpo2Pct = lastArrayValue(spo2Rows, 'spo2_percent')
    // No firmware % on the Ring 5 — estimate from the newest R/PI sample.
    const latestDerivedSpo2 = latestSpo2Pct == null ? spo2PctFromR(lastArrayValue(spo2RPiRows, 'r') ?? NaN) : null

    return {
      totalEvents: totals?.total ?? 0,
      byEventName: byName.map(b => ({ tag: b.tag, eventName: b.eventName, count: b.count })),
      latestHrBpm: lastArrayValue(hrRows, 'hr_bpm'),
      latestTempC: lastArrayValue(tempRows, 'temps_c'),
      latestHrvRmssd: lastArrayValue(hrvRows, 'rmssd_ms'),
      latestSpo2: latestSpo2Pct != null
        ? { pct: latestSpo2Pct, calibrated: true }
        : latestDerivedSpo2 != null
          ? { pct: Math.round(latestDerivedSpo2), calibrated: false }
          : null,
      latestByTag: latestRows.map((r): OuraRawSampleLatest => ({
        tag: r.tag,
        eventName: r.eventName,
        measuredAt: r.measuredAt ? new Date(r.measuredAt).toISOString() : null,
        decoded: (r.decoded as Record<string, unknown> | null) ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null),
        bodyHex: r.bodyHex,
      })),
      newestRecordedAt: totals?.newest ? new Date(totals.newest).toISOString() : null,
      clockAnchorDs: anchorDs,
      clockAnchorUtc: anchorUtcMs != null ? new Date(anchorUtcMs).toISOString() : null,
      oldestMeasuredAt: measuredAt(span?.minDs != null ? Number(span.minDs) : null),
      newestMeasuredAt: measuredAt(anchorDs),
      hrTiming: timing(hrRows),
      tempTiming: timing(tempRows),
    }
  }

  async getOuraRawSamplesByTags(userId: string, tags: number[], limit: number): Promise<OuraRawSampleRow[]> {
    if (tags.length === 0) return []
    const [rows, anchors] = await Promise.all([
      readRecentRawFrames(this.db, userId, tags, Math.min(Math.max(limit, 1), 1000)),
      this.getOuraClockAnchors(userId),
    ])
    // `event_name` and `measured_at` are columns on a hot row and derivations for a packed one, so
    // both are derived here for every row rather than read where available — a field that comes
    // from two places drifts, and `event_name` already had to be repaired once by a full-table
    // refresh for exactly that reason.
    return rows.map((r): OuraRawSampleRow => {
      const ms = resolveDsToMs(r.ds, anchors)
      return {
        ringTimestampDs: Number(r.ds),
        tag: r.tag,
        eventName: eventName(r.tag),
        measuredAt: ms != null ? new Date(ms).toISOString() : null,
        decoded: r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null),
        bodyHex: r.bodyHex,
      }
    })
  }

  /**
   * Raw samples for a tag set, decoded.
   *
   * This used to filter on `decoded IS NOT NULL` and hand back the stored column. **That column has
   * never been written**: 0 of 812,816 production rows across all 30 tags carry a value, because
   * `body_hex` is the archival source of truth and every other consumer decodes it on the fly (see
   * `step-counter-pipeline.ts`). So the filter matched nothing and this function returned an empty
   * array for every caller, forever — which is why the daytime-HRV model never fitted and why
   * `/api/oura-ble/device-metrics` answered `{"days": []}` on a device that had been ingesting all
   * day.
   *
   * Decodes from `body_hex` now, preferring the stored column if it is ever populated.
   */
  async getOuraRawSamplesForTags(userId: string, tags: number[], days: number): Promise<OuraRawSampleRow[]> {
    if (tags.length === 0) return []
    const windowDays = Math.min(Math.max(Math.floor(days), 1), MAX_RAW_SAMPLE_WINDOW_DAYS)

    // Q-541 Task 7 / Q-534: the window is converted to a RING ds range and the read is ds-keyed,
    // rather than filtering on the stored `measured_at` column.
    //
    // Three things that buys, in order of how much they matter:
    //   1. It removes the last read of `idx_oura_raw_samples_user_measured` — 136 MB, and the reason
    //      a `measured_at` re-stamp rewrote 681,005 rows with zero HOT updates and filled the disk.
    //   2. It reads BOTH tiers. A packed frame has no `measured_at` column at all, so a filter on
    //      one would have silently returned only the hot window.
    //   3. `measured_at` is a stored derivation and goes stale whenever the clock model changes —
    //      which it did, twice (Q-71, Q-536). Deriving it per read cannot go stale.
    const anchors = await this.getOuraClockAnchors(userId)
    if (anchors.length === 0) return []
    const startDs = resolveMsToDs(Date.now() - windowDays * 86_400_000, anchors)
    if (startDs == null) return []

    const rows = await readRawFrames(this.db, userId, { tags, startDs: Math.floor(startDs) })
    return rows.map((r): OuraRawSampleRow => ({
      ringTimestampDs: Number(r.ds),
      tag: r.tag,
      eventName: eventName(r.tag),
      measuredAt: (() => {
        const ms = resolveDsToMs(r.ds, anchors)
        return ms != null ? new Date(ms).toISOString() : null
      })(),
      // Infallible by contract: decodeEventBody returns null on an unknown or malformed body rather
      // than throwing, and consumers already treat a null decode as "skip this row".
      decoded: r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null),
      bodyHex: r.bodyHex,
    }))
  }

  async deleteFeedback(id: string): Promise<void> {
    await this.db.delete(s.feedbackSubmissions).where(eq(s.feedbackSubmissions.id, id))
  }

  async countFeedback(): Promise<number> {
    const rows = await this.db.select({ id: s.feedbackSubmissions.id }).from(s.feedbackSubmissions)
    return rows.length
  }

  async listInjuries(userId: string): Promise<Injury[]> {
    const rows = await this.db.select().from(s.injuries)
      .where(and(eq(s.injuries.userId, userId), isNull(s.injuries.deletedAt)))
      .orderBy(asc(s.injuries.startedDate))
    return rows.map(r => this.rowToInjury(r))
  }

  async createInjury(userId: string, data: Omit<Injury, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Injury> {
    const { id, ...rest } = data
    const [r] = await this.db.insert(s.injuries).values({
      ...(id ? { id } : {}),
      userId,
      muscleName: rest.muscleName,
      notes: rest.notes ?? null,
      severity: rest.severity,
      startedDate: rest.startedDate,
      resolvedDate: rest.resolvedDate ?? null,
    }).onConflictDoUpdate({
      target: s.injuries.id,
      set: {
        muscleName:   rest.muscleName,
        notes:        rest.notes ?? null,
        severity:     rest.severity,
        startedDate:  rest.startedDate,
        resolvedDate: rest.resolvedDate ?? null,
        updatedAt:    new Date(),
      },
      setWhere: eq(s.injuries.userId, userId),
    }).returning()
    return this.rowToInjury(r)
  }

  async updateInjury(id: string, userId: string, data: Partial<Omit<Injury, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<Injury> {
    // Truly partial: only fields present in the patch are written — a
    // resolvedDate-only PATCH must not null-clobber notes (and updated_at must
    // bump, or getSyncDelta never carries the edit to other devices).
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (data.muscleName !== undefined) set.muscleName = data.muscleName
    if (data.notes !== undefined) set.notes = data.notes
    if (data.severity !== undefined) set.severity = data.severity
    if (data.startedDate !== undefined) set.startedDate = data.startedDate
    if (data.resolvedDate !== undefined) set.resolvedDate = data.resolvedDate
    const [r] = await this.db.update(s.injuries)
      .set(set)
      .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
      .returning()
    if (!r) throw new NotFoundError('Injury')
    return this.rowToInjury(r)
  }

  async deleteInjury(id: string, userId: string): Promise<void> {
    await this.db.update(s.injuries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.injuries.id, id), eq(s.injuries.userId, userId)))
  }

  async listSupplements(userId: string, date: string): Promise<SupplementWithStatus[]> {
    const rows = await this.db.select().from(s.supplements)
      .where(and(eq(s.supplements.userId, userId), isNull(s.supplements.deletedAt)))
      .orderBy(asc(s.supplements.sortOrder), asc(s.supplements.createdAt))
    const logs = await this.db.select({ supplementId: s.supplementLogs.supplementId })
      .from(s.supplementLogs)
      .where(and(
        eq(s.supplementLogs.userId, userId),
        eq(s.supplementLogs.logDate, date),
        isNull(s.supplementLogs.deletedAt),
      ))
    const loggedIds = new Set(logs.map(l => l.supplementId))
    return rows.map(r => ({ ...this.rowToSupplement(r), loggedToday: loggedIds.has(r.id) }))
  }

  async createSupplement(userId: string, data: Omit<Supplement, 'id' | 'userId' | 'createdAt'> & { id?: string }): Promise<Supplement> {
    const { id, ...rest } = data
    // Optional client id: an offline-created supplement keeps its local UUID so the
    // outbox replay is idempotent — a re-push updates in place instead of duplicating.
    const [r] = await this.db.insert(s.supplements)
      .values({ ...(id ? { id } : {}), userId, ...rest })
      .onConflictDoUpdate({
        target: s.supplements.id,
        set: { ...rest, updatedAt: new Date() },
        setWhere: eq(s.supplements.userId, userId),
      })
      .returning()
    return this.rowToSupplement(r)
  }

  async updateSupplement(id: string, userId: string, data: Partial<Omit<Supplement, 'id' | 'userId' | 'createdAt'>>): Promise<Supplement> {
    // Allowlisted column by column, not `.set(data)`: the `Omit<>` is compile-time only, so a raw
    // body reaching `.set()` can write `userId`/`deletedAt`/`createdAt` — safe until now only
    // because the single caller happens to use `.strict()`, i.e. safety living one route away
    // (Q-134). `updateInjury` is the reference shape.
    //
    // `updatedAt` is set explicitly rather than left to the `trg_set_updated_at` BEFORE UPDATE
    // trigger migration 078 installs on this table. The trigger already covers it — Q-124(c)'s
    // claim that a web edit never reached getSyncDelta was wrong, verified against a live PATCH —
    // but a sync-critical column should not depend on a trigger no code here references.
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (data.name !== undefined) set.name = data.name
    if (data.dose !== undefined) set.dose = data.dose
    if (data.reminderEnabled !== undefined) set.reminderEnabled = data.reminderEnabled
    if (data.reminderTime !== undefined) set.reminderTime = data.reminderTime
    if (data.sortOrder !== undefined) set.sortOrder = data.sortOrder
    if (data.active !== undefined) set.active = data.active
    const [r] = await this.db.update(s.supplements)
      .set(set)
      .where(and(eq(s.supplements.id, id), eq(s.supplements.userId, userId)))
      .returning()
    if (!r) throw new NotFoundError('Supplement')
    return this.rowToSupplement(r)
  }

  async deleteSupplement(id: string, userId: string): Promise<void> {
    // Sets both active=false (the pre-existing local-read hide signal — kept for
    // clients not yet reading deletedAt) and deletedAt (the real tombstone, so the
    // delete finally reaches getSyncDelta/other devices — a hard DELETE here never
    // did, since the row simply vanished before the next sync could see it).
    await this.db.update(s.supplements)
      .set({ active: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.supplements.id, id), eq(s.supplements.userId, userId)))
  }

  async logSupplement(supplementId: string, userId: string, date: string): Promise<void> {
    const [owns] = await this.db.select({ id: s.supplements.id }).from(s.supplements)
      .where(and(eq(s.supplements.id, supplementId), eq(s.supplements.userId, userId)))
      .limit(1)
    if (!owns) throw new NotFoundError('Supplement')
    // onConflictDoUpdate (not DoNothing): a prior unlog on this same date soft-deleted
    // the row via the (supplement_id, log_date) unique constraint — re-logging must
    // revive it (clear deleted_at), not silently no-op.
    await this.db.insert(s.supplementLogs)
      .values({ supplementId, userId, logDate: date })
      .onConflictDoUpdate({
        target: [s.supplementLogs.supplementId, s.supplementLogs.logDate],
        set: { deletedAt: null, updatedAt: new Date() },
        setWhere: eq(s.supplementLogs.userId, userId),
      })
  }

  async unlogSupplement(supplementId: string, userId: string, date: string): Promise<void> {
    await this.db.update(s.supplementLogs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(s.supplementLogs.supplementId, supplementId),
        eq(s.supplementLogs.userId, userId),
        eq(s.supplementLogs.logDate, date),
      ))
  }

  // ── AI Periodization (delegated to slices/periodization.ts) ─────────────────
  async getSessionPeriodization(userId: string, programSessionId: string) { return period.getSessionPeriodization(this.db, userId, programSessionId) }
  async ensureSessionPeriodization(userId: string, programSessionId: string) { return period.ensureSessionPeriodization(this.db, userId, programSessionId) }
  async setBaselineComplete(userId: string, programSessionId: string, baseline1rm: Record<string, Baseline1rmEntry>) { return period.setBaselineComplete(this.db, userId, programSessionId, baseline1rm) }
  async advancePhase(userId: string, programSessionId: string, newPhase: PeriodizationPhase) { return period.advancePhase(this.db, userId, programSessionId, newPhase) }
  async storePrescription(userId: string, programSessionId: string, prescription: AiPrescription, expiresAt: Date, status?: PrescriptionStatus) { return period.storePrescription(this.db, userId, programSessionId, prescription, expiresAt, status) }
  async clearProgramPrescriptions(userId: string, programId: string) { return period.clearProgramPrescriptions(this.db, userId, programId) }
  async updatePrescriptionStatus(userId: string, programSessionId: string, status: PrescriptionStatus) { return period.updatePrescriptionStatus(this.db, userId, programSessionId, status) }
  async updatePrescriptionExercisesCache(userId: string, programSessionId: string, prescription: AiPrescription) { return period.updatePrescriptionExercisesCache(this.db, userId, programSessionId, prescription) }
  async storePendingTransition(userId: string, programSessionId: string, transition: PendingTransition | null) { return period.storePendingTransition(this.db, userId, programSessionId, transition) }
  async incrementSessionsInPhase(userId: string, programSessionId: string) { return period.incrementSessionsInPhase(this.db, userId, programSessionId) }
  async setLastSessionRanPrescription(userId: string, programSessionId: string, ranPrescription: boolean) { return period.setLastSessionRanPrescription(this.db, userId, programSessionId, ranPrescription) }
  async listSessionPeriodizationForProgram(userId: string, programId: string) { return period.listSessionPeriodizationForProgram(this.db, userId, programId) }
  async reconcileSessionsInPhase(userId: string, programId: string) { return period.reconcileSessionsInPhase(this.db, userId, programId) }
  async reconcileUserStats(userId: string) { return userStatsSlice.reconcileUserStats(this.db, userId) }
  async listVolumeTargets(userId: string, programId: string) { return period.listVolumeTargets(this.db, userId, programId) }
  async replaceVolumeTargets(userId: string, programId: string, targets: { muscleGroup: string; targetSetsPerWeek: number }[]) { return period.replaceVolumeTargets(this.db, userId, programId, targets) }
  async getWorkoutSessionProgramSessionId(userId: string, workoutSessionId: string) { return period.getWorkoutSessionProgramSessionId(this.db, userId, workoutSessionId) }
  async getRecentSessionsOfType(userId: string, programSessionId: string, limit: number) { return period.getRecentSessionsOfType(this.db, userId, programSessionId, limit) }
  async getSetLogsForSessions(workoutSessionIds: string[]) { return period.getSetLogsForSessions(this.db, workoutSessionIds) }
  async getSetTimingRows(userId: string, exerciseNames: string[]) { return period.getSetTimingRows(this.db, userId, exerciseNames) }
  async getExercise1rmHistory(userId: string, exerciseNames: string[], tz: string) { return period.getExercise1rmHistory(this.db, userId, exerciseNames, tz) }
  async getWeeklySetsByMuscleGroup(userId: string, programId: string, weekStart: string, weekEnd: string, tz: string) { return period.getWeeklySetsByMuscleGroup(this.db, userId, programId, weekStart, weekEnd, tz) }

  // ── Oura Ring (delegated to slices/oura.ts) ───────────────────────────────
  async upsertOuraDaily(userId: string, rows: import('../repository').OuraDailyRow[], source: HealthSource) { return oura.upsertOuraDaily(this.db, userId, rows, source) }
  async getOuraDaily(userId: string, startDate: string, endDate: string) { return oura.getOuraDaily(this.db, userId, startDate, endDate) }
  async getDerivedScoresForDay(userId: string, day: string) { return oura.getDerivedScoresForDay(this.db, userId, day) }
  async getLatestOuraCloudVitals(userId: string) { return oura.getLatestOuraCloudVitals(this.db, userId) }
  async getLatestOuraBleMeasuredAt(userId: string) { return oura.getLatestOuraBleMeasuredAt(this.db, userId) }
  async hasOuraBleSamples(userId: string) { return oura.hasOuraBleSamples(this.db, userId) }
  async declareOuraRekey(userId: string, note: string | null) { return oura.declareOuraRekey(this.db, userId, note) }
  async getPendingRekeyDeclaration(userId: string) { return oura.getPendingRekeyDeclaration(this.db, userId) }
  async consumeRekeyDeclaration(id: number, epoch: number) { return oura.consumeRekeyDeclaration(this.db, id, epoch) }
  async cancelPendingRekeyDeclaration(userId: string) { return oura.cancelPendingRekeyDeclaration(this.db, userId) }
  async startRedecodeJob(userId: string, opts: Record<string, unknown>) { return oura.startRedecodeJob(this.db, userId, opts) }
  async getRedecodeJob(userId: string, id: number) { return oura.getRedecodeJob(this.db, userId, id) }
  async getLatestRedecodeJob(userId: string) { return oura.getLatestRedecodeJob(this.db, userId) }
  async finishRedecodeJob(id: number, result: Record<string, unknown> | null, error: string | null) { return oura.finishRedecodeJob(this.db, id, result, error) }
  async reapStaleRedecodeJobs(userId: string) { return oura.reapStaleRedecodeJobs(this.db, userId) }
  async listOuraTags(userId: string, startDay: string, endDay: string) { return oura.listOuraTags(this.db, userId, startDay, endDay) }
  async upsertBodyBatteryDaily(userId: string, row: import('../repository').BodyBatteryDailyRow) { return bodyBattery.upsertBodyBatteryDaily(this.db, userId, row) }
  async getBodyBatteryHistory(userId: string, startDate: string, endDate: string) { return bodyBattery.getBodyBatteryHistory(this.db, userId, startDate, endDate) }
  async upsertOuraSleep(userId: string, sessions: import('../repository').OuraSleepUpsertRow[], source: HealthSource) { return oura.upsertOuraSleep(this.db, userId, sessions, source) }
  async upsertOuraHeartrate(userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]) { return oura.upsertOuraHeartrate(this.db, userId, rows) }
  async getHrForWindow(userId: string, from: Date, to: Date) { return oura.getHrForWindow(this.db, userId, from, to) }
  async getZoneMinutesRange(userId: string, fromDay: string, toDay: string, tz: string, profile: { maxHr: number; restingHr: number }) { return oura.getZoneMinutesRange(this.db, userId, fromDay, toDay, tz, profile) }
  async insertRrIntervals(userId: string, rows: { at: Date; rrMs: number }[]) { return oura.insertRrIntervals(this.db, userId, rows) }
  async getRrForWindow(userId: string, from: Date, to: Date) { return oura.getRrForWindow(this.db, userId, from, to) }
  async getDaytimeHrvModel(userId: string) { return oura.getDaytimeHrvModel(this.db, userId) }
  async upsertDaytimeHrvModel(userId: string, model: { intercept: number; hrCoef: number; tempCoef: number; residualStd: number; nSamples: number }) { return oura.upsertDaytimeHrvModel(this.db, userId, model) }
  async upsertWorkoutHrStats(userId: string, sessionId: string, stats: import('../repository').WorkoutHrStatsInput) { return oura.upsertWorkoutHrStats(this.db, userId, sessionId, stats) }
  async getWorkoutHrStats(userId: string, sessionId: string) { return oura.getWorkoutHrStats(this.db, userId, sessionId) }
  async getAvgBpmBySession(userId: string, sessionIds: string[]) { return oura.getAvgBpmBySession(this.db, userId, sessionIds) }
  async listSessionsMissingHrStats(userId: string, since: Date, limit: number) { return oura.listSessionsMissingHrStats(this.db, userId, since, limit) }
  async getSetDetailsForSession(workoutSessionId: string) { return oura.getSetDetailsForSession(this.db, workoutSessionId) }
  async upsertSetHrStats(userId: string, workoutSessionId: string, rows: import('@trainingai/shared/workout/set-hr-stats').SetHrRow[]) { return oura.upsertSetHrStats(this.db, userId, workoutSessionId, rows) }
  async getSetHrStatsForSession(userId: string, workoutSessionId: string) { return oura.getSetHrStatsForSession(this.db, userId, workoutSessionId) }
  async getSetHrStatsForExercise(userId: string, opts: { exerciseId?: string | null; exerciseName?: string; since: Date }) { return oura.getSetHrStatsForExercise(this.db, userId, opts) }
  async getSetHrStatsSince(userId: string, since: Date, limit?: number) { return oura.getSetHrStatsSince(this.db, userId, since, limit) }
  async listSessionsMissingSetHrStats(userId: string, since: Date, limit: number) { return oura.listSessionsMissingSetHrStats(this.db, userId, since, limit) }
  async getOuraWorkouts(userId: string, opts: { unreviewed?: boolean; from?: string; to?: string; timezone?: string }) { return oura.getOuraWorkouts(this.db, userId, opts) }
  async markOuraWorkoutReviewed(userId: string, id: string) { return oura.markOuraWorkoutReviewed(this.db, userId, id) }
  async getSetTimestampsForSession(workoutSessionId: string) { return oura.getSetTimestampsForSession(this.db, workoutSessionId) }
  async markHrSynced(workoutSessionId: string) { return oura.markHrSynced(this.db, workoutSessionId) }
  async getUnsyncedHrSessionsForDay(userId: string, day: string, timezone = DEFAULT_TZ) { return oura.getUnsyncedHrSessionsForDay(this.db, userId, day, timezone) }
  async getUnsyncedHrSessions(userId: string, from: Date, to: Date) { return oura.getUnsyncedHrSessions(this.db, userId, from, to) }
  async getWorkoutSessionById(userId: string, id: string) { return oura.getWorkoutSessionById(this.db, userId, id) }
  async replaceOuraDailySummary(userId: string, rows: import('../repository').OuraDailySummaryRow[]) { return oura.replaceOuraDailySummary(this.db, userId, rows) }
  async upsertOuraDailySummary(userId: string, rows: import('../repository').OuraDailySummaryRow[]) { return oura.upsertOuraDailySummary(this.db, userId, rows) }
  async getOuraDailySummary(userId: string, from: string, to: string) { return oura.getOuraDailySummary(this.db, userId, from, to) }
  async upsertOuraDailyDerived(userId: string, day: string, patch: import('../repository').OuraDailyDerivedPatch) { return oura.upsertOuraDailyDerived(this.db, userId, day, patch) }
  async getOuraStorageStats() { return oura.getOuraStorageStats(this.db) }
  async nullHistoricalDecoded(userId: string, maxRows?: number) { return oura.nullHistoricalDecoded(this.db, userId, maxRows) }
  async vacuumOuraRawSamples() { return oura.vacuumOuraRawSamples() }
  async vacuumTableFull(table: import('./slices/oura').VacuumFullTable) { return oura.vacuumTableFull(table) }
  async packOuraRawBuckets(userId: string, maxBuckets?: number) { return packOuraRawBuckets(this.db, userId, maxBuckets) }
  async countPackableBuckets(userId: string) { return countPackableBuckets(this.db, userId) }
  async getOuraTimeseriesDelta(userId: string, opts: { heartrate?: oura.TimeseriesCursor | null; bucket?: oura.TimeseriesCursor | null; budget?: number }) { return oura.getOuraTimeseriesDelta(userId, opts) }
  async getOuraDailyDerived(userId: string, from: string, to: string) { return oura.getOuraDailyDerived(this.db, userId, from, to) }
  async persistBodyCompFromMetrics(userId: string) { return oura.persistBodyCompFromMetrics(this.db, userId) }
}
