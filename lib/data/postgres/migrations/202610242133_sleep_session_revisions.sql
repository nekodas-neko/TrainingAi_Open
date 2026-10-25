-- #2210: record when Oura revises a night we already stored.
--
-- Oura re-analyses a night after the fact and re-sends it (a webhook `update` event, or a backfill
-- that re-reads it). Our write replaces the stored values in place, so nothing says the night
-- changed, when, or from what: `sleep_sessions.updated_at` moves on every pass, changed or not.
-- The one time this was caught (a wake time that moved 56 minutes between 06:18 and 06:51) was by
-- luck, because the earlier values had been copied into a chat by hand.
--
-- Why an append-only table and not a `revision` counter on `sleep_sessions`: the question is "did
-- this night change, when, and what changed". A counter and a `superseded_at` answer only the first
-- two. The table answers all three, and leaves `sleep_sessions` (read whole by routes and the device
-- pull) untouched, so no existing read gains a column and no delta pull re-sends a row.
--
-- One row per revision of one night: `changes` is a jsonb object of {field: {"old": …, "new": …}}
-- holding only the fields that differ, named as the `sleep_sessions` columns are. `day` is the wake
-- date after the revision (a revision can move it). The writer lands in the next PR; this file only
-- makes room for it, and nothing reads the table yet.
--
-- Additive only: one new table, nothing altered, nothing backfilled or deleted. Rows go with their
-- user or their night (ON DELETE CASCADE), the same as every other per-user table.
--
-- Guards: `lock_timeout` so a long reader on users or sleep_sessions makes this give up (and
-- ensureSchema retry it on the next boot) rather than queue the sleep writers behind it;
-- `statement_timeout` as a backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only the revisions recorded since; the `claude_ro` view selects from the table, so
-- it goes first and the boot rebuild recreates it):
--   DROP VIEW IF EXISTS claude_ro.sleep_session_revisions; DROP TABLE sleep_session_revisions;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS sleep_session_revisions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sleep_session_id uuid        NOT NULL REFERENCES sleep_sessions(id) ON DELETE CASCADE,
  oura_id          text,
  day              date        NOT NULL,
  revised_at       timestamptz NOT NULL DEFAULT now(),
  source           text        NOT NULL,
  changes          jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS sleep_session_revisions_user_day_idx
  ON sleep_session_revisions (user_id, day, revised_at);
CREATE INDEX IF NOT EXISTS sleep_session_revisions_session_idx
  ON sleep_session_revisions (sleep_session_id);
