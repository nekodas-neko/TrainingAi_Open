import { getLocalStore } from './index';
import { reconcileDeadLetters } from './dead-letter-signal';
import { resolveFailedOutboxIds, serverBackoffMs, buildWorkoutLogPayload } from './sync-helpers';
import type { SyncDelta } from '@/lib/data/repository';
import type {
  LocalBodyMetric, LocalMoodLog, LocalSleepSession,
  LocalWorkoutSession, LocalActivityLog, LocalFitnessTest, LocalPrescribedRun, LocalProgram, LocalProgressionStyle,
  LocalFoodLog, LocalFoodItem, LocalDayCheckin, LocalSupplement, LocalSupplementLog, LocalInjury,
  LocalMealPlan, LocalMealPlanVariant, LocalMealPlanMeal, LocalPlanMealAnswer,
  LocalExerciseLog, LocalSetLog, LocalPersonalRecord, LocalOuraDaily,
  LocalOuraDailySummary, LocalOuraDailyDerived,
  LocalProgramSession, LocalSessionExercise, LocalSchedule, LocalScheduleDay,
  LocalStyleSet,
} from './types';

const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Module-level cache of last sync time to avoid an async Dexie read on the
// hot path (connectivity restore, mount).
let lastSyncMs = 0;

// After a 5xx from /api/sync/push, hold the whole queue back briefly instead
// of re-hitting a struggling server on every sync trigger. Per-item failures
// are handled separately (recordMutationFailures); this is transport-level.
let push5xxUntil = 0;
let consecutive5xx = 0;

// Mirrors push5xxUntil for the pull side: a dead network otherwise gets retried
// on every mount trigger (every screen that calls pullDelta(force=true)) with no
// gate at all, since force bypasses MIN_SYNC_INTERVAL_MS.
let pullBackoffUntil = 0;
let consecutivePullFailures = 0;

