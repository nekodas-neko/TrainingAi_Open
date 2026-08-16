-- Per-workout HR summary snapshot (review H-3 / Design-notes Lever W).
-- avg/peak/HRR1/workout-HRV are recomputed live from oura_heartrate + rr_intervals on every recap
-- view today, so the 180-day HR prune (and the 90-day rr prune added alongside) silently erases them
-- for older workouts — strap-sourced rows are not re-derivable from anything. This table is the
-- durable Tier-2 record: computed on first ready view and persisted, so old recaps keep their numbers
-- after the raw series thins. Additive; no resolution lost.
CREATE TABLE IF NOT EXISTS workout_hr_stats (
  workout_session_id uuid PRIMARY KEY REFERENCES workout_sessions(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avg_bpm            integer,
  peak_bpm           integer,
  hrr1_best          integer,
  workout_hrv_ms     integer,
  readings_count     integer NOT NULL DEFAULT 0,
  source             text,
  computed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_hr_stats_user_idx ON workout_hr_stats(user_id);
