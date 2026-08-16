-- Phase sets can be "owned" by the program that auto-generated them (the AI
-- workout builder's per-program phase-cycle clone, named "<template> (<program
-- name>)"). Owned clones are renamed when their program is renamed and deleted
-- when their program is deleted.
ALTER TABLE phase_sets ADD COLUMN IF NOT EXISTS owner_program_id uuid REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE phase_sets ADD COLUMN IF NOT EXISTS template_base_name text;

CREATE INDEX IF NOT EXISTS phase_sets_owner_program_id_idx ON phase_sets(owner_program_id);

-- Backfill: link existing customised clones (created by the old "clone on save"
-- flow, named "<template> (custom-xxxxxxxx)") to the single program that
-- references them, and rename to the new "<template> (<program name>)"
-- convention. Supersedes the orphan-cleanup logic from migration 060, which
-- the application no longer runs.
UPDATE phase_sets ps
SET owner_program_id = p.id,
    template_base_name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')),
    name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')) || ' (' || p.name || ')'
FROM programs p
WHERE p.phase_set_id = ps.id
  AND ps.is_default = false
  AND ps.owner_program_id IS NULL
  AND ps.name ~ '\(custom(-[0-9a-f]+)?\)$'
  AND (SELECT count(*) FROM programs p2 WHERE p2.phase_set_id = ps.id) = 1
  AND NOT EXISTS (
    SELECT 1 FROM phase_sets ps2
    WHERE ps2.user_id = ps.user_id
      AND ps2.id != ps.id
      AND ps2.name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')) || ' (' || p.name || ')'
  );
