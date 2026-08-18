-- Q-535 — the redecode returns a job id instead of holding the request open.
--
-- `POST /api/oura-ble/samples/redecode` awaited the heaviest pair of calls in the app and exceeded
-- the platform's request timeout, so Railway returned 502 and the tester printed "redecode failed"
-- for work that had in fact completed: measured 2026-08-17, `scanned=1098158` and every
-- `sleep_sessions` row stamped 07:58:44 — after the request had already 502'd.
--
-- The cost is not cosmetic. A false failure invites a retry, and a retry is another full-history
-- pass of the operation whose own comment names it as the event-loop starvation that took
-- production down on 2026-08-13. The UI was actively encouraging the thing most likely to hurt.
--
-- State lives in a table rather than in process memory because the work outlives the request and
-- must survive a replica restart being *visible* — a job that vanishes on restart is the same false
-- negative in a different disguise.
CREATE TABLE IF NOT EXISTS oura_redecode_jobs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  -- The options the job was started with, so a poller can tell two runs apart.
  opts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The RedecodePhases payload, verbatim, once it lands. Both phases report independently: a
  -- redecode failure must not hide a successful re-aggregate, which is the whole point of the
  -- per-phase shape the synchronous route already returned.
  result      JSONB,
  -- Set only when the run itself threw, as opposed to a phase reporting an error inside `result`.
  error       TEXT
);

-- One in-flight redecode per user. The rate limit (4/min) does not prevent two overlapping runs,
-- and two concurrent full-history re-aggregates are exactly the load this item exists to stop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oura_redecode_job_running
  ON oura_redecode_jobs (user_id) WHERE finished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oura_redecode_jobs_user_started
  ON oura_redecode_jobs (user_id, started_at DESC);
