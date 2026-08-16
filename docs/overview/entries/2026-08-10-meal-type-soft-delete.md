# 2026-08-10 — the meal type you could never delete (Q-179)

**Branch:** `fix/soft-deleted-child-pins-parent` · **Domain:** `nutrition` · **v1.278.0** ·
migrations **175**, **176**

## The bug, as a user hits it

Create a meal type. Log one food against it. Delete that food log — it disappears, exactly as it
should. Now delete the meal type: **"Meal type has food log entries — reassign them first."** It is
citing a log you can no longer see, and there is nothing you can do about it. That meal type is
undeletable from then on, permanently.

`deleteMealType`'s in-use probe read `food_logs WHERE meal_type_id = id` with no `deleted_at`
filter, so a soft-deleted log still counted.

## Why the obvious fix is a worse bug

Adding `isNull(foodLogs.deletedAt)` to the probe does not fix it. `food_logs.meal_type_id ->
meal_types` is **ON DELETE RESTRICT**, so with the soft-deleted log excluded from the probe the hard
`DELETE FROM meal_types` fails on the foreign key instead — trading a clean 409 for a **500**.

That is not a deduction. Both variants were put back and run against the real database, and each
fails the new test with its own distinctive error:

| variant | what the test sees |
|---|---|
| the original (unfiltered probe, hard delete) | `Error: MEAL_TYPE_HAS_LOGS` |
| filter the probe, keep the hard delete | `violates foreign key constraint "food_logs_meal_type_id_fkey"` |

The probe was correct given the schema. The **lifecycle** was the problem, which is why this went to
the owner as a decision rather than a patch.

## What shipped (owner decision: soft-delete the meal type too)

Meal types now soft-delete, like every other user-owned row in this schema. The RESTRICT is
therefore never tested, and the soft-deleted logs keep pointing at a row that still exists — so
their sync tombstones survive and no unsynced device can resurrect them. The three rejected options
each lost something: hard-deleting the children destroys exactly those tombstones, reassigning to an
"Uncategorised" default silently rewrites history the user already deleted, and fixing only the
error message leaves the dead end in place.

- **Migration 175** — `deleted_at` on `meal_types`, plus a partial index over live rows (every read
  is `user_id` + `deleted_at IS NULL`). No backfill: every existing row is live, which is what NULL
  already means.
- **Migration 176** — the `claude_ro` views regenerated so the audit surface carries the new column.
  `claude_ro.food_logs` already exposes `deleted_at`; without this, an audit query could not tell a
  deleted meal type from a live one. The regenerated file's only diff against 173 is that one line.
- **The live-log guard is unchanged.** A meal type with logs you can still see refuses to go, and
  that is deliberate.
- Filters added to `listMealTypes`, `foodLogRefsValid`, `updateMealType`, `reorderMealTypes`, and
  the required-meal-type count.

**Two deliberate non-changes**, both worth stating because they look like omissions:

- `seedDefaultMealTypes` still counts soft-deleted rows. It asks *"has this user ever been
  seeded"*, not *"do they have any live meal types"* — filtering would re-create the six defaults
  for anyone who had deliberately deleted all of them.
- **No sync tombstone was needed**, which is the half that made this small. The local `meal_types`
  table is a read-only mirror, fully replaced from a successful GET, and is not in `getSyncDelta` at
  all. A deleted meal type simply stops appearing in that GET. No local migration, no `applyDelta`
  branch.

`activity_logs.activity_type -> activity_types` has the identical shape and is **not** fixed here:
it is admin-only behind `requireAdmin`, so it is a different severity and its own decision. Left as
filed.

## Verified

- **The reproduction, run against `pnpm dev` end to end**, not just in tests: create meal type →
  log food → DELETE meal type = **409** (guard holds) → delete the log → log gone from the day's
  list → DELETE meal type = **200** → gone from `/api/nutrition/meal-types`.
- In the database afterwards: the meal-type row **still exists** with `deleted_at` set, and the
  soft-deleted food log's foreign key still resolves to it. A hard delete could not have left this.
- Both broken variants mutation-tested (table above). The one-directional version of this test
  passed, which is the whole reason both directions are pinned.
- `/nutrition`, `/health`, `/`, `day-timeline`, `nutrition/adherence` and `nutrition/weekly-summary`
  all 200, no errors in the dev log.
- `tsc --noEmit` clean · **434 files / 3455 tests** green · all 19 custom-rule scripts pass.

## Not exercised

- **The APK.** Food logging is offline-first and the local meal-type mirror is native SQLite, which
  does not run in the web sandbox. The mirror is refreshed by a full replace from the GET this
  change filters, so the expected device behaviour is that a deleted meal type disappears on the
  next successful fetch — expected, not observed.
- **Drifted production data.** The local database was freshly migrated. Migration 175 adds a
  nullable column with no backfill, so there is nothing for prod data to diverge on, but the
  partial index is built on a table whose size here is trivial.
- **Multi-user.** One seeded user, so "user B cannot delete user A's meal type" rests on the
  `user_id` predicates being present, not on an observed attempt.
