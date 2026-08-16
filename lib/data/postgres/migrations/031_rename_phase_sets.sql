-- 031_rename_phase_sets.sql
-- Renames the two built-in phase sets to their new display names.
-- 'Default' (is_default=true) becomes 'Phase-Based Progression'.
-- 'Re-baseline' becomes 'Baselining'.

UPDATE phase_sets SET name = 'Phase-Based Progression' WHERE name = 'Default' AND is_default = true;
UPDATE phase_sets SET name = 'Baselining'               WHERE name = 'Re-baseline';
