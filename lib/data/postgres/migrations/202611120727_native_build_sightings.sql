-- #3739 (tracker #2849) — record which builds of the native app call the server, so the builds still
-- installed can be read from data before anyone raises MIN_SUPPORTED_NATIVE_BUILD (#3738).
--
-- What this does:
--   CREATE TABLE native_build_sightings — one row per (user_id, build_code, day), not one per request.
--   `build_code` is the versionCode from `X-App-Build`; `version_name` is `X-App-Version`, untrusted
--   text that is stored and never interpreted (≤ 40 chars, enforced by a CHECK as well as by the
--   writer). `day` is the user's local day from their profile timezone, never a UTC slice.
--
-- The one writer is `lib/native-builds/record-sighting.ts`, called from `/api/sync/pull` and
-- `/api/sync/push` once the route has resolved the user. It is not on auth, the bearer-token code or
-- `middleware.ts`, and no column goes on `native_refresh_tokens` (auth, confirm-first).
--
-- No prune here: about two rows a day for one user, and a delete job is confirm-first. Readers ask
-- only for the last 7 days.
--
-- Additive only: one new table. No existing row is changed, backfilled or deleted, and no existing
-- table is altered, so no lock is taken on anything that is read today.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only the sightings this table recorded):
--   DROP VIEW IF EXISTS claude_ro.native_build_sightings; DROP TABLE native_build_sightings;
--   (the view selects every column, so DROP TABLE fails without it; the boot rebuild recreates the
--   view from claude-ro-views.sql only while the table exists, so remove the view from that file in
--   the same revert)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS native_build_sightings (
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_code    integer     NOT NULL CHECK (build_code > 0),
  version_name  text        CHECK (version_name IS NULL OR char_length(version_name) <= 40),
  day           date        NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  request_count integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, build_code, day)
);
