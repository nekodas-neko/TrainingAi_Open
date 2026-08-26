import {
  pgTable, text, boolean, timestamp, uuid,
  integer, doublePrecision, date, time, primaryKey, unique, jsonb, bigint, bigserial, smallint,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/** `bytea` — drizzle-orm/pg-core has no built-in for it. The driver hands back a Node `Buffer`,
 *  which is a `Uint8Array`, so the codec in `lib/oura-ble/frame-pack.ts` consumes it directly. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
})

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  oauthSub:     text('oauth_sub').unique(),
  email:        text('email').notNull().unique(),
  name:         text('name'),
  isActive:     boolean('is_active').notNull().default(false),
  isAdmin:      boolean('is_admin').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  displayName:  text('display_name'),
  heightCm:     integer('height_cm'),
  dateOfBirth:  date('date_of_birth', { mode: 'string' }),
  weightGoalKg: doublePrecision('weight_goal_kg'),
  avatar:       text('avatar'),
  passwordHash: text('password_hash'),
  timezone:     text('timezone').notNull().default('Australia/Brisbane'),
  /** Server-authoritative user preferences, seeded into localStorage for first paint (Q-392).
   *  Shape and merge rule: `packages/shared/src/user/preferences.ts`. */
  preferences:  jsonb('preferences').$type<import('@trainingai/shared/user/preferences').UserPreferences>().notNull().default({}),
  /** SUPERSEDED by `preferences.foodRegion` (Q-392). Never read or written by any code — it was
   *  dead when the preferences work found it. Dropping it is a data-losing migration and belongs to
   *  a schema sweep, not here. */
  foodRegion:   text('food_region').notNull().default('AU'),
  sex:          text('sex'),
  stepsGoal:        integer('steps_goal'),
  stepsGoalType:    text('steps_goal_type'),
  sleepGoalHours:   doublePrecision('sleep_goal_hours'),
  calorieGoal:      integer('calorie_goal'),
  calorieGoalType:  text('calorie_goal_type'),
  waterGoalMl:      integer('water_goal_ml'),
  waterGoalType:    text('water_goal_type'),
  targetWeightKg:   doublePrecision('target_weight_kg'),
  targetBfPct:      doublePrecision('target_bf_pct'),
  friendCode:       text('friend_code').unique(),
  equippedTitle:    text('equipped_title'),
  activityLevel:    text('activity_level'),
  fitnessGoal:      text('fitness_goal'),
  lastGoalReviewAt: timestamp('last_goal_review_at', { withTimezone: true }),
  timingBaselineDate: date('timing_baseline_date', { mode: 'string' }),
})

export const invitedEmails = pgTable('invited_emails', {
  email:     text('email').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const progressionStyles = pgTable('progression_styles', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.name)])

export const styleSets = pgTable('style_sets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  styleId:   uuid('style_id').notNull().references(() => progressionStyles.id, { onDelete: 'cascade' }),
  setNumber: integer('set_number').notNull(),
  pct:       doublePrecision('pct').notNull(),
  reps:      integer('reps').notNull(),
  restSec:   integer('rest_sec').notNull().default(90),
  useFor1rm: boolean('use_for_1rm').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.styleId, t.setNumber)])

export const programs = pgTable('programs', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  userId:                   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:                     text('name').notNull(),
  isActive:                 boolean('is_active').notNull().default(false),
  createdAt:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  phaseMode:                text('phase_mode').notNull().default('manual'),
  startedAt:                date('started_at', { mode: 'string' }),
  cycleAnchorAt:            timestamp('cycle_anchor_at', { withTimezone: true }),
  sessionsPerCycle:         integer('sessions_per_cycle'),
  earlyDeloadWeekStart:     date('early_deload_week_start', { mode: 'string' }),
  phaseSetId:               uuid('phase_set_id'),  // FK to phase_sets added after that table is defined
  totalWeeks:               integer('total_weeks'),
  trainingGoal:             text('training_goal').notNull().default('strength'),
  // 'strength' | 'hypertrophy' | 'power' | 'endurance'
  autoApplyPrescriptions:   boolean('auto_apply_prescriptions').notNull().default(false),
}, t => [unique().on(t.userId, t.name)])

export const phaseSets = pgTable('phase_sets', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  isDefault:        boolean('is_default').notNull().default(false),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ownerProgramId:   uuid('owner_program_id').references(() => programs.id, { onDelete: 'set null' }),
  templateBaseName: text('template_base_name'),
}, t => [unique().on(t.userId, t.name)])

export const programSessions = pgTable('program_sessions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  programId:         uuid('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  name:              text('name').notNull(),
  position:          integer('position').notNull(),
  icon:              text('icon'),
  timeBudgetMinutes: integer('time_budget_minutes').notNull().default(60),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.programId, t.position)])

export const programPhases = pgTable('program_phases', {
  id:               uuid('id').primaryKey().defaultRandom(),
  programId:        uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
  phaseSetId:       uuid('phase_set_id').references(() => phaseSets.id, { onDelete: 'cascade' }),
  position:         integer('position').notNull(),
  name:             text('name').notNull(),
  durationCycles:   integer('duration_cycles').notNull(),
  phaseType:        text('phase_type').notNull().default('normal'),
  primaryStyleId:   uuid('primary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  secondaryStyleId: uuid('secondary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
}, t => [unique().on(t.phaseSetId, t.position)])

export const sessionExercises = pgTable('session_exercises', {
  id:           uuid('id').primaryKey().defaultRandom(),
  sessionId:    uuid('session_id').notNull().references(() => programSessions.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(),
  exerciseId:   uuid('exercise_id').references(() => exerciseLibrary.id, { onDelete: 'set null' }),
  styleId:      uuid('style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  muscleGroups: text('muscle_groups').array().notNull().default([]),
  position:     integer('position').notNull(),
  exerciseRole: text('exercise_role').notNull().default('primary'),
  supersetGroup: smallint('superset_group'),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.sessionId, t.position)])

export const schedules = pgTable('schedules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  programId:       uuid('program_id').notNull().unique().references(() => programs.id, { onDelete: 'cascade' }),
  type:            text('type').notNull(),  // 'rotation' | 'weekly'
  restAfterN:      integer('rest_after_n'),
  reminderEnabled: boolean('reminder_enabled').notNull().default(false),
  reminderTime:    text('reminder_time'),  // "HH:MM" or null
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const scheduleDays = pgTable('schedule_days', {
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  dayOfWeek:  integer('day_of_week').notNull(),
  sessionId:  uuid('session_id').references(() => programSessions.id, { onDelete: 'set null' }),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.scheduleId, t.dayOfWeek] })])

// TWO foreign keys to `program_sessions`, and until 2026-08-23 the dead one owned the name the live
// one was used under (Q-474). `session_id` is the live link — every read and the only write use it.
// `program_session_id` (079_ai_dynamic_periodization.sql, "for prescription trigger linkage") has
// never been written or read by any code, and 0 of the owner's 91 rows have it set.
//
// The Drizzle property names now match what the columns hold, which is the whole fix: reaching for
// `workoutSessions.programSessionId` gets the column that actually stores a program-session id.
// Dropping the dead column is a data-losing migration and needs owner confirmation, so it is named
// `unusedProgramSessionId` instead — a name nobody reaches for by accident.
//
// It has already cost a session: a repro fixture populated `program_session_id`, the periodization
// block took its `null` branch, and the honest reading of that run was "the race does not exist".
export const workoutSessions = pgTable('workout_sessions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The live link to `program_sessions`. Column name is historical; the property says what it holds. */
  programSessionId:  uuid('session_id').references(() => programSessions.id, { onDelete: 'set null' }),
  sessionName:       text('session_name').notNull(),
  startedAt:         timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt:       timestamp('completed_at', { withTimezone: true }),
  hrSyncedAt:        timestamp('hr_synced_at', { withTimezone: true }),
  warmupEndedAt:     timestamp('warmup_ended_at', { withTimezone: true }),
  phaseId:           uuid('phase_id').references(() => programPhases.id, { onDelete: 'set null' }),
  phaseType:         text('phase_type'),
  isEarlyDeload:     boolean('is_early_deload').notNull().default(false),
  wasOverride:       boolean('was_override').notNull().default(false),
  intensityMode:     text('intensity_mode'),
  /** DEAD — never written, never read. See the block comment above; do not start using it. */
  unusedProgramSessionId: uuid('program_session_id').references(() => programSessions.id, { onDelete: 'set null' }),
  sessionRpe:        integer('session_rpe'),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
})

