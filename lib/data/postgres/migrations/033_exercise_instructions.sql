-- 033_exercise_instructions.sql
-- Adds instructions column to exercise_library for storing how-to text
-- sourced from the exercises dataset (seeded via /api/admin/seed-exercise-gifs).

ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS instructions TEXT;
