-- BF-19: somewhere to record how long the app actually takes to load.
--
-- The owner reported the app "VERY slowly lately" and asked for a second opinion in case it was a
-- permanent regression. It could not be answered: the two existing timing endpoints
-- (`admin/timing-baseline`, `admin/time-audit`) measure how long WORKOUTS take, not the app, and
-- nothing anywhere records navigation timing. Everything server-side was ruled out by measurement
-- (`SELECT 1` at 3 ms, 99.90% buffer-cache hit, zero idle-in-transaction, no migration replay), so
-- the number that matters is on the device and nothing was collecting it.
--
-- ## Why a table rather than an existing one
--
-- `error_events` is the closest shape and is the wrong home: it is exceptional-by-definition and
-- prunes on that basis, while this is one row per navigation — far higher volume. BF-19 asks for a
-- retention cap "from day one, not later", and mixing the two would make one prune govern both.
--
-- ## `cold` is the column the report lives or dies on
--
-- Merged PRs ran 13 / 80 / 7 across three days, and every merge is a Railway deploy that rewrites
-- the service worker's cache name (`ta-<sha>`), so the device's whole offline shell is invalidated
-- once per deploy. On that cadence a warm load is rare, and a p95 that pools cold and warm together
-- measures release cadence rather than the app. The client reports which it was; the report splits
-- on it. Without the split the number is worse than nothing, because it looks like an answer.
--
-- ## Durations are integer milliseconds
--
-- `performance.getEntriesByType('navigation')` yields sub-millisecond floats. Nothing here is read
-- at that resolution — the question is "is this route slower this week than last" — and rounding at
-- the boundary keeps the rows small and the aggregates exact.
CREATE TABLE IF NOT EXISTS app_load_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The route pattern, never the resolved URL: `/health/day` rather than `/health/day?d=2026-08-26`.
  -- A per-day path would make every row its own group and no percentile could ever be computed.
  route               text NOT NULL,
  -- Time to the first response byte, and to DOMContentLoaded, and the whole navigation.
  response_start_ms   integer,
  dom_content_ms      integer,
  total_ms            integer NOT NULL,
  -- Was the shell served by the service worker, or fetched? See the note above.
  cold                boolean NOT NULL,
  -- The deploy this was measured on, so a regression can be pinned to a release rather than a day.
  build_id            text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- The report reads "this user, this route, recently", and the prune reads "older than N days".
CREATE INDEX IF NOT EXISTS app_load_metrics_user_created_idx
  ON app_load_metrics (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_load_metrics_created_idx
  ON app_load_metrics (created_at);
