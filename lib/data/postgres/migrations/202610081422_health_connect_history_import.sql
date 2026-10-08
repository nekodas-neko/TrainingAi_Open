-- issue 2169. Where the user's explicit "Import more history" run from Health Connect has got to.
--
-- Health Connect's ordinary sync reads 30 days on a cold start and 7 after, and stays that way on
-- purpose (the owner's 2026-09-30 answer on issue 2169). Older history comes in only when the user
-- asks for it, 30 days a press, each press going further back than the last. This row is what lets
-- a second press, or a press from a reinstalled app, continue where the last one stopped instead of
-- re-reading what is already in.
--
-- One row per account, holding the OLDEST calendar day imported so far, in the user's own zone.
-- The server only ever moves it older (`LEAST` in the writer), so a late or repeated request cannot
-- push the cursor forward and make a finished window be read again.
--
-- Server-only, as `health_connect_intervals` is: Health Connect is the device-side copy, and
-- nothing renders this offline.
--
-- Additive: a new table, nothing else touched.
CREATE TABLE IF NOT EXISTS health_connect_history_import (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  oldest_date  date NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT health_connect_history_import_date CHECK (isfinite(oldest_date))
);

COMMENT ON TABLE health_connect_history_import IS
  'issue 2169: the oldest local calendar day the user has imported from Health Connect with the '
  'explicit "Import more history" action. Only ever moves older.';
