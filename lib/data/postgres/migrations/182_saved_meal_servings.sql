-- A saved meal can be a batch recipe: the owner's protein ice cream makes two servings, and there
-- was nowhere to say so. Without this the meal plan inserted the whole batch as one meal, and the
-- portion scaler then tried to shrink a finished dish to fit a slot.
--
-- Defaults to 1 so every existing saved meal behaves exactly as it did before.
ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS servings DOUBLE PRECISION NOT NULL DEFAULT 1;
