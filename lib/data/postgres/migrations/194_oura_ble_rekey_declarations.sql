-- Q-314 — a re-key is DECLARED, not inferred from counter shape.
--
-- `isClockEpochReset` opened a new clock epoch on any ds regression over an hour. After a re-pair
-- the app holds no sync cursor, so the ring replays days of buffered history and that read as a
-- reset. It is not — the counter is continuous across the boundary (an 18.6 s gap on 2026-08-17)
-- and the minimum anchor lag agrees across all four epochs to within 50 s.
--
-- The cost: a spurious epoch becomes the current one, its offset is estimated from a burst where
-- >90% of anchors carry re-drain backlog, and the rollup resolves every ds against the current
-- epoch — so one re-pair re-timed the owner's entire sleep history, twice (+12.17 h, +14.16 h).
--
-- A re-key is a deliberate act performed with `open_oura` on a laptop, so the app can be told. One
-- row per declaration, consumed by the next ingest batch, which opens the epoch it names.
CREATE TABLE IF NOT EXISTS oura_ble_rekey_declarations (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  declared_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT,
  -- Set when a drain has acted on it. Kept rather than deleted: which epoch a declaration opened is
  -- the audit trail for every timestamp derived from that epoch afterwards.
  consumed_at  TIMESTAMPTZ,
  opened_epoch INTEGER
);

-- At most one declaration may be outstanding per user. A second one cannot mean anything different
-- from the first, and two pending rows would open two epochs on two consecutive drains.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oura_ble_rekey_pending
  ON oura_ble_rekey_declarations (user_id) WHERE consumed_at IS NULL;
