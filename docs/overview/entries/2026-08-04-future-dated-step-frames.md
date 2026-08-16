# 2026-08-04 — Q-56: the step rollup can no longer date a frame into the future

**Branch:** `fix/future-dated-ble-ingest-rows` · **Domain:** devices · body · **Version:** 1.255.1

## What was wrong

On 2026-07-30 five `body_metrics` rows were written carrying **real** Oura-BLE step counts dated up
to **five days in the future**. By 2026-08-04 all five had self-healed as their dates arrived, which
is exactly why this needed fixing rather than closing: the symptom expires by construction and the
writer stays.

The ring emits a monotonic deciseconds counter, never a wall clock. Converting one needs an observed
`(ringDs ↔ utc)` anchor. The step path did it with `measuredAtMs(ds, newestAnchorDs, newestAnchorUtc)`
— bare linear extrapolation, **unbounded in both directions**, against whichever anchor was newest.

## The mechanism, confirmed against production today

Anchors re-stamp mid-drain, and ring time runs far ahead of wall time while a drain is in flight.
Five consecutive live rows from this morning:

| anchor_ds | anchor_utc | ds gap | real gap |
|---|---|---|---|
| 25 920 113 | 08:34:59.9 | — | — |
| 25 929 129 | 08:35:04.5 | +9 016 (15.0 min ring) | 4.6 s |
| 25 937 020 | 08:38:50.6 | +7 891 (13.2 min) | 226 s |
| 25 946 196 | 08:39:15.7 | +9 176 (15.3 min) | 25 s |
| 25 948 290 | 08:39:24.4 | +2 094 (3.5 min) | 8.7 s |

A frame at ds 25 948 290 resolved against the 08:34:59 anchor maps to **09:22 — 43 minutes into the
future**, from a five-second-old anchor. Scale that to a drain replaying days of the ring's history
buffer and you get days ahead, one batch, self-healing. That is the observed shape.

**At rest the exposure is zero** — checked: 0 frames currently sit above the newest anchor, and 0
future-dated rows remain across `body_metrics`. The window only exists *during* a drain, which is
why a static snapshot never reproduces it and why this sat unproven.

## What changed

Two fixes, and they do different jobs:

**1. Nearest-anchor resolution.** The step path now uses `resolveDsToMs` — interpolate between the
anchors bracketing a frame, else extrapolate from the **nearest** one. That machinery already
existed (migration 161, `lib/oura-ble/clock.ts`) with the explicit comment that reads should resolve
against *"the observation nearest **that frame**, not the newest"*, and it had exactly one call site.
The step path was not it. This bounds the error to one drain interval instead of "time since the
last sync".

**2. A future guard.** A frame that still resolves past `now + INGEST_FUTURE_TOLERANCE_MS` (60 s,
the same tolerance the scale ingest path already applies) is **dropped, not clamped**. Dropping is
recoverable and clamping is not: `body_hex` is archival and the rollup re-runs, so a skipped frame
is placed correctly by the next pass once a nearer anchor exists — a test pins exactly that. Clamping
would fold a future day's steps into today permanently.

Fix 1 alone would not have prevented the incident: with only the stale pre-drain anchor in the table
there is no nearer observation to resolve against. Fix 2 is what makes the class impossible; fix 1 is
what makes the data land correctly on the retry.

`runStepCounterPipeline` now takes a `toMs` resolver rather than an anchor pair, so the pipeline no
longer holds a second opinion on anchor policy.

## Verification

10 new tests in `lib/oura-ble/__tests__/step-day-buckets.test.ts` — the file had none. They include a
test that pins **the defect itself** (`measuredAtMs` really does date that frame to 2026-08-09), so
the fix cannot be mistaken for a test that never failed. Full suite green; typecheck and lint clean.

## Not fixed, and it matters

**`toDate` in `aggregateOuraRawSamples` (adapter.ts:4696) is still single-anchor.** It is the shared
converter for the *rest* of the rollup — sleep session start/end, HR bins, temperature, and its own
`dayForDs` — so those paths keep the unbounded extrapolation the step path just lost. Converting it
looks like a one-line change and is not: it would move sleep-session boundaries for the whole rollup,
unverified, on the same day the owner's wake times were corrected by a different fix. Filed as its
own queue entry rather than folded in here.

**The hypothesis is still a hypothesis.** The mechanism is evidenced from production anchor rows and
the arithmetic is exact, but the 2026-07-30 incident itself was never replayed — that needs a drain
in flight, and the sandbox has no ring. What is proven is that the code path *can* produce the
observed dates and now cannot persist them.

**Per-frame epochs are not threaded.** `oura_raw_samples` carries an `epoch` column; the step queries
do not select it, so resolution uses the current epoch for every frame. Behaviour across a ring reset
is unchanged from before this PR (post-reset frames still fall below the rollup cutoff), so this is
not a regression — but it is the honest next step for that path.
