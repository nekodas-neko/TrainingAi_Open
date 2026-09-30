-- LA-142 — remove four oura_daily_derived columns with no writer and no reader:
-- active_calories_est, worn_hours_ble, vascular_age, pwv. Measured on production 2026-09-28: 133 of
-- the owner's rows, 0 non-null in each.
--
-- ⚠ `vascular_age` here is the DERIVED one. `oura_daily.vascular_age` is a different table, IS written
-- and IS rendered (the heart-rate page's stale Cloud vital). This migration must not touch oura_daily.
--
-- ⚠ GUARDED per column, because that measurement only sees the owner's rows (claude_ro is
-- owner-scoped). A column is dropped only if no row in any account holds a value; otherwise it stays
-- and a notice says so. Same shape as 293 (LA-159).
--
-- The claude_ro view SELECTs these by name, so it goes first; claude-ro-views.sql, regenerated in
-- this PR, recreates it after the migrations in the same deploy.
--
-- The DEVICE keeps its four local columns on purpose. SQLite has no DROP COLUMN IF EXISTS, so a
-- local migration that half-applied would throw on every retry, and that is the failure that has
-- killed the device database twice. The app simply stops reading and writing them.
--
-- Replay-safe: a column already gone is skipped.
DO $$
DECLARE
  col text;
  has_value boolean;
BEGIN
  FOREACH col IN ARRAY ARRAY['active_calories_est', 'worn_hours_ble', 'vascular_age', 'pwv'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oura_daily_derived' AND column_name = col
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM oura_daily_derived WHERE %I IS NOT NULL)', col) INTO has_value;
    IF has_value THEN
      RAISE NOTICE 'LA-142: oura_daily_derived.% still holds values somewhere; not dropped', col;
      CONTINUE;
    END IF;
    DROP VIEW IF EXISTS claude_ro.oura_daily_derived;
    EXECUTE format('ALTER TABLE oura_daily_derived DROP COLUMN %I', col);
  END LOOP;
END $$;
