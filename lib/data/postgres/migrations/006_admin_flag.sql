ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- The grant that used to live here (`UPDATE users SET is_admin = true WHERE email = '<literal>'`)
-- was removed for the public-repo migration: it carried a personal email address, and resolving a
-- row by name inside a migration is the pattern CLAUDE.md forbids — a migration runs once, so it
-- silently does nothing for a user whose row does not exist yet.
--
-- Admin is now granted at boot from the ADMIN_EMAIL env var (`bootstrapAdmin` in
-- instrumentation-node.ts), which re-runs every deploy and therefore lands whenever the row appears.
-- Existing databases are unaffected: schema_migrations tracks by filename and this file is long
-- applied, so the edit only changes what a FRESH database does. A fresh database with no ADMIN_EMAIL
-- set has no admin user — that is deliberate, not an oversight.
