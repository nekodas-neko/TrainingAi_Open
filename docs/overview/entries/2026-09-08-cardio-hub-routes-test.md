# 2026-09-08 — the cardio hub gets tests, and its resilience turns out to be partial (PS-39)

**Branch:** `test/cardio-hub-routes` · **Lane A** · PS-39, coverage ratchet **78 → 75**. Files
**LA-82**.

## What shipped

`lib/__tests__/cardio-hub-routes.test.ts` — 23 cases over `GET /api/cardio-week`,
`/api/cardio-trends` and `/api/running-bests`. No product change; the three routes behave as
written.

Batched because they paint one hub from the same activity and heart-rate rows, and because
`cardio-week` alone runs eleven repository queries whose failure behaviour is a decision rather than
an accident. Pinned: a delta needs **both** windows corroborated; `weekGoalSoFar` scales to the days
elapsed, so week-to-date is compared against week-to-date; a lazy day means **neither** lifting nor
cardio (Q-88); the trend curves see runs only; `running-bests` looks back three years as a stand-in
for all-time.

## What the tests found: LA-82

The first draft asserted that "every optional read degrades rather than fails" — nine `.catch(() =>
[])` calls in one route say so plainly. The test failed with `Error: db down`.

**Measured rather than re-read: each of the seven repository calls was failed in turn.** Five are
absorbed. `getUserById` and `listBodyMetrics` take the whole route down, because `resolveHrProfile`
runs before the `Promise.all` and guards only one of its own three reads. That also makes the
route's four `.catch`es on `listBodyMetrics` dead defence — the profile has already thrown.

Filed as **LA-82** rather than fixed here: whether a hub should paint a default resting HR of 60 as
though it were measured, or fail loudly, is a design question and not an obvious bug. The entry
carries a recommendation (guard both, and add `restingHrSource: 'unavailable'` so a consumer can
tell "we know it is 60" from "we could not ask"). The tests pin **current** behaviour and say so —
including a case asserting the two unguarded reads *do* throw, so the fix will have to update this
file deliberately.

## Mutation pass — 33 mutations, 4 survivors, all real

Two shared one cause and it is the instructive one. The rule under test is *"report the max delta
only when both windows are reliable"*, and my fixture gave the prior window a single reading. One
reading has no corroborated max at all, so `observedPrior.max != null` rejected it and the
`isReliable` guard was never reached — the case passed for the wrong reason and both reliability
mutations survived. The fixture now uses a window with **enough readings to have a max and not
enough to be called reliable**, which is the only band that tests the rule as written. A third case
covers the current window being the unreliable one.

The others: the average delta is deliberately *not* gated on reliability (an average needs no
corroboration) and nothing said so; and `days.length || 1` had no case, so a week with no rows could
scale its goal to zero and read as already cleared.

## A mocking mistake worth remembering

`getHrForWindow` was first stubbed with a `mockResolvedValueOnce` chain, one value per window. That
is wrong here: `resolveHrProfile` calls the same method before the route's own two, so it ate the
first value and shifted every assertion after it. The stub now answers by **which window is asked
for**, keyed on the start date — which is also what the real repository does.

## And a second finding, from the gate rather than the code: LA-83

The full local suite went red in two DB-touching files that this PR does not touch — it adds one
mock-only file that opens no connection. Measured rather than assumed, three full runs: clean tree
**826 passed**, with the new file **2 failed**, with the same file again **827 passed**. Scheduling,
not logic.

What the two tests have in common is no tolerance for contention: one died on
`Test timed out in 5000ms`, the `unit` project's default, and the other waits a fixed 250 ms for a
`DELETE` the write path deliberately does not await. **`vitest.config.ts` already diagnoses this
class** — the `rollup` project carries `testTimeout: 60_000` with the reason beside it, *"Contention
is what tips these over"* — and the `unit` project, which holds every other DB test, kept the
default. Filed as LA-83 with that fix and a condition-based wait for the prune test.

CI is unaffected (no `DATABASE_URL` there, so those files skip). What it costs is the local
full-suite gate every agent runs before merging, which is worse than it sounds: a red that is not
yours trains you to re-run rather than read.

## Not exercised

Web/Node only. No device run: these are server routes with no native, safe-area, gesture or
notification surface, and the tests mock the repository, so no Postgres path, no drifted production
data and no Samsung WebView rendering were exercised.
