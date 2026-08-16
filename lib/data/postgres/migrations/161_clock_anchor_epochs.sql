-- Clock anchors become append-only OBSERVATIONS, not a single mutable setting.
--
-- Migration 115 already described the intended model ("one row per clock epoch per
-- user"), but the ingest path mutated the single row forward on every batch, so the
-- owner's database holds exactly one anchor created at the 2026-07-07 re-key. Every
-- ring timestamp in history is therefore offset by that one row's lag — the gap
-- between when the newest drained event happened and when it was ingested, which the
-- redecode route's own notes record reaching hours.
--
-- `epoch` groups observations between ring clock resets. A ds is only ever resolved
-- against observations from its own epoch; without it, a re-key makes historical ds
-- values permanently ambiguous (small post-reset values would resolve weeks into the
-- past against a pre-reset anchor).
ALTER TABLE oura_ble_clock_anchors
  ADD COLUMN IF NOT EXISTS epoch           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observed_source  TEXT    NOT NULL DEFAULT 'drain';

CREATE INDEX IF NOT EXISTS idx_oura_ble_clock_anchors_epoch
  ON oura_ble_clock_anchors (user_id, epoch, anchor_ds);

-- Samples must carry the epoch they were ingested under, or a reset makes their ds
-- unresolvable after the fact. Everything already stored belongs to epoch 0.
ALTER TABLE oura_raw_samples
  ADD COLUMN IF NOT EXISTS epoch INTEGER NOT NULL DEFAULT 0;
