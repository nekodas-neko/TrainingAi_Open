-- Q-179: a meal type whose only food logs were deleted became undeletable, permanently.
--
-- `deleteMealType` probed `food_logs WHERE meal_type_id = id` with no `deleted_at` filter, so a
-- soft-deleted log the user could no longer see still raised MEAL_TYPE_HAS_LOGS. Adding the filter
-- alone does not fix it: `food_logs.meal_type_id -> meal_types` is ON DELETE RESTRICT, so the hard
-- DELETE then fails on the foreign key and the clean domain error becomes a 500.
--
-- The lifecycle was the problem, not the probe. Meal types now soft-delete like every other
-- user-owned row in this schema, so the RESTRICT is never tested and the soft-deleted logs keep
-- pointing at a row that still exists — history and sync tombstones both intact.
--
-- Idempotent: IF NOT EXISTS, and no backfill. Every existing meal type is live, which is exactly
-- what a NULL `deleted_at` means.
ALTER TABLE meal_types ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Reads filter on `deleted_at IS NULL` and are always user-scoped, so the useful index is the
-- partial one over live rows only.
CREATE INDEX IF NOT EXISTS idx_meal_types_user_live
  ON meal_types (user_id, sort_order)
  WHERE deleted_at IS NULL;
