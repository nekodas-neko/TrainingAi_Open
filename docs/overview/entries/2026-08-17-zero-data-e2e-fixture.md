# 2026-08-17 — Q-352: a zero-data account, and the two guards it unblocked

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — test infrastructure · **Lane:** Implementation B

## The gap

Every spec in `e2e/` ran as one seeded user who has a program, logs and metrics. **No first-run or
empty state was reachable from the harness at all** — which is exactly where the 2026-08-17
failure-cells sweep found the app broken (Q-451's dead primary action on the primary tab, Q-452's AI
copy about a day-one user's "significant gap"). Both shipped verified-by-hand and unguarded because
of it.

## What shipped

`e2e/zero-data.setup.ts` creates (idempotently) and signs in as `zero@local.dev`, saving a second
storage state that specs opt into with `test.use({ storageState: ZERO_DATA_STORAGE_STATE })`.

**Created from the setup project rather than from `scripts/local-db/seed.sql`, and that choice is
the whole reason this was filed as an entry rather than done inline.** `setup.sh` runs the seed only
when `users` is empty, so a developer's existing local database would never gain the account while
CI, which builds a fresh one every run, always would — a spec resting on that passes in CI and fails
locally, which is the wrong way round for a regression guard. Doing it in the setup makes both
environments identical, costs one query, and touches neither `scripts/local-db/` nor the CI
workflow (both outside either lane's ownership).

Two details worth keeping: the password hash is **copied from the seeded user** rather than
hardcoded, so it cannot drift from `SEED_PASSWORD`; and the setup **clears** the account's rows on
every run rather than only inserting, so "zero data" stays true after a spec writes to it.

## The guards, and one that had to be rewritten

`e2e/first-run-empty-states.spec.ts` — Q-451's empty state, Q-452's suppressed insight, and a
companion asserting the seeded user still sees content on all the same screens.

**Q-452's guard failed its mutation check on the first attempt**, and that is the useful part. The
obvious assertion — "no AI Insight card is visible for a zero-data account" — **passes with the gate
deleted**, because a zero-data account produces no insight to render either way. A guard that cannot
fail is not a guard (Q-259). Rewritten to assert on the **request**: with the gate removed the spec
now sees 8 `POST /api/ai/health-insight` calls and fails. The gate's real contract is "neither
fetches nor renders", and the fetch is the half observable independently of what the model does.

Mutation results:

| Mutation | Result |
|---|---|
| Remove Q-451's empty-state branch | Q-451 spec fails ✓ |
| `hasData={true}` on the score screens | Q-452 spec fails (8 requests) ✓ |
| Heart-rate gate → `data.hrMin \|\| data.recentHrv` | **Passes** — see below |

## A correction to yesterday's Q-452 entry

That third mutation was expected to fail and did not, which exposed a wrong claim I had made in the
Q-452 PR and journal: that `data.hrMin`/`data.recentHrv` are "live-ring-only, therefore null for an
account with months of recorded RHR", cited as measured.

Measured properly against `/api/readiness-score` for the seeded user:

```
hrMin: null   hrCurrent: null   recentHrv: 65   baselineHrv: 65
```

`recentHrv` is populated, so that gate is **also correct**. The earlier `card=0` reading was a
**cold-compile timing artifact** — the probe waited 6 seconds and `/api/readiness-score` had not
resolved on a first visit, so `data` was still null.

**The shipped code is unchanged**: the trend-series gate is still the better choice because it
mirrors what the *prompt* reads (`body_metrics.restingHeartRate`/`hrvMs`) rather than a different
API's fields that happen to correlate. But it was chosen for that reason, not because the
alternative was broken. The claim has been corrected in the Q-452 journal entry, the app-shell
domain index, the Lane B baton and the code comment.

**The lesson, which this repo already knew:** a fixed 6-second wait is not a measurement on a cold
dev server. `SKELETON_TIMEOUT_MS` is 20 s and `goal-round-trip.spec.ts` records a 39.7 s cold run
against a 7.6 s warm one, both for exactly this reason. The new companion spec uses `toPass` with a
30 s budget and says why.

## What was NOT exercised

- **The device.** Still the web build; the zero-data account changes who is signed in, not what
  runtime executes. `getLocalStore` returns null here as always.
- **First-run beyond these two screens.** The fixture makes 21 zero-data screens reachable; two are
  covered. The rest of the sweep's clean findings remain unguarded.
- **Whether `zero@local.dev` interacts with the vitest DB suite.** Checked that nothing asserts on a
  user count, but the suites were not run against a database that had the account until this PR's
  full run, which was green.
