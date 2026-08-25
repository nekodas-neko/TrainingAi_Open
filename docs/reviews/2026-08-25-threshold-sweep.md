# The threshold sweep — 2026-08-25

*Tuning · production data pulled 2026-08-25. Filed as [`TN-8`](../implementation-backlog.md), plus an
amendment to Q-524. Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

## Why

Every threshold anyone had investigated turned out to have a **broken input rather than a wrong
constant** — Q-506, Q-512, Q-514, TN-6. Four for four. Nobody had swept the rest. The owner asked for
the sweep on the grounds that there is now enough history to give a real range.

## Method, and what each half can and cannot see

**Half 1 — the output-distribution screen.** 86 numeric/boolean columns across `oura_daily_derived`,
`oura_daily_summary`, `body_battery_daily` and `oura_daily`. For each: rows, non-null count, min,
max, sd, distinct values. Flags DEAD (never written), STUCK (one value ever), SPARSE (<50% present),
PILED (sd under 8% of range). **48 columns flagged.**

**⚠️ This half has a blind spot that matters, and naming it is the point.** It cannot see *"fires on
almost every day"* or *"never crosses its threshold"*, because it does not know the thresholds. Run
against the two failures already known, **it catches neither**: `temp_dev_c` has a healthy-looking
range and `illness_score` looks merely sparse. A distribution screen finds stuck and dead scores; it
is blind to a score that moves normally and is compared against the wrong number.

**Half 2 — the threshold-aware pass.** 246 numeric constants across the scoring surface →
**42** plausibility/structural guards (skipped), **8** maturity gates, **196** candidates → **27**
that decide a user-visible branch. Each checked against its input's real distribution.

## Recalibration: measure coverage on a recent window, not all history

Most SPARSE flags dissolved on inspection. `oura_daily_derived` holds rows back to 2026-05, before
the BLE pipeline produced anything:

| month | days | readiness | sleep | activity | illness | stress | resilience |
|---|---|---|---|---|---|---|---|
| 2026-05 | 19 | 0% | 0% | 0% | 0% | 0% | 0% |
| 2026-06 | 28 | 0% | 0% | 0% | 0% | 0% | 0% |
| 2026-07 | 27 | 59% | 62% | 14% | 88% | 40% | 29% |
| 2026-08 | 25 | **100%** | **100%** | **100%** | **100%** | 80% | 20% |

Whole-history coverage reads 29–49% and looks like a live defect; the recent window is complete.
**A coverage number over all history measures when the pipeline started, not whether it works.**
Only resilience (20%, Q-508/Q-510) and daytime stress (80%, Q-510) are genuinely short today, and
both are already filed.

## What the sweep found

### 1. NEW — the chronic-stress fever mask is a fourth temperature consumer (TN-8)

`chronic-stress-assembly.ts:72` feeds `TEMP_DEV_FEVER_LIMIT_C = 1.0` as the per-night fever baseline,
and the model masks a night when `highestTemp > 38 || tempDev > tempDevBaseline`. The constant's own
comment states the design intent:

> *"this secondary deviation limit is set high enough that a healthy night is never masked
> (over-masking would starve the 21-night gate → permanent NaN)"*

**Measured, that premise is false.** `temp_dev_c > 1.0` on **6 of 34 nights (17.6%)** — and the owner
has said they have not been sick in 50+ days, so these are healthy nights being masked as fever. The
cause is the same 0.363 °C baseline offset behind TN-6 and BF-13.

**⚠️ It is NOT currently starving the gate, and this must not be overstated.** In the trailing
30-night window only **3 of 29** nights are masked, leaving 26 against a gate of 21. So this is a
**plausible contributor to TN-1/Q-525 and not a proven cause** — the margin is thinner than intended,
not gone.

What makes it worth filing anyway: it is a **fourth** consumer of the broken baseline, on top of the
three BF-13 counted (readiness ladder, `tempZ`/illness radar, deload card). BF-13's *"fix all three"*
is really **all four**, and this one is invisible from outside because the mask leaves no trace.

