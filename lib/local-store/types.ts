import type { SyncedMutationDomain } from '@trainingai/shared/sync/mutation-schema';

export interface LocalBodyMetric {
  date:             string;       // primary key — YYYY-MM-DD
  weightKg:         number | null;
  bodyFatPct:       number | null;
  steps:            number | null;
  calories:         number | null;
  proteinG:         number | null;
  carbsG:           number | null;
  fatG:             number | null;
  waterMl:          number | null;
  restingHeartRate: number | null;
  hrvMs:            number | null;
  spo2Pct:          number | null;
  distanceKm:       number | null;
  waistCm:          number | null;
  chestCm:          number | null;
  armCm:            number | null;
  thighCm:          number | null;
  hipCm:            number | null;
  neckCm:           number | null;
  // Direct-BLE scale composition (migration 155)
  skeletalMusclePct:  number | null;
  fatFreeMassKg:      number | null;
  subcutaneousFatPct: number | null;
  visceralFatIndex:   number | null;
  bodyWaterPct:       number | null;
  muscleMassKg:       number | null;
  boneMassKg:         number | null;
  proteinPct:         number | null;
  bmrKcal:            number | null;
  metabolicAge:       number | null;
  updatedAt:        string;       // ISO
  deletedAt:        string | null;
  syncStatus:       'pending' | 'synced';
}

