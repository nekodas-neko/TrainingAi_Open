# 2026-08-23 — The sweep came back clean, and found something else (Q-394)

**Branch:** `chore/utc-offset-fixture-sweep` · **Lane A** · **closes Q-394**, files **LA-19**

Q-356 and Q-394 were the same shape twice: a test fixture anchored to a **UTC offset**
(`now() - interval '2 hours'`) while the query derives its window from the **user's** timezone.
Between 00:00 and 02:00 Brisbane, "two hours ago" is the previous local day, so the row falls
outside `[today, today]` and the file goes red — on every branch, for two hours a day. Both were
found by accident, after taking out unrelated PRs. Q-394's remaining work was the sweep:
*"nobody has looked for the third."*

## The method, because reading was not going to find it

Grep gives **29 offset sites across 16 test files**, and no amount of reading tells you which of
them the query side actually keys to a local day. So the sweep is an experiment, borrowed from the
Q-356 regression test: **shift each test user's timezone into its own 00:00–02:00 band** — an
`Etc/GMT±N` computed from the current UTC hour — and re-run. That reproduces the hazard on any
clock, at any hour, instead of waiting for one.

**14 files, 122 tests. Two failed.** Neither is the third instance.

## Failure 1 — a false positive of the method

`meal-type-reassign.test.ts` hardcodes `2026-08-18T03:20:00Z` and says why: *"13:20 Brisbane is
inside Lunch."* Both sides are pinned — the instant and the zone — which is the shape `CLAUDE.md`
explicitly sanctions. Moving the zone invalidated the fixture's own premise. Not an instance, and
worth recording as the method's known blind spot.

## Failure 2 — the test was right and the code was wrong

`oura-workout-soft-delete.test.ts` derives everything from the clock and **reads the local day back
from the row it inserted** — one of the two correct shapes `CLAUDE.md` names. It failed anyway,
because `getUnsyncedHrSessionsForDay` re-derives the window with `aestMidnight(y, m, d)` and
**ignores the user's timezone entirely**.

That opened the real finding. `aestMidnight` takes a timezone and defaults it to `DEFAULT_TZ`:

| | call sites |
|---|---|
| pass a timezone | **9** |
| omit it | **13** |

Right for the owner, who is in Brisbane. Wrong for every other account — and the Canonical Runtime
amendment is explicit that no user-visible surface should assume the owner's own device.

## What shipped

`scripts/check-aest-midnight-timezone.js` — a shrink-only ratchet, in Custom Rules (now **52 of
52**). A file listed may only lose omitting calls; a file not listed must have none; a row that goes
to zero must be deleted, so a fixed file is held at zero from then on. Both directions are
mutation-checked.

It parses top-level arguments rather than splitting on commas, and that is not pedantry: **a
`grep | sed` audit of the same tree gave 11, missing `app/api/day-log/route.ts` entirely and reading
`early-deload.ts` as one call instead of two.** The count lives in a script for that reason.

**Converting the 13 is LA-19**, deliberately not done here — it is a behaviour change on live
day-window queries, and one of the six files (`getUnsyncedHrSessionsForDay` and its sibling) turns
out to have **no production caller at all**, so whoever takes it should decide fix-or-delete rather
than inherit that from me.

## Verification

`pnpm check:rules` → **52 of 52** · full suite **545 files / 4,506 tests** green · typecheck and
lint 0 errors. The 14 swept files were restored byte-for-byte after the experiment (`git status`
clean before committing).

**Not exercised:** the sweep covers DB-backed tests that set a user timezone. A test that hardcodes
a zone string inside a query, rather than reading it from the fixture user, would not have moved —
none of the 16 does, but the method would not catch one that did.