### 2. CLEAN — the early-deload trigger, and it clears the owner's complaint

`EARLY_DELOAD_SCORE_MAX = 45` with `EARLY_DELOAD_ACWR_MIN = 1.2` (`readiness-payload.ts:507`).
Readiness is below 45 on **2 of 41 scored days (4.9%)**, against a mean of 68.1 and a floor of 29.
That is a healthy rate for an early-warning trigger. **Deliberately not filed.**

This matters beyond the constant: the owner reported deloads firing *"a few times"*, and there are two
independent deload paths. This one fires on 4.9% of days; the deload **card** via
`TEMP_ALERT_THRESHOLD_C` fires on **23 of 34 nights (68%)**. So the complaint is entirely the
temperature card, which **confirms BF-13's attribution** rather than adding a second cause. The
temperature penalty does push readiness down and therefore makes this trigger fire slightly more than
it otherwise would — but at 4.9% it is not the mechanism the owner is seeing.

### 3. AMENDMENT — a third step goal exists, dormant

`DEFAULT_STEP_GOAL = 8000` (`daily-goals.ts:15`), reached only when `activityLevel` is null
(`daily-goals.ts:84`). Q-524 already records two live values — `users.steps_goal` = 7,000 and a
derived 10,000 from `activity_level = 'moderate'`. The owner has an activity level set, so **8,000 is
not live for them**; it would be for any user who has not. Recorded on Q-524 rather than filed
separately, per the dedup rule.

## The 27 decision thresholds, and where each stands

| already covered | entry |
|---|---|
| `RPE_DEAD_BAND` | Q-514 |
| `ACWR_*`, `EARLY_DELOAD_ACWR_MIN` | Q-512/Q-513 |
| `HR_REST_THRESHOLD` | Q-515, TN-2 |
| `FEVER_TEMP_Z`, `ILLNESS_ELEVATED_SCORE` | Q-506 |
| `STRESS_HIGH_LEVEL`, `STRESS_HIGH_DAY_THRESHOLD_MIN` | Q-507 |
| `TEMP_ALERT_THRESHOLD_C` | BF-13 / TN-6 |
| `DEFAULT_ZONE_MINUTES_GOAL` | Q-523 |
| `DEFAULT_STRENGTH_FREQ_GOAL` | measured, deliberately not filed |
| `DEFAULT_STEP_GOAL` | Q-524 (amended here) |

**Newly measured:** `TEMP_DEV_FEVER_LIMIT_C` → TN-8; `EARLY_DELOAD_SCORE_MAX` → clean.

**Not measurable from stored data** and left for a session that can run the pipeline:
`APNEA_THRESHOLD`, `MET_ACTIVE_THRESHOLD`, `RANGE_THRESHOLD`, `NIGHT_BAND_*`,
`CONSISTENCY_*`, `LOW_CONFIDENCE_THRESHOLD`, the sleep-staging constants (19 in one file). Their
inputs are per-sample intermediates that are never persisted — the same shape as TN-3a's discarded
stress buckets, and the same reason.

## What the sweep did NOT find, which is itself the result

**No new stuck, dead or saturated score.** Every DEAD/STUCK column maps to a filed entry — Q-7b (the
device-owned columns with no producer), Q-270 (`training_load_ots`), Q-525 (`chronic_stress_score`),
Q-510 (`worn_hours_ble`), Q-508 (resilience pinned at 5.99). The queue is comprehensive on this class.

That is worth stating plainly because the sweep's expected yield was higher. The four-for-four record
that motivated it held for the *investigated* thresholds; it does not generalise to the whole surface.
**One new finding from 27 thresholds is the honest return**, and the reason to have run it anyway is
that the one it found is invisible from every user-facing surface.

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The fever
mask was read from source and its input measured in production; **the mask itself was not executed**,
so the claim is that 6 nights cross the limit, not that the model's output was observed changing.