// True while a prior failure's backoff window is still open. A pull-to-sync during that window
// returns null WITHOUT attempting anything — reporting that as "Sync failed" is wrong and trains
// the owner to distrust a message that is usually about a transient earlier problem.
export function isSyncBackedOff(): boolean {
  return Date.now() < pullBackoffUntil || Date.now() < push5xxUntil;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export type SyncedDomains = {
  biometrics:  boolean
  programs:    boolean
  workouts:    boolean
  nutrition:   boolean
  supplements: boolean
  activity:    boolean
  fitnessTests: boolean
  running:     boolean
  injuries:    boolean
  ouraDaily:   boolean
  // No cache-groups entry — the day-checkin UI reads the local store/API directly,
  // never through the sqlite-cache layer, so there's nothing to invalidate.
  dayCheckins: boolean
  mealPlans:   boolean
}

// `fullResync` re-pulls from epoch (since=0) instead of the incremental cursor. The delta
// cursor is monotonic, so once `lastSyncAt` passes a change it is never re-carried — which
// leaves the on-device program mirror holding stale session ids after an edit that a later
// incremental pull can't fix. A full re-pull rebuilds the mirror from server truth (id-based;
// applyDelta still gates on sync_status='synced', so pending local edits are preserved).
export async function pullDelta(userId: string, force = false, fullResync = false, restore = false): Promise<{ synced: number; domains: SyncedDomains; hasMore: boolean } | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  // A dead network otherwise gets one pull attempt per mount (every mount trigger
  // calls this with force=true, bypassing the interval throttle below).
  if (Date.now() < pullBackoffUntil) return null;

  // Throttle to once every 5 minutes (bypassed when force = true)
  if (!force && Date.now() - lastSyncMs < MIN_SYNC_INTERVAL_MS) return null;

  // Fall back to Dexie for the authoritative timestamp (survives page refresh)
  const lastSync = fullResync ? new Date(0) : await store.getLastSyncAt();

  async function pullPage(sinceIso: string): Promise<{
    count: number; domains: SyncedDomains; syncedAt: string; hasMore: boolean;
  } | null> {
  let raw: SyncDelta;
  try {
    const res = await fetch(`/api/sync/pull?since=${sinceIso}${restore ? '&mode=restore' : ''}`);
    if (!res.ok) return null;
    raw = (await res.json()) as SyncDelta;
  } catch {
    return null;
  }

  const bodyMetrics = (raw.bodyMetrics as Record<string, unknown>[]).map(r => ({
    date:             String(r.date),
    weightKg:         (r.weightKg as number) ?? null,
    bodyFatPct:       (r.bodyFatPct as number) ?? null,
    steps:            (r.steps as number) ?? null,
    calories:         (r.calories as number) ?? null,
    proteinG:         (r.proteinG as number) ?? null,
    carbsG:           (r.carbsG as number) ?? null,
    fatG:             (r.fatG as number) ?? null,
    waterMl:          (r.waterMl as number) ?? null,
    restingHeartRate: (r.restingHeartRate as number) ?? null,
    hrvMs:            (r.hrvMs as number) ?? null,
    spo2Pct:          (r.spo2Pct as number) ?? null,
    distanceKm:       (r.distanceKm as number) ?? null,
    waistCm:          (r.waistCm as number) ?? null,
    chestCm:          (r.chestCm as number) ?? null,
    armCm:            (r.armCm as number) ?? null,
    thighCm:          (r.thighCm as number) ?? null,
    hipCm:            (r.hipCm as number) ?? null,
    neckCm:           (r.neckCm as number) ?? null,
    skeletalMusclePct:  (r.skeletalMusclePct as number) ?? null,
    fatFreeMassKg:      (r.fatFreeMassKg as number) ?? null,
    subcutaneousFatPct: (r.subcutaneousFatPct as number) ?? null,
    visceralFatIndex:   (r.visceralFatIndex as number) ?? null,
    bodyWaterPct:       (r.bodyWaterPct as number) ?? null,
    muscleMassKg:       (r.muscleMassKg as number) ?? null,
    boneMassKg:         (r.boneMassKg as number) ?? null,
    proteinPct:         (r.proteinPct as number) ?? null,
    bmrKcal:            (r.bmrKcal as number) ?? null,
    metabolicAge:       (r.metabolicAge as number) ?? null,
    updatedAt:        toIso(r.updatedAt),
    deletedAt:        r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:       'synced' as const,
  } satisfies LocalBodyMetric));

  const moodLogs = (raw.moodLogs as Record<string, unknown>[]).map(r => ({
    logDate:      String(r.logDate),
    energyLevel:  String(r.energyLevel),
    sleepQuality: String(r.sleepQuality),
    bodyState:    (r.bodyState as string[]) ?? [],
    soreMuscles:  (r.soreMuscles as string[]) ?? [],
    updatedAt:    toIso(r.updatedAt),
    deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:   'synced' as const,
  } satisfies LocalMoodLog));

  const sleepSessions = (raw.sleepSessions as Record<string, unknown>[]).map(r => ({
    id:              String(r.id),
    date:            String(r.date),
    durationHours:   (r.durationHours as number) ?? null,
    deepSleepHours:  (r.deepSleepHours as number) ?? null,
    remSleepHours:   (r.remSleepHours as number) ?? null,
    lightSleepHours: (r.lightSleepHours as number) ?? null,
    // R6: carry the full Oura column set through pull/restore (HRV/RHR/stages), not just
    // stage hours. Server select() emits these camelCase keys; a pulled row is synced.
    ouraId:          (r.ouraId as string) ?? null,
    efficiency:      (r.efficiency as number) ?? null,
    onsetLatencySec: (r.onsetLatencySec as number) ?? null,
    averageHrvMs:    (r.averageHrvMs as number) ?? null,
    avgHeartRate:    (r.avgHeartRate as number) ?? null,
    lowestHeartRate: (r.lowestHeartRate as number) ?? null,
    restlessPeriods: (r.restlessPeriods as number) ?? null,
    sleepScore:      (r.sleepScore as number) ?? null,
    respiratoryRate: (r.respiratoryRate as number) ?? null,
    sleepPhase5Min:  (r.sleepPhase5Min as string) ?? null,
    timeInBedHours:  (r.timeInBedHours as number) ?? null,
    // Q-519 — carried through the pull so a device shows the bedtime the user recorded from
    // anywhere. It is a plain value here, not a merge input: nothing on the device derives a
    // window, duration or efficiency from it.
    manualSleepStart: r.manualSleepStart ? toIso(r.manualSleepStart) : null,
    syncStatus:      'synced' as const,
    updatedAt:       toIso(r.updatedAt),
  } satisfies LocalSleepSession));

  const workoutSessions = (raw.workoutSessions as Record<string, unknown>[]).map(r => ({
    id:          String(r.id),
    sessionName: String(r.sessionName ?? r.name ?? ''),
    startedAt:   toIso(r.startedAt),
    completedAt: r.completedAt ? toIso(r.completedAt) : null,
    sessionRpe:  (r.sessionRpe as number) ?? null,
    updatedAt:   toIso(r.updatedAt),
    deletedAt:   r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:  'synced' as const,
    // Q-131: present on both ends' schemas but dropped here, so a restored device replayed its
    // outbox with no program-session link and fell back to matching by name.
    sessionId:      r.sessionId ? String(r.sessionId) : null,
    intensityMode:  r.intensityMode ? String(r.intensityMode) : null,
    wasOverride:    Boolean(r.wasOverride),
  } satisfies LocalWorkoutSession));

  const exerciseLogs = ((raw.exerciseLogs ?? []) as Record<string, unknown>[]).map(r => ({
    id:                   String(r.id),
    workoutSessionId:     String(r.workoutSessionId),
    exerciseName:         String(r.exerciseName),
    styleId:              r.styleId ? String(r.styleId) : null,
    styleName:            r.styleName ? String(r.styleName) : null,
    estimated1rm:         (r.estimated1rm as number) ?? null,
    target80:             (r.target80 as number) ?? null,
    volume:               (r.volume as number) ?? null,
    avgReps:              (r.avgReps as number) ?? null,
    timeToComplete:       (r.timeToComplete as number) ?? null,
    muscleGroups:         (r.muscleGroups as string[]) ?? [],
    loggedAt:             toIso(r.loggedAt),
    interExerciseRestSec: (r.interExerciseRestSec as number) ?? null,
    updatedAt:            toIso(r.updatedAt),
    deletedAt:            r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:           'synced' as const,
    // Q-131: on both ends' schemas, dropped here — a replayed deloaded set otherwise comes back
    // as a full-intensity one.
    exerciseDeloaded:     Boolean(r.exerciseDeloaded),
  } satisfies LocalExerciseLog));

  const setLogs = ((raw.setLogs ?? []) as Record<string, unknown>[]).map(r => ({
    id:            String(r.id),
    exerciseLogId: String(r.exerciseLogId),
    setNumber:     Number(r.setNumber),
    weightKg:      Number(r.weightKg),
    reps:          Number(r.reps),
    setTimeSec:    (r.setTimeSec as number) ?? null,
    restTimeSec:   (r.restTimeSec as number) ?? null,
    intensityPct:  (r.intensityPct as number) ?? null,
    useFor1rm:     Boolean(r.useFor1rm),
    setStartMs:    (r.setStartMs as number) ?? null,
    setEndMs:      (r.setEndMs as number) ?? null,
    rpe:           (r.rpe as number) ?? null,
    plannedPct:    (r.plannedPct as number) ?? null,
    plannedReps:   (r.plannedReps as number) ?? null,
    plannedRestSec: (r.plannedRestSec as number) ?? null,
    updatedAt:     toIso(r.updatedAt),
    deletedAt:     r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:    'synced' as const,
  } satisfies LocalSetLog));

  const personalRecords = ((raw.personalRecords ?? []) as Record<string, unknown>[]).map(r => ({
    exerciseName: String(r.exerciseName),
    exerciseId:   r.exerciseId ? String(r.exerciseId) : null,
    estimated1rm: Number(r.estimated1rm),
    achievedAt:   r.achievedAt ? toIso(r.achievedAt) : null,
    updatedAt:    r.updatedAt ? toIso(r.updatedAt) : toIso(r.achievedAt),
    syncStatus:   'synced' as const,
  } satisfies LocalPersonalRecord));

  const ouraDaily = ((raw.ouraDaily ?? []) as Record<string, unknown>[]).map(r => ({
    day:                  String(r.day),
    readinessScore:       (r.readinessScore as number) ?? null,
    sleepScore:           (r.sleepScore as number) ?? null,
    activityScore:        (r.activityScore as number) ?? null,
    temperatureDeviation: (r.temperatureDeviation as number) ?? null,
    activeCalories:       (r.activeCalories as number) ?? null,
    contributors:         r.contributors
      ? (typeof r.contributors === 'string' ? JSON.parse(r.contributors) : r.contributors as Record<string, unknown>)
      : null,
    syncStatus:           'synced' as const,
    updatedAt:            toIso(r.updatedAt),
  } satisfies LocalOuraDaily));

  // Device-computed daily summary (all scalar) — restored locally so finished-form
  // physiology + EMA baselines survive a wipe. A pulled row is synced.
  const ouraDailySummary = ((raw.ouraDailySummary ?? []) as Record<string, unknown>[]).map(r => ({
    day:                  String(r.day),
    sleepDurationHours:   (r.sleepDurationHours as number) ?? null,
    sleepEfficiency:      (r.sleepEfficiency as number) ?? null,
    deepSleepHours:       (r.deepSleepHours as number) ?? null,
    remSleepHours:        (r.remSleepHours as number) ?? null,
    restlessPeriods:      (r.restlessPeriods as number) ?? null,
    sleepLatencySec:      (r.sleepLatencySec as number) ?? null,
    hrvAvgMs:             (r.hrvAvgMs as number) ?? null,
    rhrLowBpm:            (r.rhrLowBpm as number) ?? null,
    rhrAvgBpm:            (r.rhrAvgBpm as number) ?? null,
    recoveryIndexHours:   (r.recoveryIndexHours as number) ?? null,
    tempMeanC:            (r.tempMeanC as number) ?? null,
    tempDevC:             (r.tempDevC as number) ?? null,
    metAvg:               (r.metAvg as number) ?? null,
    breathAvgRpm:         (r.breathAvgRpm as number) ?? null,
    hrvBaselineMeanX8:    (r.hrvBaselineMeanX8 as number) ?? null,
    hrvBaselineDevX8:     (r.hrvBaselineDevX8 as number) ?? null,
    rhrBaselineMeanX8:    (r.rhrBaselineMeanX8 as number) ?? null,
    rhrBaselineDevX8:     (r.rhrBaselineDevX8 as number) ?? null,
    tempBaselineMeanX8:   (r.tempBaselineMeanX8 as number) ?? null,
    tempBaselineDevX8:    (r.tempBaselineDevX8 as number) ?? null,
    sleepBaselineMeanX8:  (r.sleepBaselineMeanX8 as number) ?? null,
    sleepBaselineDevX8:   (r.sleepBaselineDevX8 as number) ?? null,
    metBaselineMeanX8:    (r.metBaselineMeanX8 as number) ?? null,
    metBaselineDevX8:     (r.metBaselineDevX8 as number) ?? null,
    breathBaselineMeanX8: (r.breathBaselineMeanX8 as number) ?? null,
    breathBaselineDevX8:  (r.breathBaselineDevX8 as number) ?? null,
    nHistory:             (r.nHistory as number) ?? null,
    syncStatus:           'synced' as const,
    updatedAt:            toIso(r.updatedAt),
  } satisfies LocalOuraDailySummary));

  // Device-computed derived metrics. The 7 JSON columns arrive stringified on the wire —
  // parse back to objects here (applyDelta re-stringifies for the TEXT columns).
  const asJson = (v: unknown): Record<string, unknown> | null =>
    v == null ? null : (typeof v === 'string' ? JSON.parse(v) as Record<string, unknown> : v as Record<string, unknown>);
  const ouraDailyDerived = ((raw.ouraDailyDerived ?? []) as Record<string, unknown>[]).map(r => ({
    day:                            String(r.day),
    source:                         (r.source as string) ?? null,
    modelVersions:                  asJson(r.modelVersions),
    sleepScore:                     (r.sleepScore as number) ?? null,
    sleepContributors:              asJson(r.sleepContributors),
    readinessScore:                 (r.readinessScore as number) ?? null,
    readinessContributors:          asJson(r.readinessContributors),
    readinessSource:                (r.readinessSource as string) ?? null,
    activityScore:                  (r.activityScore as number) ?? null,
    activityContributors:           asJson(r.activityContributors),
    activeCaloriesEst:              (r.activeCaloriesEst as number) ?? null,
    trainingLoadOts:                (r.trainingLoadOts as number) ?? null,
    trainingLoadHigh:               (r.trainingLoadHigh as boolean) ?? null,
    recoveryIndexHours:             (r.recoveryIndexHours as number) ?? null,
    wornHoursBle:                   (r.wornHoursBle as number) ?? null,
    nightHrvBaselineMs:             (r.nightHrvBaselineMs as number) ?? null,
    illnessFlag:                    (r.illnessFlag as string) ?? null,
    illnessScore:                   (r.illnessScore as number) ?? null,
    illnessBiomarkers:              asJson(r.illnessBiomarkers),
    daytimeStressScaled:            (r.daytimeStressScaled as number) ?? null,
    stressHighMinutes:              (r.stressHighMinutes as number) ?? null,
    recoveryHighMinutes:            (r.recoveryHighMinutes as number) ?? null,
    chronicStressScore:             (r.chronicStressScore as number) ?? null,
    chronicStressContributors:      asJson(r.chronicStressContributors),
    resilienceLevel:                (r.resilienceLevel as number) ?? null,
    resilienceDailyStress:          (r.resilienceDailyStress as number) ?? null,
    resilienceDailyRestorativeTime: (r.resilienceDailyRestorativeTime as number) ?? null,
    resilienceDailySleepRecovery:   (r.resilienceDailySleepRecovery as number) ?? null,
    resilienceGranular:             (r.resilienceGranular as number) ?? null,
    resilienceConfidence:           (r.resilienceConfidence as number) ?? null,
    bdiDerived:                     (r.bdiDerived as number) ?? null,
    vascularAge:                    (r.vascularAge as number) ?? null,
    pwv:                            (r.pwv as number) ?? null,
    bodyComp:                       asJson(r.bodyComp),
    syncStatus:                     'synced' as const,
    updatedAt:                      toIso(r.updatedAt),
  } satisfies LocalOuraDailyDerived));

  const activityLogs = (raw.activityLogs as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    date:         String(r.date),
    activityType: String(r.activityType),
    title:        String(r.title),
    durationMin:  (r.durationMin as number) ?? null,
    distanceKm:   (r.distanceKm as number) ?? null,
    steps:        (r.steps as number) ?? null,
    avgHr:        (r.avgHr as number) ?? null,
    maxHr:        (r.maxHr as number) ?? null,
    caloriesBurned: (r.caloriesBurned as number) ?? null,
    startTime:      r.startTime != null ? String(r.startTime) : null,
    endTime:        r.endTime != null ? String(r.endTime) : null,
    notes:          r.notes != null ? String(r.notes) : null,
    routePolyline:  r.routePolyline != null ? String(r.routePolyline) : null,
    splits:         (r.splits as { km: number; paceSec: number }[] | null) ?? null,
    bestEfforts:    (r.bestEfforts as Record<string, number> | null) ?? null,
    paceSeries:     (r.paceSeries as { tSec: number; paceSec: number }[] | null) ?? null,
    avgPaceSecPerKm: (r.avgPaceSecPerKm as number) ?? null,
    elevationGainM:  (r.elevationGainM as number) ?? null,
    elevationLossM:  (r.elevationLossM as number) ?? null,
    elevationProfile: (r.elevationProfile as { distKm: number; eleM: number }[] | null) ?? null,
    cadenceSpm:      (r.cadenceSpm as number) ?? null,
    cadenceSeries:   (r.cadenceSeries as { tSec: number; spm: number }[] | null) ?? null,
    cadenceSource:   (r.cadenceSource as 'ring' | 'strap' | null) ?? null,
    segments:        (r.segments as LocalActivityLog['segments']) ?? null,
    updatedAt:    toIso(r.updatedAt),
    deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:   'synced' as const,
  } satisfies LocalActivityLog));

  const fitnessTests = ((raw.fitnessTests ?? []) as Record<string, unknown>[]).map(r => ({
    id:          String(r.id),
    testType:    String(r.testType),
    date:        String(r.date),
    durationSec: (r.durationSec as number) ?? null,
    distanceM:   (r.distanceM as number) ?? null,
    avgHr:       (r.avgHr as number) ?? null,
    maxHr:       (r.maxHr as number) ?? null,
    restingHr:   (r.restingHr as number) ?? null,
    hrr1Bpm:     (r.hrr1Bpm as number) ?? null,
    vo2maxEst:   (r.vo2maxEst as number) ?? null,
    method:      r.method != null ? String(r.method) : null,
    notes:       r.notes != null ? String(r.notes) : null,
    updatedAt:   toIso(r.updatedAt),
    deletedAt:   r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:  'synced' as const,
  } satisfies LocalFitnessTest));

  const prescribedRuns = ((raw.prescribedRuns ?? []) as Record<string, unknown>[]).map(r => ({
    id:            String(r.id),
    planId:        r.planId != null ? String(r.planId) : '',
    date:          String(r.date),
    runType:       String(r.runType),
    durationMin:   (r.durationMin as number) ?? null,
    distanceKm:    (r.distanceKm as number) ?? null,
    targetHrLow:   (r.targetHrLow as number) ?? null,
    targetHrHigh:  (r.targetHrHigh as number) ?? null,
    targetZoneIds: Array.isArray(r.targetZoneIds) ? (r.targetZoneIds as number[]) : [],
    rationale:     r.rationale != null ? String(r.rationale) : '',
    gateAction:    r.gateAction != null ? String(r.gateAction) : 'proceed',
    status:        (r.status as LocalPrescribedRun['status']) ?? 'pending',
    activityLogId: r.activityLogId != null ? String(r.activityLogId) : null,
    updatedAt:     toIso(r.updatedAt),
    deletedAt:     r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:    'synced' as const,
  } satisfies LocalPrescribedRun));

  const programs = (raw.programs as Record<string, unknown>[]).map(r => ({
    id:                     String(r.id),
    name:                   String(r.name),
    isActive:               Boolean(r.isActive),
    phaseMode:              String(r.phaseMode ?? 'manual'),
    trainingGoal:           String(r.trainingGoal ?? 'strength'),
    startedAt:              r.startedAt ? String(r.startedAt) : null,
    sessionsPerCycle:       (r.sessionsPerCycle as number) ?? null,
    totalWeeks:             (r.totalWeeks as number) ?? null,
    autoApplyPrescriptions: Boolean(r.autoApplyPrescriptions),
    createdAt:              r.createdAt ? toIso(r.createdAt) : null,
    updatedAt:              toIso(r.updatedAt),
  } satisfies LocalProgram));

  const programSessions = ((raw.programSessions ?? []) as Record<string, unknown>[]).map(r => ({
    id:                String(r.id),
    programId:         String(r.programId),
    name:              String(r.name),
    position:          Number(r.position),
    icon:              r.icon ? String(r.icon) : null,
    timeBudgetMinutes: Number(r.timeBudgetMinutes ?? 60),
  } satisfies LocalProgramSession));

  const sessionExercises = ((raw.sessionExercises ?? []) as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    sessionId:    String(r.sessionId),
    exerciseName: String(r.exerciseName),
    styleId:      r.styleId ? String(r.styleId) : null,
    muscleGroups: (r.muscleGroups as string[]) ?? [],
    position:     Number(r.position),
    exerciseRole: String(r.exerciseRole ?? 'primary'),
    supersetGroup: r.supersetGroup != null ? Number(r.supersetGroup) : null,
  } satisfies LocalSessionExercise));

  const schedules = ((raw.schedules ?? []) as Record<string, unknown>[]).map(r => ({
    id:              String(r.id),
    programId:       String(r.programId),
    type:            String(r.type),
    restAfterN:      (r.restAfterN as number) ?? null,
    reminderEnabled: Boolean(r.reminderEnabled),
    reminderTime:    r.reminderTime ? String(r.reminderTime) : null,
  } satisfies LocalSchedule));

  const scheduleDays = ((raw.scheduleDays ?? []) as Record<string, unknown>[]).map(r => ({
    scheduleId: String(r.scheduleId),
    dayOfWeek:  Number(r.dayOfWeek),
    sessionId:  r.sessionId ? String(r.sessionId) : null,
  } satisfies LocalScheduleDay));

  const progressionStyles = (raw.progressionStyles as Record<string, unknown>[]).map(r => ({
    id:        String(r.id),
    name:      String(r.name),
    updatedAt: toIso(r.updatedAt),
  } satisfies LocalProgressionStyle));

  const styleSets = ((raw.styleSets ?? []) as Record<string, unknown>[]).map(r => ({
    id:        String(r.id),
    styleId:   String(r.styleId),
    setNumber: Number(r.setNumber),
    pct:       Number(r.pct),
    reps:      Number(r.reps),
    restSec:   Number(r.restSec),
    useFor1rm: Boolean(r.useFor1rm),
  } satisfies LocalStyleSet));

  const foodItems = ((raw.foodItems ?? []) as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    name:         String(r.name),
    brand:        r.brand ? String(r.brand) : null,
    servingSizeG: Number(r.servingSizeG),
    calories:     Number(r.calories),
    proteinG:     Number(r.proteinG),
    carbsG:       Number(r.carbsG),
    fatG:         Number(r.fatG),
    fiberG:       (r.fiberG as number) ?? null,
    sugarG:       (r.sugarG as number) ?? null,
    sodiumMg:     (r.sodiumMg as number) ?? null,
    satFatG:      (r.satFatG as number) ?? null,
    source:       r.source ? String(r.source) : null,
    imageDataUri: r.imageDataUri ? String(r.imageDataUri) : null,
    updatedAt:    toIso(r.updatedAt),
  } satisfies LocalFoodItem));

  const foodLogs = ((raw.foodLogs ?? []) as Record<string, unknown>[]).map(r => ({
    id:                 String(r.id),
    date:               String(r.date),
    mealTypeId:         String(r.mealTypeId),
    foodItemId:         String(r.foodItemId),
    // BF-39. Mapped rather than dropped: the delta carries the grouping, and a device that lost it
    // here would re-render a logged meal as loose ingredients after every pull.
    savedMealId:        r.savedMealId ? String(r.savedMealId) : null,
    mealGroupId:        r.mealGroupId ? String(r.mealGroupId) : null,
    mealGroupName:      r.mealGroupName ? String(r.mealGroupName) : null,
    quantityMultiplier: Number(r.quantityMultiplier),
    loggedAt:           toIso(r.loggedAt),
    updatedAt:          toIso(r.updatedAt),
    deletedAt:          r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:         'synced' as const,
  } satisfies LocalFoodLog));

  const supplements = ((raw.supplements ?? []) as Record<string, unknown>[]).map(r => ({
    id:              String(r.id),
    name:            String(r.name),
    dose:            r.dose ? String(r.dose) : null,
    defaultAmount:   typeof r.defaultAmount === 'number' ? r.defaultAmount : null,
    unit:            r.unit ? String(r.unit) : null,
    startedOn:       r.startedOn ? String(r.startedOn) : null,
    stoppedOn:       r.stoppedOn ? String(r.stoppedOn) : null,
    dosePrompt:      Boolean(r.dosePrompt),
    reminderEnabled: Boolean(r.reminderEnabled),
    reminderTime:    r.reminderTime ? String(r.reminderTime) : null,
    sortOrder:       Number(r.sortOrder),
    active:          Boolean(r.active),
    updatedAt:       toIso(r.updatedAt),
    deletedAt:       r.deletedAt ? toIso(r.deletedAt) : null,
  } satisfies LocalSupplement));

  const supplementLogs = ((raw.supplementLogs ?? []) as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    supplementId: String(r.supplementId),
    logDate:      String(r.logDate),
    // BF-3 — the pull carries the stamped dose. Dropping it here is the "chain half-done" shape:
    // the columns exist server-side and locally, and a fresh device would still show every past log
    // at the definition's current dose, which is the bug the columns were added to stop.
    amount:       typeof r.amount === 'number' ? r.amount : null,
    unit:         r.unit ? String(r.unit) : null,
    doseText:     r.doseText ? String(r.doseText) : null,
    // BF-69 — which act of taking it this row is. Dropping it here would collapse every meal
    // contribution into the manual one on the same day, since that is the branch applyDelta takes
    // when `source` is absent.
    source:       r.source === 'meal' ? ('meal' as const) : ('manual' as const),
    sourceRef:    r.sourceRef ? String(r.sourceRef) : null,
    updatedAt:    toIso(r.updatedAt),
    deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:   'synced' as const,
  } satisfies LocalSupplementLog));

  const injuries = ((raw.injuries ?? []) as Record<string, unknown>[]).map(r => ({
    id:           String(r.id),
    muscleName:   String(r.muscleName),
    notes:        r.notes ? String(r.notes) : null,
    severity:     String(r.severity) as LocalInjury['severity'],
    startedDate:  String(r.startedDate),
    resolvedDate: r.resolvedDate ? String(r.resolvedDate) : null,
    createdAt:    toIso(r.createdAt),
    updatedAt:    toIso(r.updatedAt),
    deletedAt:    r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:   'synced' as const,
  } satisfies LocalInjury));

  const dayCheckins = ((raw.dayCheckins ?? []) as Record<string, unknown>[]).map(r => ({
    logDate:           String(r.logDate),
    phase:             String(r.phase ?? 'evening'),
    physicalTiredness: (r.physicalTiredness as number) ?? null,
    mentalDrain:       (r.mentalDrain as number) ?? null,
    barelyMoved:       (r.barelyMoved as number) ?? null,
    hydration:         (r.hydration as number) ?? null,
    lateHeavyMeal:     (r.lateHeavyMeal as number) ?? null,
    wakeMood:          (r.wakeMood as number) ?? null,
    perceivedRecovery: (r.perceivedRecovery as number) ?? null,
    motivation:        (r.motivation as number) ?? null,
    sleepQualityFeel:  (r.sleepQualityFeel as number) ?? null,
    restingSoreness:   (r.restingSoreness as number) ?? null,
    illnessContext:            (r.illnessContext as LocalDayCheckin['illnessContext']) ?? null,
    perceivedRecoveryTouched:  Boolean(r.perceivedRecoveryTouched),
    sleepQualityFeelTouched:   Boolean(r.sleepQualityFeelTouched),
    soreMuscles:       (r.soreMuscles as string[]) ?? [],
    journal:           r.journal ? String(r.journal) : null,
    updatedAt:         toIso(r.updatedAt),
    deletedAt:         r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:        'synced' as const,
  } satisfies LocalDayCheckin));

  // Meal Plan (Q-186). Variants and meals ride the same page as their plan, so they are mapped
  // together — a plan whose meals arrive on a later page would render as an empty plan.
  const mealPlans = ((raw.mealPlans ?? []) as Record<string, unknown>[]).map(r => ({
    id:              String(r.id),
    name:            String(r.name),
    isActive:        Boolean(r.isActive),
    mealsPerDay:     Number(r.mealsPerDay),
    targetCalories:  Number(r.targetCalories),
    targetProteinG:  Number(r.targetProteinG),
    targetCarbsG:    Number(r.targetCarbsG),
    targetFatG:      Number(r.targetFatG),
    trainingTime:    r.trainingTime ? String(r.trainingTime) : null,
    generatedAt:     toIso(r.generatedAt),
    lastReviewedAt:  r.lastReviewedAt ? toIso(r.lastReviewedAt) : null,
    updatedAt:       toIso(r.updatedAt),
    deletedAt:       r.deletedAt ? toIso(r.deletedAt) : null,
    syncStatus:      'synced' as const,
  } satisfies LocalMealPlan));

  const mealPlanVariants = ((raw.mealPlanVariants ?? []) as Record<string, unknown>[]).map(r => ({
    id:             String(r.id),
    mealPlanId:     String(r.mealPlanId),
    dayType:        String(r.dayType),
    targetCalories: Number(r.targetCalories),
    targetProteinG: Number(r.targetProteinG),
    targetCarbsG:   Number(r.targetCarbsG),
    targetFatG:     Number(r.targetFatG),
  } satisfies LocalMealPlanVariant));

  const mealPlanMeals = ((raw.mealPlanMeals ?? []) as Record<string, unknown>[]).map(r => ({
    id:             String(r.id),
    variantId:      String(r.variantId),
    position:       Number(r.position),
    name:           String(r.name),
    notes:          r.notes ? String(r.notes) : null,
    targetCalories: Number(r.targetCalories),
    targetProteinG: Number(r.targetProteinG),
    targetCarbsG:   Number(r.targetCarbsG),
    targetFatG:     Number(r.targetFatG),
    // Passed through unparsed: the backend stringifies for its TEXT column, and re-serialising
    // here would just be a second place for the two shapes to disagree.
    ingredients:    r.ingredients ?? [],
    suggestedTime:  r.suggestedTime ? String(r.suggestedTime) : null,
  } satisfies LocalMealPlanMeal));

  const planMealAnswers = ((raw.planMealAnswers ?? []) as Record<string, unknown>[]).map(r => ({
    id:          String(r.id),
    planMealId:  String(r.planMealId),
    logDate:     String(r.logDate),
    answer:      r.answer ? String(r.answer) : 'no',
    answeredAt:  r.answeredAt ? String(r.answeredAt) : null,
    updatedAt:   r.updatedAt ? String(r.updatedAt) : null,
    deletedAt:   r.deletedAt ? String(r.deletedAt) : null,
  } satisfies LocalPlanMealAnswer));

  const count = bodyMetrics.length + moodLogs.length + sleepSessions.length +
    workoutSessions.length + activityLogs.length + fitnessTests.length + prescribedRuns.length + programs.length + progressionStyles.length +
    programSessions.length + sessionExercises.length + schedules.length + scheduleDays.length +
    styleSets.length +
    foodItems.length + foodLogs.length + supplementLogs.length + injuries.length +
    exerciseLogs.length + setLogs.length + personalRecords.length + ouraDaily.length +
    ouraDailySummary.length + ouraDailyDerived.length +
    dayCheckins.length + mealPlans.length + planMealAnswers.length;

  try {
    await store!.applyDelta({ bodyMetrics, moodLogs, sleepSessions,
      workoutSessions, activityLogs, fitnessTests, prescribedRuns, programs, programSessions, sessionExercises,
      schedules, scheduleDays, progressionStyles, styleSets,
      foodItems, foodLogs, supplements, supplementLogs, injuries,
      exerciseLogs, setLogs, personalRecords, ouraDaily, ouraDailySummary, ouraDailyDerived, dayCheckins,
      mealPlans, mealPlanVariants, mealPlanMeals, planMealAnswers });
    await store!.setLastSyncAt(raw.syncedAt);
  } catch (err) {
    // A broken local schema throws here, not at the fetch — and this used to propagate straight
    // out of pullDelta into a bare .catch(() => null), so the owner saw "Sync failed" with no
    // clue that the fault was on the device (2026-08-02). Report it as a failed page: the caller
    // already backs off correctly, and the cause is now in the device log.
    console.error('[pullDelta] applyDelta failed — local store may be out of schema:', err);
    return null;
  }

  return {
    count,
    domains: {
      biometrics:  bodyMetrics.length > 0 || moodLogs.length > 0 || sleepSessions.length > 0,
      programs:    programs.length > 0 || progressionStyles.length > 0 ||
                   programSessions.length > 0 || sessionExercises.length > 0 ||
                   schedules.length > 0 || scheduleDays.length > 0 || styleSets.length > 0,
      workouts:    workoutSessions.length > 0 || exerciseLogs.length > 0 || personalRecords.length > 0,
      nutrition:   foodItems.length > 0 || foodLogs.length > 0,
      supplements: supplements.length > 0 || supplementLogs.length > 0,
      activity:    activityLogs.length > 0,
      fitnessTests: fitnessTests.length > 0,
      running:     prescribedRuns.length > 0,
      injuries:    injuries.length > 0,
      ouraDaily:   ouraDaily.length > 0,
      dayCheckins: dayCheckins.length > 0,
      // Rides the mealPlans flag rather than getting its own: the answers only mean anything
      // beside the plan they answer, and every consumer that reacts to one needs the other.
      mealPlans:   mealPlans.length > 0 || planMealAnswers.length > 0,
    },
    // Old servers omit hasMore entirely, which reads as false — one page, done:
    // fully backwards compatible.
    syncedAt: raw.syncedAt,
    hasMore: Boolean((raw as { hasMore?: boolean }).hasMore),
  };
  }

  let sinceIso = lastSync.toISOString();
  let total = 0;
  // Surfaced on the outer return so a restore driver (restoreFromCloud) can keep pulling
  // past the 20-page-per-call cap until the server reports the delta is fully drained.
  let hasMore = false;
  const domains: SyncedDomains = {
    biometrics: false, programs: false, workouts: false, nutrition: false,
    supplements: false, activity: false, fitnessTests: false, running: false, injuries: false, ouraDaily: false, dayCheckins: false,
    mealPlans: false,
  };
  for (let pageN = 0; pageN < 20; pageN++) {
    const pageResult = await pullPage(sinceIso);
    if (!pageResult) {
      // Only a first-page failure is a "dead network" signal worth backing off —
      // a later-page failure mid-pagination keeps its partial progress (already
      // persisted via setLastSyncAt inside pullPage) and retries promptly next time.
      if (pageN === 0) {
        consecutivePullFailures += 1;
        pullBackoffUntil = Date.now() + serverBackoffMs(consecutivePullFailures);
        return null;
      }
      // Partial progress persisted; more likely remains — let a restore loop resume
      // from the persisted cursor rather than treating this as fully drained.
      return { synced: total, domains, hasMore: true };
    }
    total += pageResult.count;
    domains.biometrics  ||= pageResult.domains.biometrics;
    domains.programs    ||= pageResult.domains.programs;
    domains.workouts    ||= pageResult.domains.workouts;
    domains.nutrition   ||= pageResult.domains.nutrition;
    domains.supplements ||= pageResult.domains.supplements;
    domains.activity    ||= pageResult.domains.activity;
    domains.fitnessTests ||= pageResult.domains.fitnessTests;
    domains.running     ||= pageResult.domains.running;
    domains.injuries    ||= pageResult.domains.injuries;
    domains.ouraDaily   ||= pageResult.domains.ouraDaily;
    domains.dayCheckins ||= pageResult.domains.dayCheckins;
    sinceIso = pageResult.syncedAt;
    hasMore = pageResult.hasMore;
    if (!pageResult.hasMore) break;
  }
  consecutivePullFailures = 0;
  pullBackoffUntil = 0;
  lastSyncMs = Date.now();
  // hasMore stays true if we hit the 20-page cap with the server still reporting more.
  return { synced: total, domains, hasMore };
}

