-- Add unique constraint on users.email so upsertUser can conflict on email
-- for users where oauth_sub is NULL (email/password accounts).
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
