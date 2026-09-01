-- BF-84: a chosen rest day becomes a stored fact.
--
-- Until now the whole feature was a `localStorage` key (`ta_rest_day`, `lib/home/rest-day.ts`)
-- that the client re-applied over `/api/next-session`'s answer. Its own comment recorded the
-- consequence: *"/api/log-rest-day persists nothing (rest days are inferred from gaps in workout
-- history), so refetching /api/next-session after choosing rest just recomputes the prompt and
-- reverts the selection."* So the choice never reached the server, the second device never saw
-- it, and it died on reinstall.
--
-- The owner settled it as a fact rather than a display hint: a day with no workout logged is also
-- a day you forgot, were ill, or logged late, and no amount of display logic recovers a
-- distinction that was never written down.
--
-- `deleted_at` rather than a hard DELETE, per the standing rule for any domain with an unmark
-- path — a hard delete is invisible to a device that has not synced, and un-choosing rest is the
-- undo for a mistap that is now durable. Re-marking resurrects the row (`deleted_at = NULL`),
-- which is why the unique index covers live and tombstoned rows alike rather than being partial.
CREATE TABLE IF NOT EXISTS rest_days (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS rest_days_user_date_key ON rest_days (user_id, date);

-- The only read is "is this user resting on this date", and the only write upserts on the unique
-- index above, so no further index earns its keep yet.
