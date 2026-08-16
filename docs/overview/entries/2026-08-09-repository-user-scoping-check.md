# 2026-08-09 — the cheap half of Q-155: a method that takes `userId` and never uses it

**Branch:** `test/repository-ownership-coverage` · **Domain:** `platform` · no version bump
(nothing user-visible)

## Where Q-155 had got to

Removing the `user_id` scope from `getBodyMetricsBaseline` — turning a user-scoped read into one
that returns any user's row — left the whole suite green. Three passes of hand-written ownership
tests followed, 36 of them, each verified by mutation. But the entry is honest that this can only
ever *bound* the problem: exact per-predicate attribution needs ~246 individual runs (~5.5 h), and
"no quartile at zero" is much weaker than "all 246 covered".

Adding test 37 buys less than the three passes before it. The entry's own stated goal points
somewhere else: *"fails loudly when a new unscoped method appears."*

## What shipped

`scripts/check-repository-user-scoping.js`, in Custom Rules. It reads every function in
`adapter.ts` and its slices whose signature takes `userId: string`, and fails if the body never
mentions `userId` or `user_id` again — a parameter that is never used cannot be scoping anything.

**368 methods take `userId`. All 368 use it.** So the check passes clean from day one, which also
independently confirms what the 2026-08-07 review found by reading: the scoping *is* correct today.
The value is entirely in what it stops tomorrow.

## What it does not catch, stated plainly

1. A scope on the **wrong** column or id — `eq(x.userId, someOtherId)` reads as "used".
2. A join that mentions `userId` but does not actually constrain the rows.
3. Ownership enforced by a pre-check that exists but is wrong (`ensureWorkoutSession`'s throw,
   `renameExercise`'s `createdBy` compare).
4. Anything outside the adapter and its slices.

It is an omission detector, not a correctness proof. The 36 hand-written cases cover (1)–(3) for
the methods they name, and **Q-155 stays open** for the rest. Both facts are in the script's own
header, because a check whose limits live only in a journal entry gets over-trusted.

## Verified

- Run against the real tree: `368 methods take userId, all use it`.
- **Mutation-tested against Q-155's own example**: stripping
  `eq(s.bodyMetrics.userId, userId)` from `getBodyMetricsBaseline` — the exact edit that left the
  suite green — makes the check exit 1 and name the method. Working tree restored afterwards.
- Four unit tests run the script against synthetic trees: one unscoped method (fails, names it),
  a drizzle-scoped one, a raw-SQL and a delegating one (pass), and a method with a multi-line
  return type (passes).
- `tsc --noEmit` clean · **432 files / 3438 tests** green · all 16 custom-rule scripts pass.

## Two wrong versions, and why they are worth recording

The first detector reported **29 violations**, including `getBodyMetricsBaseline` — the entry's own
example of a *correctly* scoped method. Cause: it took the first `{` after the parameters as the
body start, and a multi-line return type (`Promise<{ temp: … }>`) opens a brace first, so the
"body" it scanned was the type annotation. Pinned as a test case.

The second attempt over-corrected, requiring `userId` to appear in a recognised query form
(`.userId, userId`, raw `user_id`, or a delegating call). That left **73 unclassified** — mostly
`users`-table methods where the id *is* the row key (`eq(s.users.id, userId)`), delegations with a
different argument order, and `.values({ userId, … })` inserts. All correct; the rule was just
narrower than the codebase.

Both wrong versions would have been believable if I had not checked a known-good method against
them. That is the general lesson: **a static check's first run should be spent looking for false
positives among methods you already know are fine**, not celebrating the violation count.

## Not exercised

No runtime behaviour changed, so there is nothing to verify on device. The check is static and runs
in CI.
