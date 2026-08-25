# 2026-08-25 — the dead-repo-method baseline is empty (LA-28)

**Branch:** `chore/delete-dead-repo-methods` · **Lane A** · `lib/data/` + `scripts/`. No product change.

LA-26 shipped `scripts/check-dead-repo-methods.js` hours earlier with **6 names baselined**. A
baseline is a debt row, not an approval, and this pays it off: **98 lines of dead code removed and
the baseline is now empty**, which is the state CLAUDE.md prefers outright — a dead method is a
*regression* rather than a debt row, the same property it credits `check-aest-midnight-timezone.js`
for.

Deleted, declaration and implementation together: `isUserActive`, `logExercise`,
`getWorkoutSessionOwners`, `getExerciseLogOwners`, `getLastExerciseLog`, `renameExerciseRefs`.

## The one thing that was actually blocking it

LA-26 deliberately did **not** delete these, because two are bulk *ownership* lookups and deleting a
security-adjacent helper on a "reads as superseded" basis is how a guard gets removed by accident.
So the question was whether anything still depends on them. It does not, and here is the trace
rather than the assertion:

- `pushMutations`'s `workout_log` branch calls `logExerciseFromPayload(userId, …)`, which goes
  through **`repo.ensureWorkoutSession(userId, workoutSessionId, …)`**.
- `ensureWorkoutSession` inserts with `userId`, and on the already-exists path re-reads the row
  **scoped to `user_id`** — its own comment says *"a sessionId belonging to another user must never
  be silently adopted"* — then returns a typed refusal so the route answers **404 rather than 403**,
  because a session owned by someone else must not be distinguishable from one that does not exist.
- The sibling branch, `session_rpe`, calls `setSessionRpe(userId, …)`, whose `WHERE` carries
  `eq(userId, userId)`.

So ownership on the sync-push path is enforced by user-scoped writes, not by a bulk owner map. The
two lookups were an alternative route that was never wired up.

## What the deletion proved about the check

Removing the six made the check **fail**, by design — the baseline is shrink-only, so a name that
stops being dead must leave it in the same PR:

```
Baseline is shrink-only and 6 entries are no longer dead:
  • isUserActive() is gone from the interface
  …
```

That is the ratchet doing its job on its first real use, one day old. Emptying `BASELINE` in the same
commit cleared it.

## Verified

- `tsc --noEmit` clean after removing 98 lines — nothing referenced any of the six.
- **4,821 tests pass** (572 files), `pnpm check:rules` **Ran 58 of 58**.
- **Re-mutation-tested with the empty baseline**, because that is a different code path from the one
  LA-26 tested: injecting a new dead method still fails with it named. (The first attempt at this
  silently injected nothing — the anchor string had changed — and reported a pass. Re-run against a
  real anchor. A mutation test that does not mutate is worse than none, because it certifies.)
- The check now reads `303 repository methods, none dead. Baseline is EMPTY, so the next one is a
  regression.`

## Also in this PR

`docs/implementation-backlog.md`'s size baseline **ratcheted down 12021 → 11997**, following the file
after LA-28's entry left the queue. Headroom is not bankable.

That makes the session's net **+49** rather than the +73 recorded against BF-4 — worth the
distinction: the three raises were for entries being *corrected*, this reduction is one being
*finished*.

## Not exercised

Nothing runtime. Deleting unreferenced code is compiler-verifiable and `tsc` verified it; no route
behaviour changed, so no device check is owed. The ownership trace above was read from source rather
than probed at runtime — the cross-user refusal in `ensureWorkoutSession` has its own tests, but this
change did not add one, because it removed code rather than changing that path.
