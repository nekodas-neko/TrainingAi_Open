-- Add unique constraint on users.email so upsertUser can conflict on email
-- for users where oauth_sub is NULL (email/password accounts).
--
-- IDEMPOTENT: guarded with a pg_constraint NOT EXISTS check, matching 003.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_email_unique' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END $$;
