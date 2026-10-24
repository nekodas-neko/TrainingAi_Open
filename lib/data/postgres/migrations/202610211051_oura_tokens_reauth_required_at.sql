-- #3204: record when an Oura Cloud connection stops working.
--
-- Today, when Oura refuses a refresh with `invalid_grant`, the `oura_tokens` row stays exactly as it
-- was, so the readiness payload's `connectedSources.ouraCloud` (an access token is stored) goes on
-- saying "connected", and the phones go on skipping the Oura app's Health Connect copies of data the
-- server no longer receives. This column is when the server learned the grant is gone: set when a
-- refresh ends in `invalid_grant`, or when a freshly refreshed token is refused on the scope-free
-- `personal_info` read; cleared whenever Oura issues new tokens (a connect or a refresh).
--
-- A timestamp rather than a boolean: it says when the feed stopped, which is the window a phone has
-- to re-read (#3197 item 2), at the same cost. NULL means "no known failure", which is what every
-- existing row is.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else), in the same PR
-- as the code that sets and reads it, so no code reads a column that is not there.
--
-- Additive only: one nullable column with no default (catalog-only, no rewrite). No existing row is
-- changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_tokens makes this give up (and ensureSchema retry
-- it on the next boot) rather than queue the webhook's writes behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the failure times recorded since):
--   ALTER TABLE oura_tokens DROP COLUMN reauth_required_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_tokens ADD COLUMN IF NOT EXISTS reauth_required_at TIMESTAMPTZ;