export const exerciseLogs = pgTable('exercise_logs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  workoutSessionId: uuid('workout_session_id').notNull().references(() => workoutSessions.id, { onDelete: 'cascade' }),
  exerciseName:     text('exercise_name').notNull(),
  exerciseId:       uuid('exercise_id').references(() => exerciseLibrary.id, { onDelete: 'set null' }),
  styleId:          uuid('style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  styleName:        text('style_name'),
  estimated1rm:     doublePrecision('estimated_1rm'),
  target80:         doublePrecision('target_80'),
  volume:           doublePrecision('volume'),
  avgReps:          doublePrecision('avg_reps'),
  timeToComplete:       integer('time_to_complete'),
  muscleGroups:         text('muscle_groups').array().notNull().default([]),
  loggedAt:             timestamp('logged_at', { withTimezone: true }).notNull(),
  interExerciseRestSec: integer('inter_exercise_rest_sec'),
  prepTimeSec:          integer('prep_time_sec'),
  exerciseDeloaded:     boolean('exercise_deloaded').notNull().default(false),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:            timestamp('deleted_at', { withTimezone: true }),
})

export const setLogs = pgTable('set_logs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  exerciseLogId: uuid('exercise_log_id').notNull().references(() => exerciseLogs.id, { onDelete: 'cascade' }),
  setNumber:     integer('set_number').notNull(),
  weightKg:      doublePrecision('weight_kg').notNull(),
  reps:          integer('reps').notNull(),
  setTimeSec:    integer('set_time_sec'),
  restTimeSec:   integer('rest_time_sec'),
  intensityPct:  doublePrecision('intensity_pct'),
  useFor1rm:     boolean('use_for_1rm').notNull().default(false),
  setStartMs:    bigint('set_start_ms', { mode: 'number' }),
  setEndMs:      bigint('set_end_ms', { mode: 'number' }),
  rpe:           integer('rpe'),
  // Q-14: `planned_pct` is NULL for bodyweight movements — they carry no %1RM, so the style's
  // percentage becomes a rep target instead (resolveBodyweightStyle). `planned_reps` holds that
  // target, and is written for every exercise type.
  plannedPct:     doublePrecision('planned_pct'),
  plannedReps:    integer('planned_reps'),
  plannedRestSec: integer('planned_rest_sec'),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.exerciseLogId, t.setNumber)])

// Q-481: the mutation ids the outbox has already applied, for the push branches that are not
// idempotent under replay. Only `body_metrics`' waterMlDelta writes here — see migration 199 for
// why the other eighteen branches do not need it.
export const appliedMutations = pgTable('applied_mutations', {
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mutationId: text('mutation_id').notNull(),
  appliedAt:  timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.mutationId] })])

export const bodyMetrics = pgTable('body_metrics', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:        date('date', { mode: 'string' }).notNull(),
  weightKg:    doublePrecision('weight_kg'),
  bodyFatPct:  doublePrecision('body_fat_pct'),
  calories:    integer('calories'),
  proteinG:    doublePrecision('protein_g'),
  carbsG:      doublePrecision('carbs_g'),
  fatG:        doublePrecision('fat_g'),
  steps:             integer('steps'),
  distanceKm:        doublePrecision('distance_km'),
  restingHeartRate:  integer('resting_heart_rate'),
  hrvMs:             doublePrecision('hrv_ms'),
  spo2Pct:           doublePrecision('spo2_pct'),
  waterMl:           integer('water_ml'),
  activeCalories:    integer('active_calories'),   // kcal burned from activity (Oura)
  waistCm:           doublePrecision('waist_cm'),
  chestCm:           doublePrecision('chest_cm'),
  armCm:             doublePrecision('arm_cm'),
  thighCm:           doublePrecision('thigh_cm'),
  hipCm:             doublePrecision('hip_cm'),
  neckCm:            doublePrecision('neck_cm'),
  // Direct-BLE scale composition (migration 155) — bioimpedance-derived, our own formula
  // (not Renpho's proprietary one, see lib/scale-ble/composition.ts).
  skeletalMusclePct:   doublePrecision('skeletal_muscle_pct'),
  fatFreeMassKg:       doublePrecision('fat_free_mass_kg'),
  subcutaneousFatPct:  doublePrecision('subcutaneous_fat_pct'),
  visceralFatIndex:    doublePrecision('visceral_fat_index'),
  bodyWaterPct:        doublePrecision('body_water_pct'),
  muscleMassKg:        doublePrecision('muscle_mass_kg'),
  boneMassKg:          doublePrecision('bone_mass_kg'),
  proteinPct:          doublePrecision('protein_pct'),
  bmrKcal:             integer('bmr_kcal'),
  metabolicAge:        integer('metabolic_age'),
  sourceMap:         jsonb('source_map').$type<Record<string, string>>(),   // per-field provenance
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.date)])

export const exerciseLibrary = pgTable('exercise_library', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull().unique(),
  muscles:      jsonb('muscles').notNull().default([]),
  equipment:    text('equipment').array().notNull().default([]),
  instructions: text('instructions'),
  createdBy:    uuid('created_by').references(() => users.id),
  exerciseType: text('exercise_type').notNull().default('weighted'),
  // Nullable, set only for a catalogue entry a data migration merged into another (migration 165).
  // The picker filters these out; historical exercise_id FKs stay valid since the row is kept.
  mergedInto:   uuid('merged_into').references((): AnyPgColumn => exerciseLibrary.id),
})

export const exerciseMedia = pgTable('exercise_media', {
  id:           uuid('id').primaryKey().defaultRandom(),
  exerciseName: text('exercise_name').notNull(),
  exerciseId:   uuid('exercise_id').references(() => exerciseLibrary.id, { onDelete: 'set null' }),
  gender:       text('gender').notNull().default('male'),
  startUrl:     text('start_url'),
  endUrl:       text('end_url'),
  gifUrl:       text('gif_url'),
  modelUsed:    text('model_used'),
  generatedAt:  timestamp('generated_at', { withTimezone: true }).defaultNow(),
}, (t) => [unique().on(t.exerciseName, t.gender)])

