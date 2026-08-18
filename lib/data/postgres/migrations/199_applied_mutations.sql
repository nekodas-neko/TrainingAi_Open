-- Q-481: the outbox delivers at-least-once, and exactly one of the nineteen push branches is not
-- idempotent under replay.
--
-- `body_metrics` with a `waterMlDelta` payload routes to `incrementWaterLog`, which adds inside the
-- upsert (`COALESCE(water_ml,0) + $ml`). That is deliberate and correct — an absolute set would
-- reintroduce SYNC-P7, where two concurrent quick-adds clobber each other instead of summing. Being
-- atomic-and-additive is exactly what makes a *replay* wrong: the same mutation id pushed three
-- times measured 750 ml from three 250 ml adds, each answering {"processed":1,"errors":[]}.
--
-- Replay is reachable by ordinary means on the canonical runtime, not just by a crafted request: if
-- a push reaches the server and commits but the response is lost — signal dropped mid-response, the
-- OS killing a backgrounded app, a timeout — the mutation is still `status='pending'` on the device,
-- nothing marks it in-flight, and the next sync re-pushes it. The server kept no record of which
-- mutation ids it had already applied. This table is that record.
--
-- Scoped to the branches that need it rather than all nineteen. The other eighteen upsert on
-- (user_id, date) or on a client-supplied row id and are naturally idempotent — enumerated and three
-- of them replay-tested in the review — so writing every mutation here would cost far more than it
-- buys and would make pruning a real problem instead of a trivial one.

CREATE TABLE IF NOT EXISTS applied_mutations (
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

-- Prune order. The primary key cannot serve `applied_at < cutoff` — it leads with user_id.
CREATE INDEX IF NOT EXISTS applied_mutations_applied_at ON applied_mutations (applied_at);
