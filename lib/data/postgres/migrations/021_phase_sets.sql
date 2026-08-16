-- 021_phase_sets.sql

-- 1. phase_sets table
CREATE TABLE IF NOT EXISTS phase_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- 2. Add phase_set_id to program_phases (nullable; program_id kept for safe rollback)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_phases' AND column_name = 'phase_set_id'
  ) THEN
    ALTER TABLE program_phases
      ADD COLUMN phase_set_id UUID REFERENCES phase_sets(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Fix duration_cycles constraint to allow 0 (Accessory phase uses 0)
DO $$ BEGIN
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_duration_cycles_check;
  ALTER TABLE program_phases
    ADD CONSTRAINT program_phases_duration_cycles_check CHECK (duration_cycles >= 0);
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4. Extend phase_type check to include 'testing'
DO $$ BEGIN
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_phase_type_check;
  ALTER TABLE program_phases
    ADD CONSTRAINT program_phases_phase_type_check
    CHECK (phase_type IN ('normal', 'peak', 'deload', 'accessory', 'testing'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- 5. Migrate existing block-periodization programs: create Default phase set per user
--    and point their program_phases rows at it
DO $$
DECLARE
  r      RECORD;
  set_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT p.user_id, p.id AS program_id
    FROM programs p
    WHERE p.phase_mode = 'automatic'
      AND EXISTS (
        SELECT 1 FROM program_phases pp WHERE pp.program_id = p.id
      )
  LOOP
    SELECT id INTO set_id
    FROM phase_sets
    WHERE user_id = r.user_id AND is_default = true
    LIMIT 1;

    IF set_id IS NULL THEN
      INSERT INTO phase_sets (id, user_id, name, is_default)
      VALUES (gen_random_uuid(), r.user_id, 'Default', true)
      RETURNING id INTO set_id;
    END IF;

    UPDATE program_phases
    SET phase_set_id = set_id
    WHERE program_id = r.program_id AND phase_set_id IS NULL;
  END LOOP;
END $$;

-- 6. Add phase_set_id to programs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'programs' AND column_name = 'phase_set_id'
  ) THEN
    ALTER TABLE programs
      ADD COLUMN phase_set_id UUID REFERENCES phase_sets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 7. Wire programs.phase_set_id to the migrated Default sets
UPDATE programs p
SET phase_set_id = ps.id
FROM phase_sets ps
WHERE ps.user_id = p.user_id
  AND ps.is_default = true
  AND p.phase_mode = 'automatic'
  AND p.phase_set_id IS NULL;
