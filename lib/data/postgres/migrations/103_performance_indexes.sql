-- Sync-pull scans set_logs/exercise_logs by updated_at on every pull; PR and
-- food-log reads filter on these column sets with no covering index.
CREATE INDEX IF NOT EXISTS idx_sl_updated_at        ON set_logs (updated_at);
CREATE INDEX IF NOT EXISTS idx_el_updated_at        ON exercise_logs (updated_at);
CREATE INDEX IF NOT EXISTS idx_pr_user_achieved     ON personal_records (user_id, achieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_fl_user_meal_logged  ON food_logs (user_id, meal_type_id, logged_at);
