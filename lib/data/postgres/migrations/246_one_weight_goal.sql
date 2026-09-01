-- LB-42: `weight_goal_kg` and `target_weight_kg` were two columns for one goal.
--
-- `weight_goal_kg` was edited in the Edit Profile sheet and read by exactly one consumer — the
-- nutrition-goal recommendation prompt, as *"goal weight"*. `target_weight_kg` was edited in the
-- Goals accordion and is what the Health page RENDERS as the goal, progress bar and weight-rate
-- band included. So the number the user sees as their goal and the number the AI is told is their
-- goal could differ, with nothing reconciling them.
--
-- `target_weight_kg` wins: it has the larger reader set and it is the one on screen. This fills it
-- from `weight_goal_kg` only where it is NULL, so a value the user can actually see is never
-- overwritten by one they cannot. Where both exist and disagree, the visible one stands.
--
-- Idempotent and unconditional, per the Postgres-migration rule: a second run matches no rows.
UPDATE users
   SET target_weight_kg = weight_goal_kg
 WHERE target_weight_kg IS NULL
   AND weight_goal_kg IS NOT NULL;

-- `weight_goal_kg` is deliberately NOT dropped. Nothing reads it after this change, but dropping a
-- column is the one thing here that cannot be undone, and this database holds accounts whose rows
-- the row-scoped audit view cannot show — so the values behind them cannot be checked first.
-- Dropping it is an owner decision, recorded on LB-42, not a tidy-up to fold into this migration.
COMMENT ON COLUMN users.weight_goal_kg IS
  'Superseded by target_weight_kg (LB-42, migration 246). No reader; kept because dropping it is irreversible and other accounts’ values cannot be audited from the row-scoped view. Do not write to it.';
