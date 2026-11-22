-- #3898 step 1 — somewhere to keep a connected source's rest periods and day tags. The fetch and the
-- writers are step 2, a later PR; nothing reads or writes these tables yet. Per the owner (20 Nov):
-- every data type is stored, how each is used is decided later, and rest periods get no reader.
--
-- What this does (generic shapes, docs/data-source-connector-guide.md §3h and §3i — no vendor names):
--   1. CREATE TABLE source_rest_periods — a span the person marked as resting or ill: a first day, an
--      optional end (open while it is still on), optional instants, and the episodes noted inside it.
--   2. CREATE TABLE source_day_tags — a tag or note at an instant or over a span, with the standard
--      tag codes picked, an optional custom name and optional free text. One shape holds both the
--      source's older single-note tag and its newer tag with a duration, so neither loses a field.
--
-- Both: one row per (user_id, source, source_record_id), so a re-fetch is an upsert. `source` is the
-- connector id the other generic tables use ('oura_cloud'). `deleted_at` is the tombstone for a record
-- the source deleted (CLAUDE.md offline-first rule): the writer sets it, nothing hard-deletes.
-- `start_day` / `end_day` are the source's own local days, never a UTC slice.
--
-- Additive only: two new tables and their indexes. No existing table is altered and no row is changed,
-- backfilled or deleted. No device copy: nothing on the phone writes these.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only what these tables hold; both are empty until step 2 ships):
--   DROP VIEW IF EXISTS claude_ro.source_rest_periods, claude_ro.source_day_tags;
--   DROP TABLE source_rest_periods; DROP TABLE source_day_tags;
--   (the views select every column, so DROP TABLE fails without the views dropped first; the boot
--   rebuild recreates a view from claude-ro-views.sql only while its table exists, so remove both
--   views from that file in the same revert)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS source_rest_periods (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source           text        NOT NULL CHECK (source <> ''),
  source_record_id text        NOT NULL CHECK (source_record_id <> ''),
  start_day        date        NOT NULL,
  end_day          date,
  start_at         timestamptz,
  end_at           timestamptz,
  -- [{ "at": <ISO instant>, "tags": [<tag code>, ...] }, ...], as the source sent them.
  episodes         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_rest_periods_record_key UNIQUE (user_id, source, source_record_id)
);

CREATE INDEX IF NOT EXISTS source_rest_periods_user_start_day_idx
  ON source_rest_periods (user_id, start_day);

CREATE TABLE IF NOT EXISTS source_day_tags (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source           text        NOT NULL CHECK (source <> ''),
  source_record_id text        NOT NULL CHECK (source_record_id <> ''),
  start_day        date        NOT NULL,
  end_day          date,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz,
  -- The source's standard tag codes picked for this entry. Empty for a text-only note. A custom tag
  -- carries the source's own marker for it here and its name in custom_name.
  tag_codes        text[]      NOT NULL DEFAULT '{}',
  custom_name      text,
  comment          text,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_day_tags_record_key UNIQUE (user_id, source, source_record_id)
);

CREATE INDEX IF NOT EXISTS source_day_tags_user_start_day_idx
  ON source_day_tags (user_id, start_day);
