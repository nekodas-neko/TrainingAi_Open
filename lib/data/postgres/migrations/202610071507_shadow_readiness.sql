-- #2377 (PR 1 of 2): the shadow readiness table. The #2356 pillar model (units → Sleep · Heart ·
-- Activity · Body → readiness, docs/architecture/readiness-tree.md) is computed every day beside
-- the live readiness and shown nowhere, so the owner can sign off its weights on measured
-- days-moved. This migration is only the place to keep it; the scorer and the replay over stored
-- history are PR 2. Nothing reads or writes this table yet.
--
-- **One row per (user, date, model_version).** Shadow rows are evidence: a later weight or version
-- change must be stored BESIDE the old rows, never over them, so the comparison between versions
-- survives. Within one version a recompute replaces that version's row (an idempotent upsert on the
-- key): the inputs are settled days only, and the owner's 2026-08-26 call was to recompute rather
-- than freeze, so a late sync completing a day is allowed to correct it. This is the
-- `oura_daily_derived` policy per version, not the `sleep_verdicts` one — a verdict freezes because
-- an answer was given against it; nothing is ever asked against a shadow score. Nothing UPDATEs a
-- row any other way, and no other version's row is touched.
--
-- **Pillars are columns, units are JSONB.** The four pillars are the owner's structure (#2356,
-- 2026-10-06) and are what the shadow weeks measure — "which pillar is the main drag", days moved
-- per pillar — so they are typed columns that `claude_ro` can aggregate without JSON operators.
-- Units are keyed by a stable unit id (`sleep.duration`, `heart.overnight_hrv`, …) in `units`, so
-- adding or dropping a unit needs no migration; each value carries its own score, Level, Day,
-- weight, maturity and provenance as PR 2 defines them. `pillar_detail` holds each pillar's
-- effective weight and which units dropped out and were renormalised over.
--
-- **Null means "could not be scored", never 0.** A pillar with no unit data is NULL and readiness
-- renormalises over the pillars that have data; `shadow_readiness` is NULL when nothing could be
-- scored at all.
--
-- **Settled days only.** `inputs_through` is the last calendar day whose DAYTIME data any unit
-- read (activity, load, fuel, daytime HR and stress). The night that ended on the morning of `date`
-- is that day's sleep and is settled at wake, so it does not count. The CHECK makes a row that read
-- the unsettled current day unwritable (owner, 2026-08-26: "the numbers should be fully set on
-- first open/load"). NULL when no unit read daytime data.
--
-- **The live score is frozen beside it.** `oura_daily_derived.readiness_score` is rewritten on every
-- readiness read and re-scored by every model change, so the live number the shadow was compared
-- against is copied here at compute time with its model version.
--
-- Server-only: nothing on the device reads it (docs/data-residency.md). Goes with the user
-- (ON DELETE CASCADE) and is in the user export.
--
-- Additive: a new table and its indexes, nothing else touched.
CREATE TABLE IF NOT EXISTS shadow_readiness (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The readiness day, same key as oura_daily_derived.day.
  date                date NOT NULL,
  model_version       integer NOT NULL,

  shadow_readiness    double precision,
  sleep_pillar        double precision,
  heart_pillar        double precision,
  activity_pillar     double precision,
  body_pillar         double precision,
  pillar_detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  units               jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The row's stage: the least mature of the units that scored (0–13 valid days learning, 14–29
  -- provisional, 30+ settled). Each unit's own stage is in `units`.
  maturity_stage      text NOT NULL,
  inputs_through      date,

  -- The live readiness when this row was computed, and the model that produced it.
  live_readiness      double precision,
  live_model_version  text,

  -- daily = the day's own run; replay = back-filled from stored history.
  computed_by         text NOT NULL,
  computed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shadow_readiness_user_date_version_key UNIQUE (user_id, date, model_version),
  CONSTRAINT shadow_readiness_model_version_check CHECK (model_version > 0),
  CONSTRAINT shadow_readiness_stage_check CHECK (maturity_stage IN ('learning', 'provisional', 'settled')),
  CONSTRAINT shadow_readiness_computed_by_check CHECK (computed_by IN ('daily', 'replay')),
  CONSTRAINT shadow_readiness_settled_inputs_check CHECK (inputs_through IS NULL OR inputs_through < date),
  CONSTRAINT shadow_readiness_scores_range_check CHECK (
    (shadow_readiness IS NULL OR (shadow_readiness >= 0 AND shadow_readiness <= 100)) AND
    (sleep_pillar     IS NULL OR (sleep_pillar     >= 0 AND sleep_pillar     <= 100)) AND
    (heart_pillar     IS NULL OR (heart_pillar     >= 0 AND heart_pillar     <= 100)) AND
    (activity_pillar  IS NULL OR (activity_pillar  >= 0 AND activity_pillar  <= 100)) AND
    (body_pillar      IS NULL OR (body_pillar      >= 0 AND body_pillar      <= 100))
  ),
  CONSTRAINT shadow_readiness_jsonb_objects_check CHECK (
    jsonb_typeof(pillar_detail) = 'object' AND jsonb_typeof(units) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS shadow_readiness_user_date_idx ON shadow_readiness (user_id, date DESC);

COMMENT ON TABLE shadow_readiness IS
  '#2377: the #2356 pillar readiness model computed beside the live score and shown nowhere. One row per (user, date, model_version); a new version is stored beside the old, a recompute of the same version replaces its own row.';
COMMENT ON COLUMN shadow_readiness.units IS
  'Unit results keyed by stable unit id (e.g. sleep.duration): score, Level, Day, weight, maturity, provenance. A unit with no data is absent or has a null score, never 0.';
COMMENT ON COLUMN shadow_readiness.inputs_through IS
  'Last calendar day whose daytime data any unit read. Always before date: no unit may read the unsettled current day. The night ending on the morning of date does not count.';
COMMENT ON COLUMN shadow_readiness.live_readiness IS
  'The live readiness (oura_daily_derived.readiness_score) when this row was computed, frozen; live_model_version is its model.';
