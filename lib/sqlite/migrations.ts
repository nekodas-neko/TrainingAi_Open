import type { UpgradeStatement } from './sqlite-service';

// Read-only mirror tables added in v7. Defined as constants so reconcileSchema()
// can re-run them idempotently outside the (non-idempotent) version upgrade path.
const CREATE_PERSONAL_RECORDS = `CREATE TABLE IF NOT EXISTS personal_records (
  exercise_name TEXT PRIMARY KEY,
  exercise_id   TEXT,
  estimated_1rm REAL NOT NULL,
  achieved_at   TEXT,
  updated_at    TEXT NOT NULL,
  sync_status   TEXT NOT NULL DEFAULT 'synced'
)`;

const CREATE_OURA_DAILY = `CREATE TABLE IF NOT EXISTS oura_daily (
  day                  TEXT PRIMARY KEY,
  readiness_score      INTEGER,
  sleep_score          INTEGER,
  activity_score       INTEGER,
  temperature_deviation REAL,
  active_calories      INTEGER,
  contributors         TEXT,
  updated_at           TEXT NOT NULL
)`;

// ── Oura raw-on-device: local calculated-form tables (v17) ──────────────────────
// Schema foundation for the on-device rollup (docs/superpowers/plans/
// 2026-07-21-oura-raw-on-device-*.md). These hold the CALCULATED forms the WebView
// rollup produces from raw ring data; raw body_hex lives in the native oura_raw.db,
// never here. Additive + nullable so they're safe to land ahead of the code that
// reads/writes them, and so the v17 upgrade can be device-verified in isolation
// before anything is wired to it. NOT yet read/written by any code (that arrives
// with the rollup port). The offline-first trio (updated_at/sync_status) is present
// so these become device-authored, Railway-backed synced domains in Phase 2.

// Tiered time-bucket store (the RRDtool-style ladder). One row per (tier, bucket
// start). Every metric column nullable — a bucket only carries the metrics its
// source events produced. No deleted_at: buckets are derived, never user-deleted.
// PK is (tier, bucket_start_ms) — wall-clock epoch ms via the forward-only clock
// anchor — NOT bucket_start_ds: the ring's decisecond counter RESETS on re-key /
// dead battery, so a post-reset low-ds bucket would collide with a historical one
// and silently overwrite it (corrupting the forever-retained coarse tiers).
// bucket_start_ms is globally unique/monotonic, so it can't collide across resets.
const CREATE_OURA_BUCKET = `CREATE TABLE IF NOT EXISTS oura_bucket (
  tier            TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  bucket_start_ds INTEGER NOT NULL,
  local_date      TEXT NOT NULL,
  hr_mean         REAL,
  hr_min          REAL,
  hr_max          REAL,
  hrv_rmssd_ms    REAL,
  spo2_pct        REAL,
  perfusion_index REAL,
  skin_temp_c     REAL,
  met_mean        REAL,
  met_minutes     REAL,
  motion_mad      REAL,
  ibi_ms          TEXT,
  sample_count    INTEGER,
  updated_at      TEXT NOT NULL,
  sync_status     TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (tier, bucket_start_ms)
)`;

// Measured nightly physiology + rolling EMA baselines (faithful mirror of server
// oura_daily_summary, migration 116; server key `date` ↔ local `day`). One row per
// local day. Column types match the server (RHR is a fractional bin-average → REAL,
// not INTEGER). The `*_baseline_*_x8` + `n_history` EMA state is included because the
// on-device rollup folds baselines offline and has nowhere else to persist that state.
const CREATE_OURA_DAILY_SUMMARY_LOCAL = `CREATE TABLE IF NOT EXISTS oura_daily_summary (
  day                    TEXT PRIMARY KEY,
  sleep_duration_hours   REAL,
  sleep_efficiency       REAL,
  deep_sleep_hours       REAL,
  rem_sleep_hours        REAL,
  restless_periods       INTEGER,
  sleep_latency_sec      INTEGER,
  hrv_avg_ms             REAL,
  rhr_low_bpm            REAL,
  rhr_avg_bpm            REAL,
  recovery_index_hours   REAL,
  temp_mean_c            REAL,
  temp_dev_c             REAL,
  met_avg                REAL,
  breath_avg_rpm         REAL,
  hrv_baseline_mean_x8   INTEGER,
  hrv_baseline_dev_x8    INTEGER,
  rhr_baseline_mean_x8   INTEGER,
  rhr_baseline_dev_x8    INTEGER,
  temp_baseline_mean_x8  INTEGER,
  temp_baseline_dev_x8   INTEGER,
  sleep_baseline_mean_x8 INTEGER,
  sleep_baseline_dev_x8  INTEGER,
  met_baseline_mean_x8   INTEGER,
  met_baseline_dev_x8    INTEGER,
  breath_baseline_mean_x8 INTEGER,
  breath_baseline_dev_x8  INTEGER,
  n_history              INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL,
  sync_status            TEXT NOT NULL DEFAULT 'synced'
)`;

// Scored/analysis outputs (faithful mirror of server oura_daily_derived, migrations
// 123/127/128). One row per local day; column types match the server (illness_flag
// is TEXT, resilience_level is REAL, illness_score/chronic_stress_score are INTEGER).
// JSON-text columns hold contributor/biomarker/body-comp breakdowns. Full column set
// so the on-device rollup can persist — and a restore-from-Railway can round-trip —
// every derived field the app reads offline.
const CREATE_OURA_DAILY_DERIVED_LOCAL = `CREATE TABLE IF NOT EXISTS oura_daily_derived (
  day                          TEXT PRIMARY KEY,
  source                       TEXT,
  model_versions               TEXT,
  sleep_score                  INTEGER,
  sleep_contributors           TEXT,
  readiness_score              INTEGER,
  readiness_contributors       TEXT,
  readiness_source             TEXT,
  activity_score               INTEGER,
  activity_contributors        TEXT,
  active_calories_est          INTEGER,
  training_load_ots            REAL,
  training_load_high           INTEGER,
  recovery_index_hours         REAL,
  worn_hours_ble               REAL,
  night_hrv_baseline_ms        REAL,
  illness_flag                 TEXT,
  illness_score                INTEGER,
  illness_biomarkers           TEXT,
  daytime_stress_scaled        REAL,
  stress_high_minutes          INTEGER,
  recovery_high_minutes        INTEGER,
  chronic_stress_score         INTEGER,
  chronic_stress_contributors  TEXT,
  resilience_level             REAL,
  resilience_daily_stress      REAL,
  resilience_daily_restorative_time REAL,
  resilience_daily_sleep_recovery   REAL,
  resilience_granular          REAL,
  resilience_confidence        REAL,
  bdi_derived                  REAL,
  vascular_age                 REAL,
  pwv                          REAL,
  body_comp                    TEXT,
  updated_at                   TEXT NOT NULL,
  sync_status                  TEXT NOT NULL DEFAULT 'synced'
)`;

// Intraday HR series (mirror of server oura_heartrate, migration 090). One row per
// timepoint (5-min binned; 15-sec inside workouts). ts_ms = epoch ms.
const CREATE_OURA_HEARTRATE_LOCAL = `CREATE TABLE IF NOT EXISTS oura_heartrate (
  ts_ms       INTEGER PRIMARY KEY,
  bpm         INTEGER NOT NULL,
  source      TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'synced'
)`;

// Program-structure mirror tables added in v9 (read-only server→client mirrors).
// No FK constraints — relationships are denormalized via parent-id columns, matching
// the existing local schema style and avoiding cascade/insert-order bugs.
const CREATE_PROGRAM_SESSIONS = `CREATE TABLE IF NOT EXISTS program_sessions (
  id                  TEXT PRIMARY KEY,
  program_id          TEXT NOT NULL,
  name                TEXT NOT NULL,
  position            INTEGER NOT NULL,
  icon                TEXT,
  time_budget_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at          TEXT
)`;

const CREATE_SESSION_EXERCISES = `CREATE TABLE IF NOT EXISTS session_exercises (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  style_id      TEXT,
  muscle_groups TEXT,
  position      INTEGER NOT NULL,
  exercise_role TEXT NOT NULL DEFAULT 'primary',
  updated_at    TEXT
)`;

const CREATE_SCHEDULES = `CREATE TABLE IF NOT EXISTS schedules (
  id               TEXT PRIMARY KEY,
  program_id       TEXT NOT NULL,
  type             TEXT NOT NULL,
  rest_after_n     INTEGER,
  reminder_enabled INTEGER NOT NULL DEFAULT 0,
  reminder_time    TEXT,
  updated_at       TEXT
)`;

const CREATE_SCHEDULE_DAYS = `CREATE TABLE IF NOT EXISTS schedule_days (
  schedule_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  session_id  TEXT,
  PRIMARY KEY (schedule_id, day_of_week)
)`;

const CREATE_STYLE_SETS = `CREATE TABLE IF NOT EXISTS style_sets (
  id          TEXT PRIMARY KEY,
  style_id    TEXT NOT NULL,
  set_number  INTEGER NOT NULL,
  pct         REAL NOT NULL,
  reps        INTEGER NOT NULL,
  rest_sec    INTEGER NOT NULL DEFAULT 90,
  use_for_1rm INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT
)`;

