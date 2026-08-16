-- Phase A: Add exercise_id FK columns and backfill from exercise_library.
-- exercise_name is kept as a denormalised display column; exercise_id is the join key.

ALTER TABLE session_exercises ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE exercise_logs     ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE personal_records  ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
ALTER TABLE exercise_media    ADD COLUMN IF NOT EXISTS exercise_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;

-- Backfill where names match exactly (case-sensitive — matches how the library stores names)
UPDATE session_exercises se
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = se.exercise_name
    AND se.exercise_id IS NULL;

UPDATE exercise_logs exl
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = exl.exercise_name
    AND exl.exercise_id IS NULL;

UPDATE personal_records pr
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = pr.exercise_name
    AND pr.exercise_id IS NULL;

UPDATE exercise_media em
  SET exercise_id = el.id
  FROM exercise_library el
  WHERE el.name = em.exercise_name
    AND em.exercise_id IS NULL;

-- Indexes for FK-based lookups
CREATE INDEX IF NOT EXISTS idx_session_exercises_exercise_id ON session_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise_id     ON exercise_logs(exercise_id);
CREATE INDEX IF NOT EXISTS idx_personal_records_exercise_id  ON personal_records(exercise_id);
