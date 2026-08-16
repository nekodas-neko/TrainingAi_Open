ALTER TABLE food_logs       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE injuries        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE supplements     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['food_logs','injuries','supplements','supplement_logs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
    EXECUTE format('
      CREATE TRIGGER trg_set_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END;
$$;
