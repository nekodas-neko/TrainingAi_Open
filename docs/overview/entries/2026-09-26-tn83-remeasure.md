# 2026-09-26 — TN-83 re-measured: the fix made the announcement rate worse, which is correct

**Branch:** `docs/tn83-remeasure` · **Lane A** · docs-only · the calibration is the owner's

## What was owed

LA-149 routed the sleep verdict through `nightSessions()`, so it no longer judges naps and 0 h
fragments as nights. TN-83's own sweep — 10.9 prominent announcements per 30 nights against a 4–6
target — was counted over `sleep_sessions` **rows**, so it did not survive that fix. The entry said
so and left the re-measure owed.

## The result inverts the expectation

Run with the shipped `nightSessions()` → `toVerdictNights()` → `sleepVerdictForNight()` over the
owner's real 125 rows (106 dates):

| population | judged | poor | good | normal | prominent / 30 nights |
|---|---:|---:|---:|---:|---:|
| raw rows | 96 | 25 | 9 | 62 | **10.6** |
| `nightSessions()` | 67 | 22 | 13 | 32 | **15.7** |

The raw figure reproduces TN-83's 10.9 closely (the small gap is a 200-day pull against their 120),
which is what makes the second row trustworthy.

**The fix raised the rate, and that is the fix working.** The 0 h fragments were *widening* the
bands: they dragged `p25` down, so nights that should have read as unusual were being absorbed as
normal. Remove them and the bands tighten. This is TN-83's own "desensitised bands" half arriving
as a number — the entry predicted both directions and only the loud one had been measured.

## The multiplier, swept over the corrected population

| × | poor | good | normal | per 30 |
|---:|---:|---:|---:|---:|
| 0.50 *(shipped)* | 22 | 13 | 32 | 15.7 |
| 0.75 | 16 | 5 | 46 | 9.4 |
| **1.00** | **10** | **3** | **54** | **5.8** |
| 1.25 | 9 | 2 | 56 | 4.9 |
| 1.50 | 5 | **0** | 62 | 2.2 |

The sweep uses a multiplier-parameterised copy of the rule, cross-checked against the real function
at ×0.5 — identical counts (22/13/32), which is why the other rows carry.

**1.00 is the proposal.** It is the only value inside the 4–6 target that keeps the "unusually good
night" half alive. 1.25 is also in band and halves `good` to 2 for no gain.

**TN-83's ⛔ against 1.5 survives its own numbers being wrong.** On the corrected population 1.5
still takes `good` to zero. The warning was right for a reason that outlived the measurement it was
written from — worth noting, because the tempting move was to discard the whole entry's guidance
along with its figures.

## Not done, deliberately

**The constant is unchanged.** Scoring calibration is the owner's call (CLAUDE.md): it changes
numbers he reads daily and a bad one is hard to notice from inside. The proposal states what a
proposal here is incomplete without — **of 67 judged nights, 22 change verdict**: 12 poor→normal
and 10 good→normal, nothing in the other direction.

## Not verified

The counts are the owner's own nights via `claude_ro`, which is row-scoped to him — correct here,
since it is his calibration, but they are his rows and not a population claim. `judged` falls from
96 to 67 because merging rows into nights means each component's 28-night window fills later; that
is expected, not attrition. Nothing was run on the device, and nothing here changes behaviour.
