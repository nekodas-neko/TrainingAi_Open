# 2026-09-24 — the sleep score's two autonomic terms are one axis

**Branch:** `tuning/sleep-autonomic-collinearity` · **Agent:** Tuning · **Docs-only.**

TN-60 fixed a floor rail in the readiness composite. The obvious next question was whether the sleep
composite has the same one. It does not — it has a different problem, at the other end, and the
measurement that found it is about the model's own geometry rather than its accuracy.

## r = +0.873

Across **60 nights** carrying both terms, `corr(hrv, hr) = +0.873`. Every other pair in the model is far
looser: `hrv`–`total_sleep` 0.559, `hr`–`total_sleep` 0.498, `total_sleep`–`efficiency` 0.681.

`SLEEP_WEIGHTS` gives each of them **14 of 110**, and `sleep-score.ts:20` states the intent outright:
*"Autonomic state (hrv + hr) is now 28 of 110 (25%)."* At r = 0.873 that is one effective axis carrying
25%, not two carrying 12.7% each. The share is what the owner chose; what follows from the collinearity
is that **a single bad autonomic reading moves a quarter of the score** where two independent terms
would have partly cancelled.

## They also go flat together

`hrv` reads exactly 100 on **12 of 60** nights, `hr` on **10 of 60**, and **all 10 of the `hr` ceiling
nights are `hrv` ceiling nights too**. On those, 28 of 110 weight is a constant.

The anchor tables explain it, and the two ceilings are not symmetric. `HRV_RATIO` reaches 100 at a ratio
of **1.35** — 35% above baseline, genuinely rare. `HR_RATIO` reaches 100 at **0.85**, which is its
*first* anchor, so every night at or below 85% of baseline HR scores exactly 100 with no resolution
beyond. One ceiling is a bound; the other is an open plateau.

## What it is not

**This is not TN-60's defect and the entry says so explicitly.** TN-60's rail was demonstrably wrong —
stored history inverted its own ordering. Here the total still discriminates: nights with one railed
contributor average **82.6** (36–94), with two **79.9** (42–92), so railing does not even monotonically
inflate the score. The loss is resolution at the top of one axis.

Full distribution, nights by contributors at exactly 100: 0 → 43 (mean 60.9) · 1 → 12 (82.6) · 2 → 8
(79.9) · 3 → 5 (91.4) · 4 → 3 (95.3) · 5 → 1 (95.0). **29 of 72 nights (40%) have at least one.**

## The recommendation is the small one

Extend `HR_RATIO` below 0.85 rather than touch a weight: one array, cannot reorder any night against
another, and it adds information instead of redistributing it. Then re-measure the collinearity, since
part of the 0.873 is the shared plateau. Weight changes re-score every stored night and would walk into
the same half-applied-history state TN-62 is still waiting on.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading. **Not
established:** whether the collinearity is physiological (HRV and overnight HR both index
parasympathetic tone, so 0.873 is unsurprising) or an artefact of both terms being computed from the
same BLE stream — the two look identical from here. And both numbers are **our own** derived outputs, so
this measures internal geometry and is not a validation claim; per TN-67 no external validation of any
score currently exists. `pnpm check:rules` result below.
