-- Bar-load / prep time per exercise: seconds spent on the "get ready" screen between arriving at
-- the exercise and starting the first set (loading the bar, setting up the station). Distinct from
-- inter_exercise_rest_sec (which spans the whole gap between exercises, including the previous
-- exercise's rest + summary). Surfaced on the end-of-workout time summary as "Setup", actual vs the
-- equipment-based transition estimate. Additive, nullable — absent for older logs and for the first
-- exercise (its prep is the warm-up).
ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS prep_time_sec integer;