export interface LocalMoodLog {
  logDate:      string;           // primary key — YYYY-MM-DD
  energyLevel:  string;
  sleepQuality: string;
  bodyState:    string[];
  soreMuscles:  string[];
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

export interface LocalSleepSession {
  id:              string;
  date:            string;
  durationHours:   number | null;
  deepSleepHours:  number | null;
  remSleepHours:   number | null;
  lightSleepHours: number | null;
  // Oura columns (v18, added via RECONCILE) — carried through pull/restore so a
  // wiped device gets HRV/stages back, not sleep stripped to stage hours (review R6).
  ouraId:          string | null;
  efficiency:      number | null;
  onsetLatencySec: number | null;
  averageHrvMs:    number | null;
  avgHeartRate:    number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  sleepScore:      number | null;
  respiratoryRate: number | null;
  sleepPhase5Min:  string | null;
  timeInBedHours:  number | null;
  /** Q-519 — the bedtime the user remembers for a night the ring did not observe. Read only by the
   *  bedtime estimate; never by anything deriving a window, duration or efficiency. */
  manualSleepStart: string | null;
  syncStatus:      'pending' | 'synced';
  updatedAt:       string;
}

export interface LocalWorkoutSession {
  id:          string;
  sessionName: string;
  startedAt:   string;
  completedAt: string | null;
  sessionRpe:  number | null;
  updatedAt:   string;
  deletedAt:   string | null;
  syncStatus:  'pending' | 'synced';
  sessionId?:      string | null;
  intensityMode?:  string | null;
  wasOverride?:    boolean;
}

export interface LocalExerciseLog {
  id:                   string;
  workoutSessionId:     string;
  exerciseName:         string;
  styleId:              string | null;
  styleName:            string | null;
  estimated1rm:         number | null;
  target80:             number | null;
  volume:               number | null;
  avgReps:              number | null;
  timeToComplete:       number | null;
  muscleGroups:         string[];   // stored as JSON text in SQLite
  loggedAt:             string;     // ISO
  interExerciseRestSec: number | null;
  updatedAt:            string;
  deletedAt:            string | null;
  syncStatus:           'pending' | 'synced';
  exerciseDeloaded?:    boolean;
}

export interface LocalSetLog {
  id:           string;
  exerciseLogId: string;
  setNumber:    number;
  weightKg:     number;
  reps:         number;
  setTimeSec:   number | null;
  restTimeSec:  number | null;
  intensityPct: number | null;
  useFor1rm:    boolean;
  setStartMs:   number | null;
  setEndMs:     number | null;
  rpe:          number | null;
  plannedPct:    number | null;
  plannedReps:   number | null;
  plannedRestSec: number | null;
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

export interface LocalPersonalRecord {
  exerciseName: string;  // primary key
  exerciseId:   string | null;
  estimated1rm: number;
  achievedAt:   string | null;
  updatedAt:    string;
  syncStatus:   'pending' | 'synced';
}

export interface LocalOuraDaily {
  day:                 string;  // primary key YYYY-MM-DD
  readinessScore:      number | null;
  sleepScore:          number | null;
  activityScore:       number | null;
  temperatureDeviation: number | null;
  activeCalories:      number | null;
  contributors:        Record<string, unknown> | null;  // parsed from TEXT JSON
  syncStatus:          'pending' | 'synced';
  updatedAt:           string;
}

// Device-computed daily summary (raw physiology + folded EMA baseline state). Restored
// locally so the finished-form history survives a wipe. All scalar (no JSON columns).
export interface LocalOuraDailySummary {
  day:                  string;  // primary key YYYY-MM-DD
  sleepDurationHours:   number | null;
  sleepEfficiency:      number | null;
  deepSleepHours:       number | null;
  remSleepHours:        number | null;
  restlessPeriods:      number | null;
  sleepLatencySec:      number | null;
  hrvAvgMs:             number | null;
  rhrLowBpm:            number | null;
  rhrAvgBpm:            number | null;
  recoveryIndexHours:   number | null;
  tempMeanC:            number | null;
  tempDevC:             number | null;
  metAvg:               number | null;
  breathAvgRpm:         number | null;
  hrvBaselineMeanX8:    number | null;
  hrvBaselineDevX8:     number | null;
  rhrBaselineMeanX8:    number | null;
  rhrBaselineDevX8:     number | null;
  tempBaselineMeanX8:   number | null;
  tempBaselineDevX8:    number | null;
  sleepBaselineMeanX8:  number | null;
  sleepBaselineDevX8:   number | null;
  metBaselineMeanX8:    number | null;
  metBaselineDevX8:     number | null;
  breathBaselineMeanX8: number | null;
  breathBaselineDevX8:  number | null;
  nHistory:             number | null;
  syncStatus:           'pending' | 'synced';
  updatedAt:            string;
}

// Device-computed derived metrics (readiness/illness/resilience/body-comp). Restored
// locally so the finished-form history survives a wipe. Seven columns hold TEXT JSON.
export interface LocalOuraDailyDerived {
  day:                            string;  // primary key YYYY-MM-DD
  source:                         string | null;
  modelVersions:                  Record<string, unknown> | null;  // parsed from TEXT JSON
  sleepScore:                     number | null;
  sleepContributors:              Record<string, unknown> | null;  // parsed from TEXT JSON
  readinessScore:                 number | null;
  readinessContributors:          Record<string, unknown> | null;  // parsed from TEXT JSON
  readinessSource:                string | null;
  activityScore:                  number | null;
  activityContributors:           Record<string, unknown> | null;  // parsed from TEXT JSON
  activeCaloriesEst:              number | null;
  trainingLoadOts:                number | null;
  trainingLoadHigh:               boolean | null;                  // stored as INTEGER 0/1
  recoveryIndexHours:             number | null;
  wornHoursBle:                   number | null;
  nightHrvBaselineMs:             number | null;
  illnessFlag:                    string | null;
  illnessScore:                   number | null;
  illnessBiomarkers:              Record<string, unknown> | null;  // parsed from TEXT JSON
  daytimeStressScaled:            number | null;
  stressHighMinutes:              number | null;
  recoveryHighMinutes:            number | null;
  chronicStressScore:             number | null;
  chronicStressContributors:      Record<string, unknown> | null;  // parsed from TEXT JSON
  resilienceLevel:                number | null;
  resilienceDailyStress:          number | null;
  resilienceDailyRestorativeTime: number | null;
  resilienceDailySleepRecovery:   number | null;
  resilienceGranular:             number | null;                   // REAL, not JSON
  resilienceConfidence:           number | null;
  bdiDerived:                     number | null;
  vascularAge:                    number | null;
  pwv:                            number | null;
  bodyComp:                       Record<string, unknown> | null;  // parsed from TEXT JSON
  syncStatus:                     'pending' | 'synced';
  updatedAt:                      string;
}

// Tiered RRD trend-ladder bucket (coarse tiers, forever-retained — mirror of server
// oura_bucket, migration 137). Keyed (tier, bucketStartMs). Device-computed; the
// on-device rollup (D2) is the only writer once it exists.
export interface LocalOuraBucket {
  tier:          string;
  bucketStartMs: number;
  bucketStartDs: number;
  localDate:     string;   // YYYY-MM-DD
  hrMean:        number | null;
  hrMin:         number | null;
  hrMax:         number | null;
  hrvRmssdMs:    number | null;
  spo2Pct:       number | null;
  perfusionIndex: number | null;
  skinTempC:     number | null;
  metMean:       number | null;
  metMinutes:    number | null;
  motionMad:     number | null;
  ibiMs:         string | null;
  sampleCount:   number | null;
  syncStatus:    'pending' | 'synced';
  updatedAt:     string;
}

// Intraday HR point (mirror of server oura_heartrate, migration 090). One row per
// timepoint — 5-min binned outside workouts, 15-sec inside them.
export interface LocalOuraHeartratePoint {
  tsMs:       number;   // epoch ms, primary key
  bpm:        number;
  source:     string;
  syncStatus: 'pending' | 'synced';
  updatedAt:  string;
}

export interface LocalActivityLog {
  id:             string;
  date:           string;
  activityType:   string;
  title:          string;
  durationMin:    number | null;
  distanceKm:     number | null;
  steps:          number | null;
  avgHr:          number | null;
  maxHr:          number | null;
  caloriesBurned: number | null;
  startTime:      string | null;
  endTime:        string | null;
  notes:          string | null;
  routePolyline:  string | null;
  splits:         { km: number; paceSec: number }[] | null;
  bestEfforts:    Record<string, number> | null;
  paceSeries:     { tSec: number; paceSec: number }[] | null;
  avgPaceSecPerKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  elevationProfile: { distKm: number; eleM: number }[] | null;
  cadenceSpm: number | null;
  cadenceSeries: { tSec: number; spm: number }[] | null;
  cadenceSource: 'ring' | 'strap' | null;
  segments: {
    index: number; setNumber: number; kind: 'warmup' | 'fast' | 'slow' | 'cooldown'
    startSec: number; endSec: number
    avgHr: number | null; maxHr: number | null; hrAtStart: number | null
    avgPaceSecPerKm: number | null; distanceKm: number | null; avgCadenceSpm: number | null
  }[] | null;
  updatedAt:      string;
  deletedAt:      string | null;
  syncStatus:     'pending' | 'synced';
}

export interface LocalFitnessTest {
  id:          string;
  testType:    string;       // FitnessTestId
  date:        string;       // YYYY-MM-DD (user-local)
  durationSec: number | null;
  distanceM:   number | null;
  avgHr:       number | null;
  maxHr:       number | null;
  restingHr:   number | null;
  hrr1Bpm:     number | null;
  vo2maxEst:   number | null;
  method:      string | null;
  notes:       string | null;
  updatedAt:   string;
  deletedAt:   string | null;
  syncStatus:  'pending' | 'synced';
}

export interface LocalPrescribedRun {
  id:            string;
  planId:        string;
  date:          string;       // YYYY-MM-DD (user-local)
  runType:       string;
  durationMin:   number | null;
  distanceKm:    number | null;
  targetHrLow:   number | null;
  targetHrHigh:  number | null;
  targetZoneIds: number[];
  rationale:     string;
  gateAction:    string;
  status:        'pending' | 'completed' | 'skipped';
  activityLogId: string | null;
  updatedAt:     string;
  deletedAt:     string | null;
  syncStatus:    'pending' | 'synced';
}

export interface LocalProgram {
  id:                     string;
  name:                   string;
  isActive:               boolean;
  phaseMode:              string;
  trainingGoal:           string;
  startedAt:              string | null;
  sessionsPerCycle:       number | null;
  totalWeeks:             number | null;
  autoApplyPrescriptions: boolean;
  createdAt:              string | null;
  updatedAt:              string;
}

export interface LocalProgramSession {
  id:                string;
  programId:         string;
  name:              string;
  position:          number;
  icon:              string | null;
  timeBudgetMinutes: number;
}

export interface LocalSessionExercise {
  id:           string;
  sessionId:    string;
  exerciseName: string;
  styleId:      string | null;
  muscleGroups: string[];
  position:     number;
  exerciseRole: string;
  supersetGroup: number | null;
}

export interface LocalSchedule {
  id:              string;
  programId:       string;
  type:            string;
  restAfterN:      number | null;
  reminderEnabled: boolean;
  reminderTime:    string | null;
}

export interface LocalScheduleDay {
  scheduleId: string;
  dayOfWeek:  number;
  sessionId:  string | null;
}

export interface LocalProgressionStyle {
  id:        string;
  name:      string;
  updatedAt: string;
}

export interface LocalStyleSet {
  id:        string;
  styleId:   string;
  setNumber: number;
  pct:       number;
  reps:      number;
  restSec:   number;
  useFor1rm: boolean;
}

export interface LocalFoodLog {
  id:                 string;
  date:               string;
  mealTypeId:         string;
  foodItemId:         string;
  /** BF-39. The saved meal this row came from, when it came from one — WHAT was eaten. */
  savedMealId?:       string | null;
  /** BF-39. One id per logging occasion. Two servings of one meal on a day share `savedMealId`
   *  and differ here, which is why the diary groups on this. */
  mealGroupId?:       string | null;
  quantityMultiplier: number;
  loggedAt:           string;
  updatedAt:          string;
  deletedAt:          string | null;
  syncStatus:         'pending' | 'synced';
}
/** The exercise catalogue mirrored on-device. Rendering-only: enough to decide whether a
 *  row draws a working weight or a rep target, and to name its muscles, without the server. */
export interface LocalExerciseLibraryEntry {
  /** Lower-cased name — the identity the server's own `libByName` lookup uses. */
  nameKey:      string;
  id:           string | null;
  name:         string;
  exerciseType: 'weighted' | 'bodyweight';
  muscles:      { muscle: string; role: string }[];
  equipment:    string | null;
  updatedAt:    string;
}

/** Read-only mirror of the server's meal_types, so an offline food log has a name/emoji/time
 *  window to group under. Editing stays online-only — this table is only ever fully replaced. */
export interface LocalMealType {
  id:               string;
  name:             string;
  emoji:            string;
  sortOrder:        number;
  timeStartHour:    number;
  timeEndHour:      number;
  remindersEnabled: boolean;
  required:         boolean;
}

export interface LocalFoodItem {
  id:           string;
  name:         string;
  brand:        string | null;
  servingSizeG: number;
  calories:     number;
  proteinG:     number;
  carbsG:       number;
  fatG:         number;
  fiberG:       number | null;
  sugarG:       number | null;
  sodiumMg:     number | null;
  satFatG:      number | null;
  source:       string | null;
  /** BF-35. The capped thumbnail, mirrored so a food row draws its picture with no network. */
  imageDataUri: string | null;
  updatedAt:    string;
}

// Meal Plan (Q-186). Names and macros live on the row so the Nutrition section renders offline —
// a local table of ids alone cannot draw anything.
export interface LocalMealPlan {
  id: string;
  name: string;
  isActive: boolean;
  mealsPerDay: number;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  trainingTime: string | null;
  generatedAt: string;
  lastReviewedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: 'pending' | 'synced';
}

export interface LocalMealPlanVariant {
  id: string;
  mealPlanId: string;
  dayType: string;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
}

export interface LocalMealPlanMeal {
  id: string;
  variantId: string;
  position: number;
  name: string;
  notes: string | null;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  /** JSON string or array — the pull sends JSONB, the local column is TEXT (Q-192). */
  ingredients: unknown;
  suggestedTime: string | null;
}

/**
 * A planned meal the user said they did NOT eat, on a given day (Q-187 phase 2).
 *
 * Only declines exist. "I ate it" is the food log itself, and a second row asserting the same fact
 * is how counters in this project drift. `deletedAt` carries an undo across devices — a hard delete
 * would be invisible to one that has not synced, and "no" is one mis-tap from losing a meal.
 */
export interface LocalPlanMealAnswer {
  id: string;
  planMealId: string;
  logDate: string;
  answer: string;
  answeredAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface LocalSavedMeal {
  id:         string;
  name:       string;
  /** Portions the recipe makes. Optional so a caller written before v25 still compiles; 1 on read. */
  servings?:  number;
  /** Base64 thumbnail data URI, capped — see `@trainingai/shared/nutrition/meal-image` (Q-396). */
  imageDataUri?: string | null;
  createdAt:  string;
  updatedAt:  string;
  deletedAt:  string | null;
  syncStatus: 'pending' | 'synced';
}

export interface LocalSavedMealItem {
  id:                 string;
  savedMealId:        string;
  foodItemId:         string;
  quantityMultiplier: number;
}

export interface LocalDayCheckin {
  logDate:           string;
  phase:             string;
  physicalTiredness: number | null;
  mentalDrain:       number | null;
  barelyMoved:       number | null;
  hydration:         number | null;
  lateHeavyMeal:     number | null;
  wakeMood:          number | null;
  perceivedRecovery: number | null;
  motivation:        number | null;
  sleepQualityFeel:  number | null;
  restingSoreness:   number | null;
  illnessContext:            import('@trainingai/shared/types/day-checkin').IllnessContext | null;
  perceivedRecoveryTouched:  boolean;
  sleepQualityFeelTouched:   boolean;
  soreMuscles:       string[];
  journal:           string | null;
  /** Q-387 — ISO timestamp of "I have finished logging today"; null or absent means not marked.
   *  Both read as EXCLUDED by the maintenance calibration, never as assumed-complete.
   *  **Optional on purpose**: rows written by the check-in sheets predate this field and say
   *  nothing about food logging, so requiring it would force every unrelated caller to state a
   *  value it has no opinion on. */
  foodLoggingCompletedAt?: string | null;
  updatedAt:         string;
  deletedAt:         string | null;
  syncStatus:        'pending' | 'synced';
}

export interface LocalSupplement {
  id:              string;
  name:            string;
  dose:            string | null;
  reminderEnabled: boolean;
  reminderTime:    string | null;
  sortOrder:       number;
  active:          boolean;
  updatedAt:       string;
  // Server tombstone, carried by the pull so a delete on another device propagates. Optional
  // because every local writer constructs this type without one (Q-124).
  deletedAt?:      string | null;
}

export interface LocalSupplementLog {
  id:           string;
  supplementId: string;
  logDate:      string;
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

export interface LocalInjury {
  id:           string;
  muscleName:   string;
  notes:        string | null;
  severity:     'mild' | 'moderate' | 'severe';
  startedDate:  string;
  resolvedDate: string | null;
  createdAt:    string;
  updatedAt:    string;
  deletedAt:    string | null;
  syncStatus:   'pending' | 'synced';
}

// Lean outbox entry — payload contains ONLY user-provided fields,
// never syncStatus / updatedAt / deletedAt.
export interface PendingMutation {
  id:          string;    // client UUID for this outbox record
  userId:      string;    // owner — ensures mutations aren't pushed under wrong session
  domain:      SyncedMutationDomain;
  date:        string;    // entity date key (YYYY-MM-DD)
  payload:     Record<string, unknown>;
  createdAt:   string;
  attempts:    number;
  lastError:   string | null;
  status:      'pending' | 'failed';
  nextRetryAt: string | null;
}

export interface SyncMeta {
  key:   string;
  value: string;
}