const CREATE_PROGRAM_SESSIONS_IDX = `CREATE INDEX IF NOT EXISTS idx_program_sessions_program ON program_sessions (program_id)`;
const CREATE_SESSION_EXERCISES_IDX = `CREATE INDEX IF NOT EXISTS idx_session_exercises_session ON session_exercises (session_id)`;
const CREATE_SCHEDULES_IDX = `CREATE INDEX IF NOT EXISTS idx_schedules_program ON schedules (program_id)`;
const CREATE_STYLE_SETS_IDX = `CREATE INDEX IF NOT EXISTS idx_style_sets_style ON style_sets (style_id)`;

// Columns the local store depends on that were added via ALTER TABLE in v7.
// SQLite has no `ADD COLUMN IF NOT EXISTS`, so if the v7 upgrade ever applies
// partially the column stays missing and every retry throws "duplicate column"
// and rolls the whole version back — permanently. reconcileSchema() adds only
// the columns that are actually absent, guarded by a PRAGMA table_info check.
export const RECONCILE_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'meal_plan_meals', column: 'ingredients',    ddl: `ALTER TABLE meal_plan_meals ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'` },
  { table: 'meal_plan_meals', column: 'suggested_time', ddl: `ALTER TABLE meal_plan_meals ADD COLUMN suggested_time TEXT` },
  { table: 'saved_meals',     column: 'servings',       ddl: `ALTER TABLE saved_meals ADD COLUMN servings REAL NOT NULL DEFAULT 1` },
  { table: 'saved_meals',     column: 'image_data_uri',  ddl: `ALTER TABLE saved_meals ADD COLUMN image_data_uri TEXT` },
  { table: 'food_items',      column: 'image_data_uri',  ddl: `ALTER TABLE food_items ADD COLUMN image_data_uri TEXT` },
  { table: 'food_logs',       column: 'saved_meal_id',  ddl: `ALTER TABLE food_logs ADD COLUMN saved_meal_id TEXT` },
  { table: 'food_logs',       column: 'meal_group_id',  ddl: `ALTER TABLE food_logs ADD COLUMN meal_group_id TEXT` },
  { table: 'food_logs',       column: 'meal_group_name', ddl: `ALTER TABLE food_logs ADD COLUMN meal_group_name TEXT` },
  { table: 'workout_sessions', column: 'deleted_at',  ddl: `ALTER TABLE workout_sessions ADD COLUMN deleted_at TEXT` },
  { table: 'workout_sessions', column: 'sync_status', ddl: `ALTER TABLE workout_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  { table: 'exercise_logs',    column: 'deleted_at',  ddl: `ALTER TABLE exercise_logs ADD COLUMN deleted_at TEXT` },
  { table: 'exercise_logs',    column: 'sync_status', ddl: `ALTER TABLE exercise_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  { table: 'set_logs',         column: 'deleted_at',  ddl: `ALTER TABLE set_logs ADD COLUMN deleted_at TEXT` },
  { table: 'set_logs',         column: 'sync_status', ddl: `ALTER TABLE set_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  // Q-124: supplements was the one offline write domain with no clobber guard — applyDelta
  // could not gate on sync_status because the column did not exist, so a rename made offline
  // reverted to the server's old value on the next pull.
  // BF-3 — the dose stamped on the log, and its structured form on the definition. Registered here
  // because `reconcileSchema()` is the real schema authority after a partial upgrade, and a v32 that
  // half-applies would otherwise leave a device whose logs cannot record what was taken.
  { table: 'supplements',      column: 'default_amount', ddl: `ALTER TABLE supplements ADD COLUMN default_amount REAL` },
  { table: 'supplements',      column: 'unit',       ddl: `ALTER TABLE supplements ADD COLUMN unit TEXT` },
  { table: 'supplement_logs',  column: 'amount',     ddl: `ALTER TABLE supplement_logs ADD COLUMN amount REAL` },
  { table: 'supplement_logs',  column: 'unit',       ddl: `ALTER TABLE supplement_logs ADD COLUMN unit TEXT` },
  { table: 'supplement_logs',  column: 'dose_text',  ddl: `ALTER TABLE supplement_logs ADD COLUMN dose_text TEXT` },
  { table: 'supplements',      column: 'deleted_at',  ddl: `ALTER TABLE supplements ADD COLUMN deleted_at TEXT` },
  { table: 'supplements',      column: 'sync_status', ddl: `ALTER TABLE supplements ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  // Columns the local-store / sync inserts write but earlier migrations never added.
  { table: 'exercise_logs',    column: 'muscle_groups',          ddl: `ALTER TABLE exercise_logs ADD COLUMN muscle_groups TEXT` },
  { table: 'exercise_logs',    column: 'inter_exercise_rest_sec', ddl: `ALTER TABLE exercise_logs ADD COLUMN inter_exercise_rest_sec INTEGER` },
  { table: 'set_logs',         column: 'set_start_ms',            ddl: `ALTER TABLE set_logs ADD COLUMN set_start_ms INTEGER` },
  { table: 'set_logs',         column: 'set_end_ms',              ddl: `ALTER TABLE set_logs ADD COLUMN set_end_ms INTEGER` },
  { table: 'set_logs',         column: 'planned_pct',             ddl: `ALTER TABLE set_logs ADD COLUMN planned_pct REAL` },
  { table: 'set_logs',         column: 'planned_reps',            ddl: `ALTER TABLE set_logs ADD COLUMN planned_reps INTEGER` },
  { table: 'set_logs',         column: 'planned_rest_sec',        ddl: `ALTER TABLE set_logs ADD COLUMN planned_rest_sec INTEGER` },
  // Program-mirror columns added to the v4 local_programs stub in v9.
  { table: 'local_programs',   column: 'phase_mode',               ddl: `ALTER TABLE local_programs ADD COLUMN phase_mode TEXT NOT NULL DEFAULT 'manual'` },
  { table: 'local_programs',   column: 'training_goal',            ddl: `ALTER TABLE local_programs ADD COLUMN training_goal TEXT NOT NULL DEFAULT 'strength'` },
  { table: 'local_programs',   column: 'started_at',               ddl: `ALTER TABLE local_programs ADD COLUMN started_at TEXT` },
  { table: 'local_programs',   column: 'sessions_per_cycle',       ddl: `ALTER TABLE local_programs ADD COLUMN sessions_per_cycle INTEGER` },
  { table: 'local_programs',   column: 'total_weeks',              ddl: `ALTER TABLE local_programs ADD COLUMN total_weeks INTEGER` },
  { table: 'local_programs',   column: 'auto_apply_prescriptions', ddl: `ALTER TABLE local_programs ADD COLUMN auto_apply_prescriptions INTEGER NOT NULL DEFAULT 0` },
  { table: 'local_programs',   column: 'created_at',               ddl: `ALTER TABLE local_programs ADD COLUMN created_at TEXT` },
  // Activity display columns added in v11 (see MIGRATIONS toVersion 11).
  { table: 'activity_logs',    column: 'calories_burned',          ddl: `ALTER TABLE activity_logs ADD COLUMN calories_burned REAL` },
  { table: 'activity_logs',    column: 'start_time',               ddl: `ALTER TABLE activity_logs ADD COLUMN start_time TEXT` },
  // Older ALTER-added columns — kept here so a reopen-at-v1 after a failed
  // combined upgrade can still restore them (v3 rpe; v6 activity metrics).
  { table: 'set_logs',         column: 'rpe',                      ddl: `ALTER TABLE set_logs ADD COLUMN rpe INTEGER` },
  { table: 'activity_logs',    column: 'steps',                    ddl: `ALTER TABLE activity_logs ADD COLUMN steps INTEGER` },
  { table: 'activity_logs',    column: 'avg_hr',                   ddl: `ALTER TABLE activity_logs ADD COLUMN avg_hr INTEGER` },
  { table: 'activity_logs',    column: 'max_hr',                   ddl: `ALTER TABLE activity_logs ADD COLUMN max_hr INTEGER` },
  // Outbox retry accounting + activity pull-guard added in v13.
  { table: 'mutations_outbox', column: 'attempts',      ddl: `ALTER TABLE mutations_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0` },
  { table: 'mutations_outbox', column: 'last_error',    ddl: `ALTER TABLE mutations_outbox ADD COLUMN last_error TEXT` },
  { table: 'mutations_outbox', column: 'status',        ddl: `ALTER TABLE mutations_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'` },
  { table: 'mutations_outbox', column: 'next_retry_at', ddl: `ALTER TABLE mutations_outbox ADD COLUMN next_retry_at TEXT` },
  { table: 'activity_logs',    column: 'sync_status',   ddl: `ALTER TABLE activity_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  // Batch F — additive columns, delivered via reconcile (runs every open) so they are
  // version-independent from Batch A's v13. Do NOT also add a versioned ALTER.
  { table: 'day_checkins',     column: 'wake_mood',          ddl: `ALTER TABLE day_checkins ADD COLUMN wake_mood INTEGER` },
  { table: 'day_checkins',     column: 'perceived_recovery', ddl: `ALTER TABLE day_checkins ADD COLUMN perceived_recovery INTEGER` },
  { table: 'day_checkins',     column: 'motivation',         ddl: `ALTER TABLE day_checkins ADD COLUMN motivation INTEGER` },
  { table: 'day_checkins',     column: 'sleep_quality_feel', ddl: `ALTER TABLE day_checkins ADD COLUMN sleep_quality_feel INTEGER` },
  { table: 'day_checkins',     column: 'food_logging_completed_at', ddl: `ALTER TABLE day_checkins ADD COLUMN food_logging_completed_at TEXT` },
  { table: 'day_checkins',     column: 'resting_soreness',   ddl: `ALTER TABLE day_checkins ADD COLUMN resting_soreness INTEGER` },
  // Q-113 — replaces motivation (retired in place, same reconcile pattern); touched flags
  // distinguish a genuinely-edited scale from an accepted score-derived prefill.
  { table: 'day_checkins',     column: 'illness_context',            ddl: `ALTER TABLE day_checkins ADD COLUMN illness_context TEXT` },
  { table: 'day_checkins',     column: 'perceived_recovery_touched', ddl: `ALTER TABLE day_checkins ADD COLUMN perceived_recovery_touched INTEGER NOT NULL DEFAULT 0` },
  { table: 'day_checkins',     column: 'sleep_quality_feel_touched', ddl: `ALTER TABLE day_checkins ADD COLUMN sleep_quality_feel_touched INTEGER NOT NULL DEFAULT 0` },
  // Supersets — additive, delivered via reconcile per the Batch F pattern above
  // (no versioned ALTER needed; reconcileSchema runs after every open).
  { table: 'session_exercises', column: 'superset_group', ddl: `ALTER TABLE session_exercises ADD COLUMN superset_group INTEGER` },
  { table: 'workout_sessions', column: 'session_rpe',        ddl: `ALTER TABLE workout_sessions ADD COLUMN session_rpe INTEGER` },
  // GPS run detail — additive, delivered via reconcile per the Batch F pattern
  // above. Previously the local-store save path had nowhere to put these, so a
  // run recorded on-device lost its entire route/pace/elevation data on save.
  { table: 'activity_logs', column: 'end_time',            ddl: `ALTER TABLE activity_logs ADD COLUMN end_time TEXT` },
  { table: 'activity_logs', column: 'notes',                ddl: `ALTER TABLE activity_logs ADD COLUMN notes TEXT` },
  { table: 'activity_logs', column: 'route_polyline',       ddl: `ALTER TABLE activity_logs ADD COLUMN route_polyline TEXT` },
  { table: 'activity_logs', column: 'splits',                ddl: `ALTER TABLE activity_logs ADD COLUMN splits TEXT` },
  { table: 'activity_logs', column: 'best_efforts',          ddl: `ALTER TABLE activity_logs ADD COLUMN best_efforts TEXT` },
  { table: 'activity_logs', column: 'pace_series',           ddl: `ALTER TABLE activity_logs ADD COLUMN pace_series TEXT` },
  { table: 'activity_logs', column: 'avg_pace_sec_per_km',   ddl: `ALTER TABLE activity_logs ADD COLUMN avg_pace_sec_per_km REAL` },
  { table: 'activity_logs', column: 'elevation_gain_m',      ddl: `ALTER TABLE activity_logs ADD COLUMN elevation_gain_m REAL` },
  { table: 'activity_logs', column: 'elevation_loss_m',      ddl: `ALTER TABLE activity_logs ADD COLUMN elevation_loss_m REAL` },
  { table: 'activity_logs', column: 'elevation_profile',      ddl: `ALTER TABLE activity_logs ADD COLUMN elevation_profile TEXT` },
  { table: 'activity_logs', column: 'cadence_spm',            ddl: `ALTER TABLE activity_logs ADD COLUMN cadence_spm REAL` },
  { table: 'activity_logs', column: 'cadence_series',         ddl: `ALTER TABLE activity_logs ADD COLUMN cadence_series TEXT` },
  { table: 'activity_logs', column: 'cadence_source',         ddl: `ALTER TABLE activity_logs ADD COLUMN cadence_source TEXT` },
  { table: 'body_metrics',  column: 'distance_km',           ddl: `ALTER TABLE body_metrics ADD COLUMN distance_km REAL` },
  // Delete tombstone for activity_logs — the server now soft-deletes (deleted_at)
  // instead of hard-DELETE, so a delete propagates to other devices via pullDelta;
  // the applyDelta tombstone branch for this table needs the local column to match.
  { table: 'activity_logs', column: 'deleted_at',            ddl: `ALTER TABLE activity_logs ADD COLUMN deleted_at TEXT` },
  // Batch O phase 1 — body circumference measurements, additive via reconcile per
  // the Batch F pattern above (no version bump).
  { table: 'body_metrics', column: 'waist_cm', ddl: `ALTER TABLE body_metrics ADD COLUMN waist_cm REAL` },
  { table: 'body_metrics', column: 'chest_cm', ddl: `ALTER TABLE body_metrics ADD COLUMN chest_cm REAL` },
  { table: 'body_metrics', column: 'arm_cm',   ddl: `ALTER TABLE body_metrics ADD COLUMN arm_cm REAL` },
  { table: 'body_metrics', column: 'thigh_cm', ddl: `ALTER TABLE body_metrics ADD COLUMN thigh_cm REAL` },
  { table: 'body_metrics', column: 'hip_cm',   ddl: `ALTER TABLE body_metrics ADD COLUMN hip_cm REAL` },
  { table: 'body_metrics', column: 'neck_cm',  ddl: `ALTER TABLE body_metrics ADD COLUMN neck_cm REAL` },
  // SYN-6/SYN-8 — a stranded (offline, dead-lettered-then-recovered) workout_log
  // outbox mutation replayed with no program-session id / deload / override
  // attribution because the local tables had nowhere to store them, degrading it
  // to a normal log with name-fallback phase attribution. Additive via reconcile
  // per the Batch F pattern above (no version bump).
  { table: 'workout_sessions', column: 'session_id',      ddl: `ALTER TABLE workout_sessions ADD COLUMN session_id TEXT` },
  { table: 'workout_sessions', column: 'intensity_mode',  ddl: `ALTER TABLE workout_sessions ADD COLUMN intensity_mode TEXT` },
  { table: 'workout_sessions', column: 'was_override',    ddl: `ALTER TABLE workout_sessions ADD COLUMN was_override INTEGER NOT NULL DEFAULT 0` },
  { table: 'exercise_logs',    column: 'exercise_deloaded', ddl: `ALTER TABLE exercise_logs ADD COLUMN exercise_deloaded INTEGER NOT NULL DEFAULT 0` },
  // Oura raw-on-device — the Oura columns the local sleep_sessions needs to render a
  // BLE sleep night offline (the base table only had duration/deep/rem/light). Additive
  // via reconcile per the Batch F pattern (no version bump); the on-device rollup writes
  // these, so sync_status arms the clobber-guard + Phase-2 backup sync. All nullable.
  { table: 'sleep_sessions', column: 'oura_id',           ddl: `ALTER TABLE sleep_sessions ADD COLUMN oura_id TEXT` },
  { table: 'sleep_sessions', column: 'efficiency',        ddl: `ALTER TABLE sleep_sessions ADD COLUMN efficiency REAL` },
  { table: 'sleep_sessions', column: 'onset_latency_sec', ddl: `ALTER TABLE sleep_sessions ADD COLUMN onset_latency_sec INTEGER` },
  { table: 'sleep_sessions', column: 'average_hrv_ms',    ddl: `ALTER TABLE sleep_sessions ADD COLUMN average_hrv_ms REAL` },
  { table: 'sleep_sessions', column: 'avg_heart_rate',    ddl: `ALTER TABLE sleep_sessions ADD COLUMN avg_heart_rate REAL` },
  { table: 'sleep_sessions', column: 'lowest_heart_rate', ddl: `ALTER TABLE sleep_sessions ADD COLUMN lowest_heart_rate REAL` },
  { table: 'sleep_sessions', column: 'restless_periods',  ddl: `ALTER TABLE sleep_sessions ADD COLUMN restless_periods INTEGER` },
  { table: 'sleep_sessions', column: 'sleep_score',        ddl: `ALTER TABLE sleep_sessions ADD COLUMN sleep_score INTEGER` },
  { table: 'sleep_sessions', column: 'respiratory_rate',  ddl: `ALTER TABLE sleep_sessions ADD COLUMN respiratory_rate REAL` },
  { table: 'sleep_sessions', column: 'sleep_phase_5_min', ddl: `ALTER TABLE sleep_sessions ADD COLUMN sleep_phase_5_min TEXT` },
  { table: 'sleep_sessions', column: 'time_in_bed_hours', ddl: `ALTER TABLE sleep_sessions ADD COLUMN time_in_bed_hours REAL` },
  // Q-519 — the bedtime the user remembers for a night the ring did not observe. Additive via
  // reconcile (no version bump), like every other sleep column above. It is pulled and displayed;
  // nothing on the device derives a window, duration or efficiency from it, which is the entire
  // reason it is not `sleep_start` — see docs/reviews/2026-08-26-manual-bedtime-write-audit.md.
  { table: 'sleep_sessions', column: 'manual_sleep_start', ddl: `ALTER TABLE sleep_sessions ADD COLUMN manual_sleep_start TEXT` },
  { table: 'sleep_sessions', column: 'sync_status',       ddl: `ALTER TABLE sleep_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  // oura_daily gains sync_status so the applyDelta pull can clobber-guard a device-authored
  // (BLE rollup) row against a stale server pull — the D4 finding. Default 'synced' (existing
  // rows are server-mirrored); the device-write path that sets 'pending' lands with D2.
  { table: 'oura_daily',     column: 'sync_status',       ddl: `ALTER TABLE oura_daily ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
  // #725 extended CREATE_OURA_DAILY_SUMMARY_LOCAL / CREATE_OURA_DAILY_DERIVED_LOCAL with
  // baseline/derived columns and shipped a v18 corrective DROP+CREATE — but a versioned
  // migration only runs ONCE per device. Any device that had already advanced past v18
  // before #725 landed keeps the OLD (pre-#725) column set forever; on-device Sync then
  // fails with "no such column: hrv_baseline_mean_x8" (confirmed on a real device,
  // 2026-07-23) because these columns were never registered here. This is the exact
  // "17 tables once missing from reconcile" bug class CLAUDE.md warns about — reconcile
  // is the only mechanism that self-heals a device stuck on an old schema, since it runs
  // unconditionally on every open, not just once per version. All nullable (or
  // NOT NULL with a DEFAULT, which SQLite's ALTER TABLE ADD COLUMN permits).
  { table: 'oura_daily_summary', column: 'hrv_baseline_mean_x8',    ddl: `ALTER TABLE oura_daily_summary ADD COLUMN hrv_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'hrv_baseline_dev_x8',     ddl: `ALTER TABLE oura_daily_summary ADD COLUMN hrv_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'rhr_baseline_mean_x8',    ddl: `ALTER TABLE oura_daily_summary ADD COLUMN rhr_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'rhr_baseline_dev_x8',     ddl: `ALTER TABLE oura_daily_summary ADD COLUMN rhr_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'temp_baseline_mean_x8',   ddl: `ALTER TABLE oura_daily_summary ADD COLUMN temp_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'temp_baseline_dev_x8',    ddl: `ALTER TABLE oura_daily_summary ADD COLUMN temp_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'sleep_baseline_mean_x8',  ddl: `ALTER TABLE oura_daily_summary ADD COLUMN sleep_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'sleep_baseline_dev_x8',   ddl: `ALTER TABLE oura_daily_summary ADD COLUMN sleep_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'met_baseline_mean_x8',    ddl: `ALTER TABLE oura_daily_summary ADD COLUMN met_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'met_baseline_dev_x8',     ddl: `ALTER TABLE oura_daily_summary ADD COLUMN met_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'breath_baseline_mean_x8', ddl: `ALTER TABLE oura_daily_summary ADD COLUMN breath_baseline_mean_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'breath_baseline_dev_x8',  ddl: `ALTER TABLE oura_daily_summary ADD COLUMN breath_baseline_dev_x8 INTEGER` },
  { table: 'oura_daily_summary', column: 'n_history',               ddl: `ALTER TABLE oura_daily_summary ADD COLUMN n_history INTEGER NOT NULL DEFAULT 0` },
  { table: 'oura_daily_derived', column: 'readiness_source',              ddl: `ALTER TABLE oura_daily_derived ADD COLUMN readiness_source TEXT` },
  { table: 'oura_daily_derived', column: 'activity_contributors',         ddl: `ALTER TABLE oura_daily_derived ADD COLUMN activity_contributors TEXT` },
  { table: 'oura_daily_derived', column: 'training_load_high',            ddl: `ALTER TABLE oura_daily_derived ADD COLUMN training_load_high INTEGER` },
  { table: 'oura_daily_derived', column: 'worn_hours_ble',                ddl: `ALTER TABLE oura_daily_derived ADD COLUMN worn_hours_ble REAL` },
  { table: 'oura_daily_derived', column: 'night_hrv_baseline_ms',         ddl: `ALTER TABLE oura_daily_derived ADD COLUMN night_hrv_baseline_ms REAL` },
  { table: 'oura_daily_derived', column: 'illness_biomarkers',            ddl: `ALTER TABLE oura_daily_derived ADD COLUMN illness_biomarkers TEXT` },
  { table: 'oura_daily_derived', column: 'stress_high_minutes',           ddl: `ALTER TABLE oura_daily_derived ADD COLUMN stress_high_minutes INTEGER` },
  { table: 'oura_daily_derived', column: 'recovery_high_minutes',         ddl: `ALTER TABLE oura_daily_derived ADD COLUMN recovery_high_minutes INTEGER` },
  { table: 'oura_daily_derived', column: 'chronic_stress_contributors',   ddl: `ALTER TABLE oura_daily_derived ADD COLUMN chronic_stress_contributors TEXT` },
  { table: 'oura_daily_derived', column: 'resilience_daily_stress',       ddl: `ALTER TABLE oura_daily_derived ADD COLUMN resilience_daily_stress REAL` },
  { table: 'oura_daily_derived', column: 'resilience_daily_restorative_time', ddl: `ALTER TABLE oura_daily_derived ADD COLUMN resilience_daily_restorative_time REAL` },
  { table: 'oura_daily_derived', column: 'resilience_daily_sleep_recovery',   ddl: `ALTER TABLE oura_daily_derived ADD COLUMN resilience_daily_sleep_recovery REAL` },
  { table: 'oura_daily_derived', column: 'resilience_granular',           ddl: `ALTER TABLE oura_daily_derived ADD COLUMN resilience_granular REAL` },
  { table: 'oura_daily_derived', column: 'resilience_confidence',         ddl: `ALTER TABLE oura_daily_derived ADD COLUMN resilience_confidence REAL` },
  { table: 'oura_daily_derived', column: 'vascular_age',                  ddl: `ALTER TABLE oura_daily_derived ADD COLUMN vascular_age REAL` },
  { table: 'oura_daily_derived', column: 'pwv',                          ddl: `ALTER TABLE oura_daily_derived ADD COLUMN pwv REAL` },
  { table: 'oura_daily_derived', column: 'body_comp',                     ddl: `ALTER TABLE oura_daily_derived ADD COLUMN body_comp TEXT` },
  // Direct-BLE scale composition (migration 155 server-side) — additive via reconcile per the
  // Batch F pattern (no version bump). All nullable.
  { table: 'body_metrics', column: 'skeletal_muscle_pct',  ddl: `ALTER TABLE body_metrics ADD COLUMN skeletal_muscle_pct REAL` },
  { table: 'body_metrics', column: 'fat_free_mass_kg',     ddl: `ALTER TABLE body_metrics ADD COLUMN fat_free_mass_kg REAL` },
  { table: 'body_metrics', column: 'subcutaneous_fat_pct', ddl: `ALTER TABLE body_metrics ADD COLUMN subcutaneous_fat_pct REAL` },
  { table: 'body_metrics', column: 'visceral_fat_index',   ddl: `ALTER TABLE body_metrics ADD COLUMN visceral_fat_index REAL` },
  { table: 'body_metrics', column: 'body_water_pct',       ddl: `ALTER TABLE body_metrics ADD COLUMN body_water_pct REAL` },
  { table: 'body_metrics', column: 'muscle_mass_kg',       ddl: `ALTER TABLE body_metrics ADD COLUMN muscle_mass_kg REAL` },
  { table: 'body_metrics', column: 'bone_mass_kg',         ddl: `ALTER TABLE body_metrics ADD COLUMN bone_mass_kg REAL` },
  { table: 'body_metrics', column: 'protein_pct',          ddl: `ALTER TABLE body_metrics ADD COLUMN protein_pct REAL` },
  { table: 'body_metrics', column: 'bmr_kcal',             ddl: `ALTER TABLE body_metrics ADD COLUMN bmr_kcal INTEGER` },
  { table: 'body_metrics', column: 'metabolic_age',        ddl: `ALTER TABLE body_metrics ADD COLUMN metabolic_age INTEGER` },
  // Per-segment guided-walk stats (server migration 161) — additive via reconcile per the
  // Batch F pattern (no version bump).
  { table: 'activity_logs', column: 'segments', ddl: `ALTER TABLE activity_logs ADD COLUMN segments TEXT` },
];

// Local mirror of the user's food items so food logs render offline (name +
// macros) without a server round-trip — the local store is the read source.
// The exercise catalogue, mirrored locally for rendering only. Offline, a log/program row
// cannot be drawn correctly without it: `exercise_type` decides whether a row shows a kg
// working weight or a rep target, and without it every exercise read offline was typed
// `weighted` (Q-20) — the same class of gap as `food_logs` holding no `food_items`.
// Keyed by the lower-cased name because that is the identity the server's own
// `libByName` lookup uses (`lib/workout/session-data.ts`); `id` is carried for the
// eventual move to id identity.
const CREATE_EXERCISE_LIBRARY = `CREATE TABLE IF NOT EXISTS exercise_library (
  name_key      TEXT PRIMARY KEY,
  id            TEXT,
  name          TEXT NOT NULL,
  exercise_type TEXT NOT NULL DEFAULT 'weighted',
  muscles       TEXT NOT NULL DEFAULT '[]',
  equipment     TEXT,
  updated_at    TEXT NOT NULL
)`;

// Read-only reference mirror of the server's meal_types — without it, offline food logs have
// no meal-type name/emoji/time-window to group under once the generic response cache expires.
// Editing (create/reorder/delete) stays online-only; this table is only ever fully replaced
// (delete-all + insert) from a successful GET, keyed by the server's own row id.
const CREATE_MEAL_TYPES = `CREATE TABLE IF NOT EXISTS meal_types (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  emoji              TEXT NOT NULL DEFAULT '🍽️',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  time_start_hour    INTEGER NOT NULL DEFAULT 0,
  time_end_hour      INTEGER NOT NULL DEFAULT 24,
  reminders_enabled  INTEGER NOT NULL DEFAULT 1,
  required           INTEGER NOT NULL DEFAULT 1
)`;

const CREATE_FOOD_ITEMS = `CREATE TABLE IF NOT EXISTS food_items (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  brand          TEXT,
  serving_size_g REAL NOT NULL DEFAULT 100,
  calories       REAL NOT NULL DEFAULT 0,
  protein_g      REAL NOT NULL DEFAULT 0,
  carbs_g        REAL NOT NULL DEFAULT 0,
  fat_g          REAL NOT NULL DEFAULT 0,
  fiber_g        REAL,
  sugar_g        REAL,
  sodium_mg      REAL,
  sat_fat_g      REAL,
  source         TEXT,
  -- BF-35. A ~100px OFF thumbnail or the user's own scan photo, as a capped data URI rather than a
  -- URL: food_items is read local-first and a URL renders nothing in airplane mode. Reaches fresh
  -- installs only -- the v30 ALTER is what reaches an upgraded device.
  image_data_uri TEXT,
  updated_at     TEXT NOT NULL
)`;

// Core tables from earlier migrations (v1/v2/v4/v5). Mirrored here as their
// BASE definitions so a reopen-at-v1 after a failed combined upgrade can
// recreate any that a partial upgrade dropped. Columns added by later ALTERs
// (v7 sync_status/deleted_at, v8/v9/v11 extras) are restored by RECONCILE_COLUMNS,
// so these use the original CREATE shape without them. CREATE ... IF NOT EXISTS
// is a no-op when the table already exists, so this is safe to run on every open.
const CREATE_WORKOUT_SESSIONS = `CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  session_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced INTEGER NOT NULL DEFAULT 0
)`;
const CREATE_EXERCISE_LOGS = `CREATE TABLE IF NOT EXISTS exercise_logs (
  id TEXT PRIMARY KEY,
  workout_session_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  style_id TEXT,
  style_name TEXT,
  estimated_1rm REAL,
  target_80 REAL,
  volume REAL,
  avg_reps REAL,
  time_to_complete INTEGER,
  logged_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced INTEGER NOT NULL DEFAULT 0
)`;
const CREATE_SET_LOGS = `CREATE TABLE IF NOT EXISTS set_logs (
  id TEXT PRIMARY KEY,
  exercise_log_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  set_time_sec INTEGER,
  rest_time_sec INTEGER,
  intensity_pct REAL,
  use_for_1rm INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced INTEGER NOT NULL DEFAULT 0
)`;
const CREATE_SYNC_OUTBOX = `CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;
const CREATE_SYNC_META = `CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;
const CREATE_API_CACHE = `CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;
const CREATE_BODY_METRICS = `CREATE TABLE IF NOT EXISTS body_metrics (
  date              TEXT PRIMARY KEY,
  weight_kg         REAL,
  body_fat_pct      REAL,
  steps             INTEGER,
  calories          INTEGER,
  protein_g         REAL,
  carbs_g           REAL,
  fat_g             REAL,
  water_ml          INTEGER,
  resting_heart_rate INTEGER,
  hrv_ms            REAL,
  spo2_pct          REAL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  sync_status       TEXT NOT NULL DEFAULT 'synced'
)`;
const CREATE_MOOD_LOGS = `CREATE TABLE IF NOT EXISTS mood_logs (
  log_date      TEXT PRIMARY KEY,
  energy_level  TEXT NOT NULL,
  sleep_quality TEXT NOT NULL,
  body_state    TEXT NOT NULL DEFAULT '[]',
  sore_muscles  TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'synced'
)`;
const CREATE_SLEEP_SESSIONS = `CREATE TABLE IF NOT EXISTS sleep_sessions (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  duration_hours    REAL,
  deep_sleep_hours  REAL,
  rem_sleep_hours   REAL,
  light_sleep_hours REAL,
  updated_at        TEXT NOT NULL
)`;
const CREATE_ACTIVITY_LOGS = `CREATE TABLE IF NOT EXISTS activity_logs (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  title         TEXT NOT NULL,
  duration_min  REAL,
  distance_km   REAL,
  updated_at    TEXT NOT NULL
)`;
// Every other activity_logs column is added through RECONCILE_COLUMNS rather than this
// base DDL — reconcile runs on every open, so it is what actually heals a device whose
// versioned upgrade partially applied. New columns go there, not here.
const CREATE_LOCAL_PROGRAMS = `CREATE TABLE IF NOT EXISTS local_programs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`;
const CREATE_LOCAL_PROGRESSION_STYLES = `CREATE TABLE IF NOT EXISTS local_progression_styles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const CREATE_MUTATIONS_OUTBOX = `CREATE TABLE IF NOT EXISTS mutations_outbox (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  domain     TEXT NOT NULL,
  date       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;
const CREATE_FOOD_LOGS = `CREATE TABLE IF NOT EXISTS food_logs (
  id                  TEXT PRIMARY KEY,
  date                TEXT NOT NULL,
  meal_type_id        TEXT NOT NULL,
  food_item_id        TEXT NOT NULL,
  -- BF-39. WHAT was eaten, and WHICH TIME. Two servings of one meal on a day share the first and
  -- differ in the second, so the diary groups on meal_group_id and names the group from saved_meal_id.
  -- On this side both are plain TEXT with no FK: the local store mirrors, it does not enforce.
  saved_meal_id       TEXT,
  meal_group_id       TEXT,
  -- BF-97. A scanned group has no saved_meal_id to be named from, so it carries its own name.
  meal_group_name     TEXT,
  quantity_multiplier REAL NOT NULL DEFAULT 1,
  logged_at           TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  sync_status         TEXT NOT NULL DEFAULT 'pending'
)`;
const CREATE_SUPPLEMENTS = `CREATE TABLE IF NOT EXISTS supplements (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  dose             TEXT,
  default_amount   REAL,
  unit             TEXT,
  reminder_enabled INTEGER NOT NULL DEFAULT 0,
  reminder_time    TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  sync_status      TEXT NOT NULL DEFAULT 'synced'
)`;
const CREATE_SUPPLEMENT_LOGS = `CREATE TABLE IF NOT EXISTS supplement_logs (
  id            TEXT PRIMARY KEY,
  supplement_id TEXT NOT NULL,
  log_date      TEXT NOT NULL,
  amount        REAL,
  unit          TEXT,
  dose_text     TEXT,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(supplement_id, log_date)
)`;
const CREATE_INJURIES = `CREATE TABLE IF NOT EXISTS injuries (
  id            TEXT PRIMARY KEY,
  muscle_name   TEXT NOT NULL,
  notes         TEXT,
  severity      TEXT NOT NULL,
  started_date  TEXT NOT NULL,
  resolved_date TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
)`;
// Offline-first saved meals: create/edit/delete offline, read local-first. The item
// rows reference food_items (already mirrored locally) so a meal renders + logs offline.
// Hydrated from the page's server fetch (clobber-gated on sync_status) — no delta domain.
// Meal Plan (Q-186). Names and macros are denormalised onto every row on purpose: the section has
// to RENDER offline, and a local table holding only ids repeats the food_logs -> food_items bug
// that was this project's worst data loss.
const CREATE_MEAL_PLANS = `CREATE TABLE IF NOT EXISTS meal_plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 0,
  meals_per_day     INTEGER NOT NULL,
  target_calories   INTEGER NOT NULL,
  target_protein_g  REAL NOT NULL,
  target_carbs_g    REAL NOT NULL,
  target_fat_g      REAL NOT NULL,
  training_time     TEXT,
  generated_at      TEXT NOT NULL,
  last_reviewed_at  TEXT,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  sync_status       TEXT NOT NULL DEFAULT 'synced'
)`;
const CREATE_MEAL_PLAN_VARIANTS = `CREATE TABLE IF NOT EXISTS meal_plan_variants (
  id                TEXT PRIMARY KEY,
  meal_plan_id      TEXT NOT NULL,
  day_type          TEXT NOT NULL,
  target_calories   INTEGER NOT NULL,
  target_protein_g  REAL NOT NULL,
  target_carbs_g    REAL NOT NULL,
  target_fat_g      REAL NOT NULL
)`;
const CREATE_MEAL_PLAN_MEALS = `CREATE TABLE IF NOT EXISTS meal_plan_meals (
  id                TEXT PRIMARY KEY,
  variant_id        TEXT NOT NULL,
  position          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  notes             TEXT,
  target_calories   INTEGER NOT NULL,
  target_protein_g  REAL NOT NULL,
  target_carbs_g    REAL NOT NULL,
  target_fat_g      REAL NOT NULL,
  -- JSON snapshot in the NutritionIngredient shape (Q-192). A local table of ids cannot render,
  -- which was the food_logs -> food_items data-loss bug; this holds the food itself.
  -- Reaches upgraded devices via RECONCILE_COLUMNS + the v24 ALTERs, never this body alone.
  ingredients       TEXT NOT NULL DEFAULT '[]',
  suggested_time    TEXT
)`;
// Q-187 phase 2. Declines only — "I ate it" is the food log itself. `sync_status` is what stops a
// pull clobbering an answer the user just gave offline: applyDelta only overwrites a row that is
// already 'synced'.
const CREATE_PLAN_MEAL_ANSWERS = `CREATE TABLE IF NOT EXISTS plan_meal_answers (
  id            TEXT PRIMARY KEY,
  plan_meal_id  TEXT NOT NULL,
  log_date      TEXT NOT NULL,
  answer        TEXT NOT NULL DEFAULT 'no',
  answered_at   TEXT,
  deleted_at    TEXT,
  updated_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
)`;
const CREATE_PLAN_MEAL_ANSWERS_IDX =
  `CREATE INDEX IF NOT EXISTS idx_plan_meal_answers_date ON plan_meal_answers(log_date)`;
const CREATE_MEAL_PLAN_VARIANTS_IDX =
  `CREATE INDEX IF NOT EXISTS idx_meal_plan_variants_plan ON meal_plan_variants(meal_plan_id)`;
const CREATE_MEAL_PLAN_MEALS_IDX =
  `CREATE INDEX IF NOT EXISTS idx_meal_plan_meals_variant ON meal_plan_meals(variant_id, position)`;

const CREATE_SAVED_MEALS = `CREATE TABLE IF NOT EXISTS saved_meals (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  servings       REAL NOT NULL DEFAULT 1,
  image_data_uri TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending'
)`;
const CREATE_SAVED_MEAL_ITEMS = `CREATE TABLE IF NOT EXISTS saved_meal_items (
  id                  TEXT PRIMARY KEY,
  saved_meal_id       TEXT NOT NULL,
  food_item_id        TEXT NOT NULL,
  quantity_multiplier REAL NOT NULL DEFAULT 1
)`;

// BF-11e — which meal types a saved meal is eligible for, mirrored locally so the tags render and
// write offline. A NEW table, which is the one case `CREATE TABLE IF NOT EXISTS` handles correctly
// on upgraded devices as well as fresh installs: the hazard that check-local-column-upgrade-path.js
// exists for is a COLUMN added to an existing table's CREATE body, where the IF NOT EXISTS makes the
// whole statement a no-op and the column never arrives.
const CREATE_SAVED_MEAL_MEAL_TYPES = `CREATE TABLE IF NOT EXISTS saved_meal_meal_types (
  saved_meal_id TEXT NOT NULL,
  meal_type_id  TEXT NOT NULL,
  PRIMARY KEY (saved_meal_id, meal_type_id)
)`;

// Local mirror of the evening/morning End of Day check-in so it renders and
// writes offline-first — the local store is the source of truth. One row per
// (log_date, phase). sore_muscles stored as JSON text like mood_logs.
const CREATE_DAY_CHECKINS = `CREATE TABLE IF NOT EXISTS day_checkins (
  log_date            TEXT NOT NULL,
  phase               TEXT NOT NULL DEFAULT 'evening',
  physical_tiredness  INTEGER,
  mental_drain        INTEGER,
  barely_moved        INTEGER,
  hydration           INTEGER,
  late_heavy_meal     INTEGER,
  sore_muscles        TEXT NOT NULL DEFAULT '[]',
  journal             TEXT,
  -- Q-387. A column added to a CREATE TABLE IF NOT EXISTS body reaches FRESH INSTALLS ONLY, so it
  -- also needs the v27 ALTER below and its RECONCILE_COLUMNS row — see the migrations rule.
  food_logging_completed_at TEXT,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  sync_status         TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (log_date, phase)
)`;

// Local mirror of cardio baseline / fitness-test results so they render and
// write offline-first — the local store is the source of truth.
const CREATE_FITNESS_TESTS = `CREATE TABLE IF NOT EXISTS fitness_tests (
  id            TEXT PRIMARY KEY,
  test_type     TEXT NOT NULL,
  date          TEXT NOT NULL,
  duration_sec  INTEGER,
  distance_m    REAL,
  avg_hr        INTEGER,
  max_hr        INTEGER,
  resting_hr    INTEGER,
  hrr1_bpm      INTEGER,
  vo2max_est    REAL,
  method        TEXT,
  notes         TEXT,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
)`;

const CREATE_PRESCRIBED_RUNS = `CREATE TABLE IF NOT EXISTS prescribed_runs (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT,
  date            TEXT NOT NULL,
  run_type        TEXT NOT NULL,
  duration_min    REAL,
  distance_km     REAL,
  target_hr_low   INTEGER,
  target_hr_high  INTEGER,
  target_zone_ids TEXT,
  rationale       TEXT,
  gate_action     TEXT,
  status          TEXT,
  activity_log_id TEXT,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'pending'
)`;

// Indexes accompanying the tables above (idempotent).
const RECONCILE_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_mutations_outbox_user ON mutations_outbox (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_body_metrics_updated ON body_metrics (updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mood_logs_updated ON mood_logs (updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sleep_sessions_date ON sleep_sessions (date)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs (date)`,
  `CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs (date)`,
  `CREATE INDEX IF NOT EXISTS idx_supplement_logs_date ON supplement_logs (log_date)`,
  `CREATE INDEX IF NOT EXISTS idx_injuries_started ON injuries (started_date)`,
  `CREATE INDEX IF NOT EXISTS idx_exercise_logs_session ON exercise_logs (workout_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_set_logs_exercise ON set_logs (exercise_log_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exercise_logs_name ON exercise_logs (exercise_name)`,
  `CREATE INDEX IF NOT EXISTS idx_oura_daily_day ON oura_daily (day)`,
  `CREATE INDEX IF NOT EXISTS idx_fitness_tests_date ON fitness_tests (date)`,
  `CREATE INDEX IF NOT EXISTS idx_prescribed_runs_date ON prescribed_runs (date)`,
  `CREATE INDEX IF NOT EXISTS idx_oura_bucket_date ON oura_bucket (local_date)`,
];

