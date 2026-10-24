-- #3194 (PR 1 of 2) — an origin column on oura_heartrate, for the Health Connect app that wrote the row.
--
-- Legacy Health Connect heart-rate rows carry no origin: they are all stored as
-- `source = 'health_connect'`, so the readiness per-device normals pool every app's data under one
-- label. `data_origin` will hold the app's package id, filled from `metadata.dataOrigin` on upload,
-- and the normals will key on it. `source` is unchanged: it stays our provenance, which
-- `mergeHrSources` and the source ladder rank on.
--
-- Shipped alone, in its own release, before the code that writes and reads it (CLAUDE.md: a
-- migration never rides in a batch with anything else; an INSERT names every schema column, so the
-- column must exist before the Drizzle schema that lists it is deployed). Until that code lands
-- nothing writes the column, every row has it NULL, and no score, formula or scoring input changes.
-- The owner has 0 Health Connect heart-rate rows in the last 120 days, so 0 past days move.
--
-- Additive only: one nullable column with no default, which is catalog-only (no table rewrite, no
-- backfill, however large oura_heartrate is). No row is changed or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_heartrate makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only what later code writes into the column):
--   DROP VIEW IF EXISTS claude_ro.oura_heartrate;
--   ALTER TABLE oura_heartrate DROP COLUMN data_origin;
-- The boot rebuild of claude-ro-views.sql recreates the view, so the DROP VIEW is not a loss.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_heartrate ADD COLUMN IF NOT EXISTS data_origin TEXT;
