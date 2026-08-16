-- sleep_sessions.oura_id was GLOBALLY unique, but the BLE rollup derives it as `ble:<startDs>`
-- from the ring's own counter with no user component. Real Oura Cloud ids are globally unique so
-- the old constraint suited them; the synthetic BLE ids are not.
--
-- Latent with one ring, live the moment a second person wears one: their nights collide with the
-- owner's. The rollup's insert arbitrates on (user_id, sleep_start), which does not cover oura_id,
-- so the loser hits an unhandled unique violation — and aggregateOuraRawSamples files write errors
-- into its returned stepErrors rather than throwing, so that user's sleep would SILENTLY stop
-- landing. Production holds several real accounts.
--
-- The id identifies a night *for a user*, so that is what the constraint should say. Widening is
-- guaranteed to succeed: the old constraint was strictly stronger, so no duplicate (user_id,
-- oura_id) pair can already exist. Nothing queries sleep_sessions by oura_id alone — it is a dedup
-- guard, never a lookup key — so no read path changes.
--
-- The alternative considered was scoping the id itself (`ble:<userId>:<ds>`). Rejected: it leaves
-- every existing row on the old form until re-stamped, and it fixes only this one id scheme rather
-- than the constraint that is wrong for any synthetic id.

ALTER TABLE sleep_sessions DROP CONSTRAINT IF EXISTS sleep_sessions_oura_id_key;

-- Partial: NULL oura_id is the norm (manual and Health Connect nights have none) and Postgres
-- treats NULLs as distinct anyway, but stating it keeps the index off the rows that can never
-- collide.
CREATE UNIQUE INDEX IF NOT EXISTS sleep_sessions_user_oura_id_key
  ON sleep_sessions (user_id, oura_id)
  WHERE oura_id IS NOT NULL;