/**
 * Full-history restore driver. Seeds the sync cursor to epoch ONCE, then drains the
 * `?mode=restore` pull (server unclamps the 90-day floor → full history) page-by-page,
 * across pullDelta's 20-page-per-call cap, until the server reports nothing more.
 *
 * Resumable: each page persists the advancing cursor (setLastSyncAt inside pullPage), and
 * the loop uses fullResync=false so it reads that persisted cursor rather than re-seeding
 * epoch every call (the review's fullResync-vs-resumable fix). An interrupted restore
 * continues from where it stopped. Device-only (getLocalStore is null on web).
 *
 * NOTE: this drains the shared day-grained delta (sleep/oura_daily/body_metrics/…). The
 * high-volume Track-B time-series (intraday HR, coarse buckets) are NOT restored here and have no
 * driver. `/api/sync/oura-timeseries` was deleted 2026-08-10 (Q-136) — it had sat unreachable since
 * it was written, because this driver never was. `repo.getOuraTimeseriesDelta` is still there and
 * still tested, so whoever writes the driver has the DB half waiting; see Q-180.
 */
export async function restoreFromCloud(
  userId: string,
  onProgress?: (syncedSoFar: number) => void,
): Promise<{ synced: number; failed: boolean } | null> {
  const store = getLocalStore(userId);
  if (!store) return null;
  // A deliberate user action — clear any pull backoff so a recent transient failure
  // doesn't silently no-op the restore.
  _resetSyncBackoff();
  // Seed epoch once (covers the "restore on an already-synced device" case); the loop
  // then advances the persisted cursor and never re-seeds epoch.
  await store.setLastSyncAt(new Date(0).toISOString());
  let total = 0;
  // Safety bound far above any real day-grained history (1000 × 20 pages × 500 rows).
  for (let guard = 0; guard < 1000; guard++) {
    const res = await pullDelta(userId, /*force*/ true, /*fullResync*/ false, /*restore*/ true);
    // A dead pull attempt (network/auth/rate-limit) must not be reported as a completed
    // restore of zero records — the cursor is already persisted up to the last successful
    // page, so this is resumable, but the caller needs to know to retry, not treat it as done.
    if (!res) return { synced: total, failed: true };
    total += res.synced;
    onProgress?.(total);
    if (!res.hasMore) break;
  }
  return { synced: total, failed: false };
}

