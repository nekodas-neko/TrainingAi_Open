-- 120_health_data_source.sql — per-field provenance for the health-metric tables.
-- A `source_map` JSONB ({ <sql_column>: <source> }) records which source last wrote each
-- field, so the upsert helpers can merge PER FIELD by precedence (manual > oura_ble >
-- oura_cloud > health_connect) instead of blind COALESCE last-writer-wins. Nullable — a legacy
-- row with no map reads as "unknown" (lowest precedence), so any explicit source corrects it.
-- Additive + idempotent; no backfill needed.
ALTER TABLE body_metrics   ADD COLUMN IF NOT EXISTS source_map JSONB;
ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS source_map JSONB;
ALTER TABLE oura_daily     ADD COLUMN IF NOT EXISTS source_map JSONB;
