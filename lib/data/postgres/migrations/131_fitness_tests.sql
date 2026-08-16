-- lib/data/postgres/migrations/131_fitness_tests.sql
-- Cardio baseline / fitness-test results. One row per completed guided test.
-- Offline-first synced domain (mirrors activity_logs): soft-delete via deleted_at,
-- getSyncDelta emits deletedAt so cross-device deletes propagate. `date` is the
-- user's local day (todayInTz), not UTC.
CREATE TABLE IF NOT EXISTS fitness_tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_type     TEXT NOT NULL,               -- FitnessTestId: '6mwt' | 'cooper12' | 'resting_hrr'
  date          DATE NOT NULL,               -- user-local day
  duration_sec  INTEGER,
  distance_m    DOUBLE PRECISION,
  avg_hr        INTEGER,
  max_hr        INTEGER,
  resting_hr    INTEGER,
  hrr1_bpm      INTEGER,
  vo2max_est    DOUBLE PRECISION,
  method        TEXT,                         -- equation/source label, e.g. 'ross_2010'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fitness_tests_user_date ON fitness_tests (user_id, date);
CREATE INDEX IF NOT EXISTS idx_fitness_tests_user_updated ON fitness_tests (user_id, updated_at);
