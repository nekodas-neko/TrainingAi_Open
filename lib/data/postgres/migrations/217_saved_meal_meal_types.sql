-- BF-11e — which meal types a saved meal is eligible for. The owner's report is the whole
-- specification: *"we don't want pancakes recommended for dinner."*
--
-- `MealType` is reused as the tag vocabulary rather than inventing a parallel "category" concept.
-- The user already names and configures their own meal types, each with a time window, and a meal
-- can be eligible for several — a protein shake is plausibly Breakfast and Post-Workout — so this
-- is a join table rather than a column.
--
-- `saved_meal_id` CASCADEs, matching `saved_meal_items`: deleting a meal takes its tags with it.
-- `meal_type_id` also cascades, and that is a deliberate difference from `food_logs.meal_type_id`,
-- which is ON DELETE RESTRICT. A food log is a historical fact and losing its meal type would
-- rewrite history, so that restriction is what forces meal types to soft-delete at all. A tag is
-- not a fact about the past — it is current eligibility — so a genuinely hard-deleted type should
-- take its tags. In practice this rarely fires: the app soft-deletes, and the read filters
-- soft-deleted types out rather than deleting join rows, so restoring a type restores its tags.
CREATE TABLE IF NOT EXISTS saved_meal_meal_types (
  saved_meal_id UUID NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  meal_type_id  UUID NOT NULL REFERENCES meal_types(id)  ON DELETE CASCADE,
  PRIMARY KEY (saved_meal_id, meal_type_id)
);

-- The composite PK already indexes (saved_meal_id, …) for "the tags of these meals", which is the
-- read this table exists for. This covers the other direction — "which meals are tagged X" — which
-- is what the planner's slot matching will ask.
CREATE INDEX IF NOT EXISTS idx_saved_meal_meal_types_type ON saved_meal_meal_types(meal_type_id);
