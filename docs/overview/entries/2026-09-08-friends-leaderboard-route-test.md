# 2026-09-08 — the leaderboard's scoping gets tested, closing an omission this sweep recorded (PS-39)

**Branch:** `test/friends-leaderboard-route` · **Lane A** · PS-39, coverage ratchet **58 → 57**.

## Why this route, and why now

`friends/leaderboard` was **deliberately left uncovered earlier in this same PS-39 sweep**, and the
reasoning was written down at the time: its scoping lives inside `inArray(allIds)` across five
queries, where a mock cannot see it, and a stub would pin canned rows and read as coverage without
being any.

That was right about mocking and wrong as a conclusion. The DB-backed pattern the sweep has since
established — used for the coach undo window, the trend SQL and the gif media — can see exactly
that, so the omission is closed rather than left standing.

The property worth coming back for is a privacy one: **a non-friend must never appear on your
leaderboard**, and nothing in the codebase checked it. In the fixture the stranger trains harder
than either party, so their absence is a result rather than an accident of having no data.

## What is pinned

- friends **and self**, never a stranger; `isSelf` marks the caller and nobody else;
- a friend who has never trained still appears, at zero — the user list drives the output;
- soft-deleted sessions, exercise logs and set logs are excluded from **both** totals;
- this week is separated from all time by a session older than the window;
- the display name falls back through `name` to `Unknown`;
- **BF-122a** — the streak's rest allowance is read from each user's own schedule, not a hardcoded 1.

## Two things the mutation pass corrected

**The BF-122a case could not tell the two allowances apart as first written.** It trained on two
*adjacent* days, and zero rest days between them clears every threshold — so a rotation (allowance
1) and a Mon+Tue weekly plan (allowance 5, the wrap-around hole) both scored 2 and the rule went
untested. The days are four apart now: three rest days sits above a rotation's allowance and below
the weekly one, which is the only band where the answers differ. Same rows, same days; only the plan
varies.

**The soft-delete filters are written out twice**, once in the weekly query and once in the all-time
one. Removing only the weekly copy changed nothing a test noticed, because the first draft asserted
all-time volume alone. Both totals are asserted now wherever one is, and the reason is recorded in
the file so a later reader keeps the pairing.

One survivor is left deliberately: `maxCompliantRestGapFor`'s rotation early-return is an equivalent
mutant — deleting it lets a rotation fall past the weekly branch its own type guard excludes it
from, to the same `return 1`. Worth keeping as a statement of intent, not testable through this
route.

## Not exercised

Runs only against a real local dev Postgres and **skips in CI** (no `DATABASE_URL` there), so the
scoping is verified locally rather than on every push — the existing convention for that directory.
Web/Node only otherwise: no device run, no native, safe-area, gesture or notification surface.
