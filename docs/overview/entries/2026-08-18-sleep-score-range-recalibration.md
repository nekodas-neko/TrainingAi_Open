## 2026-08-18 — Sleep Score recalibrated to use its range (Tuning, v1.319.0)

Owner-directed: *"free reign to continue changing this until it makes more realistic values — this
should be determined by days getting close to full and some days being low."* The acceptance test is
a distribution, not a day. Full evidence:
[`docs/reviews/2026-08-18-sleep-score-range-recalibration.md`](../../reviews/2026-08-18-sleep-score-range-recalibration.md).

**The problem, measured.** Sleep averaged 87.4 with **27 of 35 days ≥ 85** and **no night between 40
and 69**. Eight of ten contributors averaged ~90; only `deep` discriminated.

**Two real defects.** Scoring exactly your own HRV/HR baseline returned **90** and **86** — a
self-referencing term whose median input scores 90 cannot separate anything. And the REM ceiling sat
at 2.2 h with 1.8 h scoring 97, against an owner median of **1.86 h**.

**The structural cause, and the transferable lesson.** Re-shaping all nine curves moved the mean
84.1 → 73.6 and left spread almost unchanged (**sd 15.9 → 14.9**): the blend averages ten
contributors, so its spread shrinks by ~1/√10. Its interquartile range was **6 points**. So the fix
splits: *contributor curves decide the ranking; a calibration on the blend decides the range.*

**Shipped.** Nine curves re-anchored on the owner's measured percentiles, plus `SCORE_CALIBRATION`
on the blend. Over the same 65 nights, run through the shipped TypeScript: **mean 69.5, sd 16.6,
range 32–99, 7 nights ≥ 90, 8 below 50, every band populated.** Ordering checks out — 9.17 h at 95 %
tops it at 99, a 7 h night at 81 % efficiency lands at 33.

**A threshold rule came out of it.** `LOW_SLEEP_SCORE` was tuned against the compressed score (fired
4/65, 6 %). Left at 60 it would fire 17/65 (26 %) — three times the nagging for no physiological
reason. Re-anchored to **42**. A threshold on a display scale is calibrated to that scale's
distribution; re-anchor every one in the same PR as a range change, preserving the firing *rate*.

**Verification.** Full suite 3,345 passed; `check:rules` 38/38; typecheck clean. The distribution was
produced by importing the shipped `computeSleepScoreSeries`, not the design harness. Four tests
changed, each with its reason recorded — three because a 2.0 h-REM fixture is no longer maximal, one
because "old baseline pins at exactly 100" was a curve artifact and now asserts the relation instead.

**Readiness and Activity: analysed, NOT shipped.** Readiness has the identical problem (IQR 11 points,
nothing above 87) and the same fix gives mean 66.8 / sd 19.3 / range 15–99. It is held because it
feeds **five** action thresholds and moves 12 of 26 days across at least one — early-deload firing
would quadruple. Those need re-anchoring across `readiness`/`workouts`/AI periodization first.
Activity (sd 7.3) is untouched — Q-277.

**Not exercised.** Nothing on-device. **Historical rows keep their old scores until re-read, so the
trend chart shows a step at the changeover — and sleep stamps no `model_version` (Q-273), so nothing
marks where.** The calibration is fitted to one sleeper. Noise is amplified in the steep middle.
