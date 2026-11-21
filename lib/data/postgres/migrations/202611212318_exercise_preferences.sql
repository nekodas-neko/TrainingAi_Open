-- #3896 step 3 — somewhere to keep what a person has chosen for one lift: a rep range, a rest, a
-- one-shot "lighter or heavier next time" step and a one-shot ±1 set. Per the owner (20 Nov): a
-- preference applies per lift in every session it appears in (D1), lasts until changed (D2), and
-- "lighter / heavier next time" is one plate step (D5). Nothing reads or writes this table yet: the
-- clamp that enforces it is step 4, the Coach domain that writes it is step 5.
--
-- What this does:
--   1. CREATE TABLE exercise_preferences — one row per user and lift, modelled on exercise_estimates
--      (migration 159): the same key, user_id + exercise_name, with exercise_id carried beside it.
--      Reader code matches on exercise_id first and falls back to the name, exactly as that table's
--      comment says, so the name -> id move lands without another migration.
--   2. A partial unique index on (user_id, exercise_id), so a lift with an id cannot hold two rows.
--
-- "No preference" is never a magic number: every preference column is nullable, and a row with
-- nothing set (or no row) means the program as written.
--   rep_min / rep_max   a lasting rep range. Both set or both null. 1 <= rep_min <= rep_max <= 30
--                       (30 is the prescription schema's rep ceiling). The Zod bound in the writer is
--                       tighter (3-30, span of 3); the table only refuses nonsense.
--   rest_sec            a lasting rest between sets, seconds, >= 0.
--   next_load_step      one-shot: 'lighter' or 'heavier', one plate step (weightStepFor). NULL = none.
--   sets_delta          one-shot: -1 or +1 set. NULL = none.
--   one_shot_set_at     when either one-shot was last written. Set exactly when a one-shot is present.
--                       A one-shot is consumed once: the first completed log of this lift with
--                       logged_at after one_shot_set_at applies it, and the same write sets
--                       next_load_step, sets_delta and one_shot_set_at back to NULL. No second table.
--   source              who wrote the row: 'coach', 'checkin' (#3890's Heavy / Light) or 'editor'.
--   deleted_at          tombstone for a cleared preference (CLAUDE.md offline-first rule: a hard delete
--                       is invisible to a device that has not synced). The unique key still covers a
--                       tombstoned row, so setting the preference again revives it instead of adding one.
--
-- Additive only: one new table and its indexes. No existing table is altered (not session_exercises,
-- which every program save rewrites) and no row is changed, backfilled or deleted. No device copy.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only what the table holds; it is empty until step 5 ships):
--   DROP VIEW IF EXISTS claude_ro.exercise_preferences;
--   DROP TABLE exercise_preferences;
--   (the view selects every column, so DROP TABLE fails without the view dropped first; the boot
--   rebuild recreates a view from claude-ro-views.sql only while its table exists, so remove the
--   view from that file in the same revert)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS exercise_preferences (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id     uuid             REFERENCES exercise_library(id) ON DELETE SET NULL,
  exercise_name   text             NOT NULL CHECK (exercise_name <> ''),
  rep_min         smallint,
  rep_max         smallint,
  rest_sec        integer,
  next_load_step  text,
  sets_delta      smallint,
  one_shot_set_at timestamptz,
  source          text             NOT NULL,
  deleted_at      timestamptz,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT exercise_preferences_lift_key UNIQUE (user_id, exercise_name),
  CONSTRAINT exercise_preferences_rep_range_check CHECK (
    (rep_min IS NULL AND rep_max IS NULL)
    OR (rep_min IS NOT NULL AND rep_max IS NOT NULL AND rep_min >= 1 AND rep_min <= rep_max AND rep_max <= 30)
  ),
  CONSTRAINT exercise_preferences_rest_sec_check CHECK (rest_sec IS NULL OR rest_sec >= 0),
  CONSTRAINT exercise_preferences_next_load_step_check CHECK (next_load_step IS NULL OR next_load_step IN ('lighter', 'heavier')),
  CONSTRAINT exercise_preferences_sets_delta_check CHECK (sets_delta IS NULL OR sets_delta IN (-1, 1)),
  CONSTRAINT exercise_preferences_one_shot_check CHECK (
    ((next_load_step IS NOT NULL OR sets_delta IS NOT NULL) AND one_shot_set_at IS NOT NULL)
    OR (next_load_step IS NULL AND sets_delta IS NULL AND one_shot_set_at IS NULL)
  ),
  CONSTRAINT exercise_preferences_source_check CHECK (source IN ('coach', 'checkin', 'editor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS exercise_preferences_user_exercise_id_key
  ON exercise_preferences (user_id, exercise_id) WHERE exercise_id IS NOT NULL;
