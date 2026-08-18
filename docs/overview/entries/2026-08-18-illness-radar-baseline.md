# The illness radar cannot fire, and it is one poisoned baseline

**Date:** 2026-08-18 · **Branch:** `claude/tuning-agent-role-x9jg4r` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-506

Picked because the owner's instruction was to take **only tuning work no other lane holds**, and the
illness radar is the highest-coverage score in the app that no review had ever calibrated. Lane A is
on the DB volume reclaim, Lane B closed its feature, and Review's five sweeps covered correctness
rather than calibration.

## What it does today

Over 46 days with an illness score: range **0–38**, median 7.5, sd 7.17, flags `normal` 33 and
`learning` 13 — and **zero** `watch`, `elevated` or `fever`. The lowest threshold is 40, so it has
peaked two points short and never crossed.

That near-miss is what made it worth measuring rather than shrugging at. A wildly mis-scaled score is
a design question; a score that stops *just* short usually has one term missing.

## The term that was missing

`score` is a weighted mean of four one-sided biomarker z-scores. Three of them look like z-scores —
centred near zero, both signs, spanning ±2–3 over a month. **Temperature does not**: observed range
**0.07 – 0.47**, always positive, spanning 0.4 in total. It carries **40% of the weight** and
contributes at most **6** of the 40 points that weight allows.

The best day on record (2026-07-26, score 38) had a −2.5σ HRV drop *with* elevated breathing *and*
elevated resting HR simultaneously, and still fell short — because the heaviest term was asleep.

## Why

Stored baseline deviation against the true night-to-night sd of the same rows:

| baseline | true sd | stored dev | ratio |
|---|---|---|---|
| **temperature** (centi-°C) | **13.5** | **253.7** | **18.7×** |
| hrv (ms) | 9.3 | 5.8 | 0.6× |
| rhr (bpm) | 3.1 | 4.3 | 1.4× |
| breath (rpm ×10) | 5.4 | 7.6 | 1.4× |

A cold start. The EMA mean began at **1791** centi-°C (17.9 °C) on 2026-07-08 against true values of
~3584, so the first nights produced residuals ~130× the true sd, and the deviation term is still
carrying them 40 nights later (332 → 196, with an order of magnitude to go). It hit temperature and
not the others purely because of scale — centi-°C is ~3,500 where HRV is ~50 ms and RHR ~55 bpm.

Two consumers, one defect: the radar cannot reach `watch` and its fever path cannot fire at all
(`FEVER_TEMP_Z = 2.5` would need ~5 °C above baseline), and **readiness's temperature contributor is
near-constant** — mean 70.5, and 0 of 33 days with |z| ≥ 1.2.

## The thing not done, deliberately

**The thresholds were not touched.** `watch = 40` against a score peaking at 38 is precisely the
shape that invites a two-point nudge, and it would have hidden a dead biomarker behind a firing
radar — the mistake this same session already made on readiness (Q-504) and reverted. The proposal
is to fix the baseline and re-measure, accepting that the radar may then fire *too* often, which is
the next calibration question rather than this one.

The durable half matters more than the owner's own rows: seeding an EMA from zero repeats this for
**every new user**, and the app has other users.

## Not exercised

No code changed and nothing was run on-device. The baseline update rule itself was not read — the
cold-start diagnosis rests on the stored series and on temperature being the only baseline out of
line, and whether the seed is literally zero is a code question for whoever implements the fix.
Whether the owner was actually ill on any of these 46 days is unknown; the finding is that the
mechanism *could not* have fired, which is true either way. Every figure is the owner's
(`claude_ro` is row-scoped).
