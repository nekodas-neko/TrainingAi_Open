-- Issue 2153 (LB-199): seed which meal types a saved meal is suitable for, from how it was logged.
--
-- The storage already exists: `saved_meal_meal_types` (migration 217, BF-11e) is the declared,
-- multi-valued set, ON DELETE CASCADE on both keys, soft-deleted types filtered on read. What was
-- missing is a starting point. Every existing saved meal has an empty set, so the picker would open
-- with nothing ticked on a list the owner has already used for months.
--
-- THE RULE (the only place history belongs). History is a FLOOR, never the set: the owner's protein
-- shake has 45 logs, all at breakfast, and he uses it at all four meals. So the seed only pre-ticks,
-- and the user's own set always wins. A meal type is ticked for a meal when BOTH hold:
--     logs of that meal at that type >= 3      (seed_min_logs)
--     those logs >= 60% of ALL of that meal's logs   (seed_min_share_pct)
-- Below that nothing is ticked: a pre-tick from one log is work to undo. The two numbers live in the
-- `params` CTE below and nowhere else.
--
-- A "log" here is one logging EVENT, not one row: logging a 3-ingredient meal writes 3 food_logs
-- rows that share a `meal_group_id` (migration 238), so rows are counted by DISTINCT group (a row
-- with no group counts as its own event). Soft-deleted logs are not history. The tie to a saved
-- meal is `food_logs.saved_meal_id`; logs from before migration 238 carry none and cannot be
-- attributed, so they are not counted (that can only under-seed, which is the safe direction).
--
-- "DECLARED" is `saved_meals.meal_types_seeded`:
--   * false  = the seed has not yet looked at this meal. Only this migration ever sees it: the
--              column is added with DEFAULT false so that every EXISTING row starts false, then the
--              default is flipped to true, so every meal created from now on is born true.
--   * true   = the seed has run (or never will) for this meal. From here the join table is entirely
--              the user's, including a deliberate EMPTY set, which no-rows alone could not express.
-- The seed touches only meals that are false AND have no join rows, so it never overwrites a
-- choice, and a replay (CI truncates schema_migrations and re-runs every file) finds nothing false.
--
-- ADDITIVE only: one new column and INSERTs of new join rows. Nothing is updated except the new
-- column, and no existing row is deleted or changed.
ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS meal_types_seeded boolean NOT NULL DEFAULT false;

WITH params AS (
  SELECT 3 AS seed_min_logs, 60 AS seed_min_share_pct
),
events AS (
  -- One row per (saved meal, meal type, logging event).
  SELECT DISTINCT fl.saved_meal_id, fl.meal_type_id, COALESCE(fl.meal_group_id, fl.id) AS event_id
    FROM food_logs fl
   WHERE fl.saved_meal_id IS NOT NULL AND fl.deleted_at IS NULL
),
per_type AS (
  SELECT saved_meal_id, meal_type_id, COUNT(*) AS n
    FROM events GROUP BY saved_meal_id, meal_type_id
),
per_meal AS (
  SELECT saved_meal_id, COUNT(DISTINCT event_id) AS total
    FROM events GROUP BY saved_meal_id
)
INSERT INTO saved_meal_meal_types (saved_meal_id, meal_type_id)
SELECT pt.saved_meal_id, pt.meal_type_id
  FROM per_type pt
  JOIN per_meal pm ON pm.saved_meal_id = pt.saved_meal_id
  JOIN saved_meals sm ON sm.id = pt.saved_meal_id AND sm.meal_types_seeded = false
  JOIN meal_types mt ON mt.id = pt.meal_type_id AND mt.user_id = sm.user_id AND mt.deleted_at IS NULL
  CROSS JOIN params p
 WHERE pt.n >= p.seed_min_logs
   AND pt.n * 100 >= p.seed_min_share_pct * pm.total
   AND NOT EXISTS (SELECT 1 FROM saved_meal_meal_types x WHERE x.saved_meal_id = pt.saved_meal_id)
ON CONFLICT DO NOTHING;

-- Every existing meal has now been looked at, seeded or not. Ordered AFTER the insert so the insert
-- still sees `false`; on replay the column already exists, nothing is false, and this is a no-op.
UPDATE saved_meals SET meal_types_seeded = true WHERE meal_types_seeded = false;
ALTER TABLE saved_meals ALTER COLUMN meal_types_seeded SET DEFAULT true;
