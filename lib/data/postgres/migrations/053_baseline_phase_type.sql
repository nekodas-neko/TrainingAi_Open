-- Extend phase_type CHECK constraint to include 'baseline'.
-- Drops ALL existing check constraints on the phase_type column (regardless of
-- auto-generated or named) then re-adds a single canonical one.
DO $$ DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid
    WHERE rel.relname = 'program_phases'
      AND con.contype = 'c'
      AND att.attname = 'phase_type'
      AND con.conkey @> ARRAY[att.attnum]
  LOOP
    EXECUTE 'ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;

  ALTER TABLE program_phases
    ADD CONSTRAINT program_phases_phase_type_check
    CHECK (phase_type IN ('normal', 'peak', 'deload', 'accessory', 'testing', 'baseline'));
EXCEPTION WHEN others THEN NULL;
END $$;
