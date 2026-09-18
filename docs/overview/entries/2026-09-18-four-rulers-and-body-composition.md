# What the score can and cannot say about this person

**Tuning agent · 2026-09-18 · branch `tuning/four-rulers-and-body-composition` · docs-only**

A calibration sweep against the owner's ask: make the results genuinely personal, using all the data
already being collected.

## The headline is a negative result, and it changes what to fix

The readiness composite is **robust**. Half its weight is baseline-relative, every one of those
denominators is wrong by a different factor, and correcting all of them moves the score by a **mean
of 0.4 points, max 4, with zero days moving more than 5** across 65 days. The nine weights average
the distortion away.

What the distortion wrecks is the **explanation**. `Z_POINTS_PER_UNIT = 50/1.5` rails a contributor
at ±1.5σ, and the personal baseline divides by a **mean absolute deviation** rather than a standard
deviation — MAD ≈ 0.798σ, so even a working baseline inflates every z by ~1.25×. Measured against the
true spread of the same rows: HRV **1.7× too hot**, sleep **1.6×**, resting HR roughly right,
temperature **17× too cold** (Q-506). Result: **hrvBalance reads exactly 0 or exactly 100 on 46% of
days**, sleepBalance on 29%. A rail cannot tell "a bit low" from "catastrophically low".

Split at the first Retatrutide dose, the ratios hold either side — HRV 0.67 pre / 0.65 during — so
this is the formula, not the physiology.

Filed as **TN-47**, scoped explicitly as an explainability fix carrying the 0.4-point measurement, so
nobody ships it as a re-score.

## The clearest win was not in the scoring at all

`body_metrics` carries a full bioimpedance suite on 49 of the last 90 days. Those columns appear in
18 files and **zero analysis modules** — stored, rendered as bare numbers, never interpreted.

Taken raw over the medication window: weight **−1.10 kg**, fat **+0.33 kg**, lean **−1.43 kg**. That
reads as *every kilo lost was lean, and then some*, which is alarming and is what the card shows.

It is mostly wrong, and the app already holds the column that shows why. Body water fell **1.04 kg**
across the same window, so **lean minus water is −0.38 kg** — inside scale noise. **Water explains
73% of the apparent lean loss.** The last eight readings move the right way: fat 25.7% → 25.2%,
muscle 39.4% → 39.6%.

Filed as **TN-48**, first in the recommended order, because it is the only one of the three that adds
an answer the user cannot get today and it needs no scoring change. Its guardrails are inline and
load-bearing: never show a lean-mass change without the water decomposition, show the reading count,
state the noise floor.

## Also found

**Seven days show a score that contradicts its own breakdown** (TN-49) — all consecutive, 2026-07-16
→ 07-22, off by −4 to −6, predating the 2026-07-22 weight rebalance. Their contributors were
re-derived; their score was not. And 40 of 65 rows carry no model stamp, with stamped and unstamped
ranges overlapping. This is a follow-on to Q-501, not a regression of it — storing the inputs is what
made it checkable.

**Two contributors are a floor with a label.** `prevDayActivity` has never scored below 57 in 65
days, `activityBalance` never below 51; together 15% of the weight supplying 7.4% of the movement.
Noted inside TN-47 rather than split out.

**A stale comment worth correcting.** `readiness-composite.ts`'s header still says Recovery Index is
*"always neutral/provisional … never scored"*. It has been scored since Q-500 fitted its 5-hour
anchor, and it is the 5th-largest driver of score movement.

## Checked and deliberately not filed

DB growth reads 224 MB against a 171 MB baseline — 1.7 MB/day against an expected 0.4. Already
attributed: `oura_raw_packed` is the archive, grows ~1.2 MB/day, is never pruned, and postdates the
baseline (BF-55, Q-283). No new entry. SpO₂, which looked like unused data at 98% coverage, is used —
sleep staging and the intraday curve.

## What was not exercised

Reads of stored production rows and replays of the shipped scoring functions, in the sandbox. No code
changed, no scoring touched, no device, no UI. Row-scoped to the owner throughout. The bioimpedance
figures are what the scale reported, not a clinical measurement.
