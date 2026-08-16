-- Per-SET HR metric snapshot (owner-directed 2026-07-21; plan 2026-07-21-per-set-hr-metrics).
-- The sibling of workout_hr_stats (migration 135): per-workout stats are durable there, but the
-- per-set detail (peak/avg HR during each set, the beat-drop during the following rest, and how long
-- HR takes to return toward baseline) is recomputed live on every recap and then discarded. The 180d
-- oura_heartrate prune therefore erases it for older workouts. This table is the durable per-set
-- record: computed on first ready recap view (and by the admin backfill) and persisted, so per-set
-- and per-exercise HR trends survive the raw-series thinning. Server-derived, NOT an offline-sync
-- domain. Additive; no resolution lost.
--
-- Trend dimensions (exercise / phase / intensity %) are DENORMALISED here at compute time so
-- per-exercise trend queries are a single-table scan and keep working even after the raw HR and even
-- the parent set_logs rows change.
CREATE TABLE IF NOT EXISTS set_hr_stats (
  set_log_id           uuid PRIMARY KEY REFERENCES set_logs(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_session_id   uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_log_id      uuid REFERENCES exercise_logs(id) ON DELETE CASCADE,
  -- denormalised trend dimensions (snapshot at compute) --
  exercise_id          uuid,
  exercise_name        text NOT NULL,
  phase_type           text,
  set_number           integer NOT NULL,
  intensity_pct        double precision,
  planned_pct          double precision,
  rest_taken_sec       integer,
  planned_rest_sec     integer,
  logged_at            timestamptz,
  -- HR during the set --
  peak_bpm             integer,
  avg_bpm              integer,
  bpm_at_end           integer,
  -- drop during the rest that follows (the "HR drops X beats" curve) --
  drop_30s             integer,
  drop_60s             integer,
  drop_90s             integer,
  drop_120s            integer,
  trough_bpm           integer,
  -- time-to-recover, all three "recovered" definitions (owner: capture all three) --
  sec_to_preset        integer,          -- s until HR ≤ the pre-set baseline HR
  recovered_preset     boolean,          -- reached pre-set within the rest window? (censoring flag)
  sec_to_resting       integer,          -- s until HR ≤ the day's resting HR
  recovered_resting    boolean,
  pct_hrr_at_rest_end  double precision, -- %HRR recovered from peak by the time the next set began
  sec_to_hrr50         integer,          -- s to cross 50% HRR recovered
  -- rest sufficiency (CARDIOVASCULAR only — not CNS/neuromuscular readiness) --
  rest_adequate        boolean,
  -- data quality --
  readings_count       integer NOT NULL DEFAULT 0,
  coverage_ok          boolean NOT NULL DEFAULT false,
  source               text,
  computed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS set_hr_stats_user_idx ON set_hr_stats(user_id);
-- The per-exercise trend query: WHERE user_id = ? AND exercise_id = ? ORDER BY logged_at.
CREATE INDEX IF NOT EXISTS set_hr_stats_user_exercise_idx ON set_hr_stats(user_id, exercise_id, logged_at);
CREATE INDEX IF NOT EXISTS set_hr_stats_user_exercise_name_idx ON set_hr_stats(user_id, exercise_name, logged_at);
CREATE INDEX IF NOT EXISTS set_hr_stats_session_idx ON set_hr_stats(workout_session_id);
