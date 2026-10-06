-- #2462. Health Connect steps, active calories and step cadence at the source's own resolution.
--
-- Until now the app read Health Connect steps and calories only as daily totals, so the `MET/min`
-- cascade (#2115, the #2448 input layer in packages/shared/src/inputs/) had nothing per-minute to
-- offer for a user whose movement comes from a watch or a phone rather than the ring.
--
-- One row per Health Connect record for the interval types (`steps` — a count over
-- [start_at, end_at]; `active_kcal` — kilocalories over [start_at, end_at]) and one row per sample
-- for the series type (`cadence_spm` — steps per minute at an instant, start_at = end_at). The key
-- is Health Connect's own record id, so the device re-reading its sync window is an idempotent
-- upsert and an edit made in the source app replaces the value rather than adding a second row.
--
-- Rows from different apps that cover the same minutes are ALL kept (a phone and a watch both write
-- steps). Overlap is resolved at read time by `dedupeOverlappingWindows` through `stepCandidates`,
-- the same as every other step source, never by dropping rows here; `data_origin` and `device_type`
-- say which app and which kind of device each row came from so a reader can rank them.
--
-- Server-only, not an on-device store domain: nothing in the app writes it locally, Health Connect
-- itself is the device-side copy, and the sync re-reads its whole window every time.
--
-- Additive: a new table and its index, nothing else touched.
CREATE TABLE IF NOT EXISTS health_connect_intervals (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  record_id    text NOT NULL,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  value        double precision NOT NULL,
  -- The writing app's package name (`metadata.dataOrigin`), e.g. com.sec.android.app.shealth.
  data_origin  text,
  -- `metadata.device.type` as the plugin spells it (TYPE_WATCH, TYPE_PHONE, …); null when the
  -- writing app recorded no device.
  device_type  text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, record_id, start_at),
  CONSTRAINT health_connect_intervals_kind CHECK (kind IN ('steps', 'active_kcal', 'cadence_spm')),
  CONSTRAINT health_connect_intervals_record_id CHECK (length(trim(record_id)) > 0),
  CONSTRAINT health_connect_intervals_span CHECK (
    isfinite(start_at) AND isfinite(end_at) AND end_at >= start_at
  ),
  CONSTRAINT health_connect_intervals_value CHECK (
    value >= 0 AND value < 'Infinity'::double precision
  )
);

CREATE INDEX IF NOT EXISTS health_connect_intervals_range_idx
  ON health_connect_intervals (user_id, kind, start_at);

COMMENT ON TABLE health_connect_intervals IS
  '#2462: Health Connect steps (count), active_kcal (kcal) per record over [start_at, end_at], and '
  'cadence_spm samples (start_at = end_at). Keyed by the Health Connect record id; overlapping rows '
  'from different apps are all kept and de-duplicated at read time.';
