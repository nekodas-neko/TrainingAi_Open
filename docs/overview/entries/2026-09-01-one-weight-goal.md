# 2026-09-01 · Lane A — one weight goal, one column (LB-42)

Branch `lane-a/one-weight-goal`. Migration 246, so it ships alone — a migration is never batched.

## The defect

`users` carried **two** columns for one goal. `weight_goal_kg` was edited in the Edit Profile sheet
and read by exactly one consumer: the nutrition-goal recommendation prompt, as *"goal weight"*.
`target_weight_kg` was edited in the Goals accordion and is what the Health page **renders** — the
number, the progress bar, the weight-rate band.

So the goal the user sees and the goal the AI is told could differ, and nothing reconciled them.

## What shipped

`target_weight_kg` wins, as LB-42 predicted: larger reader set, and it is the one on screen.

- **Migration 246** fills it from `weight_goal_kg` **only where it is NULL**. A value the user
  cannot see never overwrites one they can, and where both exist and disagree the visible number
  stands. Idempotent and unconditional; a second run matches no rows.
- **The API keeps the field name `weightGoalKg` and repoints it** — `rowToUser` reads
  `target_weight_kg`, `updateUserProfile` writes it. That is what let both editors converge with
  **no client change at all**. Repointing one screen would have left the other still diverging,
  which is the shape of the original bug rather than a fix for it.
- BF-78's presence guard survives the move: a PATCH that omits the field leaves the value alone, an
  explicit `null` still clears it. Both pinned.

## What is deliberately NOT done

**`weight_goal_kg` is not dropped.** Nothing reads or writes it now, and both the schema and a
`COMMENT ON COLUMN` say so. Dropping it is the one step here that cannot be undone, and the
row-scoped audit view **cannot show other accounts' values** — so what would be lost cannot be
checked first. That is the owner's call, recorded on the entry.

## Honest about the measurement

The owner's two columns **agreed** (60 / 60.00), and no other account is visible from the audit
view. So this fixes a live hazard rather than an observed wrong number — worth saying plainly,
because "the AI was told the wrong goal" would be a stronger claim than the evidence supports.

## Verification

Full suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean. Three mutations, all dead:
sending the profile write back to the retired column, sending the read back, and dropping the
presence guard. Exercised live on `pnpm dev` in **both** directions — set through the profile route
and read back from goals (73.5), set through goals and read back from the profile (69) — with the
retired column confirmed untouched at its old value.

**Not exercised:** native SQLite / Capacitor, safe-area, Samsung WebView, the APK path. Nothing here
touches them, and the local store holds no copy of this field.
