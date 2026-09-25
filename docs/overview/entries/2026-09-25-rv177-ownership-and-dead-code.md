# RV-177 — a food item that was not yours, and two methods nothing called

**Branch:** `fix/rv177-ownership-dead-code` · **Lane A** · `[platform][nutrition][workouts]`

Two more of RV-177's nine gaps. Four remain, and none of them is re-verified — the entry's `Keep:`
says so, because three of its claims have now turned out stale or backwards.

## The read that was not scoped

`createFoodItem`'s id-bearing branch exists to make an outbox retry idempotent: the device mints the
id before the push, so a re-push conflicts and the row is read back instead of inserted. It read it
back **by id alone**.

So if the supplied id belonged to somebody else, the insert no-opped and their food item — name,
brand, macros — was returned to the caller, for the cost of guessing a uuid. CLAUDE.md's write-path
ownership rule (c) names exactly this: a client-supplied row id in an upsert must be
ownership-verified. `food_items` has a `user_id`, so the check is direct rather than a join.

**Scoped, not blanket-refused, and the distinction is the whole design.** A 409 on every conflict
would break the idempotent retry this branch exists for, and on the push path a 4xx is a poison pill
the outbox quarantines — it would cost a real food log to close a latent read. So the read is scoped
on `userId`, the caller's own row still comes back, and only a foreign id is refused.

## The two dead methods, and the thing I had wrong about them

`logExerciseWithId` and `logSets` had no production caller and — re-verified — no place on the
`WorkoutRepository` interface, so deleting them was contained.

**My own note on the entry said deleting their tests lost no coverage. That was wrong.** `logSets`
collapsed duplicates on `set_number`; the live path a completed workout actually calls,
`logExerciseAndSets`, collapses on `set.id`. Different conflict target — and the live one had **no
direct test at all**. Deleting the two cases would have left the real key uncovered while the dead
key had been pinned for months.

So the coverage moved rather than went: one case now drives `logExerciseAndSets` with a repeated set
id and asserts the batch survives, last write wins, and the returned ids match the stored rows.
Removing that collapse now fails it — which was the point of checking.

## Verification

| mutation | killed |
|---|---|
| drop the `userId` scope from the read-back (the original bug) | the cross-user case |
| refuse every conflict, breaking the idempotent retry | the retry control |
| remove `collapseOnConflict` from the live `logExerciseAndSets` | the new live-path case |
| **control:** reword the refusal message | **0 — survived, as intended** |

`create-food-item-id-ownership.test.ts` is new (2 cases, one of them the retry control);
`batch-upsert-duplicate-collapse.test.ts` keeps its 6 untouched cases and swaps the 2 dead ones for
the live-path case, 7 in all.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Server-side only — no schema change, no migration, no local-store change, no device path. The
ownership fix NARROWS access and adds no new auth surface, which is why it is not in the
confirm-first carve-out; the carve-out is for changes that could weaken security, and this is the
safer direction. No user-visible behaviour on any path the app actually takes, so no version or
changelog bump.

One first-draft failure worth recording: the new test's fixture omitted `food_items.source`, which
is `NOT NULL` with no default, and failed as a 23502 rather than as the assertion. The schema, not
the type, is the authority for what a fixture needs.
