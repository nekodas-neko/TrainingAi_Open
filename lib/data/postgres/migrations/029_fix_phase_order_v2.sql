-- 029_fix_phase_order_v2.sql
-- Migration 026 failed silently: the unique(phase_set_id, position) constraint
-- rejects row-by-row position updates when the new value collides with an
-- existing row that hasn't been updated yet.
-- Fix: shift all positions to 1000+ first (still unique, no collisions),
-- then assign canonical positions one by one (0-N range, no conflict).

DO $$
DECLARE
  set_row   RECORD;
  phase_row RECORD;
  new_pos   INTEGER;
BEGIN
  FOR set_row IN SELECT id FROM phase_sets WHERE is_default = true LOOP

    -- Step 1: move all positions out of the 0-N range
    UPDATE program_phases
    SET position = position + 1000
    WHERE phase_set_id = set_row.id;

    -- Step 2: assign canonical positions
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
        position  -- preserves relative order within same type
    LOOP
      UPDATE program_phases SET position = new_pos WHERE id = phase_row.id;
      new_pos := new_pos + 1;
    END LOOP;

  END LOOP;
END $$;
