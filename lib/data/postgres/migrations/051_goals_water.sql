-- 051_goals_water.sql
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS water_ml integer;

ALTER TABLE users ADD COLUMN IF NOT EXISTS steps_goal          integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS steps_goal_type     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sleep_goal_hours    numeric(4,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS calorie_goal        integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calorie_goal_type   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_goal_ml       integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_goal_type     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_weight_kg    numeric(5,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_bf_pct       numeric(4,2);