export const exerciseGifCache = pgTable('exercise_gif_cache', {
  exerciseName: text('exercise_name').primaryKey(),
  gifUrl:       text('gif_url'),
  imageUrl:     text('image_url'),
  fetchedAt:    timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userStats = pgTable('user_stats', {
  userId:         uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  totalSessions:  integer('total_sessions').notNull().default(0),
  totalVolumeKg:  doublePrecision('total_volume_kg').notNull().default(0),
  totalSets:      integer('total_sets').notNull().default(0),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const activityTypes = pgTable('activity_types', {
  id:              text('id').primaryKey(),
  label:           text('label').notNull(),
  icon:            text('icon').notNull(),
  isDistanceBased: boolean('is_distance_based').notNull().default(false),
  sortOrder:       integer('sort_order').notNull().default(0),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const activityLogs = pgTable('activity_logs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:            date('date', { mode: 'string' }).notNull(),
  activityType:    text('activity_type').notNull().default('other').references(() => activityTypes.id),
  title:           text('title').notNull(),
  startTime:       time('start_time'),
  endTime:         time('end_time'),
  durationMin:     doublePrecision('duration_min'),
  distanceKm:      doublePrecision('distance_km'),
  caloriesBurned:  doublePrecision('calories_burned'),
  avgHr:           integer('avg_hr'),
  maxHr:           integer('max_hr'),
  notes:           text('notes'),
  routePolyline:   text('route_polyline'),
  splits:          jsonb('splits').$type<{ km: number; paceSec: number }[]>(),
  bestEfforts:     jsonb('best_efforts').$type<Record<string, number>>(),
  paceSeries:      jsonb('pace_series').$type<{ tSec: number; paceSec: number }[]>(),
  avgPaceSecPerKm: doublePrecision('avg_pace_sec_per_km'),
  elevationGainM:  doublePrecision('elevation_gain_m'),
  elevationLossM:  doublePrecision('elevation_loss_m'),
  elevationProfile: jsonb('elevation_profile').$type<{ distKm: number; eleM: number }[]>(),
  steps:           integer('steps'),
  cadenceSpm:      doublePrecision('cadence_spm'),
  cadenceSeries:   jsonb('cadence_series').$type<{ tSec: number; spm: number }[]>(),
  cadenceSource:   text('cadence_source').$type<'ring' | 'strap'>(),
  // Per-segment stats for a guided interval walk — see migration 161.
  segments:        jsonb('segments').$type<{
    index: number; setNumber: number; kind: 'warmup' | 'fast' | 'slow' | 'cooldown'
    startSec: number; endSec: number
    avgHr: number | null; maxHr: number | null; hrAtStart: number | null
    avgPaceSecPerKm: number | null; distanceKm: number | null; avgCadenceSpm: number | null
  }[]>(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
})

export const fitnessTests = pgTable('fitness_tests', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  testType:    text('test_type').notNull(),
  date:        date('date', { mode: 'string' }).notNull(),
  durationSec: integer('duration_sec'),
  distanceM:   doublePrecision('distance_m'),
  avgHr:       integer('avg_hr'),
  maxHr:       integer('max_hr'),
  restingHr:   integer('resting_hr'),
  hrr1Bpm:     integer('hrr1_bpm'),
  vo2maxEst:   doublePrecision('vo2max_est'),
  method:      text('method'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
})

export const runningPlans = pgTable('running_plans', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalKind:         text('goal_kind').notNull().default('cardio_health'),
  targetDistanceKm: doublePrecision('target_distance_km'),
  targetDate:       date('target_date', { mode: 'string' }),
  frameworkKey:     text('framework_key').notNull().default('polarized-80-20'),
  timePerSessionMinutes: integer('time_per_session_minutes'),
  fitnessSnapshot:  jsonb('fitness_snapshot').notNull().default({}),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const prescribedRuns = pgTable('prescribed_runs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId:        uuid('plan_id').notNull().references(() => runningPlans.id, { onDelete: 'cascade' }),
  date:          date('date', { mode: 'string' }).notNull(),
  runType:       text('run_type').notNull(),
  durationMin:   doublePrecision('duration_min'),
  distanceKm:    doublePrecision('distance_km'),
  targetHrLow:   integer('target_hr_low'),
  targetHrHigh:  integer('target_hr_high'),
  targetZoneIds: jsonb('target_zone_ids').notNull().default([]),
  rationale:     text('rationale').notNull().default(''),
  gateAction:    text('gate_action').notNull().default('proceed'),
  status:        text('status').notNull().default('pending'),
  activityLogId: uuid('activity_log_id').references(() => activityLogs.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.planId, t.date)])

export const sleepSessions = pgTable('sleep_sessions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:             date('date', { mode: 'string' }).notNull(),  // wake-up date
  sleepStart:       timestamp('sleep_start', { withTimezone: true }).notNull(),
  sleepEnd:         timestamp('sleep_end',   { withTimezone: true }).notNull(),
  durationHours:    doublePrecision('duration_hours'),
  deepSleepHours:   doublePrecision('deep_sleep_hours'),
  remSleepHours:    doublePrecision('rem_sleep_hours'),
  lightSleepHours:  doublePrecision('light_sleep_hours'),
  awakHours:        doublePrecision('awake_hours'),
  // Oura Ring enhancements (migration 085)
  // NOT .unique() — the constraint is per-user (migration 166). The BLE rollup derives this as
  // `ble:<startDs>` from the ring counter with no user component, so a global unique would collide
  // between two people wearing rings.
  ouraId:           text('oura_id'),
  efficiency:       integer('efficiency'),          // 0-100 %
  onsetLatencySec:  integer('onset_latency_sec'),   // seconds to fall asleep
  averageHrvMs:     doublePrecision('average_hrv_ms'),
  avgHeartRate:     integer('avg_heart_rate'),
  lowestHeartRate:  integer('lowest_heart_rate'),
  restlessPeriods:  integer('restless_periods'),
  sleepScore:       integer('sleep_score'),
  respiratoryRate:  doublePrecision('respiratory_rate'),  // breaths/min (Oura average_breath)
  sleepPhase5Min:   text('sleep_phase_5_min'),            // 5-min stage codes: 1=deep 2=light 3=REM 4=awake
  timeInBedHours:   doublePrecision('time_in_bed_hours'), // migration 112
  sourceMap:        jsonb('source_map').$type<Record<string, string>>(),   // per-field provenance (migration 120)
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.sleepStart)])

export const moodLogs = pgTable('mood_logs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate:      date('log_date', { mode: 'string' }).notNull(),
  energyLevel:  text('energy_level').notNull(),
  sleepQuality: text('sleep_quality').notNull(),
  bodyState:    text('body_state').array().notNull().default([]),
  soreMuscles:  text('sore_muscles').array().notNull().default([]),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.logDate)])

export const dayCheckins = pgTable('day_checkins', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate:           date('log_date', { mode: 'string' }).notNull(),
  phase:             text('phase').notNull().default('evening'),
  physicalTiredness: integer('physical_tiredness'),
  mentalDrain:       integer('mental_drain'),
  barelyMoved:       integer('barely_moved'),
  hydration:         integer('hydration'),
  lateHeavyMeal:     integer('late_heavy_meal'),
  wakeMood:          integer('wake_mood'),
  perceivedRecovery: integer('perceived_recovery'),
  motivation:        integer('motivation'),
  sleepQualityFeel:  integer('sleep_quality_feel'),
  restingSoreness:   integer('resting_soreness'),
  // Replaces motivation going forward (retired in place, same pattern as wakeMood/restingSoreness
  // before it) — a quick illness/context flag, ties into the existing self-reported-sick signal.
  illnessContext:            text('illness_context'),
  // Distinguishes a genuinely-edited scale from an accepted score-derived prefill (Q-113) — a
  // calibration query must filter on these before trusting perceivedRecovery/sleepQualityFeel
  // as real self-report.
  perceivedRecoveryTouched:  boolean('perceived_recovery_touched').notNull().default(false),
  sleepQualityFeelTouched:   boolean('sleep_quality_feel_touched').notNull().default(false),
  soreMuscles:       text('sore_muscles').array().notNull().default([]),
  journal:           text('journal'),
  /** Q-387 — "I have finished logging today". NULL means not marked, which the maintenance
   *  calibration reads as EXCLUDED rather than as assumed-complete: the failure mode has to be
   *  "the estimate waits", not "the estimate is quietly wrong". Undo sets it back to NULL. */
  foodLoggingCompletedAt: timestamp('food_logging_completed_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.logDate, t.phase)])

export const personalRecords = pgTable('personal_records', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(),
  exerciseId:   uuid('exercise_id').references(() => exerciseLibrary.id, { onDelete: 'set null' }),
  estimated1rm: doublePrecision('estimated_1rm').notNull(),
  achievedAt:   timestamp('achieved_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.exerciseName)])

/** A starting 1RM the user typed into the program builder — an estimate, deliberately not an
 *  earned record. `personal_records` holds the latter and is written only from logs (Q-5). */
export const exerciseEstimates = pgTable('exercise_estimates', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  exerciseId:   uuid('exercise_id').references(() => exerciseLibrary.id, { onDelete: 'set null' }),
  exerciseName: text('exercise_name').notNull(),
  estimated1rm: doublePrecision('estimated_1rm').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.exerciseName)])

export const goalRecommendations = pgTable('goal_recommendations', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  userId:                   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  source:                   text('source').notNull(),
  recommendedStepsGoal:     integer('recommended_steps_goal'),
  recommendedCalories:      integer('recommended_calories'),
  recommendedProteinG:      doublePrecision('recommended_protein_g'),
  recommendedCarbsG:        doublePrecision('recommended_carbs_g'),
  recommendedFatG:          doublePrecision('recommended_fat_g'),
  recommendedWaterMl:       integer('recommended_water_ml'),
  recommendedActivityLevel: text('recommended_activity_level'),
  reasoning:                text('reasoning'),
  insights:                 text('insights'),
  dataQualityNote:          text('data_quality_note'),
  status:                   text('status').notNull().default('pending'),
  appliedAt:                timestamp('applied_at', { withTimezone: true }),
  dismissedAt:              timestamp('dismissed_at', { withTimezone: true }),
})

export const mealTypes = pgTable('meal_types', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  emoji:         text('emoji').notNull().default('🍽️'),
  sortOrder:     integer('sort_order').notNull().default(0),
  timeStartHour: integer('time_start_hour').notNull().default(0),
  timeEndHour:   integer('time_end_hour').notNull().default(24),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  required:      boolean('required').notNull().default(true),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Meal types soft-delete (Q-179). `food_logs.meal_type_id` is ON DELETE RESTRICT, so a hard
  // DELETE fails the moment any log — including a soft-deleted one — still points here.
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
})

export const foodItems = pgTable('food_items', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  brand:        text('brand'),
  servingSizeG: doublePrecision('serving_size_g').notNull().default(100),
  calories:     integer('calories').notNull(),
  proteinG:     doublePrecision('protein_g').notNull().default(0),
  carbsG:       doublePrecision('carbs_g').notNull().default(0),
  fatG:         doublePrecision('fat_g').notNull().default(0),
  fiberG:       doublePrecision('fiber_g'),
  sugarG:       doublePrecision('sugar_g'),
  sodiumMg:     doublePrecision('sodium_mg'),
  satFatG:      doublePrecision('sat_fat_g'),
  source:       text('source').notNull().$type<'ai' | 'barcode' | 'manual' | 'text'>(),
  barcode:      text('barcode'),
  region:       text('region').notNull().default('AU'),
  // BF-35 (migration 227). Bytes, not a URL — this table is read local-first and mirrored into
  // on-device SQLite, where a URL renders nothing offline. Capped by FOOD_ITEM_IMAGE_MAX_BYTES.
  imageDataUri: text('image_data_uri'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const foodLogs = pgTable('food_logs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  userId:             uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:               text('date').notNull(),
  mealTypeId:         uuid('meal_type_id').notNull().references(() => mealTypes.id, { onDelete: 'restrict' }),
  foodItemId:         uuid('food_item_id').notNull().references(() => foodItems.id, { onDelete: 'restrict' }),
  quantityMultiplier: doublePrecision('quantity_multiplier').notNull().default(1.0),
  loggedAt:           timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
})

export const savedMeals = pgTable('saved_meals', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  // How many portions the recipe makes. 1 for an ordinary meal; >1 for a batch (the owner's
  // protein ice cream makes two), so a plan can take one portion instead of the whole tub.
  servings:  doublePrecision('servings').notNull().default(1),
  // A 128x128 WebP thumbnail as a base64 data URI, capped at SAVED_MEAL_IMAGE_MAX_BYTES (Q-396).
  // Not a URL: this row syncs to a phone and has to render offline. Not 5 MB like `users.avatar`:
  // that column never enters the sync delta and this one does.
  imageDataUri: text('image_data_uri'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// BF-11e — which meal types a saved meal is eligible for, so a plan does not put pancakes at dinner.
// `MealType` is reused as the vocabulary rather than a parallel "category": the user already names
// and configures their own types with time windows, and a meal can suit several (a protein shake is
// plausibly Breakfast and Post-Workout).
//
// `meal_types` SOFT-deletes (see its own comment), so a row here can point at a deleted type. That
// is deliberate and handled on READ, not by deleting join rows — restoring a type restores its tags.
export const savedMealMealTypes = pgTable('saved_meal_meal_types', {
  savedMealId: uuid('saved_meal_id').notNull().references(() => savedMeals.id, { onDelete: 'cascade' }),
  mealTypeId:  uuid('meal_type_id').notNull().references(() => mealTypes.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.savedMealId, t.mealTypeId] })])

export const savedMealItems = pgTable('saved_meal_items', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  savedMealId:        uuid('saved_meal_id').notNull().references(() => savedMeals.id, { onDelete: 'cascade' }),
  foodItemId:         uuid('food_item_id').notNull().references(() => foodItems.id, { onDelete: 'restrict' }),
  quantityMultiplier: doublePrecision('quantity_multiplier').notNull().default(1.0),
})

// Meal Plan (Q-186, migrations 177-178). `mealPlanVariants` sits between the plan and its meals so
// one plan can carry different macros on training vs rest days; a plan with no split has a single
// variant with dayType 'all'. Which variant applies to a date is resolved from the user's existing
// schedule — there is no second definition of "training day" here.
export const mealPlans = pgTable('meal_plans', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  userId:               uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:                 text('name').notNull(),
  isActive:             boolean('is_active').notNull().default(false),
  mealsPerDay:          integer('meals_per_day').notNull(),
  targetCalories:       integer('target_calories').notNull(),
  targetProteinG:       doublePrecision('target_protein_g').notNull(),
  targetCarbsG:         doublePrecision('target_carbs_g').notNull(),
  targetFatG:           doublePrecision('target_fat_g').notNull(),
  trainingTime:         text('training_time'),
  stores:               jsonb('stores').notNull().default([]),
  excludedFoods:        jsonb('excluded_foods').notNull().default([]),
  restrictionsSnapshot: jsonb('restrictions_snapshot').notNull().default([]),
  avoidNote:            text('avoid_note'),
  generatedAt:          timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  lastReviewedAt:       timestamp('last_reviewed_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:            timestamp('deleted_at', { withTimezone: true }),
})

export const mealPlanVariants = pgTable('meal_plan_variants', {
  id:              uuid('id').primaryKey().defaultRandom(),
  mealPlanId:      uuid('meal_plan_id').notNull().references(() => mealPlans.id, { onDelete: 'cascade' }),
  dayType:         text('day_type').notNull(),
  targetCalories:  integer('target_calories').notNull(),
  targetProteinG:  doublePrecision('target_protein_g').notNull(),
  targetCarbsG:    doublePrecision('target_carbs_g').notNull(),
  targetFatG:      doublePrecision('target_fat_g').notNull(),
})

export const mealPlanMeals = pgTable('meal_plan_meals', {
  id:              uuid('id').primaryKey().defaultRandom(),
  variantId:       uuid('variant_id').notNull().references(() => mealPlanVariants.id, { onDelete: 'cascade' }),
  mealTypeId:      uuid('meal_type_id').references(() => mealTypes.id, { onDelete: 'set null' }),
  savedMealId:     uuid('saved_meal_id').references(() => savedMeals.id, { onDelete: 'set null' }),
  position:        integer('position').notNull(),
  // Denormalised on purpose: the row must stay renderable after its saved meal or meal type is
  // deleted, and the offline mirror needs names and macros rather than ids alone.
  name:            text('name').notNull(),
  notes:           text('notes'),
  targetCalories:  integer('target_calories').notNull(),
  targetProteinG:  doublePrecision('target_protein_g').notNull(),
  targetCarbsG:    doublePrecision('target_carbs_g').notNull(),
  targetFatG:      doublePrecision('target_fat_g').notNull(),
  // A denormalised snapshot in the NutritionIngredient shape, so the plan stays re-scalable and
  // renderable offline without joining food_items (Q-192).
  ingredients:     jsonb('ingredients').notNull().default([]),
  suggestedTime:   text('suggested_time'),
})

// Q-187 phase 2. Only DECLINES live here. "I ate it" stays derivable from the food log itself —
// storing a 'yes' beside it would be two sources of truth for one fact — while "I did not eat it"
// is not derivable at all, because an absent food log is indistinguishable from an unanswered
// prompt. Keeping unconfirmed prefills out of `food_logs` entirely is what stops the day's totals
// counting food nobody ate, without teaching 23 readers a new filter.
export const planMealAnswers = pgTable('plan_meal_answers', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planMealId: uuid('plan_meal_id').notNull().references(() => mealPlanMeals.id, { onDelete: 'cascade' }),
  logDate:    date('log_date').notNull(),
  answer:     text('answer').notNull().default('no'),
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  // Undo is a soft delete: "no" is one mis-tap from losing the meal for the day, and a hard DELETE
  // would never reach a device that has not synced.
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Seeded global catalogue — no personal data. The per-user selections are in the join below.
export const dietaryRestrictions = pgTable('dietary_restrictions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  code:      text('code').notNull().unique(),
  label:     text('label').notNull(),
  category:  text('category').notNull(),
  synonyms:  jsonb('synonyms').notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
})

// Per USER, not per plan: an allergy belongs to the person, so every plan inherits it and a new
// plan cannot silently forget it.
export const userDietaryRestrictions = pgTable('user_dietary_restrictions', {
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  restrictionId: uuid('restriction_id').notNull().references(() => dietaryRestrictions.id, { onDelete: 'cascade' }),
  severity:      text('severity').notNull().default('avoid'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.restrictionId] })])

