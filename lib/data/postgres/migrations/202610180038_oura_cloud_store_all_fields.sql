-- issue 2982 (batch 1 of #2860) — somewhere to keep the Oura Cloud fields the connector receives and
-- drops today. Storage only: nothing reads these yet, and no score, formula or scoring input changes.
--
-- Field names are the pinned spec's (`.claude/skills/oura-api/references/openapi-v1.34.json`). The
-- writers land in the follow-up PR; this file only makes room for them.
--
-- What this does:
--   1. CREATE TABLE oura_cloud_sleep_periods — one row per Oura sleep period (`PublicModifiedSleepModel`),
--      every type including `rest`, keyed (user_id, oura_id). `oura_id` is the same id
--      `sleep_sessions.oura_id` holds for a Cloud night, so the two join on it. Holds `type` (nap vs
--      night), the `heart_rate` and `hrv` series (`PublicSample`: `interval`, `items`, `timestamp`,
--      stored as Oura sent them, because the spec does not state the interval), the 30-second
--      hypnogram and movement strings, `sleep_algorithm_version`, `low_battery_alert`,
--      `sleep_analysis_reason`, `period` and `ring_id`.
--   2. CREATE TABLE oura_cloud_daily — one row per (user_id, date) for `PublicDailyActivity`'s `met`
--      series, `class_5_min`, `inactivity_alerts`, `sedentary_met_minutes` and Oura's own goals
--      (`target_calories`, `target_meters`, `meters_to_target`), Oura's readiness, sleep and
--      activity contributors, and `daily_stress.day_summary`. `oura_daily.day_summary` exists, but
--      the Readiness screen shows it and the AI planner's context reads it, so writing Oura's label
--      there would change both; it lands here until #2860 decides.
--   3. CREATE TABLE oura_sessions — one row per Oura session (`PublicSession`: breathing, meditation,
--      nap …) with its heart-rate, HRV and motion series and mood. The `session` scope is already
--      granted.
--   4. ALTER TABLE oura_heartrate ADD COLUMN context — Oura's label for a sample (`awake`, `rest`,
--      `sleep`, `workout`, `live`, `session`). `source` stays our provenance (`oura_cloud`, the ring,
--      an aggregator), which the source ladder ranks on, so the label needs a column of its own.
--   5. ALTER TABLE oura_workouts ADD COLUMN label — the user's own name for a workout.
--
-- Why new tables rather than columns on `sleep_sessions` and `oura_daily`: both are read whole
-- (`select()`) by the server routes and the device pull, so a night's series or a day's per-minute
-- MET array would ride along on every read of a table the screens use. And Oura's contributors must
-- stay out of `oura_daily.*_contributors`: those columns are what the Sleep and Activity screens
-- show, and they hold ours. A separate table keeps "no screen reads this" true by construction.
--
-- Vendor enums (`type`, `context`, mood …) carry no CHECK: the connector's Zod schema decides what is
-- accepted, and a value Oura adds later should fail its parse, not a database write mid-batch.
--
-- Additive only: new tables, and nullable columns with no default on the two existing tables, which
-- is a catalog-only change with no rewrite. No row is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_heartrate or oura_workouts makes this give up (and
-- ensureSchema retry it on the next boot) rather than queue the heart-rate writers behind it;
-- `statement_timeout` as a backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only what the connector wrote into them):
--   DROP TABLE oura_cloud_sleep_periods; DROP TABLE oura_cloud_daily; DROP TABLE oura_sessions;
--   DROP VIEW IF EXISTS claude_ro.oura_heartrate; ALTER TABLE oura_heartrate DROP COLUMN context;
--   DROP VIEW IF EXISTS claude_ro.oura_workouts; ALTER TABLE oura_workouts DROP COLUMN label;
--   (those views select the columns, so each DROP COLUMN fails without its DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS oura_cloud_sleep_periods (
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oura_id                 text NOT NULL,
  day                     date NOT NULL,
  bedtime_start           timestamptz,
  bedtime_end             timestamptz,
  sleep_type              text,
  heart_rate              jsonb,
  hrv                     jsonb,
  sleep_phase_30_sec      text,
  movement_30_sec         text,
  sleep_algorithm_version text,
  low_battery_alert       boolean,
  sleep_analysis_reason   text,
  period                  integer,
  ring_id                 text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, oura_id)
);
CREATE INDEX IF NOT EXISTS oura_cloud_sleep_periods_user_day_idx ON oura_cloud_sleep_periods (user_id, day);

CREATE TABLE IF NOT EXISTS oura_cloud_daily (
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                   date NOT NULL,
  met                    jsonb,
  class_5_min            text,
  inactivity_alerts      integer,
  sedentary_met_minutes  integer,
  target_calories        integer,
  target_meters          integer,
  meters_to_target       integer,
  readiness_contributors jsonb,
  sleep_contributors     jsonb,
  activity_contributors  jsonb,
  day_summary            text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS oura_sessions (
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oura_id                text NOT NULL,
  day                    date NOT NULL,
  session_type           text,
  start_datetime         timestamptz,
  end_datetime           timestamptz,
  mood                   text,
  heart_rate             jsonb,
  heart_rate_variability jsonb,
  motion_count           jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, oura_id)
);
CREATE INDEX IF NOT EXISTS oura_sessions_user_day_idx ON oura_sessions (user_id, day);

ALTER TABLE oura_heartrate ADD COLUMN IF NOT EXISTS context text;
ALTER TABLE oura_workouts ADD COLUMN IF NOT EXISTS label text;
