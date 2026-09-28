-- BF-15 — an exercise saved without a role used to become `primary`: the goal's heaviest band
-- (90% × 3 in a Peak phase) and an AMRAP last set, on a movement nobody classified. The default is
-- now the unclassified role, `accessory`, which under-loads when wrong instead of over-loading.
-- Only the DEFAULT changes; no stored row is rewritten (re-classifying existing rows is BF-16b's,
-- which the owner declined). The local SQLite CREATE constant flips in the same change.
ALTER TABLE session_exercises ALTER COLUMN exercise_role SET DEFAULT 'accessory';
