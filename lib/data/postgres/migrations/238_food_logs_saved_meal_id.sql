-- BF-39: a logged meal stops being a meal.
--
-- Logging a saved meal writes one `food_logs` row per ingredient and nothing records that they came
-- from a meal, so the moment it is logged its identity is gone. One AI-logged breakfast rendered as
-- EIGHT diary rows — flour, protein powder, baking powder, salt, milk, eggs, butter, bacon — and the
-- owner's report is literal: *"we need to be able to create an over arching food and have the
-- ingredients and macro break down inside of it."*
--
-- Three symptoms, one cause: the meal's photo cannot follow it into the diary, a saved meal has no
-- last-used timestamp at all (so My Foods can only order by `created_at DESC` — Q-395c filed that as
-- a constraint), and the diary shows five ingredients where the owner ate one thing.
--
-- `saved_meal_id` is the identity; `meal_group_id` is the OCCASION. Both are needed: two servings of
-- the same meal on the same day share a `saved_meal_id` and must not collapse into one diary row, so
-- the grouping key is the group, and the saved meal is what the group is OF.
--
-- Chosen over the alternative of logging a meal as a single row (see the entry). That would change
-- what a `food_logs` row IS, for the diary, the energy balance, the adaptive-TDEE window, the sync
-- delta and the local store — and would make editing one ingredient impossible without decomposing
-- it anyway. This is additive: a log row is still a log row and every existing query is unchanged.
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS saved_meal_id uuid;
ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS meal_group_id uuid;

-- ON DELETE SET NULL, never CASCADE or RESTRICT: a log is a record of something eaten, and deleting
-- the recipe afterwards must neither erase that history nor become un-deletable because of it. The
-- rows keep their `meal_group_id`, so a diary can still group them even once the meal is gone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_logs_saved_meal_id_fkey'
  ) THEN
    ALTER TABLE food_logs
      ADD CONSTRAINT food_logs_saved_meal_id_fkey
      FOREIGN KEY (saved_meal_id) REFERENCES saved_meals(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The diary reads a day at a time and groups within it; this is that query's index.
CREATE INDEX IF NOT EXISTS idx_food_logs_meal_group
  ON food_logs (user_id, date, meal_group_id) WHERE meal_group_id IS NOT NULL;

-- Q-395c's true MRU: "when did I last eat this meal", answered from the logs rather than a stored
-- counter that would drift (CLAUDE.md, Stored Counters — derive, or reconcile on read).
CREATE INDEX IF NOT EXISTS idx_food_logs_saved_meal_recent
  ON food_logs (user_id, saved_meal_id, logged_at DESC) WHERE saved_meal_id IS NOT NULL;