export const nutritionTargets = pgTable('nutrition_targets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').unique().notNull().references(() => users.id, { onDelete: 'cascade' }),
  calories:  integer('calories'),
  proteinG:  doublePrecision('protein_g'),
  carbsG:    doublePrecision('carbs_g'),
  fatG:      doublePrecision('fat_g'),
  fiberG:    doublePrecision('fiber_g'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const friendships = pgTable('friendships', {
  id:          uuid('id').primaryKey().defaultRandom(),
  requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status:      text('status').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.requesterId, t.addresseeId)])

export const seasons = pgTable('seasons', {
  id:        uuid('id').primaryKey().defaultRandom(),
  label:     text('label').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate:   date('end_date', { mode: 'string' }).notNull(),
})

export const seasonResults = pgTable('season_results', {
  id:         uuid('id').primaryKey().defaultRandom(),
  seasonId:   uuid('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rank:       integer('rank').notNull(),
  sessions:   integer('sessions').notNull().default(0),
  volumeKg:   doublePrecision('volume_kg').notNull().default(0),
  badgeLabel: text('badge_label').notNull(),
}, t => [unique().on(t.seasonId, t.userId)])

export const aiHealthInsights = pgTable('ai_health_insights', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  section:     text('section').notNull(),
  date:        date('date', { mode: 'string' }).notNull(),
  insight:     text('insight').notNull(),
  contextHash: text('context_hash'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.section, t.date)])

