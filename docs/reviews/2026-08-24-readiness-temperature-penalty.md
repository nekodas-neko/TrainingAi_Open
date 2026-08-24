# "Body temp elevated" is nearly permanent, and it is costing readiness ~16 points a day — 2026-08-24

*Tuning · production data pulled 2026-08-24 (ring data through the night of 2026-08-25 local). Filed
as [`TN-6`](../implementation-backlog.md). Propose-only. Counts are the owner's account only
(`claude_ro` is row-scoped).*

## The report

Owner, with a screenshot of Home showing *"Body temp elevated"*, *"+0.5°C above your baseline
(threshold 0.5°C) — based on 50 nights of history"*, *"Readiness 52 — below the 70+ range"*, and a
Recovery recommendation: *"its often triggering deload days. its not trustable yet."*

Correct on both counts.

## The penalty ladder

`computeBlendedScore` (`lib/health/readiness-payload.ts:169`) applies an **absolute °C** ladder to
the readiness score:

| deviation | effect |
|---|---|
| \|dev\| > 1.0 °C | score capped at **40** |
| \|dev\| > 0.5 °C | **−20** points |
| \|dev\| > 0.3 °C | **−10** points |

This is a different path from the `tempZ` one already filed as Q-506 — that is the z-scored input to
the illness radar and the readiness *contributor*; this is a hard subtraction applied to the blended
score. Q-506 does not cover it.

## Measured firing rate — 34 nights with a stored deviation

| | |
|---|---|
| deviation mean | **+0.662 °C** |
| deviation range | **+0.14 … +1.33 °C** |
| nights with a **negative** deviation | **0 of 34** |
| \|dev\| > 0.3 (−10) | **31/34 — 91.2%** |
| \|dev\| > 0.5 (−20) | **23/34 — 67.6%** |
| \|dev\| > 1.0 (cap 40) | **6/34 — 17.6%** |
| nights with **no** temperature penalty | **3/34 — 8.8%** |

**A deviation from a baseline that is positive on every single night is not a deviation.** It should
centre on zero with roughly half the nights below.

## Root cause: the baseline mean never caught up

`oura_daily_summary.temp_baseline_mean_x8` is ×8 of centi-degrees, so degrees = `raw / 800`. Verified
against the stored deviation on the newest night: measured 35.950 − baseline 35.464 = +0.486, stored
+0.503. Scale confirmed.

| | |
|---|---|
| true measured nightly temp, 34 nights | **35.827 °C**, sd **0.140** |
| stored baseline mean, newest night | **35.464 °C** |
| **baseline too low by** | **0.363 °C** |

**That gap alone exceeds the 0.3 °C penalty threshold**, before the night's real variation is
considered. The EMA cold-started at **34.696 °C** (36 nights ago) and has climbed +0.767 °C since —
converging, but still 0.363 short after 50 nights of history. First-half mean deviation +0.884,
second-half +0.441.

### And the same object's SD is ~13× too wide

On the same scale, `temp_baseline_dev_x8` reads **1.82 °C** against a true nightly sd of **0.140 °C**.
That is **Q-506's finding independently reproduced** from a different table and a different consumer
(Q-506 measured 18.7×; this run measures 13×).

**So one broken baseline object is failing two consumers in opposite directions.** Its **sd is too
wide**, which divides `tempZ` down to nothing and means the illness radar can never fire (Q-506). Its
**mean is too low**, which makes the absolute deviation permanently positive and penalises readiness
every day (this finding). Fixing one does not fix the other, and a fix aimed at only one of them will
look like it worked.

## Counterfactual — baseline as the trailing mean of prior nights

Replacing the EMA with a trailing mean over the prior nights (minimum 7), on the 27 nights where both
are computable:

| | shipped | proposed |
|---|---|---|
| deviation mean | **+0.557 °C** | **−0.040 °C** |
| nights with a negative deviation | 0/27 | **16/27** |
| \|dev\| > 0.3 (−10) | 24/27 — 88.9% | **1/27 — 3.7%** |
| \|dev\| > 0.5 (−20) | 16/27 — 59.3% | **0/27** |
| \|dev\| > 1.0 (cap 40) | 1/27 — 3.7% | **0/27** |
| no penalty | 3/27 — 11.1% | **26/27 — 96.3%** |
| **mean readiness penalty** | **−16.3 pts/day** | **−0.4 pts/day** |

*(Severity ranking counts the cap-at-40 arm as −60; it is a clamp, not a subtraction, so that figure
ranks the arms rather than measuring points lost.)*

## The thresholds are right; do not touch them

Against a true nightly sd of **0.140 °C**, the ladder sits at **2.1 sd / 3.6 sd / 7.1 sd**. Those are
defensible for illness detection. **This is the fourth instance of "the threshold is right, the input
is wrong"** in this pillar — Q-506, Q-512 and Q-514 are the others. Lowering or raising the ladder
would hide a broken baseline behind a plausible firing rate, which is the Q-504 mistake.

## What this does not establish

- **Whether the owner has actually been ill on any of these nights.** The claim is that a permanently
  positive deviation cannot distinguish illness from baseline error, not that every flagged night was
  healthy.
- **Why the EMA cold-started ~1.1 °C low.** It converges, so the seeding or the update rate is the
  suspect; that is a code question this measurement does not answer. Q-2 (nightly temperature treats
  one frame's simultaneous probes as consecutive samples) is a plausible contributor and is already
  queued — check it before designing the fix.
- **The trailing mean is a diagnostic, not a shipped design.** It demonstrates the offset is an
  artefact of the estimator rather than real physiology. A production fix should re-seed or correct
  the existing baseline; a naive trailing mean has its own problems (it absorbs a genuine multi-day
  fever into the baseline within a week).

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The
counterfactual is arithmetic over stored nightly means, not a run of the shipped baseline code.
