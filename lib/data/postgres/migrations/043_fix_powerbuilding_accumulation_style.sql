-- 043_fix_powerbuilding_accumulation_style.sql
-- Backfills null primary_style_id / secondary_style_id on the Accumulation phase
-- of "Powerbuilding Progression" phase sets. Migration 042 inserted that phase
-- before the Powerbuilding style was guaranteed to exist, leaving the IDs null.

UPDATE program_phases pp
SET
  primary_style_id   = ps.id,
  secondary_style_id = ps.id
FROM phase_sets ph
JOIN users u ON u.id = ph.user_id
JOIN progression_styles ps ON ps.user_id = ph.user_id AND ps.name = 'Powerbuilding'
WHERE pp.phase_set_id = ph.id
  AND ph.name        = 'Powerbuilding Progression'
  AND pp.name        = 'Accumulation'
  AND (pp.primary_style_id IS NULL OR pp.secondary_style_id IS NULL);