// Idempotent CREATE TABLE IF NOT EXISTS statements safe to re-run any time.
// This is a COMPLETE mirror of the persistent schema: every data/infra table any
// migration creates is here, so a reopen-at-v1 after a failed upgrade can restore
// whatever a partial upgrade dropped — not just the most recently added tables.
export const RECONCILE_TABLES: string[] = [
  CREATE_WORKOUT_SESSIONS, CREATE_EXERCISE_LOGS, CREATE_SET_LOGS,
  CREATE_SYNC_OUTBOX, CREATE_SYNC_META, CREATE_API_CACHE,
  CREATE_BODY_METRICS, CREATE_MOOD_LOGS, CREATE_SLEEP_SESSIONS,
  CREATE_ACTIVITY_LOGS, CREATE_LOCAL_PROGRAMS, CREATE_LOCAL_PROGRESSION_STYLES,
  CREATE_MUTATIONS_OUTBOX, CREATE_FOOD_LOGS, CREATE_SUPPLEMENTS,
  CREATE_SUPPLEMENT_LOGS, CREATE_INJURIES,
  CREATE_PERSONAL_RECORDS, CREATE_OURA_DAILY,
  CREATE_PROGRAM_SESSIONS, CREATE_SESSION_EXERCISES,
  CREATE_SCHEDULES, CREATE_SCHEDULE_DAYS, CREATE_STYLE_SETS,
  CREATE_PROGRAM_SESSIONS_IDX, CREATE_SESSION_EXERCISES_IDX,
  CREATE_SCHEDULES_IDX, CREATE_STYLE_SETS_IDX,
  CREATE_FOOD_ITEMS, CREATE_EXERCISE_LIBRARY,
  CREATE_DAY_CHECKINS,
  CREATE_FITNESS_TESTS,
  CREATE_PRESCRIBED_RUNS,
  CREATE_SAVED_MEALS, CREATE_SAVED_MEAL_ITEMS, CREATE_SAVED_MEAL_MEAL_TYPES,
  CREATE_MEAL_PLANS, CREATE_MEAL_PLAN_VARIANTS, CREATE_MEAL_PLAN_MEALS,
  CREATE_MEAL_PLAN_VARIANTS_IDX, CREATE_MEAL_PLAN_MEALS_IDX,
  CREATE_PLAN_MEAL_ANSWERS, CREATE_PLAN_MEAL_ANSWERS_IDX,
  CREATE_OURA_BUCKET, CREATE_OURA_DAILY_SUMMARY_LOCAL,
  CREATE_OURA_DAILY_DERIVED_LOCAL, CREATE_OURA_HEARTRATE_LOCAL,
  CREATE_MEAL_TYPES,
  ...RECONCILE_INDEXES,
];

