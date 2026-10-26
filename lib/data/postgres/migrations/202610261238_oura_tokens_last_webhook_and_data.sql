-- #2861: record when the Oura Cloud feed last spoke, for the Devices status and the freshness line.
--
-- Nothing stores this today. `oura_tokens.updated_at` moves on a token refresh, not on data, and
-- the document tables' `updated_at` cannot tell a webhook from a backfill. Two columns, both
-- written server-side and read by `GET /api/oura/connection`:
--   - `last_webhook_at`: the last verified webhook event for a data type we store that resolved to
--     this user, whatever came of it (a document Oura no longer has still proves the subscription is
--     delivering).
--   - `last_data_at`: the last time an Oura document or heart-rate batch was written for this
--     user, from a webhook, a backfill or the daily reconciliation.
-- Both are NULL for every existing row, which the screens read as "nothing received yet".
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else). The code that
-- writes and reads the columns follows in its own PR, so no code reads a column that is not there.
--
-- Additive only: two nullable columns with no default (catalog-only, no rewrite). No existing row
-- is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_tokens makes this give up (and ensureSchema retry
-- it on the next boot) rather than queue the webhook's writes behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the times recorded since). The boot rebuild recreates the claude_ro view from
-- claude-ro-views.sql:
--   DROP VIEW IF EXISTS claude_ro.oura_tokens;
--   ALTER TABLE oura_tokens DROP COLUMN last_webhook_at, DROP COLUMN last_data_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_tokens ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;
ALTER TABLE oura_tokens ADD COLUMN IF NOT EXISTS last_data_at TIMESTAMPTZ;
