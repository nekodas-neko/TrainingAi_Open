-- TN-81 — the app's own verdict on a night, and the evidence behind it.
--
-- Design: docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md. The app fills the
-- sleep category itself and announces what it filled; the owner's only interaction is to correct
-- it. A correction is a disagreement, and a disagreement is the outcome label the tuning models
-- have never had — five validation attempts have failed for want of one.
--
-- **Why the bands and the component values are stored, not just the verdict.** `sleep_score` is
-- computed on read and persisted nowhere: measured 2026-09-26, non-null on 0 of 119 rows over the
-- last 120 days. Store only the outcome and a later scoring change silently rewrites what each
-- correction was disagreeing with, and the corrections decay into noise with no signal that it
-- happened. A correction whose paired verdict is not pinned is not evidence. This is the single
-- most important requirement in the entry.
--
-- **A new table rather than a column on a daily sibling, which is the opposite of migration 282's
-- call and deliberately so.** 282 put `acwr` on `oura_daily_derived` because a second
-- daily-metrics table would split one day's metrics across two places, and that reasoning holds
-- for a metric. This is not a metric: it is an announcement with a response state and a frozen
-- copy of its own inputs. `day_checkins` is the other candidate and is worse — its row exists
-- only once the sheet is SAVED, while an announcement happens when the sheet is OPENED, so the
-- "announced, no response" state this table exists to record would have nowhere to live.
--
-- Server-side only, and not mirrored into the device's SQLite: the verdict needs 28 nights of
-- history and per-component medians to compute, which makes it a server-assembled aggregate of
-- the kind `weekly-stats` already is.

CREATE TABLE IF NOT EXISTS sleep_verdicts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Wake-up date, matching sleep_sessions.date.
  date               date NOT NULL,

  -- normal | poor | good, and WHICH components put it there. A verdict with no stated cause
  -- cannot be argued with, and being argued with is the entire point.
  verdict            text NOT NULL,
  triggered          text[] NOT NULL DEFAULT '{}',

  -- The night as judged. NULL = the component had no value, which is not the same as zero.
  duration_hours     double precision,
  onset_minutes      double precision,
  efficiency         double precision,

  -- The bands it was judged against, frozen at announcement time. See the header.
  duration_low       double precision,
  duration_high      double precision,
  onset_low          double precision,
  onset_high         double precision,
  efficiency_low     double precision,
  efficiency_high    double precision,

  -- Largest per-component window that fed the bands, and which rule produced the verdict.
  baseline_nights    integer NOT NULL,
  model_version      integer NOT NULL,

  -- none | acknowledged | corrected. Three states, not two: silence under correction-only
  -- feedback is ambiguous — it means either "the app was right" or "he never looked" — and that
  -- distinction cannot be recovered afterwards. A quiet ordinary-day line cannot carry an
  -- acknowledgement, so its silence stays 'none' rather than being promoted to agreement.
  response_state     text NOT NULL DEFAULT 'none',

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sleep_verdicts_user_date_key UNIQUE (user_id, date),
  CONSTRAINT sleep_verdicts_verdict_check CHECK (verdict IN ('normal', 'poor', 'good')),
  CONSTRAINT sleep_verdicts_response_check
    CHECK (response_state IN ('none', 'acknowledged', 'corrected'))
);

CREATE INDEX IF NOT EXISTS sleep_verdicts_user_date_idx ON sleep_verdicts (user_id, date DESC);

COMMENT ON TABLE sleep_verdicts IS
  'TN-81: the app''s announced verdict on a night plus the component values and bands behind it, frozen at announcement time so a later scoring change cannot rewrite what a correction disagreed with.';
COMMENT ON COLUMN sleep_verdicts.response_state IS
  'none | acknowledged | corrected. Silence stays none — never promoted to agreement (TN-57).';
COMMENT ON COLUMN sleep_verdicts.onset_minutes IS
  'Signed minutes from the wake date''s local midnight; negative before midnight (23:10 = -50).';
