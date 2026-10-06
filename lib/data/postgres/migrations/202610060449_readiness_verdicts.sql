-- #2105 — the app's verdict on whether a day's readiness score was unusual, and the evidence
-- behind it. The readiness counterpart of `sleep_verdicts` (migration 284), feeding the
-- outlier-gated rating prompt (LB-193).
--
-- **Why a new table.** `oura_daily_derived` already holds `readiness_score`,
-- `readiness_contributors` and `model_versions.readiness` per day, but `/api/readiness-score`
-- rewrites them on every read, so they cannot stay frozen at the moment the prompt was shown —
-- and freezing is the reason this snapshot exists. `sleep_verdicts` has sleep-only columns and its
-- `(user_id, date)` key would collide. `day_checkins` gets a row only when the sheet is SAVED,
-- while a verdict is made when it is OPENED, so "asked, not answered" would have nowhere to live.
--
-- **Contributors are JSONB, not a column each.** The contributor set changes between readiness
-- model versions (`checkin` left in v5), so fixed columns would need a migration per model change.
-- Stored in the same shape as `oura_daily_derived.readiness_contributors`, beside the model version
-- that produced them, a row can be re-derived by itself.
--
-- Server-side only and not mirrored into the device's SQLite: it needs 28 days of stored scores
-- to compute, which makes it a server-assembled aggregate like `sleep_verdicts`.

CREATE TABLE IF NOT EXISTS readiness_verdicts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The readiness day, same key as oura_daily_derived.day.
  date                        date NOT NULL,

  verdict                     text NOT NULL,
  -- The score as judged, and the band it was judged against (p25 − k·IQR, p75 + k·IQR).
  score                       integer NOT NULL,
  band_median                 double precision NOT NULL,
  band_low                    double precision NOT NULL,
  band_high                   double precision NOT NULL,
  -- Scored days that fed the band, and how many of them came from the same readiness model as
  -- `score`. The model changes often, so a 28-day window usually mixes versions; this count lets
  -- an analysis keep only the verdicts whose band was one model.
  baseline_days               integer NOT NULL,
  baseline_same_version_days  integer NOT NULL,
  -- The composite's contributors {score, provisional, input, gap}, frozen.
  contributors                jsonb NOT NULL,
  -- READINESS_MODEL_VERSION that produced `score`, and the version of the outlier rule.
  readiness_model_version     text NOT NULL,
  model_version               integer NOT NULL,

  -- none | rated | dismissed. Readiness asks for a rating on an unusual day, which is not sleep's
  -- announce-and-correct. Silence stays 'none' and is never promoted to an answer.
  response_state              text NOT NULL DEFAULT 'none',

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT readiness_verdicts_user_date_key UNIQUE (user_id, date),
  CONSTRAINT readiness_verdicts_verdict_check CHECK (verdict IN ('normal', 'poor', 'good')),
  CONSTRAINT readiness_verdicts_response_check CHECK (response_state IN ('none', 'rated', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS readiness_verdicts_user_date_idx ON readiness_verdicts (user_id, date DESC);

COMMENT ON TABLE readiness_verdicts IS
  '#2105: whether a day''s readiness score was unusual, with the score, band and contributors frozen at the moment it was judged, so a later rewrite or model change cannot change what a rating was answering.';
COMMENT ON COLUMN readiness_verdicts.response_state IS
  'none | rated | dismissed. Silence stays none — never promoted to an answer.';
COMMENT ON COLUMN readiness_verdicts.baseline_same_version_days IS
  'How many of baseline_days were scored by the same readiness model as score. Equal to baseline_days when the band is a single model.';
