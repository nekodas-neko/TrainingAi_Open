-- Oura sleep_time endpoint: recommended bedtime window + status
ALTER TABLE oura_daily
  ADD COLUMN IF NOT EXISTS recommended_bedtime_start INTEGER,   -- minutes from midnight UTC
  ADD COLUMN IF NOT EXISTS recommended_bedtime_end   INTEGER,   -- minutes from midnight UTC
  ADD COLUMN IF NOT EXISTS sleep_time_status         TEXT,      -- 'optimal'|'slightly_early'|'slightly_late'|'early'|'late'
  ADD COLUMN IF NOT EXISTS sleep_time_recommendation TEXT;      -- 'improve_efficiency'|'earlier_bedtime'|'later_bedtime'|'earlier_wake_up_time'|'later_wake_up_time'|'follow_optimal_bedtime'|'no_recommendation'
