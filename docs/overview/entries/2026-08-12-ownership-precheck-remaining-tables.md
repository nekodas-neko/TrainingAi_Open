# 2026-08-12 — the ownership guards on tables with no `user_id` are now covered (Q-155)

**Branch:** `fix/ownership-precheck-remaining-tables` · test-only, no runtime change, no version bump.

## What this closes

Q-155's mutation sweep neutralised all **246** `user_id` predicates in the adapter and its slices at
once. It could not reach **13 tables that have no `user_id` column at all** — for those, ownership is
enforced by a parent row-count check or a join, so rewriting `eq(x.userId, userId)` never touched the
guard and "no predicate failed" said nothing about them. The 2026-08-10 pass covered two
(`removeSessionExercise`, `ensureWorkoutSession`) and left the rest explicitly sampled, not closed.

This adds **13 cases** covering the remainder. The suite goes 42 → 55 tests in that file, 3,684 →
3,697 overall.

### The parent-guard class — four methods

Each is the shape CLAUDE.md names by name: a user-scoped UPDATE on a parent whose id came from the
client, followed by an **unscoped** `DELETE … WHERE parent_id = id` + re-insert of the children.

| method | child table with no `user_id` | guard that stops it |
|---|---|---|
| `saveProgressionStyle` | `style_sets` | row-count check on the `progression_styles` UPDATE |
| `updatePhaseSet` | `program_phases` | user-scoped SELECT on `phase_sets`, throws if absent |
| `updateSavedMeal` | `saved_meal_items` | `setWhere: eq(savedMeals.userId, userId)` → 0 rows → throw |
| `saveProgram` | `program_sessions`, `schedules`, `schedule_days` | row-count check on the `programs` UPDATE |

### The friendships class — three methods

`friendships` is the odd one out: user-scoped **twice** (`requester_id`, `addressee_id`) and by
neither name. The 246-predicate sweep never saw it, and
`scripts/check-repository-user-scoping.js` cannot see it either — that check fires on a method that
takes `userId` and never uses it, and all three of these use it. They also differ in *which* party
may act (`acceptFriendRequest`/`declineFriendRequest` → addressee only; `removeFriend` → either
party), which is exactly the distinction a careless edit flattens.

## Nothing here is a fix

Every one of the seven guards is correct today. They were read first, then tested. The value is
entirely in what they stop tomorrow, in the highest-severity class this project has.

## Verified by mutation, one guard at a time

Per the warning at the top of that test file — two earlier tests in it *could not fail* as first
written — every reject case was checked by breaking its own guard and observing the result:

| mutation | failing tests |
|---|---|
| `saveProgressionStyle` — drop the `userId` predicate | 1 — its own |
| `updatePhaseSet` — drop the `userId` predicate | 1 — its own |
| `writeSavedMeal` — drop `setWhere` | 1 — its own |
| `saveProgram` — drop the `userId` predicate | 1 — its own |
| `acceptFriendRequest` — drop the addressee predicate | 1 — its own |
| `declineFriendRequest` — drop the addressee predicate | 1 — its own |
| `removeFriend` — drop the two-party `or(...)` | 1 — its own |

Each permit case pairs with its reject case, so a guard that rejected *everyone* would not pass.

### Two things that went wrong on the way, both worth keeping

**1. The first mutation pass reported four guards as unguarded, and it was the harness.** Parsing
vitest's `--reporter=json` output gave zero failures for four mutations that in fact fail loudly.
Running one by hand showed the real failure immediately. A measurement that says "your test is
worthless" deserves one manual reproduction before it is believed — the same discipline this file
already applies in the other direction.

**2. The friendship cases contaminated each other.** `friendships` is UNIQUE on
`(requester_id, addressee_id)`. A case that failed skipped its cleanup `DELETE`, so the *next* case
failed on the constraint rather than on its own guard — mutating `acceptFriendRequest` reddened the
decline case too, which misattributes the mutation. Fixed by seeding through an upserting helper and
cleaning up in `finally`; re-measured, every mutation now fails exactly one test.

**3. `declineFriendRequest`'s where-clause is byte-identical to `acceptFriendRequest`'s**, so a
`replace(..., 1)` mutation on it silently re-mutated *accept* and left decline unmeasured. Caught by
noticing the two runs reported the same failure; re-mutated against the `db.delete` line, which is
unique to decline.

## Deliberately excluded

`exercise_media` and `exercise_gif_cache` — the last two of the thirteen. Both are keyed by exercise
**name**, hold no per-user row, and are written only by admin routes. That is shared-catalogue
maintenance, the same category the 2026-08-10 pass placed `renameExercise` in, not a leak with a
missing guard.

## What Q-155 still has open

Unchanged by this: exact per-predicate attribution across the 246 (the quartile bisect bounds, it
does not attribute), and the ~3,300-test full suite, of which only the DB tests have ever been
measured. The **pre-check/join class is now closed for all 13 tables**, which is the part this entry
moves.

## Not exercised

No runtime code changed, so there is nothing to verify on device. The tests run only against a real
local dev Postgres and skip cleanly in CI, which has no `DATABASE_URL` — meaning **CI's Tests job
does not run any of this**, here or before. The mutation evidence above is local, and that is the
only place it can be.

## A harness note that cost a diagnosis

Two full-suite runs went red mid-session with failures that had nothing to do with the diff:
`Hook timed out in 10000ms`, and an unrelated route test getting `Too many requests` where it
expected `Invalid date`. Cause: the seven back-to-back mutation runs consumed the `rate_limits`
budget for routes the suite exercises, and added pool contention on top. Clearing `rate_limits` and
re-running gave 448 files / 3,697 tests green, twice in a row. So it is **load-dependent, not a
deterministic repeat-run hazard** — two consecutive clean suite runs do not trigger it. Recorded in
CLAUDE.md's local-DB section rather than filed as a bug.
