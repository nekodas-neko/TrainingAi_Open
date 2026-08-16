# 2026-08-08 — The ring clock stops compressing time during a history drain

**Domain:** activity / devices / platform — v1.270.25, JS-only (no APK rebuild)

Q-139, the queue's top 🔴 item. **Owner decision, 2026-08-08: option 2 — fix forward, no backfill.**

## The defect

A clock anchor is `(batch max ds, server receive time)`, so its *lag* is however long that batch took
to arrive. `resolveDsToMs` interpolated linearly between the two anchors bracketing a `ds`, which
means the local time-scale it applied was `Δutc / Δds`. While the ring drains buffered history, ds
advances far faster than the wall clock and that ratio collapses.

Measured on real production frames (2026-08-07, reproduction exact — replaying the rollup's own
`computeStepsByDay` returns 4,178 against the stored 4,176):

| | value |
|---|---|
| anchor-lag spread over the day (n=99) | 56.2 min |
| worst observed compression | Δds 17,094 (**28.5 min** of ring time) → **95 s** of wall clock (~18×) |
| resulting 60 s step windows | **1,555** · 664 · 268 steps — the top one is 26 steps *per second* |

`resampleSteps` folds per-sample steps into fixed 60 s wall-clock blocks, so everything squeezed into
a block sums there. That is the mechanism turning a compressed timeline into an impossible step rate.

## The fix

**The slope was never the unknown.** The ring's counter ticks at exactly 100 ms per ds by
construction; only the offset is unobserved. So `resolveDsToMs` now applies the fixed slope with a
single offset per epoch, estimated as the **p10 of anchor lag** rather than the raw minimum — an
event cannot be received before it happened, so the floor of the lag distribution is the honest
offset and the tail is pure receive latency. The production distribution has exactly that shape: p0→p10
spans 1.4 min against a 56.2 min full spread. The percentile rather than the minimum is what stops one
early-arriving glitch defining the offset for a whole epoch.

This also makes the mapping **monotonic in `ds`**, which the interpolating version could not promise
— and a step bucket that moves backwards is unrecoverable once resampled.

**The sibling gap the entry named shipped with it:** `mergeStepCounterWithLive` applied
`isPlausibleStepWindow` to *live* windows only, so model windows went through unfiltered — which is
how the three impossible windows reached the daily total. It now gates both. Dropped, not clamped:
there is no way to know how many of a bad window's steps were real.

## The trade-off, stated so it is not rediscovered

A single offset per epoch ignores the ring's own crystal drift across that epoch — seconds per day.
That is the error this accepts in exchange for removing one measured in tens of minutes. If drift
ever matters, the fix is a sliding-window offset that preserves monotonicity, not a return to
slope-from-anchors.

**Stored history was deliberately not rewritten** (the owner's option 2). The last ~35 days therefore
read inconsistently with everything after this deploy — days that should come down stay inflated. The
read-only `previewStepsBackfill` still exists if that is ever worth quantifying.

## Verification

`tsc --noEmit` clean · full suite **411 files / 3253 tests, all green**.

Four new clock tests, and one replaced. The replaced one is the point: it asserted that 1,000 ds
across 110 s of wall clock meant *"the ring ran 10% slow"* and should be interpolated. It does not —
that 10 s is transport lag on the second observation, and treating it as slope is the bug. The test
now asserts the fixed-slope answer, with the reasoning written where the old assumption used to live.

The new tests cover: the fixed slope; **the measured production case** (Δds 17,094 in 95 s preserves
28.5 min instead of squeezing it); monotonicity across anchors whose lags disagree; and that one
hour-late anchor does not drag the offset. Plus one in `step-estimate.test.ts` proving a 1,555-step
60 s **model** window is now dropped from the daily total.

**Not exercised:** nothing on device, and no production data has been re-decoded. The correctness
argument is the measured reproduction above plus the tests; the on-device consequence (step timelines
stop clustering into false bursts) will only be visible after the next real drain. `dayForDs` derives
the local day from this conversion, so day-boundary assignment near midnight should also get more
reliable — not separately verified.
