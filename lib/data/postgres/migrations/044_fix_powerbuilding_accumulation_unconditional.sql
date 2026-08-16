-- 044_fix_powerbuilding_accumulation_unconditional.sql
-- Unconditionally sets primary_style_id / secondary_style_id on the Accumulation
-- phase of every user's "Powerbuilding Progression" phase set to the correct
-- 'Powerbuilding' style UUID. Migration 043 had an IS NULL guard that prevented
-- fixing rows where the ID was already set but stale.

UPDATE program_phases pp
SET
  primary_style_id   = ps.id,
  secondary_style_id = ps.id
FROM phase_sets ph
JOIN progression_styles ps ON ps.user_id = ph.user_id AND ps.name = 'Powerbuilding'
WHERE pp.phase_set_id = ph.id
  AND ph.name         = 'Powerbuilding Progression'
  AND pp.name         = 'Accumulation';
