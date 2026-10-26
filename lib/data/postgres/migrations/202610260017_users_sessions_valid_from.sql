-- #3369: the moment before which a user's sign-ins no longer count.
--
-- An admin is gaining a "reset this user's data" action. The offline-first apps keep the user's data
-- on the device, so a reset that only empties the server would be undone by the next push from a
-- phone that still holds the old rows. Every session issued before the reset must therefore stop
-- being accepted, and this column is what it is compared against:
--
--   sessions_valid_from  a web session or native access token whose `signedInAt` claim (the moment
--                        of the sign-in itself, stamped once) is earlier than this is refused. It is
--                        not `iat`: Auth.js re-issues `iat` as a cookie ages, so `iat` would let a
--                        stale session through after its next refresh. NULL means "no cut-off", the
--                        state of every existing account.
--
-- Every existing row stays NULL, so nobody is signed out by this migration. NULL with no default
-- keeps it catalog-only on any server version, and an older build that never reads the column
-- behaves exactly as before.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else); the code that
-- writes and checks the column follows in its own PR, so no code reads a column that is not there.
--
-- Additive only: one nullable column with no default. No existing row is changed, backfilled or
-- deleted.
--
-- Guards: `lock_timeout` so a long reader on users makes this give up (and ensureSchema retry it on
-- the next boot) rather than queue sign-ins behind it; `statement_timeout` as a backstop. Both are
-- SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the cut-offs recorded since). The claude_ro view lists columns explicitly, so
-- it has to go first or the column drop is refused (#3263); the next boot rebuilds it:
--   DROP VIEW IF EXISTS claude_ro.users;
--   ALTER TABLE users DROP COLUMN sessions_valid_from;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;
