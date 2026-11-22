-- #3890 — record which rest days the weekly check-in itself wrote. The engine (step 2) applies
-- "days off next week" (days_off_weekdays) by writing rest_days rows. Undoing or redoing the check-in has
-- to take those rows back, but a rest day the person had already set for the same date must stay, and
-- nothing recorded which dates the check-in made. This column stores that set. The engine's writer fills
-- it in the same transaction as the rest_days writes; nothing writes it yet.
--
-- What this does:
--   1. ADD COLUMN weekly_checkins.days_off_written date[], nullable, no default.
--
-- days_off_written
--   The dates the check-in ITSELF made rest days when it applied days_off_weekdays: dates that were not
--   already a live rest day at that moment. NULL = the check-in has written none (not answered, or
--   nothing applied). Undo and redo withdraw only these dates, so a rest day the person set themselves
--   is never removed. '{}' is also valid and means the same as NULL to a reader.
--   CHECKs (both NULL-safe):
--     weekly_checkins_days_off_written_count_check  at most 7 entries (one week).
--     weekly_checkins_days_off_written_week_check   every date is inside the week the answers apply to:
--                       >= applies_week_start and < applies_week_start + 7. Written as containment in
--                       ARRAY[applies_week_start, applies_week_start + 1, ... + 6], which needs no
--                       subquery or helper function (a CHECK allows neither), and which also refuses a
--                       NULL element (containment never matches a NULL).
--   Not enforced: that the entries are distinct, and that they match a weekday in days_off_weekdays.
--   The writer builds the set from days_off_weekdays, so a duplicate or a stray date is its bug, and
--   undo withdraws by date either way.
--
-- Additive only: one new nullable column and two CHECKs on it. No existing column, constraint or row is
-- changed. No backfill: both tables are empty in production and nothing writes them yet.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): ADD COLUMN IF NOT EXISTS carries
-- its constraints with it, so a second run skips the whole clause.
--
-- REVERSE (loses only what this column holds; it is empty until step 2 ships):
--   ALTER TABLE weekly_checkins DROP COLUMN days_off_written;   (its two CHECKs go with it)
--   then regenerate claude-ro-views.sql: the claude_ro.weekly_checkins view selects every column, so
--   DROP COLUMN fails while the view exists; drop and recreate the view in the same revert.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE weekly_checkins
  ADD COLUMN IF NOT EXISTS days_off_written date[]
    CONSTRAINT weekly_checkins_days_off_written_count_check CHECK (
      days_off_written IS NULL OR cardinality(days_off_written) <= 7
    )
    CONSTRAINT weekly_checkins_days_off_written_week_check CHECK (
      days_off_written IS NULL
      OR days_off_written <@ ARRAY[
        applies_week_start, applies_week_start + 1, applies_week_start + 2, applies_week_start + 3,
        applies_week_start + 4, applies_week_start + 5, applies_week_start + 6
      ]
    );
