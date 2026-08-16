-- Migration 002: Change users.id from TEXT (Google OAuth sub) to UUID.
-- Adds oauth_sub TEXT UNIQUE to preserve the OAuth identity.
-- All tables with user_id TEXT FK are migrated to UUID.
--
-- IDEMPOTENT: wrapped in a DO block that checks users.id type.
-- Skips entirely if id is already UUID (i.e. migration already applied).
-- Safe to run on every server start.
--
-- NOTE: After this deploys, existing session cookies store the old TEXT OAuth sub
-- as userId and will fail DB lookups. Users must log out and log back in.

DO $$
DECLARE
  v_id_type text;
BEGIN
  -- Check current type of users.id
  SELECT data_type INTO v_id_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'id';

  -- Already migrated → skip
  IF v_id_type = 'uuid' THEN
    RAISE NOTICE 'Migration 002 already applied (users.id is uuid), skipping.';
    RETURN;
  END IF;

  -- users.id missing entirely (partial failure from a previous run) → repair first
  IF v_id_type IS NULL THEN
    RAISE NOTICE 'Migration 002: users.id missing, repairing before proceeding.';
    ALTER TABLE users ADD COLUMN id UUID DEFAULT gen_random_uuid();
    UPDATE users SET id = gen_random_uuid();
    ALTER TABLE users ALTER COLUMN id SET NOT NULL;
    ALTER TABLE users ADD PRIMARY KEY (id);
    RAISE NOTICE 'Migration 002 repair complete, but FK tables may be inconsistent. Manual review recommended.';
    RETURN;
  END IF;

  -- Normal path: users.id is TEXT (original schema)
  RAISE NOTICE 'Migration 002: migrating users.id TEXT → UUID';

  -- Step 1: Add oauth_sub to users (copy from existing TEXT id)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='oauth_sub') THEN
    ALTER TABLE users ADD COLUMN oauth_sub TEXT;
  END IF;
  UPDATE users SET oauth_sub = id WHERE oauth_sub IS NULL;
  ALTER TABLE users ALTER COLUMN oauth_sub SET NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_sub ON users (oauth_sub);

  -- Step 2: Add new UUID column to users
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='id_new') THEN
    ALTER TABLE users ADD COLUMN id_new UUID DEFAULT gen_random_uuid();
  END IF;
  UPDATE users SET id_new = gen_random_uuid() WHERE id_new IS NULL;
  ALTER TABLE users ALTER COLUMN id_new SET NOT NULL;

  -- Step 3: Add UUID shadow FK columns to referencing tables
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='progression_styles' AND column_name='user_uuid') THEN
    ALTER TABLE progression_styles ADD COLUMN user_uuid UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='programs' AND column_name='user_uuid') THEN
    ALTER TABLE programs ADD COLUMN user_uuid UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workout_sessions' AND column_name='user_uuid') THEN
    ALTER TABLE workout_sessions ADD COLUMN user_uuid UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='body_metrics' AND column_name='user_uuid') THEN
    ALTER TABLE body_metrics ADD COLUMN user_uuid UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cardio_sessions' AND column_name='user_uuid') THEN
    ALTER TABLE cardio_sessions ADD COLUMN user_uuid UUID;
  END IF;

  -- Step 4: Populate UUID FKs by joining on the old TEXT id
  UPDATE progression_styles t SET user_uuid = u.id_new FROM users u WHERE u.id = t.user_id AND t.user_uuid IS NULL;
  UPDATE programs          t SET user_uuid = u.id_new FROM users u WHERE u.id = t.user_id AND t.user_uuid IS NULL;
  UPDATE workout_sessions  t SET user_uuid = u.id_new FROM users u WHERE u.id = t.user_id AND t.user_uuid IS NULL;
  UPDATE body_metrics      t SET user_uuid = u.id_new FROM users u WHERE u.id = t.user_id AND t.user_uuid IS NULL;
  UPDATE cardio_sessions   t SET user_uuid = u.id_new FROM users u WHERE u.id = t.user_id AND t.user_uuid IS NULL;

  -- Step 5: Make new UUID FKs NOT NULL
  ALTER TABLE progression_styles ALTER COLUMN user_uuid SET NOT NULL;
  ALTER TABLE programs          ALTER COLUMN user_uuid SET NOT NULL;
  ALTER TABLE workout_sessions  ALTER COLUMN user_uuid SET NOT NULL;
  ALTER TABLE body_metrics      ALTER COLUMN user_uuid SET NOT NULL;
  ALTER TABLE cardio_sessions   ALTER COLUMN user_uuid SET NOT NULL;

  -- Step 6: Drop old TEXT FK constraints
  ALTER TABLE progression_styles DROP CONSTRAINT IF EXISTS progression_styles_user_id_fkey;
  ALTER TABLE programs          DROP CONSTRAINT IF EXISTS programs_user_id_fkey;
  ALTER TABLE workout_sessions  DROP CONSTRAINT IF EXISTS workout_sessions_user_id_fkey;
  ALTER TABLE body_metrics      DROP CONSTRAINT IF EXISTS body_metrics_user_id_fkey;
  ALTER TABLE cardio_sessions   DROP CONSTRAINT IF EXISTS cardio_sessions_user_id_fkey;

  -- Step 7: Drop old TEXT user_id columns and rename UUID shadows
  ALTER TABLE progression_styles DROP COLUMN IF EXISTS user_id;
  ALTER TABLE programs          DROP COLUMN IF EXISTS user_id;
  ALTER TABLE workout_sessions  DROP COLUMN IF EXISTS user_id;
  ALTER TABLE body_metrics      DROP COLUMN IF EXISTS user_id;
  ALTER TABLE cardio_sessions   DROP COLUMN IF EXISTS user_id;

  ALTER TABLE progression_styles RENAME COLUMN user_uuid TO user_id;
  ALTER TABLE programs          RENAME COLUMN user_uuid TO user_id;
  ALTER TABLE workout_sessions  RENAME COLUMN user_uuid TO user_id;
  ALTER TABLE body_metrics      RENAME COLUMN user_uuid TO user_id;
  ALTER TABLE cardio_sessions   RENAME COLUMN user_uuid TO user_id;

  -- Step 8: Swap users primary key TEXT → UUID
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
  ALTER TABLE users DROP COLUMN id;           -- drop TEXT id (OAuth sub already copied to oauth_sub)
  ALTER TABLE users RENAME COLUMN id_new TO id;
  ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ALTER TABLE users ADD PRIMARY KEY (id);

  -- Step 9: Add new FK constraints referencing UUID users.id
  ALTER TABLE progression_styles ADD CONSTRAINT progression_styles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE programs ADD CONSTRAINT programs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE body_metrics ADD CONSTRAINT body_metrics_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE cardio_sessions ADD CONSTRAINT cardio_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

  -- Step 10: Recreate index
  DROP INDEX IF EXISTS idx_ws_user_started;
  CREATE INDEX idx_ws_user_started ON workout_sessions (user_id, started_at DESC);

  RAISE NOTICE 'Migration 002 complete.';
END $$;
