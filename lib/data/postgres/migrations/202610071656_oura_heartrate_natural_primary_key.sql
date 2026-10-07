-- #2079 (BF-223) — `oura_heartrate`'s primary key becomes its natural key, (user_id, timestamp).
-- Owner-approved 2026-10-06 on #2079: alternative (b) of the brief, in its own migration, after a
-- verified snapshot.
--
-- Why: the surrogate key `oura_heartrate_pkey (id)` had **0 scans in the database's lifetime**
-- (pg_stat_user_indexes.idx_scan = 0 with pg_stat_database.stats_reset NULL, measured 2026-09-29) at
-- 7.2 MB, and every insert paid to maintain it. Its sibling `oura_heartrate_user_id_timestamp_key`
-- took 10,025,158 scans: every read and every upsert goes through (user_id, timestamp). Nothing
-- references this table by foreign key. After this, ONE index on (user_id, timestamp) does both jobs.
--
-- What does NOT change:
--   * The `id` column and its gen_random_uuid() default stay. No row and no column is removed; only
--     the uniqueness index on `id` goes (the UUID default is what makes ids unique, not the index).
--   * Every writer's `ON CONFLICT (user_id, timestamp)` keeps working: a primary key on those
--     columns is a valid arbiter. Nothing in the repo uses `ON CONFLICT ON CONSTRAINT` by name.
--   * `lib/export/db-snapshot.ts` pages each table by its primary key, so it now pages this one by
--     (user_id, timestamp) — the reason the brief's first option (drop the key outright) was ruled
--     out: no key leaves `ORDER BY ` empty and the export fails.
--
-- Why not `ADD PRIMARY KEY USING INDEX oura_heartrate_user_id_timestamp_key` (no rebuild): Postgres
-- refuses it — that index already belongs to the UNIQUE constraint ("index is already associated
-- with a constraint"), and dropping the constraint drops the index. So the key's index is BUILT here,
-- under ACCESS EXCLUSIVE, which blocks reads and writes on this table for the build.
--   * Measured on a scratch database built from migrations, 650,000 rows / 52 MB (more than
--     production's 38 MB, near the projected 69 MB): see PR for the timings. Production is
--     sub-second to a few seconds.
--   * `lock_timeout = 5s`: if a long reader holds the table, the ALTER gives up rather than queueing
--     every sensor insert behind it. The migration then fails loudly, is not recorded, and
--     ensureSchema retries it on the next boot. Nothing is half-applied: it is one statement.
--   * During the lock an HR upload waits; past the 15 s pool statement_timeout it errors and the
--     device retries the batch from its outbox. No reading is lost.
--
-- REVERSE (one statement; tested on the scratch DB, reverse then forward again):
--   ALTER TABLE oura_heartrate
--     DROP CONSTRAINT oura_heartrate_pkey,
--     ADD CONSTRAINT oura_heartrate_pkey PRIMARY KEY (id),
--     ADD CONSTRAINT oura_heartrate_user_id_timestamp_key UNIQUE (user_id, "timestamp");
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): the block acts only while the
-- key is still on `id` (or missing). A table already keyed on (user_id, timestamp) is left alone,
-- apart from dropping a leftover duplicate unique constraint, and never fails the deploy. A key on
-- anything else is reported and left alone.
--
-- Verify after release (admin query endpoint):
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'oura_heartrate' ORDER BY 1;
-- Expected: exactly one row, oura_heartrate_pkey ... btree (user_id, "timestamp").

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  pk_cols text[];
BEGIN
  SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum))
    INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'public.oura_heartrate'::regclass AND i.indisprimary;

  IF pk_cols = ARRAY['user_id', 'timestamp'] THEN
    -- Already re-keyed. A leftover unique constraint would be the same index twice; drop it.
    ALTER TABLE oura_heartrate DROP CONSTRAINT IF EXISTS oura_heartrate_user_id_timestamp_key;
    RAISE NOTICE '#2079: oura_heartrate is already keyed on (user_id, timestamp); nothing to do';
  ELSIF pk_cols IS NULL OR pk_cols = ARRAY['id'] THEN
    -- One ALTER, so one lock acquisition and no moment without a uniqueness guarantee. `id` keeps
    -- NOT NULL explicitly: it was only ever implied by the key being dropped (090 never declared
    -- it), and on Postgres 16 it is already set, so this costs no scan.
    ALTER TABLE oura_heartrate
      DROP CONSTRAINT IF EXISTS oura_heartrate_pkey,
      DROP CONSTRAINT IF EXISTS oura_heartrate_user_id_timestamp_key,
      ALTER COLUMN id SET NOT NULL,
      ADD CONSTRAINT oura_heartrate_pkey PRIMARY KEY (user_id, "timestamp");
    RAISE NOTICE '#2079: oura_heartrate primary key moved from (id) to (user_id, timestamp)';
  ELSE
    RAISE NOTICE '#2079: oura_heartrate primary key is on %, not (id); left alone', pk_cols;
  END IF;
END $$;
