-- Batch F (data & analytics): morning check-in scales, Oura tags/sessions/rest-mode,
-- SpO2 breathing disturbance index, one-tap session RPE.

-- F1 — morning check-in scales on day_checkins. phase='morning' rows use these five;
-- the UNIQUE (user_id, log_date, phase) constraint from migration 102 already covers
-- one morning row per (user, day) — no constraint change needed.
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS wake_mood          INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS perceived_recovery INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS motivation         INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS sleep_quality_feel INTEGER;
ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS resting_soreness   INTEGER;

-- F2 — Oura enhanced tags, sessions (moments) and rest-mode periods; one row each.
-- oura_id is the Oura document id (dedup key on re-sync).
CREATE TABLE IF NOT EXISTS oura_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oura_id     TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,     -- 'enhanced_tag' | 'session' | 'rest_mode'
  tag_type    TEXT,              -- tag_type_code | session type (breathing/meditation/nap/…) | 'rest_mode'
  custom_name TEXT,              -- enhanced_tag custom_name
  comment     TEXT,              -- enhanced_tag freeform comment
  mood        TEXT,              -- session mood: bad|worse|same|good|great
  start_day   DATE NOT NULL,
  end_day     DATE,
  start_time  TIMESTAMPTZ,
  end_time    TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oura_tags_user_day ON oura_tags (user_id, start_day);

-- F2 — BDI from the spo2_daily payload the sync already fetches but drops.
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS breathing_disturbance_index DOUBLE PRECISION;

-- F3 — one-tap session RPE captured on the done screen (Foster sRPE method, 1–10).
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS session_rpe INTEGER;
