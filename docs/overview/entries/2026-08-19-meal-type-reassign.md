# 2026-08-19 — Q-412: move a meal type's entries instead of making the user delete them

**Branch:** `feat/meal-type-reassign` · Implementation Lane A · JS/server only, no APK needed.

## What was wrong

Deleting a meal type that had logs answered **409 "Meal type has food log entries — reassign them
first"**. There was no reassign, anywhere: `meal_type_id` was not a settable field on any route, and
no UI offered to move a logged item between meal types. So the message named the one action that
would clear the block and the app had never implemented it.

The only escape a user could actually perform was **deleting every food log ever recorded against
that meal type** — throwing away nutrition history to change a setting. The owner's case, dropping
from five meal types back to three, is the ordinary one.

## What shipped

`DELETE /api/nutrition/meal-types/[id]?reassignTo=<uuid>` moves every live log onto the target and
soft-deletes the source, **in one transaction** — a reassign that succeeds followed by a delete that
fails would leave the user halfway with no way back. Without the parameter the old behaviour stands,
except that the refusal now **names the number of entries in the way** and says what can be done
about them, so a caller can offer the choice rather than repeat an instruction nobody can follow.

**Each moved row is re-stamped against the new window** (Q-413). A 3 pm snack reassigned to Lunch
would otherwise keep a 15:00 time sitting outside Lunch's 12–15h window — the exact inconsistency the
move exists to tidy. That goes through `resolveEatenAt`, not a second copy of the midpoint
arithmetic: the SQL in migration 203 is a one-off historical correction, and every *live* path uses
the one implementation.

The update is one statement per moved row, on purpose. Each row resolves against its **own** `date`,
so there is no single timestamp to set; this is a settings action bounded by one meal type's history,
and a row-count-shaped optimisation would trade clarity for nothing measurable. A first attempt used
a single `UPDATE … FROM unnest(…)` and Drizzle would not marshal the arrays — worth knowing before
reaching for that shape again.

## Two entry premises that were wrong, and were checked rather than assumed

The backlog entry called for "the outbox mutation, the `pushMutations` branch, `getSyncDelta` and the
`applyDelta` mapping" — a full sync chain. Re-verified against the code:

- **`meal_types` is not an outbox domain.** Meal-type CRUD is already online-only, so the reassign
  needs no outbox mutation and no push branch. Nothing was added that would have had no caller.
- **The pull direction needed one real fix, and it was not in this PR's scope** —
  `applyDelta`'s `food_logs` conflict arm updated only 4 of 8 columns, so a server-side
  `meal_type_id` change could never reach a device that already held the row. That was found while
  scoping this item and shipped with Q-413 as **Q-325**, because it also silently voided that
  change's timestamp corrections. Without it this feature would have looked correct on the web and
  done nothing on the APK.

`updated_at` is bumped on every moved row, which is what carries the move out on the next pull —
`getSyncDelta` cursors on it, so that is load-bearing rather than incidental.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** · full suite green.

**8 DB-backed tests**, covering the move, the delete, that the live log count is unchanged (the
entries move, they do not go away — that distinction is the whole point), the re-stamp against the
new window, that a time already inside the new window survives, self-target, a target that is not the
user's, and the `updated_at` bump.

One of those tests had to be rewritten because its premise was wrong, and the reason is worth
keeping: since Q-413 a create resolves against its **own** window, so a log written under Snack
(15–17) can never come out holding a time inside Lunch (12–15). The "already inside the new window"
case only arises from a pre-Q-413 row or overlapping windows, and the test now sets the stored time
directly to produce that shape.

**Live against `pnpm dev`** with two logs under Afternoon Snack (15–17), both stamped 16:00:

| request | result |
|---|---|
| `DELETE` with no target | **409** — *"This meal type has 2 entries. Move them to another meal type, or delete them."* with `logCount: 2` |
| `?reassignTo=` itself | **400** — *"Pick a different meal type to move the entries to"* |
| `?reassignTo=` an id that is not the user's | **404**, nothing changed |
| `?reassignTo=not-a-uuid` | **400**, nothing changed |
| `?reassignTo=<Lunch>` | **200 `{moved: 2}`** — both rows now under Lunch at **13:30**, Afternoon Snack gone from the live list |

After each refusal the logs were re-checked and still sat under Afternoon Snack, untouched.

## Not exercised, and what is deliberately not here

**The device.** `food_logs` is an offline-first domain and the local mirror is where a sync half fails
silently. The pull path is fixed (Q-325) and unit-pinned at the statement level, but it has not been
run against a real device database. The on-device check: reassign a meal type with logs, then confirm
on the APK that the entries appear under the new type with the same calories and that the day total
is unchanged — and that it survives an app restart.

**The dialog is Lane B and is not in this PR.** The endpoint had to land first. What Lane B needs:
the 409 body now carries `code: 'MEAL_TYPE_HAS_LOGS'` and `logCount`, so the manager can open a
picker of the remaining live meal types instead of firing a delete that can only fail. The entry also
asks for a warning *before* the attempt and for the dialog to say plainly that this **rewrites
history** — a 3 pm snack moved to Lunch reads as Lunch on every past day, which is the intent but
should not be a surprise.
