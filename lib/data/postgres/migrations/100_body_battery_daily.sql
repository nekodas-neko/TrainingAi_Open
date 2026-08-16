-- Daily Body Battery snapshot — one row per user per local day.
--
-- Body Battery itself is computed on read (no migration needed for the feature),
-- but to TUNE the drain/charge model against physiology we need a longitudinal
-- record of (a) what the model produced and (b) exactly which inputs + constants
-- produced it. This table is written through from GET /api/body-battery, so the
-- last computation of each day becomes that day's end-of-day snapshot.
--
-- Analysis intent: correlate end_value / day_min against the NEXT day's Oura
-- readiness (oura_daily) and HRV (body_metrics.hrv_ms) to check whether the
-- battery actually predicts recovery, then adjust the constants. model_version
-- partitions rows by constant set so pre/post-tuning data is never mixed.

CREATE TABLE IF NOT EXISTS body_battery_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,                 -- local day in the user's timezone

  anchor          INTEGER NOT NULL,              -- opening value (morning readiness)
  anchor_source   TEXT    NOT NULL,              -- 'readiness' | 'sleep' | 'default'
  end_value       INTEGER NOT NULL,              -- latest computed value (end-of-day on final write)
  day_min         INTEGER NOT NULL,
  day_max         INTEGER NOT NULL,
  total_charged   INTEGER NOT NULL,
  total_drained   INTEGER NOT NULL,

  -- Inputs that fed the HR-reserve computation (so a recompute is reproducible)
  resting_hr      INTEGER NOT NULL,              -- RHR baseline used
  hr_max          INTEGER NOT NULL,              -- HRmax used (currently 220 - age)
  hr_max_observed INTEGER,                        -- actual peak HR seen today (for HRmax personalisation)
  hr_sample_count INTEGER NOT NULL DEFAULT 0,     -- HR samples backing the curve (data-quality flag)

  model_version   TEXT NOT NULL,                  -- constant signature, e.g. 'v1:rest0.05:chg0.4:drn0.6'
  computed_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_body_battery_daily_user_date ON body_battery_daily(user_id, date);
