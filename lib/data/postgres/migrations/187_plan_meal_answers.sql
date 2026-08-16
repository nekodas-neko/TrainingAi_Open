-- Q-187 phase 2. A prefilled meal is *suggested*, not eaten — so the day's totals must not count it
-- until the user says they ate it.
--
-- The obvious design is a `confirmed_at` column on `food_logs` and a filter at every read. There are
-- 23 files reading that table, in the domain with this project's worst data-loss history, and one
-- missed reader is a wrong number the owner acts on. So unconfirmed prefills never enter `food_logs`
-- at all: they live here until answered, and confirming writes a real food log through the existing
-- `logPlanMeal` path. No reader can miscount, because there is nothing to miscount.
--
-- Only DECLINES are stored. "I ate it" stays derivable — the food is in the day, which is how phase
-- 1 already matches it — and storing a 'yes' here beside the food log would be two sources of truth
-- for one fact, which is how counters in this project drift. "I did not eat it" is the half that is
-- NOT derivable: an absent food log is indistinguishable from an unanswered prompt, and a prefill
-- that keeps re-asking after being declined is worse than no prefill. Hence the CHECK — it is
-- deliberate, not an unfinished enum. Allowing 'yes' is one migration away if that ever changes.
CREATE TABLE IF NOT EXISTS plan_meal_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Cascades with the plan, like meal_plan_variants and meal_plan_meals already do. A deleted plan
  -- propagates to devices through `meal_plans`' own tombstone, so these need none of their own —
  -- and an answer about a meal that no longer exists is meaningless anyway.
  plan_meal_id UUID NOT NULL REFERENCES meal_plan_meals(id) ON DELETE CASCADE,
  -- The user's local date, not a timestamp: "did you eat lunch today" is a question about a day.
  log_date     DATE NOT NULL,
  answer       TEXT NOT NULL DEFAULT 'no' CHECK (answer IN ('no')),
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Undo is a soft delete so it reaches devices that have not synced. "No" is one mis-tap away from
  -- losing the meal for the day, so it has to be reversible, and a hard DELETE would be invisible.
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One answer per meal per day. Partial on the tombstone so declining, undoing, then declining again
-- re-uses the row rather than colliding with a soft-deleted one.
CREATE UNIQUE INDEX IF NOT EXISTS plan_meal_answers_user_date_meal_uniq
  ON plan_meal_answers (user_id, log_date, plan_meal_id)
  WHERE deleted_at IS NULL;

-- The read is always "this user's answers for this day", and the sync delta cursors on updated_at.
CREATE INDEX IF NOT EXISTS plan_meal_answers_user_date_idx
  ON plan_meal_answers (user_id, log_date);
CREATE INDEX IF NOT EXISTS plan_meal_answers_user_updated_idx
  ON plan_meal_answers (user_id, updated_at);