// BF-33: clinically measured resting metabolic rate (indirect calorimetry). Its own table rather
// than a `body_metrics` column because a second test must sit BESIDE the first — see migration 225.
export const measuredRmr = pgTable('measured_rmr', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  measuredOn:     date('measured_on', { mode: 'string' }).notNull(),
  rmrKcal:        integer('rmr_kcal').notNull(),
  // The load-bearing column: it is what lets the measurement be re-scaled to today's body instead
  // of expiring on a date (`personalRmr`). Nullable — a provider may report a rate and no comp.
  ffmKgAtTest:    doublePrecision('ffm_kg_at_test'),
  weightKgAtTest: doublePrecision('weight_kg_at_test'),
  method:         text('method'),
  provider:       text('provider'),
  notes:          text('notes'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.measuredOn)])

export const errorEvents = pgTable('error_events', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  source:    text('source').notNull(), // 'client' | 'server'
  message:   text('message').notNull(),
  stack:     text('stack'),
  url:       text('url'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// App-load observability (BF-19) — one row per navigation, written best-effort by
// lib/app-load-metrics.ts. Higher volume than `error_events` by construction, so it has its own
// table and its own prune. See migration 229 for why `cold` is load-bearing.
export const appLoadMetrics = pgTable('app_load_metrics', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  route:           text('route').notNull(),
  responseStartMs: integer('response_start_ms'),
  domContentMs:    integer('dom_content_ms'),
  totalMs:         integer('total_ms').notNull(),
  cold:            boolean('cold').notNull(),
  buildId:         text('build_id'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// AI call observability — one row per @ai-sdk/google model call (metadata only,
// written best-effort by lib/ai/instrument.ts). See migration 136.
export const aiCallLog = pgTable('ai_call_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  section:      text('section').notNull(),
  model:        text('model').notNull(),
  inputTokens:  integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens:  integer('total_tokens'),
  latencyMs:    integer('latency_ms'),
  ok:           boolean('ok').notNull(),
  fingerprint:  text('fingerprint'),
  /** BF-4 (migration 208). The request payload the call carried, for the shapes that have one —
   *  `latency_ms` is the MODEL's time, and the leg the owner reported as slow is the one before it.
   *  Null, not 0, where a shape has no payload. */
  payloadBytes: integer('payload_bytes'),
  /** Q-295 (migration 222). Input tokens the PROVIDER served from its own cache. Gemini 3.x caches
   *  implicitly by default, so this is how you tell whether prompt caching is already happening
   *  before adding an explicit cache on top. NULL (not 0) where the call predates the column or the
   *  provider reported nothing — a miss is 0 and is a different fact. */
  cachedInputTokens: integer('cached_input_tokens'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const feedbackSubmissions = pgTable('feedback_submissions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),
  title:          text('title').notNull(),
  description:    text('description'),
  screenshotData: text('screenshot_data'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const injuries = pgTable('injuries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  muscleName:   text('muscle_name').notNull(),
  notes:        text('notes'),
  severity:     text('severity').notNull(),
  startedDate:  date('started_date', { mode: 'string' }).notNull(),
  resolvedDate: date('resolved_date', { mode: 'string' }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
})

export const supplements = pgTable('supplements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:            text('name').notNull(),
  dose:            text('dose'),
  reminderEnabled: boolean('reminder_enabled').notNull().default(false),
  reminderTime:    text('reminder_time'),
  sortOrder:       integer('sort_order').notNull().default(0),
  active:          boolean('active').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
})

export const supplementLogs = pgTable('supplement_logs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  supplementId: uuid('supplement_id').notNull().references(() => supplements.id, { onDelete: 'cascade' }),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate:      date('log_date', { mode: 'string' }).notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.supplementId, t.logDate)])

export const sessionPeriodization = pgTable('session_periodization', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  userId:                   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  programSessionId:         uuid('program_session_id').notNull().references(() => programSessions.id, { onDelete: 'cascade' }),

  phase:                    text('phase').notNull().default('baseline'),
  // 'baseline' | 'accumulation' | 'intensification' | 'realisation' | 'deload'
  phaseStartedAt:           timestamp('phase_started_at', { withTimezone: true }).notNull().defaultNow(),
  sessionsInPhase:          integer('sessions_in_phase').notNull().default(0),
  baselineComplete:         boolean('baseline_complete').notNull().default(false),
  baseline1rm:              jsonb('baseline_1rm').notNull().default({}),
  // { "<session_exercise_id UUID>": { kg: number, source: "amrap" | "personal_record" | "existing" | "estimate" } }

  prescription:                 jsonb('prescription'),
  prescriptionGeneratedAt:      timestamp('prescription_generated_at', { withTimezone: true }),
  prescriptionExpiresAt:        timestamp('prescription_expires_at', { withTimezone: true }),
  prescriptionStatus:           text('prescription_status').notNull().default('none'),
  // 'none' | 'pending' | 'accepted' | 'auto_applied' | 'dismissed' | 'consumed'
  lastSessionRanPrescription:   boolean('last_session_ran_prescription'),

  pendingTransition:            jsonb('pending_transition'),
  // { newPhase, reasoning, urgency } or null
  preEmergencyDeloadPhase:      text('pre_emergency_deload_phase'),

  updatedAt:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.programSessionId)])

export const programVolumeTargets = pgTable('program_volume_targets', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  programId:          uuid('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  muscleGroup:        text('muscle_group').notNull(),
  targetSetsPerWeek:  integer('target_sets_per_week').notNull(),
}, t => [unique().on(t.programId, t.muscleGroup)])

// ── Oura Ring ─────────────────────────────────────────────────────────────────

export const ouraTokens = pgTable('oura_tokens', {
  userId:              uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  personalAccessToken: text('personal_access_token'),
  accessToken:         text('access_token'),
  refreshToken:        text('refresh_token'),
  expiresAt:           timestamp('expires_at', { withTimezone: true }),
  scope:               text('scope'),
  ouraUserId:          text('oura_user_id').unique(),  // Oura's own user ID — used for webhook lookup
  webhookSigningKey:   text('webhook_signing_key'),    // HMAC key from Oura webhook subscription response
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ouraDaily = pgTable('oura_daily', {
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:   date('date', { mode: 'string' }).notNull(),

  // Readiness
  readinessScore:            integer('readiness_score'),
  temperatureDeviation:      doublePrecision('temperature_deviation'),
  temperatureTrendDeviation: doublePrecision('temperature_trend_deviation'),
  readinessContributors:     jsonb('readiness_contributors'),

  // Sleep score
  sleepScore:        integer('sleep_score'),
  sleepContributors: jsonb('sleep_contributors'),

  // Activity
  activityScore:             integer('activity_score'),
  activeCalories:            integer('active_calories'),
  totalCalories:             integer('total_calories'),
  equivalentWalkingDistance: integer('equivalent_walking_distance'),
  highActivityTimeSec:       integer('high_activity_time_sec'),
  mediumActivityTimeSec:     integer('medium_activity_time_sec'),
  lowActivityTimeSec:        integer('low_activity_time_sec'),
  sedentaryTimeSec:          integer('sedentary_time_sec'),
  nonWearTimeSec:            integer('non_wear_time_sec'),
  activityContributors:      jsonb('activity_contributors'),
  // migration 112
  restingTimeSec:              integer('resting_time_sec'),
  avgMetMinutes:                doublePrecision('avg_met_minutes'),
  highActivityMetMinutes:       doublePrecision('high_activity_met_minutes'),
  mediumActivityMetMinutes:     doublePrecision('medium_activity_met_minutes'),
  lowActivityMetMinutes:        doublePrecision('low_activity_met_minutes'),

  // Daily stress (GET /v2/usercollection/daily_stress)
  stressHigh:    integer('stress_high'),    // minutes in high stress
  recoveryHigh:  integer('recovery_high'),  // minutes in high recovery
  daySummary:    text('day_summary'),       // 'restored'|'restorative'|'stressful'|'very_stressful'|'passive'

  // VO2 Max (GET /v2/usercollection/vO2_max) — Ring 4+ / Ring 5
  vo2Max:        doublePrecision('vo2_max'),  // ml/kg/min

  // Cardiovascular age (GET /v2/usercollection/daily_cardiovascular_age)
  vascularAge:         integer('vascular_age'),          // years [18, 100]
  pulseWaveVelocity:   doublePrecision('pulse_wave_velocity'), // m/s

  // Daily resilience (GET /v2/usercollection/daily_resilience)
  resilienceLevel:        text('resilience_level'),       // 'exceptional'|'strong'|'adequate'|'limited'|'low'
  resilienceContributors: jsonb('resilience_contributors'), // { sleep_recovery, daytime_recovery, stress }

  // sleep_time endpoint (GET /v2/usercollection/sleep_time) — migration 090
  recommendedBedtimeStart: integer('recommended_bedtime_start'),
  recommendedBedtimeEnd:   integer('recommended_bedtime_end'),
  sleepTimeStatus:         text('sleep_time_status'),
  sleepTimeRecommendation: text('sleep_time_recommendation'),

  // Breathing disturbance index (from GET /v2/usercollection/spo2_daily) — migration 106
  breathingDisturbanceIndex: doublePrecision('breathing_disturbance_index'),

  sourceMap: jsonb('source_map').$type<Record<string, string>>(),   // per-field provenance (migration 120)
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.date)])

export const ouraHeartrate = pgTable('oura_heartrate', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  bpm:       integer('bpm').notNull(),
  source:    text('source'),
  // migration 130 (Phase-2 B1) — cursor for the dedicated Track-B timeseries backup sync.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.timestamp)])

// Server mirror of the on-device `oura_bucket` coarse-tier RRD trend ladder (migration 137,
// Phase-2 B1). Durable backup destination for Track-B — device-computed, never server-computed.
// Coarse tiers are forever-retained (no prune). Keyed `(user_id, tier, bucket_start_ms)`.
export const ouraBucket = pgTable('oura_bucket', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tier:           text('tier').notNull(),
  bucketStartMs:  bigint('bucket_start_ms', { mode: 'number' }).notNull(),
  bucketStartDs:  bigint('bucket_start_ds', { mode: 'number' }).notNull(),
  localDate:      date('local_date', { mode: 'string' }).notNull(),
  hrMean:         doublePrecision('hr_mean'),
  hrMin:          doublePrecision('hr_min'),
  hrMax:          doublePrecision('hr_max'),
  hrvRmssdMs:     doublePrecision('hrv_rmssd_ms'),
  spo2Pct:        doublePrecision('spo2_pct'),
  perfusionIndex: doublePrecision('perfusion_index'),
  skinTempC:      doublePrecision('skin_temp_c'),
  metMean:        doublePrecision('met_mean'),
  metMinutes:     doublePrecision('met_minutes'),
  motionMad:      doublePrecision('motion_mad'),
  ibiMs:          text('ibi_ms'),
  sampleCount:    integer('sample_count'),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.tier, t.bucketStartMs)])

// Server-side rollup cache of per-day time-in-HR-zone, derived from oura_heartrate (migration 129).
// NOT an offline-first user-write domain — recomputed on read (reconcile), never synced to the local
// store. One row per (user, local date).
export const dailyZoneMinutes = pgTable('daily_zone_minutes', {
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:        date('day', { mode: 'string' }).notNull(),
  zone1Sec:   integer('zone1_sec').notNull().default(0),
  zone2Sec:   integer('zone2_sec').notNull().default(0),
  zone3Sec:   integer('zone3_sec').notNull().default(0),
  zone4Sec:   integer('zone4_sec').notNull().default(0),
  zone5Sec:   integer('zone5_sec').notNull().default(0),
  // Zone profile the split was computed under (migration 134). A mismatch vs the
  // current profile is a cache miss for days still inside HR retention (J-2/H-4).
  maxHr:      integer('max_hr'),
  restingHr:  integer('resting_hr'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.day] })])

// Per-workout HR summary snapshot (migration 135, review H-3 / Lever W). Durable Tier-2 record of
// avg/peak/HRR1/workout-HRV, computed on first ready recap view and persisted, so old recaps keep
// their numbers after the 180d oura_heartrate / 90d rr_intervals prunes thin the raw series. Keyed
// by workout session; server-derived, not an offline-first sync domain.
export const workoutHrStats = pgTable('workout_hr_stats', {
  workoutSessionId: uuid('workout_session_id').primaryKey().references(() => workoutSessions.id, { onDelete: 'cascade' }),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  avgBpm:           integer('avg_bpm'),
  peakBpm:          integer('peak_bpm'),
  hrr1Best:         integer('hrr1_best'),
  workoutHrvMs:     integer('workout_hrv_ms'),
  readingsCount:    integer('readings_count').notNull().default(0),
  source:           text('source'),
  computedAt:       timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
})

// Per-SET HR metric snapshot (migration 139, plan 2026-07-21-per-set-hr-metrics). Sibling of
// workout_hr_stats: the durable per-set record of peak/avg HR, the drop-during-rest curve, and the
// three time-to-recover models, computed on first recap view (and by the admin backfill) so per-set /
// per-exercise HR trends survive the 180d oura_heartrate prune. Trend dimensions (exercise/phase/%1RM)
// are denormalised for single-table trend scans. Server-derived; not an offline-sync domain.
export const setHrStats = pgTable('set_hr_stats', {
  setLogId:          uuid('set_log_id').primaryKey().references(() => setLogs.id, { onDelete: 'cascade' }),
  userId:            uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workoutSessionId:  uuid('workout_session_id').notNull().references(() => workoutSessions.id, { onDelete: 'cascade' }),
  exerciseLogId:     uuid('exercise_log_id').references(() => exerciseLogs.id, { onDelete: 'cascade' }),
  exerciseId:        uuid('exercise_id'),
  exerciseName:      text('exercise_name').notNull(),
  phaseType:         text('phase_type'),
  setNumber:         integer('set_number').notNull(),
  intensityPct:      doublePrecision('intensity_pct'),
  plannedPct:        doublePrecision('planned_pct'),
  plannedReps:       integer('planned_reps'),
  restTakenSec:      integer('rest_taken_sec'),
  plannedRestSec:    integer('planned_rest_sec'),
  loggedAt:          timestamp('logged_at', { withTimezone: true }),
  peakBpm:           integer('peak_bpm'),
  avgBpm:            integer('avg_bpm'),
  bpmAtEnd:          integer('bpm_at_end'),
  drop30s:           integer('drop_30s'),
  drop60s:           integer('drop_60s'),
  drop90s:           integer('drop_90s'),
  drop120s:          integer('drop_120s'),
  troughBpm:         integer('trough_bpm'),
  secToPreset:       integer('sec_to_preset'),
  recoveredPreset:   boolean('recovered_preset'),
  secToResting:      integer('sec_to_resting'),
  recoveredResting:  boolean('recovered_resting'),
  pctHrrAtRestEnd:   doublePrecision('pct_hrr_at_rest_end'),
  secToHrr50:        integer('sec_to_hrr50'),
  restAdequate:      boolean('rest_adequate'),
  readingsCount:     integer('readings_count').notNull().default(0),
  coverageOk:        boolean('coverage_ok').notNull().default(false),
  source:            text('source'),
  computedAt:        timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
})

// Beat-to-beat RR intervals from the chest strap (migration 124). Raw HRV
// material — rMSSD is derived on read, never stored.
export const rrIntervals = pgTable('rr_intervals', {
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at:     timestamp('at', { withTimezone: true }).notNull(),
  rrMs:   integer('rr_ms').notNull(),
  source: text('source').notNull().default('chest_strap'),
}, t => [unique().on(t.userId, t.at)])

// TN-3a — the 30-minute daytime-stress buckets, persisted (migration 212). `summarizeStressDay`
// reduces this series to three daily scalars on `oura_daily_derived`; those are too compressed to
// answer "which hours run hottest" (measured span −0.14 … +0.23 on a [−1,+1] scale), so the series
// itself is kept. Rows rather than a JSONB array because the read aggregates ACROSS days by hour.
// `bucketStart` is the instant, not a local hour — the hour is derived in the user's timezone at
// read time, so a timezone change does not strand rows keyed to the old one.
export const ouraDaytimeStressBuckets = pgTable('oura_daytime_stress_buckets', {
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:         text('day').notNull(),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  level:       doublePrecision('level').notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.bucketStart] })])

// D5 — own daytime-HRV: per-user regression replacing Oura's dhrv_imputation ONNX model
// (migration 149). One row per user, upserted on refit. See lib/health/daytime-hrv-model.ts.
export const ouraDaytimeHrvModel = pgTable('oura_daytime_hrv_model', {
  userId:      uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  intercept:   doublePrecision('intercept').notNull(),
  hrCoef:      doublePrecision('hr_coef').notNull(),
  tempCoef:    doublePrecision('temp_coef').notNull(),
  residualStd: doublePrecision('residual_std').notNull(),
  nSamples:    integer('n_samples').notNull(),
  fittedAt:    timestamp('fitted_at', { withTimezone: true }).notNull().defaultNow(),
})

// Direct-BLE raw ring event store (Phase 3+4 MVP, migration 114). One row per raw
// history event from the ring, kept re-decodable (body_hex) alongside a best-effort
// structured decode. Populated by the server-side ingest route, not the outbox.
export const ouraRawSamples = pgTable('oura_raw_samples', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(), // BIGSERIAL in migration 114; DB fills it, inserts omit it
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ringTimestampDs: bigint('ring_timestamp_ds', { mode: 'number' }).notNull(),
  tag:             smallint('tag').notNull(),
  eventName:       text('event_name').notNull(),
  bodyHex:         text('body_hex').notNull(),
  decoded:         jsonb('decoded'),
  recordedAt:      timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  measuredAt:      timestamp('measured_at', { withTimezone: true }), // wall-clock via anchor (migration 115)
  epoch:           integer('epoch').notNull().default(0), // clock epoch this ds belongs to (migration 161)
}, t => [unique().on(t.userId, t.ringTimestampDs, t.tag, t.bodyHex)])

