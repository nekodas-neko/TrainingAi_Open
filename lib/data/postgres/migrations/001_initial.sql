-- TrainingAI — PostgreSQL schema
-- All CREATE TABLE statements use IF NOT EXISTS.
-- ALTER TABLE statements handle columns added after initial deploy.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT        PRIMARY KEY,   -- Google OAuth sub claim
  email      TEXT        NOT NULL,
  name       TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- ── Progression Styles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progression_styles (
  id      UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT  NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS style_sets (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id    UUID    NOT NULL REFERENCES progression_styles(id) ON DELETE CASCADE,
  set_number  INTEGER NOT NULL,
  pct         FLOAT   NOT NULL,
  reps        INTEGER NOT NULL,
  rest_sec    INTEGER NOT NULL DEFAULT 90,
  use_for_1rm BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (style_id, set_number)
);

-- ── Programs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS program_sessions (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID    NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,  -- 0-indexed rotation order
  UNIQUE (program_id, position)
);

CREATE TABLE IF NOT EXISTS session_exercises (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID    NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  exercise_name TEXT    NOT NULL,
  style_id      UUID    REFERENCES progression_styles(id) ON DELETE SET NULL,
  muscle_groups TEXT[]  NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL,
  UNIQUE (session_id, position)
);

-- ── Schedules ─────────────────────────────────────────────────────────────────
-- type='rotation' : sessions rotate by position; rest_after_n workouts → rest day
-- type='weekly'   : schedule_days maps day-of-week to a session (null = rotate)
CREATE TABLE IF NOT EXISTS schedules (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   UUID    NOT NULL UNIQUE REFERENCES programs(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('rotation', 'weekly')),
  rest_after_n INTEGER             -- rotation only: null = no rest days
);

-- Used only for type='weekly'.
-- session_id = null → rotate that day based on last workout.
-- A day not present in this table = rest day.
CREATE TABLE IF NOT EXISTS schedule_days (
  schedule_id UUID    NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Mon, 6=Sun
  session_id  UUID    REFERENCES program_sessions(id) ON DELETE SET NULL,
  PRIMARY KEY (schedule_id, day_of_week)
);

-- ── Workout Logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id   UUID        REFERENCES program_sessions(id) ON DELETE SET NULL,
  session_name TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID        NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_name      TEXT        NOT NULL,
  style_id           UUID        REFERENCES progression_styles(id) ON DELETE SET NULL,
  style_name         TEXT,
  estimated_1rm      FLOAT,
  target_80          FLOAT,
  volume             FLOAT,
  avg_reps           FLOAT,
  time_to_complete   INTEGER,
  muscle_groups      TEXT[]      NOT NULL DEFAULT '{}',
  logged_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS set_logs (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_log_id UUID    NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  set_number      INTEGER NOT NULL,
  weight_kg       FLOAT   NOT NULL,
  reps            INTEGER NOT NULL,
  set_time_sec    INTEGER,
  rest_time_sec   INTEGER,
  intensity_pct   FLOAT,
  use_for_1rm     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (exercise_log_id, set_number)
);

-- ── Body Metrics ──────────────────────────────────────────────────────────────
-- One row per user per day. All fields nullable — filled in as data becomes available.
-- Health Connect, manual entry, and nutrition apps all write here.
CREATE TABLE IF NOT EXISTS body_metrics (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         DATE  NOT NULL,
  weight_kg    FLOAT,
  body_fat_pct FLOAT,
  calories     INTEGER,
  protein_g    FLOAT,
  carbs_g      FLOAT,
  fat_g        FLOAT,
  steps        INTEGER,
  distance_km  FLOAT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- ── Cardio / Activity Sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cardio_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE        NOT NULL,
  title           TEXT        NOT NULL,
  start_time      TIME,
  end_time        TIME,
  duration_min    FLOAT,
  calories_burned FLOAT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ws_user_started ON workout_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_el_ws           ON exercise_logs (workout_session_id);
CREATE INDEX IF NOT EXISTS idx_el_name_date    ON exercise_logs (exercise_name, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_sl_el           ON set_logs (exercise_log_id);
CREATE INDEX IF NOT EXISTS idx_programs_user   ON programs (user_id);
CREATE INDEX IF NOT EXISTS idx_ps_program_pos  ON program_sessions (program_id, position);
CREATE INDEX IF NOT EXISTS idx_style_user      ON progression_styles (user_id);
CREATE INDEX IF NOT EXISTS idx_bm_user_date    ON body_metrics (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cs_user_date    ON cardio_sessions (user_id, date DESC);
