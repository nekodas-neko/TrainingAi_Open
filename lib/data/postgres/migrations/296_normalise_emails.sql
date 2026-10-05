-- LA-61 — one account per email regardless of case. The code now lower-cases and trims an email on
-- the way in (normalizeEmail) and matches stored rows by lower(email); this brings the stored rows
-- into line and adds a case-insensitive unique index so a second spelling can never be inserted.
--
-- Owner-approved 2026-09-28, under the 2026-09-27 production policy (OR-182): a backfill, nothing
-- deleted. Three guards:
--   1. PRE-IMAGE. Every row it rewrites is recorded first in email_normalisation_preimage, so the undo
--      is exact: UPDATE <table> SET email = old_email WHERE email = new_email. That table holds other
--      people's addresses, so it is on the claude_ro DENIED list and exported as third-party.
--   2. COLLISIONS ARE SKIPPED, NOT MERGED. A row whose normalised form another row already holds (or
--      that two rows share) is left exactly as it is, with a NOTICE — merging two accounts is a
--      data decision for a human, not a migration. The unique index is then skipped too, because it
--      cannot be built, and the NOTICE says so. The code still works: lookups match by lower().
--   3. COUNT SELF-CHECK. The rows updated must equal the rows predicted immediately before, or the
--      whole block rolls back.
-- Replay-safe: a second run finds nothing to rewrite, and the index is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS email_normalisation_preimage (
  table_name  TEXT        NOT NULL,
  old_email   TEXT        NOT NULL,
  new_email   TEXT        NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, old_email)
);

DO $$
DECLARE
  predicted integer;
  affected  integer;
  skipped   integer;
BEGIN
  -- users: rewrite only a row whose normalised form no other row shares.
  CREATE TEMP TABLE la61_users ON COMMIT DROP AS
    SELECT u.id, u.email AS old_email, lower(btrim(u.email)) AS new_email
      FROM users u
     WHERE u.email <> lower(btrim(u.email))
       AND NOT EXISTS (SELECT 1 FROM users o
                        WHERE o.id <> u.id AND lower(btrim(o.email)) = lower(btrim(u.email)));
  SELECT count(*) INTO predicted FROM la61_users;
  SELECT count(*) INTO skipped FROM users u
   WHERE u.email <> lower(btrim(u.email))
     AND NOT EXISTS (SELECT 1 FROM la61_users l WHERE l.id = u.id);

  INSERT INTO email_normalisation_preimage (table_name, old_email, new_email)
    SELECT 'users', old_email, new_email FROM la61_users
    ON CONFLICT DO NOTHING;
  UPDATE users u SET email = l.new_email FROM la61_users l WHERE u.id = l.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> predicted THEN
    RAISE EXCEPTION 'LA-61: users rewrite touched % rows, predicted %; rolled back', affected, predicted;
  END IF;
  RAISE NOTICE 'LA-61: normalised % users.email, skipped % on collision', affected, skipped;

  -- invited_emails: email is the primary key, so the same rule, keyed on the value.
  CREATE TEMP TABLE la61_invites ON COMMIT DROP AS
    SELECT i.email AS old_email, lower(btrim(i.email)) AS new_email
      FROM invited_emails i
     WHERE i.email <> lower(btrim(i.email))
       AND NOT EXISTS (SELECT 1 FROM invited_emails o
                        WHERE o.email <> i.email AND lower(btrim(o.email)) = lower(btrim(i.email)));
  SELECT count(*) INTO predicted FROM la61_invites;
  SELECT count(*) INTO skipped FROM invited_emails i
   WHERE i.email <> lower(btrim(i.email))
     AND NOT EXISTS (SELECT 1 FROM la61_invites l WHERE l.old_email = i.email);

  INSERT INTO email_normalisation_preimage (table_name, old_email, new_email)
    SELECT 'invited_emails', old_email, new_email FROM la61_invites
    ON CONFLICT DO NOTHING;
  UPDATE invited_emails i SET email = l.new_email FROM la61_invites l WHERE i.email = l.old_email;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> predicted THEN
    RAISE EXCEPTION 'LA-61: invited_emails rewrite touched % rows, predicted %; rolled back', affected, predicted;
  END IF;
  RAISE NOTICE 'LA-61: normalised % invited_emails.email, skipped % on collision', affected, skipped;

  -- The case-insensitive unique indexes, only where no two rows share a lowered value.
  IF NOT EXISTS (SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
  ELSE
    RAISE NOTICE 'LA-61: users_email_lower_key NOT built — two accounts share an email by case';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invited_emails GROUP BY lower(email) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS invited_emails_email_lower_key ON invited_emails (lower(email));
  ELSE
    RAISE NOTICE 'LA-61: invited_emails_email_lower_key NOT built — two invites differ only by case';
  END IF;
END $$;
