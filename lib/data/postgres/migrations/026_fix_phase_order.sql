-- 026_fix_phase_order.sql
-- Re-numbers positions in Default phase sets to the canonical block order:
-- Normal phases first (preserving relative order), then Peak, Testing,
-- Deload, Accessory last. Backfill migrations appended phases at max+1,
-- so Testing/Deload/Accessory ended up before the original normal/peak phases.

DO $$
DECLARE
  set_row   RECORD;
  phase_row RECORD;
  new_pos   INTEGER;
BEGIN
  FOR set_row IN SELECT id FROM phase_sets WHERE is_default = true LOOP
    new_pos := 0;
    FOR phase_row IN
      SELECT id FROM program_phases
      WHERE phase_set_id = set_row.id
      ORDER BY
        CASE phase_type
          WHEN 'normal'    THEN 0
          WHEN 'peak'      THEN 10
          WHEN 'testing'   THEN 20
          WHEN 'deload'    THEN 30
          WHEN 'accessory' THEN 40
          ELSE 50
        END,
        position  -- preserve relative order within same type
    LOOP
      UPDATE program_phases SET position = new_pos WHERE id = phase_row.id;
      new_pos := new_pos + 1;
    END LOOP;
  END LOOP;
END $$;
