-- #4119. Which phase the plan a workout TRAINED was made for (accumulation, deload, ...), as the app
-- sent it at the finish. Nothing stored said this, so the readers that count a session type's
-- sessions in its phase could only go by timestamps: a workout trained on a plan served before the
-- phase moved was skipped at the finish and counted again by the next read.
-- NULL means the app did not say (the web app, an older build, every row before this): those rows
-- keep the timestamp rule they were counted by. No backfill; nothing reads the column yet.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS plan_phase text;
