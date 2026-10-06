-- #2478. Automatic walk detection's funnel, recorded server-side.
--
-- Found by #2471 (detection is right about one time in ten). Probes, confirmations, the "Activity
-- detected" notification and dismissals happened only on the phone, so nobody could count how many
-- probes became sessions, how many sessions the owner kept, or which gate turned each one away.
--
-- One DETECTION is one GPS probe (or, with no motion sensor, one session under always-on GPS). Its
-- id is a UUID the phone mints when the probe starts, and every event of that detection carries it.
-- Each detection emits each KIND at most once, so (user_id, detection_id, kind) is the natural key:
-- the phone retries a failed post with the same rows and the insert ignores the repeats.
--
-- Kinds, in funnel order:
--   candidate  GPS probe started. gate = what armed it (ring_gait_window, phone_motion, always_on_gps)
--   confirmed  a session started.  gate = ring_cadence or gps_speed
--   notified   the notification fired. gate = which notify rule passed it
--   offered    the session passed the save-quality gates and became a confirm card. gate = quality_gates
--   saved      the user saved it from the review sheet. gate = user_review
--   dismissed  it ended without a save. gate = the rule that ended it (probe_timeout, min_distance,
--              motorised_p80, session_owned, user_card, user_review, ...)
--
-- `kind` and `gate` are free text, like `strap_status.state`: the route validates them, and a new
-- gate must be recordable without a migration. `occurred_at` is the phone's clock (events are
-- queued and can post minutes later); `recorded_at` is the server's.
--
-- Additive: a new table and its indexes, nothing else touched.
CREATE TABLE IF NOT EXISTS detection_events (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detection_id      UUID NOT NULL,
  kind              TEXT NOT NULL,
  gate              TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- What armed or confirmed the detection: 'ring' or 'sensor'.
  trigger_source    TEXT,
  activity_type     TEXT,
  session_start_at  TIMESTAMPTZ,
  distance_m        DOUBLE PRECISION,
  elapsed_sec       DOUBLE PRECISION,
  point_count       INTEGER,
  avg_speed_ms      DOUBLE PRECISION
);

CREATE UNIQUE INDEX IF NOT EXISTS detection_events_user_detection_kind_uq
  ON detection_events (user_id, detection_id, kind);

CREATE INDEX IF NOT EXISTS detection_events_user_time_idx
  ON detection_events (user_id, occurred_at DESC);

COMMENT ON TABLE detection_events IS
  '#2478: walk auto-detection funnel (candidate, confirmed, notified, offered, saved, dismissed), '
  'one row per kind per detection_id, with the gate that decided it. occurred_at is device time.';
