-- #3793 item 4: an index for the two "is this source connected" probes on oura_heartrate.
--
-- `getRecentSourceFacts` (lib/data/postgres/slices/oura.ts) asks, for the readiness payload's
-- `connectedSources`, whether the user has any chest-strap heart rate, and any Health Connect heart
-- rate, since local midnight 30 days ago:
--
--   SELECT 1 FROM oura_heartrate
--    WHERE user_id = $1 AND "timestamp" >= $2 AND source IN (...)   -- ('chest_strap') or
--    LIMIT 1                                                       -- ('health_connect', 'health_connect_native')
--
-- The only index was the primary key (user_id, timestamp), so `source` is a filter. When nothing
-- in the window matches (the usual case: a strap used weeks ago, or no Health Connect at all) the
-- probe reads every row of the window and keeps none. With a LIMIT 1 and many old strap rows, the
-- planner bets on finding a match early and seq-scans the whole table instead: production showed
-- 388 sequential scans of the table against 378 calls of each probe.
--
-- Column order: `user_id` and `source` are equality predicates (IN is one equality per value) and
-- `timestamp` is the one range, so it goes last. Each probe then descends to (user, source, since)
-- once per source value and the first entry it lands on answers the LIMIT 1, or there is none: a
-- few pages, whatever the size of the window or the table. (user_id, timestamp, source) would still
-- walk the whole window. `user_id` leads, as on every other per-user index here.
--
-- Not CONCURRENTLY, on purpose. The runner sends a file as one query on a pool with
-- `statement_timeout = 15s` (lib/data/postgres/client.ts). CREATE INDEX CONCURRENTLY works only as
-- the file's sole statement, so the file cannot lift that timeout, and a concurrent build that hits
-- it leaves an INVALID index behind; the next boot's `IF NOT EXISTS` then skips that name and records
-- the migration as applied, leaving the probes on an index the planner never uses. A plain build
-- inside the transaction rolls back cleanly instead and is retried on the next boot.
--
-- Lock: CREATE INDEX holds SHARE on oura_heartrate for the build. Reads go on; heart-rate writes
-- (Oura Cloud ingest, strap and Health Connect uploads) wait for it. Measured locally: 170 ms for
-- 196k rows. Production is the owner's 180-day window; count it first with the Orchestrator's query
-- in the PR. `lock_timeout` makes the build give up, and ensureSchema retry on the next boot, rather
-- than queue writers behind a long reader; `statement_timeout` is the backstop on the build. Both are
-- SET LOCAL, scoped to this migration's transaction, as in 202610200318.
--
-- Additive only: one index, no table or column, so claude-ro-views.sql does not change.
--
-- REVERSE:
--   DROP INDEX IF EXISTS oura_heartrate_user_source_ts_idx;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

CREATE INDEX IF NOT EXISTS oura_heartrate_user_source_ts_idx
  ON oura_heartrate (user_id, source, "timestamp");
