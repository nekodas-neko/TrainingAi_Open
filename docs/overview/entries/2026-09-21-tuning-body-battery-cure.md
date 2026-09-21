# 2026-09-21 — the Body Battery cure, fitted offline; and the blocker that wasn't there

**Branch:** `tuning/body-battery-cure` · **Agent:** Tuning · **Docs + one script.**

Earlier today I filed TN-55 saying the Body Battery nets −30/day and that validating a fix needed the
replay endpoint (TN-56) that doesn't exist. The owner asked for a cure. The blocker was not real.

## `walkBodyBattery` is a pure function, so the fit runs offline

TN-2 asserts the fit *"cannot be done from an agent sandbox"*. That was true when the arithmetic was
welded into a 200-line route with eight DB reads — and Lane A extracted it into
`packages/shared/src/health/body-battery-walk.ts` **for exactly this reason**, with a header saying
so. Bundling that module and driving it with production reads gives a full replay with no server
work. TN-56 remains worth building for the 25 sleep-staging constants, whose inputs are never
persisted, but it does not gate TN-55.

Harness committed at `scripts/tuning/body-battery-replay.cjs`.

## The harness was wrong twice before it was right

Both caught by validating against stored values rather than trusting the replay.

1. **Wake time from `max(sleep_end)` per day picks up naps** — it put wake at 15:05, 19:00, 13:01, so
   the whole day's HR fell before `wakeTime` and was discarded. Zero drain on days with 3,000
   samples. That is the Q-17 shape, reproduced by accident. Fixed by using the repo's own
   `nightSessions()` classifier, which needs `date` and `durationHours` on each row or it silently
   returns zero nights.
2. **The stress term cannot be replayed** — it needs the persisted dHRV model. The residual
   (stored drain − replayed HR drain) implies a mean |stressLevel| of **0.14–0.62 on every day**, all
   inside [0,1], which is what makes the reconstruction credible. The `--validate` step now asserts
   that range, because a residual outside it means a harness bug, not stress.

Equivalence was then asserted before any sweep: the candidate model configured as the shipped one
reproduces `walkBodyBattery` on **70 of 70 days, max absolute difference 0**.

## What is actually wrong — four defects, and the ceiling is not one

| # | defect | measured |
|---|---|---|
| 1 | the stress term dominates | **61% of all drain**, exceeds HR drain on 49/65 days, **−0.61** correlation with day end |
| 2 | sleep cannot charge | the walk starts at `wakeTime` |
| 3 | the charge ramp zeroes at the ceiling | mean multiplier **0.30–0.50** |
| 4 | drain is 3× charge | 0.60 vs 0.20 |

Full-day replay with shipped constants: **median net −85/day, 66% of days end at zero.** The stored
rows read −30 instead of −85 because they are partial-day snapshots — `hr_sample_count` ranges from
**11 to 4,676** depending on when the route last ran.

The charge ceiling, which TN-2 and TN-52 both name as the problem, is not among the four — the
correction I already made this morning, now with the mechanism measured.

## The cure

Charge through sleep, flatten the charge ramp, de-weight stress, and scale the rates by one gain.
At gain 0.5: **median net −0.2, mean end 59.2, sd 28.0, days-at-zero 5%** (from 66%). Gain is a clean
dial — 0.3 takes railing to 5% at sd 23.9 — so Lane A can move within the range without refitting.
Plan: [`2026-09-21-body-battery-rate-balance.md`](../../superpowers/plans/2026-09-21-body-battery-rate-balance.md).

**The finding that outranks the arithmetic:** the Body Battery is mostly a rendering of the
daytime-stress metric, whose sign TN-33 says is unvalidated and which the owner declined to validate
today. So the proposed `STRESS_DRAIN_RATE = 0.05` is a **de-weighting of an untrusted input**, not a
calibration of a trusted one, and the plan says not to raise it back until TN-33 settles.

## Not done, deliberately

**The constants are not final and must not be shipped as final.** The dose stepped 0.5 → 1 mg on
**2026-09-13**; the calibration-period rule I wrote this morning puts the earliest honest fit at
**2026-10-04**. The four structural changes don't depend on the window and can ship now. The implied
stress level runs 0.56–0.62 in the last four days against 0.14–0.41 before the step, so fitting
against the current window would encode the titration as normal.

## Not exercised

Nothing shipped to production. The replay is read-only against `/api/admin/db-query`, **row-scoped to
the owner**, which is the right scope since every claim is about his own data. The stress term's
*shape within a day* is not established — one mean level per day is inferred, not replayed. Whether
5% railing survives in production is unknown, because the route persists partial days.
`pnpm check:rules` **Ran 75 of 75**, all passed.
