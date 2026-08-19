# Do all the pillars actually move? Only one does

**Date:** 2026-08-19 · **Branch:** `tuning/cross-pillar-range-view` · **Agent:** Tuning 🎶
**Type:** docs-only — cross-pillar synthesis, no new findings

The owner asked whether every pillar moves through its range — near 100 on good days, under 50 on bad
ones — and whether that is a useful way to judge a score. Both halves turned out to be worth writing
down, because each component was filed separately and the comparison existed nowhere.

## Only Body Battery genuinely spans

| score | n | range | mean | sd | < 50 | ≥ 85 |
|---|---|---|---|---|---|---|
| **Body Battery** | 51 | **0–100** | 50.7 | **29.6** | 24 | 5 |
| sleep — **old model** | 36 | 15–97 | **85.3** | 16.4 | 2 | **27** |
| readiness | 35 | 29–87 | 68.2 | 13.4 | 5 | 1 |
| **activity** | 23 | 64–91 | 75.2 | **6.0** | **0** | 1 |
| illness *(inverted)* | 46 | 0–38 | 7.3 | 7.2 | — | 0 |

And even Body Battery overstates itself: **5 of 51 days sit exactly on 0 or 100**, so part of that span
is the clamp rather than resolution.

Sleep's 85.3 is the **pre-recalibration** model — 27 of 36 nights at 85+, which is exactly what Q-503
fixed; the shipped curves replay to mean 69.5. Activity is the most compressed thing in the app at sd
6.0 with no day under 50. Illness never crosses its own threshold.

## The more useful half of the answer

**Range is a good first filter and a bad verdict.**

It catches the stuck-score class in one query, and it earned its keep this sweep — resilience emitting
one value ever, illness never firing, `strengthFreq` at exactly 100 on all 91 days, two of five peak
bands structurally unreachable. A score that cannot move cannot inform anything.

But it misleads three ways. **Clamping manufactures range** — saturating at both ends looks maximally
healthy on this statistic. **A wide range can be amplified noise** — sleep's calibration deliberately
turns ~4 blend points into ~12 displayed points, a stated cost the baton already flags. And most
importantly, **range says nothing about whether the movement is correct**: Q-507's stress metric has a
textbook spread, a defensible 16% firing rate, and correlates **+0.40 with readiness** — it moves
beautifully and points the wrong way for the decision it drives.

So the statistic to use is a pair: *does it move*, and *does it move with something it did not come
from*. Nothing in the first question could have separated Q-507 from Q-503. A cheap third is worth
having too — count the days sitting exactly on a clamp bound, which is one `CASE WHEN` and tells real
span from saturation.

## Not exercised

No code changed and no new measurement was taken beyond the aggregates — every underlying finding is
already filed with its own caveats, and this adds the comparison rather than evidence. The rows are
**stored** values, so they reflect whichever model wrote them; sleep's 36 are the old model, and
because Q-518 means the version stamp does not survive, **this table cannot be re-derived per-model
from stored data**. `n` differs per score (23–51) and the columns are not the same days. Activity's 23
rows predate its unbuilt redesign.
