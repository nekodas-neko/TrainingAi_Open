-- #3829: the moment before which a user's sign-ins no longer count, kept apart from the data epoch.
--
-- Linking Google onto a password account clears the password (#3797), and the sign-ins made with
-- that password have to end. Phone sign-ins are revoked at the link; a web session is a stateless
-- cookie and needs a server-side cut-off to compare with. `sessions_valid_from` is one, but it is
-- also the admin reset's data epoch: setting it makes every phone on the account wipe its local
-- store, unsynced changes included. This column ends sign-ins and nothing else:
--
--   sign_ins_valid_from  a web session or native access token whose `signedInAt` claim (stamped once,
--                        at the sign-in) is earlier than this is refused, and the person signs in
--                        again. No device data is touched. NULL means "no cut-off", the state of
--                        every existing account.
--
-- Additive only: one nullable column, no default, no backfill. Every existing row stays NULL, so
-- nobody is signed out by this migration, and NULL with no default keeps it catalog-only.
--
-- Guards: `lock_timeout` so a long reader on users makes this give up (and ensureSchema retry it on
-- the next boot) rather than queue sign-ins behind it; `statement_timeout` as a backstop. Both are
-- SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the cut-offs recorded since). The claude_ro view lists columns explicitly, so
-- it has to go first or the column drop is refused (#3246); the next boot rebuilds it from
-- claude-ro-views.sql:
--   DROP VIEW IF EXISTS claude_ro.users;
--   ALTER TABLE users DROP COLUMN sign_ins_valid_from;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_ins_valid_from TIMESTAMPTZ;
