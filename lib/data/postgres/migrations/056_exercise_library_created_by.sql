ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