/**
 * The dose a `supplement_logs` mutation was actually taken at (BF-3).
 *
 * A mutation queued offline can drain days later. `logSupplement` falls back to the definition's
 * CURRENT dose when the payload carries none — right for the web route, where the log and the stamp
 * are the same instant, and wrong here: after a titration it would write the new dose onto an old
 * act, which is the exact rewrite these columns exist to stop.
 *
 * The local row already holds what was stamped at log time (`upsertSupplementLog` fills it from the
 * local definition), so reading it back is what closes that window — and it closes it for the
 * INSTALLED client, which sends no dose and does not need to change.
 *
 * Anything else is passed through untouched. A read that fails falls back to the original payload:
 * a mutation pushed without its dose is worse than one not pushed at all only if it is also wrong,
 * and the server's fallback is the definition, which is what today already does.
 */
async function enrichPayload(
  store: Awaited<ReturnType<typeof getLocalStore>>,
  m: { domain: string; date: string; payload: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  if (m.domain !== 'supplement_logs' || m.payload.deleted) return m.payload;
  if (typeof m.payload.supplementId !== 'string') return m.payload;
  try {
    const rows = await store!.getSupplementLogs(String(m.payload.logDate ?? m.date));
    // BF-69 — the manual contribution specifically. A day can hold a meal's dose too, and a bare
    // `find` on supplementId would enrich the tick's mutation with the meal's amount.
    const row = rows.find(r => r.supplementId === m.payload.supplementId && (r.source ?? 'manual') === 'manual');
    if (!row) return m.payload;
    return {
      ...m.payload,
      amount: row.amount ?? null,
      unit: row.unit ?? null,
      doseText: row.doseText ?? null,
    };
  } catch {
    return m.payload;
  }
}

export async function pushMutations(userId: string): Promise<{ pushed: number } | null> {
  const store = getLocalStore(userId);
  if (!store) return null;

  // K3: seed the dead-letter badge + fire a one-time toast for any workout that
  // dead-lettered. Runs before the backoff gate so the badge reflects reality even
  // when the push itself is held back.
  reconcileDeadLetters(userId).catch(() => {});

  if (Date.now() < push5xxUntil) return null;

  // Re-queue workouts stranded by a double failure (POST threw AND queueMutation
  // threw): pending locally, absent from the outbox. Grace period avoids racing
  // a direct POST that is still in flight.
  try {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const stranded = await store.getStrandedPendingWorkouts(cutoff);
    for (const h of stranded) {
      for (const el of h.exerciseLogs) {
        const { date, payload } = buildWorkoutLogPayload(h.session, el);
        await store.queueMutation({ userId, domain: 'workout_log', date, payload });
      }
    }
  } catch { /* sweep is best-effort; the normal queue still drains */ }

  // Heal food logs stranded by the D-1 envelope drop: their food_item never
  // reached the server, so re-queue the item (ordered ahead) and re-open the log.
  // One-shot per row — a healed log leaves the 'failed' set, so this can't loop.
  try {
    await store.requeueStrandedFoodItems(userId);
  } catch { /* best-effort; the normal queue still drains */ }

  const pending = await store.getPendingMutations(userId);
  if (pending.length === 0) return { pushed: 0 };

  // Push in small chunks. A `workout_log` mutation costs ~8 queries + 2
  // transactions server-side; flushing a large backlog in one request can
  // saturate the DB connection pool. Bounding each request keeps load flat.
  const PUSH_CHUNK_SIZE = 5;
  const confirmed: typeof pending = [];
  let anyRequestOk = false;

  for (let i = 0; i < pending.length; i += PUSH_CHUNK_SIZE) {
    const chunk = pending.slice(i, i + PUSH_CHUNK_SIZE);
    let res: Response;
    try {
      res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mutations: await Promise.all(
            chunk.map(async m => ({ id: m.id, domain: m.domain, date: m.date, payload: await enrichPayload(store, m) })),
          ),
        }),
      });
    } catch {
      break;          // network gone — stop; remaining mutations retry next sync
    }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) {
        consecutive5xx += 1;
        push5xxUntil = Date.now() + serverBackoffMs(consecutive5xx);
        break; // server overloaded/rate-limited — stop hammering, retry later
      }
      // A non-429 4xx means the server rejected the whole chunk before it could
      // return per-mutation results (envelope-level validation failure) — never
      // a signal about mutations queued behind it. Quarantine this chunk via the
      // normal attempts/dead-letter path and keep draining the rest of the
      // backlog, instead of blocking every sibling mutation forever.
      await store.recordMutationFailures(
        chunk.map(m => ({ id: m.id, error: `push rejected: HTTP ${res.status}` })),
      ).catch(() => {});
      continue;
    }
    anyRequestOk = true;

    const result = await res.json() as {
      processed: number;
      errors: Array<{ id?: string; domain: string; date: string; error?: string; retryable?: boolean }>;
    };
    // Confirm by outbox id. Failed rows stay queued; resolveFailedOutboxIds
    // degrades to domain:date matching against pre-id servers.
    const failed = resolveFailedOutboxIds(chunk, result.errors);
    confirmed.push(...chunk.filter(m => !failed.has(m.id)));

    // Q-475: a database that cannot write reaches us as HTTP 200 with per-item errors, because
    // pushMutations catches per mutation — which is what makes the poison-pill rule work, and is
    // also why a dead database used to be indistinguishable from a validation rejection here. The
    // server now says which it is; these must NOT be counted against MAX_MUTATION_ATTEMPTS, for
    // the same reason the transport failures below are not. Without this, ~42.5 minutes of outage
    // (30 s → 2 m → 8 m → 32 m, then dead-letter) strands every queued mutation behind a
    // per-item-only retry UI.
    const rejected = [...failed.entries()].filter(([, f]) => !f.retryable);
    const serverUnavailable = failed.size > rejected.length;

    if (rejected.length) {
      // Per-item server rejections: bump attempts / schedule backoff / dead-letter
      // at MAX_MUTATION_ATTEMPTS. Transport failures (catch/!res.ok above) are
      // deliberately NOT counted — they say nothing about the mutation itself.
      await store.recordMutationFailures(
        rejected.map(([id, f]) => ({ id, error: f.error })),
      ).catch(() => {});
    }

    if (serverUnavailable) {
      // Same treatment as a 5xx: the rows stay queued, untouched, and the whole queue backs off
      // rather than pushing at full cadence into a server that cannot write. Breaking also stops
      // the remaining chunks, which would fail identically.
      consecutive5xx += 1;
      push5xxUntil = Date.now() + serverBackoffMs(consecutive5xx);
      break;
    }

    // Cleared only once this chunk is known NOT to be a server-unavailable one — a 200 carrying
    // nothing but "the database is down" must escalate the backoff like a 5xx, not reset it to
    // 30 s on every attempt.
    consecutive5xx = 0;
    push5xxUntil = 0;
  }

  // K3: refresh the badge/toast now that this push may have dead-lettered rows.
  reconcileDeadLetters(userId).catch(() => {});

  if (confirmed.length === 0) return anyRequestOk ? { pushed: 0 } : null;

  await store.deleteMutations(confirmed.map(m => m.id));

  // Mark confirmed local records as synced
  for (const m of confirmed) {
    if (m.domain === 'body_metrics') {
      const recs = await store.getBodyMetrics(m.date);
      const rec = recs.find(r => r.date === m.date);
      if (rec) await store.upsertBodyMetric({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'mood_logs') {
      const recs = await store.getMoodLogs(m.date);
      const rec = recs.find(r => r.logDate === m.date);
      if (rec) await store.upsertMoodLog({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'food_logs') {
      const recs = await store.getFoodLogs(m.date);
      const rec = recs.find(r => r.id === m.payload.id);
      if (rec) await store.upsertFoodLog({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'supplement_logs') {
      const recs = await store.getSupplementLogs(m.date);
      const rec = recs.find(r => r.supplementId === (m.payload.supplementId as string) && (r.source ?? 'manual') === 'manual');
      if (rec) await store.upsertSupplementLog({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'supplements') {
      // Flip the local row back to synced so the next pull is allowed to update it again —
      // without this arm the row stays 'pending' forever and the new clobber guard would make
      // it permanently unreachable by sync (Q-124).
      if (typeof m.payload.id === 'string') await store.markSupplementSynced(m.payload.id);
    } else if (m.domain === 'injuries') {
      const recs = await store.getInjuries();
      const rec = recs.find(r => r.id === m.payload.id);
      if (rec) await store.upsertInjury({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'saved_meals') {
      // Flip the local row to synced; a synced tombstone (offline delete) then gets
      // pruned by the next hydrateSavedMeals pass against the server list.
      if (typeof m.payload.id === 'string') await store.markSavedMealSynced(m.payload.id);
    } else if (m.domain === 'day_checkins') {
      const rec = await store.getDayCheckin(m.date, String(m.payload.phase ?? 'evening'));
      if (rec) await store.upsertDayCheckin({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'activity_logs') {
      // A delete cannot confirm through the upsert round-trip below (Q-328): `getActivityLogs`
      // filters `deleted_at IS NULL`, so the row is never found, and `upsertActivityLog` omits
      // `deleted_at` from its columns anyway. Flipping it to synced is also what makes the
      // tombstone prunable by the next pull, which checks `sync_status='synced'`.
      if (m.payload.deleted) {
        const id = m.payload.id as string | undefined;
        if (id) await store.markActivityLogSynced(id);
      } else {
        const recs = await store.getActivityLogs(m.date);
        const rec = recs.find(r => r.id === (m.payload.id as string));
        if (rec) await store.upsertActivityLog({ ...rec, syncStatus: 'synced' });
      }
    } else if (m.domain === 'fitness_tests') {
      const recs = await store.getFitnessTests(m.date);
      const rec = recs.find(r => r.id === (m.payload.id as string));
      if (rec) await store.upsertFitnessTest({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'prescribed_run') {
      const recs = await store.getPrescribedRuns(m.date);
      const rec = recs.find(r => r.id === (m.payload.id as string));
      if (rec) await store.upsertPrescribedRun({ ...rec, syncStatus: 'synced' });
    } else if (m.domain === 'workout_log') {
      // Mark just this exercise's log/set rows (and the session) as synced —
      // never every exercise under the session (see markWorkoutSynced).
      const wsId = m.payload.workoutSessionId as string | undefined;
      const exerciseLogId = m.payload.exerciseLogId as string | undefined;
      if (wsId && exerciseLogId) await store.markWorkoutSynced(wsId, exerciseLogId);
    } else if (m.domain === 'session_rpe' || m.domain === 'complete_workout') {
      const wsId = m.payload.workoutSessionId as string | undefined;
      if (wsId) await store.markSessionSynced(wsId);
    } else if (m.domain === 'sleep_session') {
      // Local row id (its own PK, distinct from the server-side oura_id dedup key) —
      // same convention as workout_log/activity_logs above.
      const id = m.payload.id as string | undefined;
      if (id) await store.markSleepSessionSynced(id);
    } else if (m.domain === 'oura_daily_summary') {
      await store.markOuraDailySummarySynced(m.date);
    } else if (m.domain === 'oura_daily_derived') {
      await store.markOuraDailyDerivedSynced(m.date);
    }
  }

  return { pushed: confirmed.length };
}

// ── Test hooks ────────────────────────────────────────────────────────────
export function _resetSyncBackoff(): void {
  push5xxUntil = 0;
  consecutive5xx = 0;
  pullBackoffUntil = 0;
  consecutivePullFailures = 0;
}
