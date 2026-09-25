# 2026-09-25 — LA-141: the ring clock's inverse was not an inverse

**Branch:** `rv182-clock-anchor-offset` · **Lane A**

## What was wrong

`resolveDsToMs` converts a ring counter value to wall-clock time. **Q-139 deliberately removed
bracket interpolation from it**, because the slope that derives — `Δutc / Δds` — is not a property of
either clock. The ring's counter ticks at exactly 100 ms by construction, so the slope was never the
unknown; only the offset is. While the ring drains buffered history, ds advances far faster than the
wall clock and that ratio collapses: Q-139 measured **17,094 ds (28.5 minutes of ring time) arriving
in 95 seconds**, an 18× squeeze, which is how one 60-second step block came to hold 1,555 steps.

`resolveMsToDs`, its inverse, kept interpolating. Its docstring said it was *"symmetric with the
forward direction"*. It was not — it carried exactly the defect Q-139 had removed from the other
half, and asserted the opposite.

Measured on Q-139's own drain shape, a ds round-tripped **16,144 ds away from itself — 26.9 minutes
of ring time**.

This is the third time this method has been measured and found wrong in this repository. Q-139 found
the 18× compression. A later sweep ran naive interpolation against the nine most recent real nights
and found every one shifted **10–48 minutes later** (one outlier +79), because a backlog drain mints
several anchors seconds apart covering very different ds ranges, so a "bracketing" pair is often two
members of the same burst and brackets nothing meaningful. That sweep's conclusion was *"do not
re-attempt naive interpolation"*. The inverse was still doing it.

## The fix

Both directions now go through one `offsetForEpoch`, so `resolveMsToDs` is literally
`resolveDsToMs` solved for `ds`:

```
resolveDsToMs(ds)  = ds * 100 + offset
resolveMsToDs(ms)  = (ms - offset) / 100
```

They are inverses by construction rather than by two models happening to agree, which is what the
shared helper is for. The trade-off Q-139 documented carries over unchanged and is restated at the
call site rather than left to be rediscovered: one offset per epoch ignores the ring's crystal drift
across that epoch, seconds per day. That is the error accepted in exchange for removing one measured
in tens of minutes.

## Who was affected

Nine call sites in `adapter.ts` convert a wall-clock window into a ds range to query
`ring_timestamp_ds BETWEEN …`. Four of them are the ones **LA-139 moved onto the anchor series
earlier the same day**, for correctness. Their windows were skewed for any span touching a drain —
so LA-139's conversion was right about which resolver to call and sat on a resolver with a
known-class defect underneath it.

## The test that could not fail

`clock.test.ts` already asserted the round-trip property — `resolveMsToDs(resolveDsToMs(ds)) ≈ ds` —
and it **passed against the broken implementation**. Its fixture spans 10,000 ds over exactly
1,000,000 ms: a slope of exactly 100 ms/ds, the one case where interpolation and the fixed-slope
model give the same answer. The property was the right one; the fixture made it unfalsifiable.

The drain case now sits beside it, and restoring the old interpolating body fails it.

One case I wrote and then removed is worth recording, because the expectation was mine and it was
wrong: I asserted the mapping is *unmoved by a burst of anchors*. It is not, and should not be —
`robustOffsetMs` estimates over every anchor in the epoch, so a new observation legitimately refines
it. My fixture also added anchors implying a lag 6,800 s from the others, which is not a burst but a
different clock. The case now asserts what is actually true: anchors that **agree** about the clock
do not move the mapping, however many arrive.

## Verification

- Mutation pass: flipping the offset's sign kills 2 cases; **restoring the entire old interpolating
  body kills the drain case**, which is the mutation that matters, since the pre-existing test did
  not catch it. An equivalent control (`memoFor(anchors).epoch` → `currentEpoch(anchors)`, the same
  value memoised) survives.
- `tsc` clean, `typecheck:tests` at baseline, **1054 test files / 9818 tests passed**.

**Not exercised:** no device, native or safe-area surface is touched. The stored values this affects
are query windows rather than persisted rows, so nothing is rewritten; reads that previously selected
a skewed ds range now select the right one. **This has not been observed against production data** —
the drain shape is reproduced from Q-139's recorded measurement, not re-measured live.

## What this unblocks

RV-182 ②. With both directions needing only the per-epoch offset, neither needs the anchor *series*
in memory — which is the obstacle to replacing the 12,582-row read (2,190 calls, 106 s, 9.4% of all
database time) with a SQL order statistic. That work is still open and now has nothing in its way.
