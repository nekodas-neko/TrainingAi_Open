-- Durable watermark for the BLE rollup's incremental window (Q-213 Stage 1 follow-up).
--
-- Stage 1 narrowed `aggregateOuraRawSamples` to the span an ingest touched, but tracked that span in
-- process memory. A fresh process therefore could not know what an earlier one had left un-rolled, so
-- it re-derived the whole 35-day window once per container — and that pass was measured in production
-- at **six minutes of a pegged main thread** (CPU 1.5, memory 2.2 GB, 14:45–14:50 Brisbane
-- 2026-08-13). Every deploy paid it, and the owner felt every one.
--
-- Persisting the watermark removes the reason for that pass: a cold start reads how far the last
-- successful rollup reached and narrows from there, exactly as a warm process does.
--
-- `last_rolled_ds` is a ring deciseconds counter (`oura_raw_samples.ring_timestamp_ds`), not a
-- timestamp — it restarts on a ring re-key, which is why the clock `epoch` is stored beside it
-- (`oura_ble_clock_anchors.epoch`, migration 161). A watermark from a previous epoch is not
-- comparable to the current counter and is ignored rather than trusted: the caller falls back to the
-- full window, which is correct-but-slow rather than fast-but-wrong.
CREATE TABLE IF NOT EXISTS oura_rollup_state (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_rolled_ds BIGINT      NOT NULL,
  epoch          INTEGER     NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