// Direct-BLE raw scale sample store (migration 155). One row per weigh-in, archival raw_hex
// kept forever (redecode-safe), decoded is the disposable best-effort snapshot. A weigh-in is
// synchronous/one-shot (no ring-clock-anchor complexity needed) — measured_at is wall-clock time
// at capture. `status` gates the multi-user weight-anomaly safety net (lib/scale-ble): a reading
// only reaches body_metrics once status is 'confirmed', either immediately (delta within
// threshold) or via the pending confirm/dismiss routes.
export const scaleRawSamples = pgTable('scale_raw_samples', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
  rawHex:     text('raw_hex').notNull(),
  decoded:    jsonb('decoded'),
  status:     text('status').notNull().default('confirmed'), // 'confirmed' | 'pending' | 'dismissed'
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Live keepalive battery poll (migration 133) — the 5-min reqBattery() reading persisted
// so active-use drain rate is captured. measured_at is server-stamped (the poll is live).
export const ouraBleBatteryPoll = pgTable('oura_ble_battery_poll', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
  percent:    integer('percent').notNull(),
  charging:   boolean('charging'),
})

// One (anchor_ds ↔ anchor_utc) correspondence per ring-clock epoch (migration 115).
// A ring reset (re-key / dead battery) starts a new epoch → a new row; older rows
// keep dating their epoch's samples via created_at ordering.
export const ouraBleClockAnchors = pgTable('oura_ble_clock_anchors', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  anchorDs:  bigint('anchor_ds', { mode: 'number' }).notNull(),
  anchorUtc: timestamp('anchor_utc', { withTimezone: true }).notNull(),
  // Migration 161: rows are append-only observations grouped by clock epoch.
  epoch:          integer('epoch').notNull().default(0),
  observedSource: text('observed_source').notNull().default('drain'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Cold tier for raw BLE frames (migration 191, Q-541). One sealed blob per
// `(user_id, epoch, tag, ds_bucket)`, replacing ~1,135 rows each. `oura_raw_samples` above keeps the
// hot window and the ingest path untouched; a background packer moves everything older here and only
// deletes a hot row once it has re-read the blob and proven the frames equal. Sealed blobs are never
// updated, which is the property the row-per-frame table lacks and why it bloated (Q-534).
//
// `event_name`, `measured_at` and `decoded` are deliberately absent — derivable from `tag`, from the
// clock anchors, and from the body respectively. Dropping the stored `measured_at` is what removes
// the full-table re-stamp that caused the 2026-08-17 disk_full outage.
export const ouraRawPacked = pgTable('oura_raw_packed', {
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  epoch:      integer('epoch').notNull(),
  tag:        smallint('tag').notNull(),
  /** floor(ring_timestamp_ds / 864000) — a day of *ring* time, not a calendar day, so a change to
   *  the ds→wall-clock derivation never invalidates a bucket. */
  dsBucket:   bigint('ds_bucket', { mode: 'number' }).notNull(),
  frameCount: integer('frame_count').notNull(),
  minDs:      bigint('min_ds', { mode: 'number' }).notNull(),
  maxDs:      bigint('max_ds', { mode: 'number' }).notNull(),
  bodySha256: text('body_sha256').notNull(),
  blob:       bytea('blob').notNull(),
  packedAt:   timestamp('packed_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.epoch, t.tag, t.dsBucket] })])

// A deliberate ring re-key, declared by the owner (migration 194, Q-314). The next ingest batch
// consumes the pending row and opens the epoch it names, instead of the epoch being inferred from a
// ds regression — which a history re-drain produces too, and which re-timed the whole sleep history
// twice. At most one may be pending per user (partial unique index).
// One admin-triggered redecode run (migration 196, Q-535). The route returns this row's id
// immediately instead of awaiting the work, because awaiting it exceeded the gateway timeout and
// reported "failed" for a run that had completed — which invited a retry of the heaviest pair of
// calls in the app. In a table rather than process memory so a restart cannot silently lose a job.
export const ouraRedecodeJobs = pgTable('oura_redecode_jobs', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt:  timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  opts:       jsonb('opts').notNull().default({}),
  result:     jsonb('result'),
  error:      text('error'),
})

export const ouraBleRekeyDeclarations = pgTable('oura_ble_rekey_declarations', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  declaredAt:  timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  note:        text('note'),
  consumedAt:  timestamp('consumed_at', { withTimezone: true }),
  openedEpoch: integer('opened_epoch'),
})

// Durable watermark for the BLE rollup's incremental window (migration 184). Stage 1 of Q-213 kept
// this in process memory, so every container restart re-derived the whole 35-day window once — six
// minutes of a pegged main thread, measured in production, on every deploy. `lastRolledDs` is a ring
// deciseconds counter, which restarts on a re-key, so the clock `epoch` is stored beside it and a
// watermark from a different epoch is ignored rather than trusted.
export const ouraRollupState = pgTable('oura_rollup_state', {
  userId:       uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  lastRolledDs: bigint('last_rolled_ds', { mode: 'number' }).notNull(),
  epoch:        integer('epoch').notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Accurate live-counted step windows (migration 119) — the rollup's Tier-2-wins merge
// overrides the Tier-1 gate estimate for the ds span each row covers.
export const stepLiveWindows = pgTable('step_live_windows', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startDs:   bigint('start_ds', { mode: 'number' }).notNull(),
  endDs:     bigint('end_ds', { mode: 'number' }).notNull(),
  steps:     integer('steps').notNull(),
  source:    text('source').notNull().default('live-accel'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.startDs)])

// Raw accel-magnitude chunks from the continuous daytime capture (migration 122).
// Gait-counted on ingest into step_live_windows; raw retained 7 days for
// recount/calibration, pruned opportunistically on ingest.
export const ouraAccelChunks = pgTable('oura_accel_chunks', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startedAt:  timestamp('started_at', { withTimezone: true }).notNull(),
  sampleRate: integer('sample_rate').notNull(),
  n:          integer('n').notNull(),
  steps:      integer('steps').notNull(),
  magnitudes: integer('magnitudes').array().notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.startedAt)])

// Per-night daily summary + rolling personal baselines (migration 116, Oura BLE
// Phase 5 addendum A3) — the substrate for baseline-relative readiness contributors.
// Baseline state (ecore-style asymmetric EMA, ×8 fixed-point) is carried forward
// night to night; n_history is the shared age counter across all six metrics.
export const ouraDailySummary = pgTable('oura_daily_summary', {
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:   date('date', { mode: 'string' }).notNull(),

  sleepDurationHours: doublePrecision('sleep_duration_hours'),
  sleepEfficiency:    doublePrecision('sleep_efficiency'),
  deepSleepHours:     doublePrecision('deep_sleep_hours'),
  remSleepHours:      doublePrecision('rem_sleep_hours'),
  restlessPeriods:    integer('restless_periods'),
  sleepLatencySec:    integer('sleep_latency_sec'),
  hrvAvgMs:           doublePrecision('hrv_avg_ms'),
  rhrLowBpm:          doublePrecision('rhr_low_bpm'),
  rhrAvgBpm:          doublePrecision('rhr_avg_bpm'),
  recoveryIndexHours: doublePrecision('recovery_index_hours'),
  tempMeanC:          doublePrecision('temp_mean_c'),
  tempDevC:           doublePrecision('temp_dev_c'),
  metAvg:             doublePrecision('met_avg'),
  breathAvgRpm:       doublePrecision('breath_avg_rpm'),

  hrvBaselineMeanX8:   integer('hrv_baseline_mean_x8'),
  hrvBaselineDevX8:    integer('hrv_baseline_dev_x8'),
  rhrBaselineMeanX8:   integer('rhr_baseline_mean_x8'),
  rhrBaselineDevX8:    integer('rhr_baseline_dev_x8'),
  tempBaselineMeanX8:  integer('temp_baseline_mean_x8'),
  tempBaselineDevX8:   integer('temp_baseline_dev_x8'),
  sleepBaselineMeanX8: integer('sleep_baseline_mean_x8'),
  sleepBaselineDevX8:  integer('sleep_baseline_dev_x8'),
  metBaselineMeanX8:   integer('met_baseline_mean_x8'),
  metBaselineDevX8:    integer('met_baseline_dev_x8'),
  breathBaselineMeanX8: integer('breath_baseline_mean_x8'),
  breathBaselineDevX8:  integer('breath_baseline_dev_x8'),
  nHistory:            integer('n_history').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.date)])


// Completed-form derived metrics — one row per user per local day (Oura on-device-models
// program, Sub-plan A / master §4.1). The scored/analysis layer on top of the measured
// physiology (oura_daily_summary / sleep_sessions / body_metrics): finished model outputs
// (scores + contributors, illness radar, stress, training load, energy, body comp, vascular
// age). Analysis-first + optional read-path acceleration; NOT authoritative over the measured
// tables. Server-side only (rollup writes, readiness route reads); every column nullable.
export const ouraDailyDerived = pgTable('oura_daily_derived', {
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:    date('day', { mode: 'string' }).notNull(),

  source:        text('source'),
  modelVersions: jsonb('model_versions'),

  sleepScore:        integer('sleep_score'),
  sleepContributors: jsonb('sleep_contributors'),

  readinessScore:        integer('readiness_score'),
  readinessContributors: jsonb('readiness_contributors'),
  readinessSource:       text('readiness_source'),

  activityScore:        integer('activity_score'),
  activityContributors: jsonb('activity_contributors'),
  activeCaloriesEst:    integer('active_calories_est'),
  trainingLoadOts:      doublePrecision('training_load_ots'),
  trainingLoadHigh:     boolean('training_load_high'),

  recoveryIndexHours: doublePrecision('recovery_index_hours'),
  wornHoursBle:       doublePrecision('worn_hours_ble'),
  nightHrvBaselineMs: doublePrecision('night_hrv_baseline_ms'),

  illnessFlag:       text('illness_flag'),
  illnessScore:      integer('illness_score'),
  illnessBiomarkers: jsonb('illness_biomarkers'),

  daytimeStressScaled:       doublePrecision('daytime_stress_scaled'),
  stressHighMinutes:         integer('stress_high_minutes'),
  recoveryHighMinutes:       integer('recovery_high_minutes'),
  chronicStressScore:        integer('chronic_stress_score'),
  chronicStressContributors: jsonb('chronic_stress_contributors'),
  resilienceLevel:           doublePrecision('resilience_level'),
  resilienceDailyStress:          doublePrecision('resilience_daily_stress'),
  resilienceDailyRestorativeTime: doublePrecision('resilience_daily_restorative_time'),
  resilienceDailySleepRecovery:   doublePrecision('resilience_daily_sleep_recovery'),
  resilienceGranular:             doublePrecision('resilience_granular'),
  resilienceConfidence:           doublePrecision('resilience_confidence'),

  bdiDerived: doublePrecision('bdi_derived'),

  vascularAge: doublePrecision('vascular_age'),
  pwv:         doublePrecision('pwv'),
  bodyComp:    jsonb('body_comp'),

  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.day)])


