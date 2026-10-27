-- #2265: the owner marks a night the ring only partly measured (it came off, or went on late).
--
--   partial_night_at  when the owner marked the night partial; NULL means not marked, which is every
--                     existing row. A marked night keeps its physiology (HRV, heart rate, breathing)
--                     but its duration-derived metrics (time asleep, efficiency, latency, restless
--                     periods) stay out of the sleep score and out of every baseline. Unsetting it
--                     returns the night. It is manual only: nothing detects a partial night.
--
-- Every existing row stays NULL, so no score, baseline or trend changes by this migration. NULL with
-- no default keeps it catalog-only on any server version.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else); the code that
-- writes the column and the filters that read it follow in a second PR, applied after this one has
-- run, because once schema.ts names the column every full-row select of the table selects it.
--
-- Additive only: one nullable column with no default. No existing row is changed, backfilled or
-- deleted.
--
-- Guards: `lock_timeout` so a long reader on sleep_sessions makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue reads behind it; `statement_timeout` as a backstop.
-- Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the marks made since). The claude_ro view lists columns explicitly, so it has
-- to go first or the column drop is refused (#3263); the next boot rebuilds it:
--   DROP VIEW IF EXISTS claude_ro.sleep_sessions;
--   ALTER TABLE sleep_sessions DROP COLUMN partial_night_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS partial_night_at TIMESTAMPTZ;
