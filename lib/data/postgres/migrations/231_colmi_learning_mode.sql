-- PS-8 Phase 2: storage for the Colmi R09 ring, in LEARNING MODE.
--
-- ## The whole point of these tables is that they are not the other ones
--
-- The owner's requirement was that a second ring be ingested "so it doesn't affect anything else".
-- The intuitive way to do that — rank a `colmi_ble` source below `oura_ble` and let the ranked
-- per-field merge in `lib/data/health-source.ts` sort it out — does not work, and the reason is
-- worth stating where the schema lives. That merge governs WRITES. Every scoring READ is
-- source-blind: `getHrForWindow` selects `oura_heartrate` with no source predicate and hands the
-- rows to `preferStrapBuckets`, which allowlists exactly one value (`chest_strap`) and lets
-- everything else through; `listBodyMetrics` / `listSleepSessions` / `getOuraDaily` /
-- `getOuraDailyDerived` read whole rows and never consult `source_map`.
--
-- So a row in a shared table IS a scored row, however it is stamped. Isolation comes from the data
-- never entering those five tables — hence these. `scripts/check-learning-mode-isolation.js` fails
-- CI if the Colmi code ever names one of them, and `colmi_ble` is deliberately absent from
-- `HEALTH_SOURCES`, which makes a shared-table write a compile error rather than a policy breach.
--
-- ## Why one wide-ish readings table rather than one per metric
--
-- The ring emits seven kinds of point sample (heart rate, steps, HRV, stress, SpO2, skin
-- temperature, battery) that differ only in units and cadence. Seven tables would be seven
-- migrations, seven repo methods and seven comparison adapters for data whose entire purpose is to
-- be compared against another device. `kind` keeps that to one of each. Sleep is the exception and
-- gets its own table: it is an interval with a stage, not a point.
--
-- This is a research store, so the schema is allowed to be simpler than a production one. If the
-- ring is ever promoted out of learning mode, that promotion writes into the real tables and these
-- stay as the raw record.
--
-- ## `local_date` is stored, not derived on read
--
-- Every query here is "what did the ring say on day X" against another device's day X. Deriving the
-- day at read time means each reader re-deciding a timezone, which is exactly how this project has
-- produced off-by-one days before. The writer resolves it once, in the user's zone, and stores it.
--
-- ## Dedup
--
-- The ring's history buffer is re-readable and a sync may overlap a previous one, so re-sending is
-- expected and must be free. `(user_id, kind, measured_at)` makes a repeat sync a no-op instead of
-- a duplicate, the same property the Oura raw ingest relies on.

CREATE TABLE IF NOT EXISTS colmi_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'heart_rate' | 'steps' | 'calories' | 'distance' | 'hrv' | 'stress' | 'spo2' | 'temperature' | 'battery'
  kind         text NOT NULL,
  measured_at  timestamptz NOT NULL,
  local_date   date NOT NULL,
  value        double precision NOT NULL,
  -- Second component where the ring reports a pair (SpO2 max against `value`'s min). NULL otherwise.
  value_high   double precision,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colmi_readings_unique UNIQUE (user_id, kind, measured_at)
);

CREATE INDEX IF NOT EXISTS colmi_readings_user_kind_date_idx
  ON colmi_readings (user_id, kind, local_date);

-- Sleep is an interval with a stage, so it cannot live in the point table above.
-- `stage` uses the ring's own encoding: 2 light, 3 deep, 4 REM, 5 awake.
CREATE TABLE IF NOT EXISTS colmi_sleep_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The night's own day, resolved in the user's timezone by the writer.
  local_date  date NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  stage       integer NOT NULL,
  minutes     integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colmi_sleep_segments_unique UNIQUE (user_id, started_at, stage)
);

CREATE INDEX IF NOT EXISTS colmi_sleep_segments_user_date_idx
  ON colmi_sleep_segments (user_id, local_date);