// To add a new field: append { toVersion: N+1, statements: ['ALTER TABLE ...'] }.
// The plugin runs only statements for versions the device hasn't seen yet — no APK rebuild needed.
export const MIGRATIONS: UpgradeStatement[] = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS workout_sessions (
        id TEXT PRIMARY KEY,
        session_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS exercise_logs (
        id TEXT PRIMARY KEY,
        workout_session_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        style_id TEXT,
        style_name TEXT,
        estimated_1rm REAL,
        target_80 REAL,
        volume REAL,
        avg_reps REAL,
        time_to_complete INTEGER,
        logged_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS set_logs (
        id TEXT PRIMARY KEY,
        exercise_log_id TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        reps INTEGER NOT NULL,
        set_time_sec INTEGER,
        rest_time_sec INTEGER,
        intensity_pct REAL,
        use_for_1rm INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        synced INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    toVersion: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    ],
  },
  {
    toVersion: 3,
    statements: [
      `ALTER TABLE set_logs ADD COLUMN rpe INTEGER`,
    ],
  },
  {
    toVersion: 4,
    statements: [
      // NOTE: `PRAGMA journal_mode=WAL` must NOT live here — the plugin runs
      // upgrade statements inside a transaction, and SQLite throws "cannot change
      // into wal mode from within a transaction", which fails the entire upgrade
      // and leaves the local DB unopenable. WAL is set post-open in sqlite-service.
      `CREATE TABLE IF NOT EXISTS body_metrics (
        date              TEXT PRIMARY KEY,
        weight_kg         REAL,
        body_fat_pct      REAL,
        steps             INTEGER,
        calories          INTEGER,
        protein_g         REAL,
        carbs_g           REAL,
        fat_g             REAL,
        water_ml          INTEGER,
        resting_heart_rate INTEGER,
        hrv_ms            REAL,
        spo2_pct          REAL,
        updated_at        TEXT NOT NULL,
        deleted_at        TEXT,
        sync_status       TEXT NOT NULL DEFAULT 'synced'
      )`,

      `CREATE TABLE IF NOT EXISTS mood_logs (
        log_date      TEXT PRIMARY KEY,
        energy_level  TEXT NOT NULL,
        sleep_quality TEXT NOT NULL,
        body_state    TEXT NOT NULL DEFAULT '[]',
        sore_muscles  TEXT NOT NULL DEFAULT '[]',
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT,
        sync_status   TEXT NOT NULL DEFAULT 'synced'
      )`,

      `CREATE TABLE IF NOT EXISTS sleep_sessions (
        id                TEXT PRIMARY KEY,
        date              TEXT NOT NULL,
        duration_hours    REAL,
        deep_sleep_hours  REAL,
        rem_sleep_hours   REAL,
        light_sleep_hours REAL,
        updated_at        TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS activity_logs (
        id            TEXT PRIMARY KEY,
        date          TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        title         TEXT NOT NULL,
        duration_min  REAL,
        distance_km   REAL,
        updated_at    TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS local_programs (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS local_progression_styles (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS mutations_outbox (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        domain     TEXT NOT NULL,
        date       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,

      `CREATE INDEX IF NOT EXISTS idx_mutations_outbox_user ON mutations_outbox (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_body_metrics_updated ON body_metrics (updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_mood_logs_updated ON mood_logs (updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sleep_sessions_date ON sleep_sessions (date)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs (date)`,
    ],
  },
  {
    toVersion: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS food_logs (
        id                  TEXT PRIMARY KEY,
        date                TEXT NOT NULL,
        meal_type_id        TEXT NOT NULL,
        food_item_id        TEXT NOT NULL,
        quantity_multiplier REAL NOT NULL DEFAULT 1,
        logged_at           TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        deleted_at          TEXT,
        sync_status         TEXT NOT NULL DEFAULT 'pending'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs (date)`,

      `CREATE TABLE IF NOT EXISTS supplements (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        dose             TEXT,
        reminder_enabled INTEGER NOT NULL DEFAULT 0,
        reminder_time    TEXT,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        active           INTEGER NOT NULL DEFAULT 1,
        updated_at       TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS supplement_logs (
        id            TEXT PRIMARY KEY,
        supplement_id TEXT NOT NULL,
        log_date      TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT,
        sync_status   TEXT NOT NULL DEFAULT 'pending',
        UNIQUE(supplement_id, log_date)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_supplement_logs_date ON supplement_logs (log_date)`,

      `CREATE TABLE IF NOT EXISTS injuries (
        id            TEXT PRIMARY KEY,
        muscle_name   TEXT NOT NULL,
        notes         TEXT,
        severity      TEXT NOT NULL,
        started_date  TEXT NOT NULL,
        resolved_date TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT,
        sync_status   TEXT NOT NULL DEFAULT 'pending'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_injuries_started ON injuries (started_date)`,
    ],
  },
  {
    toVersion: 6,
    statements: [
      `ALTER TABLE activity_logs ADD COLUMN steps    INTEGER`,
      `ALTER TABLE activity_logs ADD COLUMN avg_hr   INTEGER`,
      `ALTER TABLE activity_logs ADD COLUMN max_hr   INTEGER`,
    ],
  },
  {
    toVersion: 7,
    statements: [
      // Extend legacy workout tables with sync_status + soft-delete
      `ALTER TABLE workout_sessions ADD COLUMN deleted_at  TEXT`,
      `ALTER TABLE workout_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,
      `ALTER TABLE exercise_logs   ADD COLUMN deleted_at  TEXT`,
      `ALTER TABLE exercise_logs   ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,
      `ALTER TABLE set_logs        ADD COLUMN deleted_at  TEXT`,
      `ALTER TABLE set_logs        ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,

      // New: local personal-records mirror (one row per exercise — all-time best)
      CREATE_PERSONAL_RECORDS,

      // New: Oura daily read-only cache (contributors stored as JSON text)
      CREATE_OURA_DAILY,

      // Indexes for join performance
      `CREATE INDEX IF NOT EXISTS idx_exercise_logs_session  ON exercise_logs (workout_session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_set_logs_exercise      ON set_logs (exercise_log_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exercise_logs_name     ON exercise_logs (exercise_name)`,
      `CREATE INDEX IF NOT EXISTS idx_oura_daily_day         ON oura_daily (day)`,
    ],
  },
  {
    toVersion: 8,
    statements: [
      // Columns the local-store writes/syncs were referencing but earlier
      // migrations never added (also covered by reconcileSchema as a backstop).
      `ALTER TABLE exercise_logs ADD COLUMN muscle_groups TEXT`,
      `ALTER TABLE exercise_logs ADD COLUMN inter_exercise_rest_sec INTEGER`,
      `ALTER TABLE set_logs ADD COLUMN set_start_ms INTEGER`,
      `ALTER TABLE set_logs ADD COLUMN set_end_ms INTEGER`,
    ],
  },
  {
    toVersion: 9,
    statements: [
      // Program-structure mirror so the workout screen can render sessions,
      // exercises, schedule and per-set progression from the local store offline.
      // Extend the v4 local_programs stub with the columns the screen reads.
      `ALTER TABLE local_programs ADD COLUMN phase_mode TEXT NOT NULL DEFAULT 'manual'`,
      `ALTER TABLE local_programs ADD COLUMN training_goal TEXT NOT NULL DEFAULT 'strength'`,
      `ALTER TABLE local_programs ADD COLUMN started_at TEXT`,
      `ALTER TABLE local_programs ADD COLUMN sessions_per_cycle INTEGER`,
      `ALTER TABLE local_programs ADD COLUMN total_weeks INTEGER`,
      `ALTER TABLE local_programs ADD COLUMN auto_apply_prescriptions INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE local_programs ADD COLUMN created_at TEXT`,

      CREATE_PROGRAM_SESSIONS,
      CREATE_SESSION_EXERCISES,
      CREATE_SCHEDULES,
      CREATE_SCHEDULE_DAYS,
      CREATE_STYLE_SETS,

      CREATE_PROGRAM_SESSIONS_IDX,
      CREATE_SESSION_EXERCISES_IDX,
      CREATE_SCHEDULES_IDX,
      CREATE_STYLE_SETS_IDX,
    ],
  },
  {
    toVersion: 10,
    statements: [
      // Local food-item mirror so food logs render offline-first (name/macros)
      // instead of the page having to read them from the server.
      CREATE_FOOD_ITEMS,
    ],
  },
  {
    toVersion: 11,
    statements: [
      // Display columns the activity history card renders — the local store
      // needs them to render activity logs offline (source-of-truth read).
      `ALTER TABLE activity_logs ADD COLUMN calories_burned REAL`,
      `ALTER TABLE activity_logs ADD COLUMN start_time TEXT`,
    ],
  },
  {
    toVersion: 12,
    statements: [
      // Local End of Day check-in mirror so the review renders/writes offline-first.
      CREATE_DAY_CHECKINS,
    ],
  },
  {
    toVersion: 13,
    statements: [
      // Outbox retry accounting: attempts + last_error + dead-letter status +
      // exponential next_retry_at, so a poisoned mutation stops silently
      // retrying forever and becomes visible/recoverable in the sync-health UI.
      `ALTER TABLE mutations_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE mutations_outbox ADD COLUMN last_error TEXT`,
      `ALTER TABLE mutations_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE mutations_outbox ADD COLUMN next_retry_at TEXT`,
      // Pull-clobber guard for offline activity edits (applyDelta checks it).
      `ALTER TABLE activity_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,
    ],
  },
  {
    toVersion: 14,
    statements: [
      // Cardio baseline / fitness-test results — offline-first synced domain.
      CREATE_FITNESS_TESTS,
    ],
  },
  {
    toVersion: 15,
    statements: [
      // Running-prescription plan: prescribed runs whose completion is offline-first.
      CREATE_PRESCRIBED_RUNS,
    ],
  },
  {
    toVersion: 16,
    statements: [
      // Offline-first saved meals (create/edit/delete offline, read local-first).
      CREATE_SAVED_MEALS,
      CREATE_SAVED_MEAL_ITEMS,
      CREATE_SAVED_MEAL_MEAL_TYPES,
    ],
  },
  {
    toVersion: 17,
    statements: [
      // Oura raw-on-device: local calculated-form tables (the tiered bucket store +
      // finished daily/nightly mirrors). Raw body_hex stays in the native oura_raw.db.
      CREATE_OURA_BUCKET,
      CREATE_OURA_DAILY_SUMMARY_LOCAL,
      CREATE_OURA_DAILY_DERIVED_LOCAL,
      CREATE_OURA_HEARTRATE_LOCAL,
    ],
  },
  {
    toVersion: 18,
    statements: [
      // Corrective (confirmation-review fixes): a v17 device created these three tables
      // with the wrong bucket PK (ring-decisecond counter — resets on re-key/dead battery
      // → collides + silently overwrites forever-tiers) and column types/columns that
      // drifted from the server tables they mirror. The tables are empty + unread (the
      // rollup that writes them isn't built yet), so drop + recreate with the corrected
      // schema is a no-data operation. oura_heartrate was already correct — left as is.
      `DROP TABLE IF EXISTS oura_bucket`,
      `DROP TABLE IF EXISTS oura_daily_summary`,
      `DROP TABLE IF EXISTS oura_daily_derived`,
      CREATE_OURA_BUCKET,
      CREATE_OURA_DAILY_SUMMARY_LOCAL,
      CREATE_OURA_DAILY_DERIVED_LOCAL,
    ],
  },
  {
    toVersion: 19,
    statements: [
      // Q-14: the prescribed rep target, kept alongside planned_pct so a stranded replay
      // re-sends the style it was actually given. ADD COLUMN is not idempotent, so a
      // retried partial upgrade would throw "duplicate column" and roll the whole version
      // back — RECONCILE_COLUMNS below carries the same row and is the real authority.
      `ALTER TABLE set_logs ADD COLUMN planned_reps INTEGER`,
    ],
  },
  {
    toVersion: 20,
    statements: [
      // Q-20: the reference table an offline program/log read needs to render its rows.
      CREATE_EXERCISE_LIBRARY,
    ],
  },
  {
    toVersion: 21,
    statements: [
      // The reference table an offline food-log read needs to group under a meal-type name/emoji.
      CREATE_MEAL_TYPES,
    ],
  },
  {
    toVersion: 22,
    statements: [
      // Q-124: the two columns every other write domain's applyDelta arm gates on. Without them
      // supplements could not have a pull-clobber guard at all. ADD COLUMN is not idempotent, so a
      // retried partial upgrade throws "duplicate column" — RECONCILE_COLUMNS carries both rows and
      // is the real authority.
      `ALTER TABLE supplements ADD COLUMN deleted_at TEXT`,
      `ALTER TABLE supplements ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,
    ],
  },
  {
    toVersion: 23,
    statements: [
      // Q-186. Table creation only — no ALTER — so a retried partial upgrade is a no-op rather
      // than a rollback. All three are in RECONCILE_TABLES, which is the real authority once an
      // upgrade has partially applied.
      CREATE_MEAL_PLANS,
      CREATE_MEAL_PLAN_VARIANTS,
      CREATE_MEAL_PLAN_MEALS,
      CREATE_MEAL_PLAN_VARIANTS_IDX,
      CREATE_MEAL_PLAN_MEALS_IDX,
    ],
  },
  {
    toVersion: 24,
    statements: [
      // Q-192. A device that already has meal_plan_meals from v23 needs these as ALTERs — adding
      // them to the CREATE body alone would reach fresh installs only, and never the phone that
      // already ran v23. ALTER is not idempotent, so a retried partial upgrade throws "duplicate
      // column"; RECONCILE_COLUMNS carries both and is the real authority after that.
      `ALTER TABLE meal_plan_meals ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE meal_plan_meals ADD COLUMN suggested_time TEXT`,
    ],
  },
  {
    toVersion: 25,
    statements: [
      // How many portions a saved meal makes. Same three-part rule as v24: the ALTER here for a
      // device already holding saved_meals, the column in the CREATE body for fresh installs, and
      // the RECONCILE_COLUMNS row that is the real authority if this upgrade half-applies.
      // DEFAULT 1 so every meal that already exists keeps behaving as a single portion.
      `ALTER TABLE saved_meals ADD COLUMN servings REAL NOT NULL DEFAULT 1`,
    ],
  },
  {
    toVersion: 26,
    statements: [
      // A whole new table, so `CREATE TABLE IF NOT EXISTS` is idempotent on its own and needs no
      // ALTER counterpart — unlike v24/v25, which added columns to tables devices already had.
      CREATE_PLAN_MEAL_ANSWERS,
      CREATE_PLAN_MEAL_ANSWERS_IDX,
    ],
  },
  {
    toVersion: 27,
    statements: [
      // Q-387. `day_checkins` already exists on every upgraded device, so the CREATE TABLE body
      // above is a no-op for them — this ALTER is the only thing that reaches them, and the
      // RECONCILE_COLUMNS row is the authority if this upgrade half-applies.
      `ALTER TABLE day_checkins ADD COLUMN food_logging_completed_at TEXT`,
    ],
  },
  {
    toVersion: 28,
    statements: [
      // Q-396. Same shape as v27: `saved_meals` exists on every upgraded device, so the column added
      // to the CREATE TABLE body above reaches fresh installs ONLY — this ALTER is what reaches
      // everyone else, and the RECONCILE_COLUMNS row is the authority if the upgrade half-applies.
      `ALTER TABLE saved_meals ADD COLUMN image_data_uri TEXT`,
    ],
  },
  {
    toVersion: 29,
    statements: [
      // BF-11e. A new TABLE, not a column — so unlike v27 and v28 above, the `CREATE TABLE IF NOT
      // EXISTS` in the fresh-install list is not a no-op for upgraded devices, because the table is
      // not there yet. Repeating it here is what makes an upgraded device get it; it is also
      // idempotent, so a retried partial upgrade cannot throw the way a duplicate ADD COLUMN does.
      CREATE_SAVED_MEAL_MEAL_TYPES,
    ],
  },
  {
    toVersion: 30,
    statements: [
      // BF-35. Same shape as v27/v28: `food_items` exists on every upgraded device, so the column
      // added to the CREATE TABLE body above reaches fresh installs ONLY — this ALTER is what
      // reaches everyone else, and the RECONCILE_COLUMNS row is the authority if it half-applies.
      `ALTER TABLE food_items ADD COLUMN image_data_uri TEXT`,
    ],
  },
  {
    toVersion: 31,
    statements: [
      // BF-39. Same shape again, and for the same reason: `food_logs` exists on every upgraded
      // device, so `CREATE TABLE IF NOT EXISTS` is a no-op there and the columns added to its body
      // above would reach fresh installs ONLY. These ALTERs reach everyone else; the two
      // RECONCILE_COLUMNS rows are the authority if this upgrade half-applies.
      `ALTER TABLE food_logs ADD COLUMN saved_meal_id TEXT`,
      `ALTER TABLE food_logs ADD COLUMN meal_group_id TEXT`,
    ],
  },
  {
    toVersion: 32,
    statements: [
      // BF-3. Same shape as v30/v31, and for the same reason: both tables exist on every upgraded
      // device, so `CREATE TABLE IF NOT EXISTS` is a no-op there and the columns added to their
      // bodies above would reach fresh installs ONLY. These ALTERs reach everyone else; the five
      // RECONCILE_COLUMNS rows are the authority if this upgrade half-applies.
      `ALTER TABLE supplement_logs ADD COLUMN amount REAL`,
      `ALTER TABLE supplement_logs ADD COLUMN unit TEXT`,
      `ALTER TABLE supplement_logs ADD COLUMN dose_text TEXT`,
      `ALTER TABLE supplements ADD COLUMN default_amount REAL`,
      `ALTER TABLE supplements ADD COLUMN unit TEXT`,
    ],
  },
  {
    toVersion: 33,
    statements: [
      // BF-97. Same shape as v30/v31/v32, and for the same reason: `food_logs` exists on every
      // upgraded device, so the column added to its `CREATE TABLE IF NOT EXISTS` body above reaches
      // fresh installs ONLY. This ALTER reaches everyone else; the RECONCILE_COLUMNS row is the
      // authority if this upgrade half-applies.
      `ALTER TABLE food_logs ADD COLUMN meal_group_name TEXT`,
    ],
  },
];
