-- LB-66: removing a training session from a program was a hard DELETE, so the rows were
-- unrecoverable and — worse — the two FKs pointing at `program_sessions` fired on the way out:
-- `workout_sessions.session_id`/`program_session_id` are ON DELETE SET NULL, so months of logged
-- workouts were severed from the session they were trained under, and `session_periodization` is
-- ON DELETE CASCADE, so its phase/cycle state was destroyed. A tombstone keeps all three.
--
-- The unique constraints are the reason this is a constraint swap rather than a plain ADD COLUMN.
-- `(program_id, position)` and `(session_id, position)` are what make a tombstone collide: delete
-- the middle session of three and the client re-saves the survivors at positions 0 and 1, while the
-- tombstoned row still holds position 1. Every deletion of a non-last session would be a 23505.
-- Partial unique indexes over live rows only are the standard shape and preserve the constraint
-- exactly where it still means something.
--
-- Not destructive: additive columns, and the constraint is replaced by an index with the same
-- columns plus a predicate that no existing row fails (nothing is tombstoned at migration time).
-- Reversible by a corrective migration that hard-deletes tombstones and recreates the constraints.
-- The DROP CONSTRAINT / CREATE INDEX pair takes a write lock on each table; both hold a program's
-- structure, tens of rows per user, so the build is not worth doing CONCURRENTLY (which cannot run
-- inside the migration runner's transaction anyway).

ALTER TABLE program_sessions  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE session_exercises ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE program_sessions  DROP CONSTRAINT IF EXISTS program_sessions_program_id_position_key;
ALTER TABLE session_exercises DROP CONSTRAINT IF EXISTS session_exercises_session_id_position_key;

CREATE UNIQUE INDEX IF NOT EXISTS program_sessions_program_id_position_live
  ON program_sessions (program_id, "position")
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS session_exercises_session_id_position_live
  ON session_exercises (session_id, "position")
  WHERE deleted_at IS NULL;
