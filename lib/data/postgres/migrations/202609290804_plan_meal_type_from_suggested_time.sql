-- LA-172 (owner, 2026-09-28): "Give it a type by its time; as well as what its tagged with."
-- A plan meal's type resolves tag → derived from its suggested time → none. New and edited meals do
-- this in `lib/data/postgres/slices/meal-plans.ts` via `planMealTypeId`
-- (`packages/shared/src/nutrition/meal-type-for-time.ts`). This is the one-time backfill for meals
-- written before it: every owner plan meal had `meal_type_id` NULL, so nothing matching a log to a
-- slot by meal type could match anything (BF-203a).
--
-- The SAME rule as `planMealTypeId`: among the owner's live meal types, the one whose
-- [time_start_hour, time_end_hour) is NEAREST the suggested time in minutes (0 when it contains it,
-- and the end is exclusive), ties to sort_order then created_at, the order `listMealTypes` returns.
-- Nearest rather than none because the owner's hours have gaps and he asked for "a type by its time".
-- A tagged meal is never touched (`meal_type_id IS NULL` is the target). Safe to re-run.
DO $$
DECLARE
  predicted integer;
  affected integer;
BEGIN
  DROP TABLE IF EXISTS la172_pick;
  CREATE TEMP TABLE la172_pick ON COMMIT DROP AS
  SELECT mpm.id,
         (SELECT mt.id
            FROM meal_types mt,
                 LATERAL (SELECT split_part(mpm.suggested_time, ':', 1)::int * 60
                               + split_part(mpm.suggested_time, ':', 2)::int AS minute) t
           WHERE mt.user_id = mp.user_id
             AND mt.deleted_at IS NULL
           ORDER BY CASE
                      WHEN t.minute <  mt.time_start_hour * 60 THEN mt.time_start_hour * 60 - t.minute
                      WHEN t.minute >= mt.time_end_hour * 60   THEN t.minute - mt.time_end_hour * 60 + 1
                      ELSE 0
                    END,
                    mt.sort_order, mt.created_at
           LIMIT 1) AS meal_type_id
    FROM meal_plan_meals mpm
    JOIN meal_plan_variants v ON v.id = mpm.variant_id
    JOIN meal_plans mp ON mp.id = v.meal_plan_id
   WHERE mpm.meal_type_id IS NULL
     AND mpm.suggested_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]';
  DELETE FROM la172_pick WHERE meal_type_id IS NULL;

  SELECT count(*) INTO predicted FROM la172_pick;

  UPDATE meal_plan_meals mpm SET meal_type_id = pick.meal_type_id
    FROM la172_pick pick
   WHERE mpm.id = pick.id AND mpm.meal_type_id IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected <> predicted THEN
    RAISE EXCEPTION 'LA-172: backfill touched % rows, predicted %; rolled back', affected, predicted;
  END IF;
  RAISE NOTICE 'LA-172: gave % untyped plan meals the meal type their suggested time falls in', affected;
END $$;
