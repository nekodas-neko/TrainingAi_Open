# TN-55 — the Body Battery stops being a countdown

**Branch:** `lane-a/tn55-body-battery-rate-balance` · **Lane A** · 2026-09-24

The battery netted about −48 points a day and ended at the floor on two thirds of days, which is
the owner's *"it's pretty much useless"*. This ships the fix the Tuning agent fitted, with the
owner's 2026-09-22 sign-off to ship now on provisional constants and re-sweep after 2026-10-04.

## What shipped

| file | change |
|---|---|
| `packages/shared/src/health/body-battery-walk.ts` | the charge ramp is flat at or below the rest threshold |
| `app/api/body-battery/route.ts` | `CHARGE_RATE` 0.20 → 0.120 · `DRAIN_RATE` 0.60 → 0.080 · `STRESS_DRAIN_RATE` 0.2 → 0.020 · `MODEL_VERSION` v5 → v6 |
| `scripts/tuning/body-battery-replay.cjs` | `SHIPPED` mirrored forward, the v5 set kept beside it |
| `packages/shared/src/health/__tests__/body-battery-walk.test.ts` | the ceiling is a step now, and that is pinned |

`REST_THRESHOLD` is untouched, which is the point of the entry: TN-2 and TN-52 both framed this as
a threshold problem and it was a ratio problem.

## Measured, not assumed

The entry forbids quoting the plan's before-figures as current, so they were re-measured. The
harness validates 14/14 days against stored production values; 66 days replayed, shipped against
proposed, same reconstructed stress series on both sides:

| | shipped | proposed |
|---|---:|---:|
| median daily net | −48.0 | **+0.2** |
| mean end value | 13.5 | **59.0** |
| sd of end value | 25.1 | **25.2** |
| days ending at 0 | **67%** | **0%** |
| days pinned at 100 | 0% | 9% |

The plan's pass test is net within ±5 of zero, days-at-zero under ~10%, and the spread preserved.
All three hold, and the third is the one that matters: a fix that centred every day near 50 with a
collapsed sd would score well on the first two and have destroyed the signal.

## The pre-ship gate, and what it actually found

`DRAIN_RATE` falls 7.5×, so the plan required proof that a workout day still separates from a rest
day before shipping. Over 48 workout days against 18 rest days:

| | workout | rest | Cohen d |
|---|---:|---:|---:|
| drain, shipped | 102.5 | 87.7 | 0.31 |
| drain, proposed | 12.1 | 10.1 | **0.37** |
| end value, shipped | 13.3 | 13.9 | −0.03 |
| end value, proposed | 58.5 | 60.3 | −0.07 |

Drain separates slightly better than before. The end value — the number actually on the screen —
separates almost not at all, in **either** model. That is Q-521's finding (drain tracks ring wear
time, `r = +0.518`, rather than exertion, `r = −0.153`) showing through, it pre-dates this change,
and the plan is explicit that it must not be patched by putting `DRAIN_RATE` back. Filed as its own
entry rather than fixed here.

## Three things the entry and plan got wrong

**"Ship the four structural changes."** Written 2026-09-22, before the 2026-09-23 revision removed
overnight charging. One structural change survives — the flat ramp. The rest are constants.

**"This change re-scores all 84 stored days."** It does not. `upsertBodyBatteryDaily` has exactly
one caller, and it writes *today's* row on each read; no backfill path touches the table. Every row
stamped `v5:` stays v5 forever. The consequence is small and worth stating rather than fixing: no
user-facing surface reads that history, and the one cross-day field the route does consume from it
(`hrMaxObserved`) is an observed heart rate, unaffected by any of these constants. The re-sweep is
also unaffected, because the harness fits from raw HR rather than from stored battery rows.

**`--validate` cannot check pre-v6 rows any more.** It bundles the live walk, and the walk changed,
so validating a v5 row now needs the v5 constants *and* a checkout from before this commit. Both
are recorded in the harness. It works again against the default from a few days of v6 rows onward.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | the old ramp multiplier returns | killed (3) |
| 2 | the ceiling becomes exclusive, `<` for `<=` | killed (2) |
| C | `p.chargeRate * dt` written `dt * p.chargeRate` | **survived** (correct) |

## Failure surfaces not exercised

No device. `app/api/body-battery/__tests__` could not be run locally in this session — those five
files are covered by CI's Tests job, and none of them assert a constant or a battery value (they
assert ranges and relative equalities), so the constants change does not reach them.

The constants are provisional by design. The dose stepped 0.5 mg → 1 mg on 2026-09-13, so the
calibration-period rule puts the earliest honest fit at 2026-10-04; the owner chose to ship now and
re-sweep then rather than leave the battery a countdown for another fortnight.
