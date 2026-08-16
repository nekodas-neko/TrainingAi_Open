-- 124_rr_intervals.sql
-- Beat-to-beat RR intervals from the chest strap (Polar H10). One row per beat;
-- `at` is the beat's wall-clock time derived from the notification receive time.
-- Raw material for HRV (rMSSD) — derived on read, never stored (Stored Counters rule).
CREATE TABLE IF NOT EXISTS rr_intervals (
  id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL,
  rr_ms   INTEGER     NOT NULL,
  source  TEXT        NOT NULL DEFAULT 'chest_strap',
  UNIQUE(user_id, at)
);

CREATE INDEX IF NOT EXISTS rr_intervals_user_at ON rr_intervals(user_id, at);
