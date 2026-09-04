# 2026-09-04 — a gate reason for training stress, and two columns the sync dropped (Q-270)

**Branch:** `fix/training-stress-gate-observability` · **Lane:** A · **Domain:** readiness / platform

## Why observability first

`training_load_ots` has been NULL on all 104 days and three diagnoses of why have been wrong. The
entry is explicit about the reason, and about what to build before guessing again: the persist is a
side effect of a GET, it fires only on `status === 'ok'`, and nothing records that the route ran at
all. So "never called" and "called and gated" are indistinguishable from outside — and a session that
cannot tell those apart produces a fourth wrong answer.

## What shipped

`oura_daily_derived.training_load_gate` — migration **265**, local SQLite **v37** — written by the
route on **every** evaluation:

| value | meaning |
|---|---|
| NULL | the route never ran for this day |
| `'ok'` | it ran and scored; `training_load_ots` beside it is the number |
| a reason | it ran and refused: `no_readiness` · `readiness_learning` · `no_profile` · `insufficient_met` |

The reasons are the existing `TrainingStressResult` gate enum, not a new vocabulary — this records a
decision the code already makes and then discards.

`'ok'` rather than NULL on the success path is load-bearing and has its own test. The upsert
COALESCEs, so writing NULL would leave a morning's `insufficient_met` standing on a day that scored
by afternoon.

Migration **266** regenerates the `claude_ro` views. That is not bookkeeping: the generator emits an
explicit column list per view, so without it the column is invisible to `/api/admin/db-query`, which
is the only way anyone reads production data here — which would defeat the entire point. Verified
against 264 the way migration 259's note prescribes: the two differ by exactly this column.

## The bug found on the way, which is worse than the one I came for

`daytime_stress_coverage_min` and `chronic_stress_granular_nights` were in `DERIVED_COLS`, in the
local mirror types, in the sync-engine's outbox payload, and in the round-trip test's fixture — and
appeared **zero times** in `adapter.ts`. The server's push branch dropped both. A device backing up
its derived rows has silently lost them for as long as they have existed.

**The tripwire for exactly this class could not see it.** `oura-daily-derived-sync.test.ts` has a
test named *"the push payload carries every DERIVED_COLS column (drift tripwire)"* — and it compares
the test's own fixture against `DERIVED_COLS`. Both of those are lists; the test controls one and
the slice controls the other, and neither is what actually runs. The landing assertion beside it
named five columns by hand, so it held while two others were being dropped.

A second assertion now drives off `DERIVED_COLS` and asserts every column the payload sends actually
**lands in Postgres**. Mutation-verified: restoring the bug fails it by name (`daytimeStressCoverageMin`,
`chronicStressGranularNights`) and leaves the original assertion passing — the blind spot, shown.

## What is owed, and it is not code

One query, a few days from now, once the column has had time to be written:

```sql
SELECT day, training_load_gate, training_load_ots
  FROM claude_ro.oura_daily_derived ORDER BY day DESC LIMIT 14
```

All-NULL means the route is not being called, and the fix is on the client (the entry's `warmCache`
candidate). A reason string means it is called and refusing, and names which gate. Do not diagnose
further until that read exists.

## Not exercised

The route was confirmed loading under the real Next runtime on `pnpm dev` (unauthenticated → 401,
failing closed); its authenticated write path runs in tests against the same local Postgres. **Not
exercised: the device.** Local SQLite v37 and the push-branch fix run in the web/test path only —
native SQLite does not run in this sandbox, so the migration's first real execution will be on the
phone. No production write; every production number here was read through `claude_ro`.

## Gates

lint 0 errors / 17 warnings in the changed areas · `tsc --noEmit` clean · `pnpm check:rules` 67 of 67
· full suite 756 passed | 5 skipped (761 files), 6436 tests passed.