export const ouraWorkouts = pgTable('oura_workouts', {
  id:             text('id').primaryKey(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:            date('day', { mode: 'string' }).notNull(),
  activity:       text('activity').notNull(),
  startDatetime:  timestamp('start_datetime', { withTimezone: true }).notNull(),
  endDatetime:    timestamp('end_datetime', { withTimezone: true }).notNull(),
  calories:       doublePrecision('calories'),
  distanceM:      doublePrecision('distance_m'),
  intensity:      text('intensity'),
  source:         text('source'),
  reviewed:       boolean('reviewed').notNull().default(false),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Oura enhanced tags, sessions (breathing/meditation/nap moments) and rest-mode
// periods — one row per Oura document, deduped on oura_id. Migration 106.
export const ouraTags = pgTable('oura_tags', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ouraId:     text('oura_id').notNull().unique(),
  source:     text('source').notNull(),      // 'enhanced_tag' | 'session' | 'rest_mode'
  tagType:    text('tag_type'),
  customName: text('custom_name'),
  comment:    text('comment'),
  mood:       text('mood'),
  startDay:   date('start_day', { mode: 'string' }).notNull(),
  endDay:     date('end_day', { mode: 'string' }),
  startTime:  timestamp('start_time', { withTimezone: true }),
  endTime:    timestamp('end_time', { withTimezone: true }),
  syncedAt:   timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bodyBatteryDaily = pgTable('body_battery_daily', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:          date('date', { mode: 'string' }).notNull(),
  anchor:        integer('anchor').notNull(),
  anchorSource:  text('anchor_source').notNull(),
  endValue:      integer('end_value').notNull(),
  dayMin:        integer('day_min').notNull(),
  dayMax:        integer('day_max').notNull(),
  totalCharged:  integer('total_charged').notNull(),
  totalDrained:  integer('total_drained').notNull(),
  restingHr:     integer('resting_hr').notNull(),
  hrMax:         integer('hr_max').notNull(),
  hrMaxObserved: integer('hr_max_observed'),
  hrSampleCount: integer('hr_sample_count').notNull().default(0),
  modelVersion:  text('model_version').notNull(),
  computedAt:    timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Every change AI Coach applied on the user's behalf — the source of Undo and of the
 *  "changes you've made" history. `beforeState` is captured in the same request that writes,
 *  because a value re-derived later is a value that may already have moved. */
export const coachChanges = pgTable('coach_changes', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  domain:      text('domain').notNull(),
  targetId:    uuid('target_id').notNull(),
  patch:       jsonb('patch').notNull(),
  acceptedIds: text('accepted_ids').array().notNull().default([]),
  beforeState: jsonb('before_state').notNull().default({}),
  summary:     text('summary').notNull().default(''),
  appliedAt:   timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  undoneAt:    timestamp('undone_at', { withTimezone: true }),
})

/** An AI Coach conversation. Pruned to a 30-day window on write — there is no cron layer. */
export const coachThreads = pgTable('coach_threads', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:     text('title').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Whole UI message *parts*, not just text — a thread rehydrated without them loses its widgets,
 *  which would make the scrollback a lie about what happened. */
export const coachMessages = pgTable('coach_messages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  threadId:  uuid('thread_id').notNull().references(() => coachThreads.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(),
  parts:     jsonb('parts').notNull().default([]),
  position:  integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.threadId, t.position)])

// ── Colmi R09 ring — LEARNING MODE (migration 231, PS-8) ───────────────────────────────────
// Deliberately separate from body_metrics / sleep_sessions / oura_daily / oura_daily_derived /
// oura_heartrate. Every scoring read is source-blind, so a row in one of those IS a scored row
// however it is stamped; isolation comes from the data never landing there. `colmi_ble` is also
// absent from HEALTH_SOURCES on purpose, which makes a shared-table write a compile error.
// Enforced by scripts/check-learning-mode-isolation.js.

/** Point samples. `kind` distinguishes hr / steps / calories / distance / hrv / stress / spo2 /
 *  temperature / battery — one table because they differ only in unit and cadence, and their whole
 *  purpose is to be compared against another device. */
export const colmiReadings = pgTable('colmi_readings', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind:       text('kind').notNull(),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
  localDate:  date('local_date', { mode: 'string' }).notNull(),
  value:      doublePrecision('value').notNull(),
  /** Upper bound where the ring reports a pair (SpO2 max against `value`'s min). */
  valueHigh:  doublePrecision('value_high'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('colmi_readings_unique').on(t.userId, t.kind, t.measuredAt)])

/** Sleep is an interval with a stage, so it cannot live in the point table. `stage` is the ring's
 *  own encoding: 2 light, 3 deep, 4 REM, 5 awake. */
export const colmiSleepSegments = pgTable('colmi_sleep_segments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  localDate: date('local_date', { mode: 'string' }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt:   timestamp('ended_at', { withTimezone: true }).notNull(),
  stage:     integer('stage').notNull(),
  minutes:   integer('minutes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('colmi_sleep_segments_unique').on(t.userId, t.startedAt, t.stage)])
