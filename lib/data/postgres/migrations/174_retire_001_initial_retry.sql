-- Q-159: stop `001_initial.sql` failing on every boot, and repair what its rollback left behind.
--
-- 001 declares `cardio_sessions.user_id TEXT NOT NULL REFERENCES users(id)`; 002_users_uuid.sql
-- later made `users.id` a UUID. Re-applying 001 to any database past 002 therefore raises 42804
-- (`foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented`). `ensureSchema`
-- only records a migration after a SUCCESSFUL apply, so 001 is never recorded, and it is retried
-- and re-failed on every single boot — forever. Q-152 made that line loud; this makes it stop.
--
-- A multi-statement `pool.query` runs as one implicit transaction, so each failed retry rolls the
-- whole file back. On a database whose 001 never completed, that leaves its indexes missing.
--
-- Measured 2026-08-09, production vs the local dev DB:
--
--   index                 production   local dev
--   idx_bm_user_date      present      MISSING
--   idx_programs_user     present      MISSING
--   idx_style_user        present      MISSING
--   idx_el_name_date      absent       absent      <- BY DESIGN, see below
--
-- So production is not missing anything and this migration is a no-op there; it repairs
-- environments (like a drifted dev DB) whose 001 rolled back. Because production already holds
-- all three, the non-CONCURRENT CREATE INDEX below takes no meaningful lock there.
--
-- `idx_el_name_date` is deliberately NOT recreated: 009_perf_indexes.sql drops it and replaces it
-- with `idx_el_name_date_ws`, a superset covering index carrying workout_session_id. Recreating it
-- would re-add an index 009 removed on purpose.
--
-- `cardio_sessions` and its `idx_cs_user_date` are likewise NOT created. The table does not exist
-- in any environment, nothing outside lib/data/postgres/migrations/ references it, and creating it
-- would mean inventing a user_id type 001 got wrong. It stays dead.

CREATE INDEX IF NOT EXISTS idx_bm_user_date   ON body_metrics       (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_programs_user  ON programs           (user_id);
CREATE INDEX IF NOT EXISTS idx_style_user     ON progression_styles (user_id);

-- Everything in 001 that any environment still needs now exists, so record it and end the retry
-- loop. Idempotent: on a genuinely fresh database 001 applies cleanly and records itself before
-- this migration ever runs, and the conflict clause makes this a no-op there.
INSERT INTO schema_migrations (filename) VALUES ('001_initial.sql') ON CONFLICT DO NOTHING;
