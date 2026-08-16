-- The named built-in phase sets (Strength/Hypertrophy/S+H/Powerbuilding
-- Progression, Baselining, Linear Progression) are templates the AI program
-- builder maps goals onto by name. Mark them read-only "Default" templates —
-- same treatment as "Phase-Based Progression" already has — so users clone
-- them to customise instead of editing/deleting the canonical version.
UPDATE phase_sets
SET is_default = true
WHERE name IN (
  'Strength Progression',
  'Hypertrophy Progression',
  'S+H Progression',
  'Powerbuilding Progression',
  'Baselining',
  'Linear Progression'
);

-- Clean up orphaned customised clones (created by the phase-cycle "clone on
-- save" flow) that no longer have a referencing program or workout history.
-- Includes the legacy "(custom)" name from before clone names got a random
-- suffix, which the orphan-cleanup regex previously didn't match.
DELETE FROM phase_sets ps
WHERE ps.is_default = false
  AND ps.name ~ '\(custom(-[0-9a-f]+)?\)$'
  AND NOT EXISTS (SELECT 1 FROM programs p WHERE p.phase_set_id = ps.id)
  AND NOT EXISTS (
    SELECT 1 FROM workout_sessions wsx
    JOIN program_phases pp ON pp.id = wsx.phase_id
    WHERE pp.phase_set_id = ps.id
  );
