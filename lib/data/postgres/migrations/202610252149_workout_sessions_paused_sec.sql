-- #3266 / #3255: how long a workout was paused, so paused time can come out of its duration.
--
-- Preview is gaining a real workout pause. A 10-minute phone call mid-session should not count
-- toward the session's length or its energy estimate, and `completed_at - started_at` cannot say
-- how much of the span was paused. This is the second to keep it:
--
--   paused_sec  whole seconds the workout spent paused. NULL means "never paused", the same as 0.
--
-- Every existing row stays NULL, so no past session changes. NULL, not a default of 0, keeps this
-- catalog-only on any server version and means an older build that never writes the column leaves
-- it NULL too.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else); the code that
-- writes the column and subtracts it follows in its own PR, so no code reads a column that is not
-- there.
--
-- Additive only: one nullable column with no default. No existing row is changed, backfilled or
-- deleted.
--
-- Guards: `lock_timeout` so a long reader on workout_sessions makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue session writes behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the paused times recorded since). The claude_ro view lists columns
-- explicitly, so it has to go first or the column drop is refused (#3263); the next boot rebuilds it:
--   DROP VIEW IF EXISTS claude_ro.workout_sessions;
--   ALTER TABLE workout_sessions DROP COLUMN paused_sec;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS paused_sec INTEGER;
