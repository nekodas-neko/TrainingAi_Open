# Daytime stress and resilience — one threshold that should not be tuned, and one score that has only ever emitted a single value

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-507 (stress threshold) · Q-508 (resilience saturation) · **Lane:** A implements
**Scope note:** these are the last two scores in the app with no calibration review. Picked under the
owner's instruction to take **only tuning work no other lane holds** — Lane A is on the DB volume
reclaim, Lane B closed its feature, Review's sweeps covered correctness.

Both models are **vendored ports pinned to golden vectors** and their algorithms are explicitly
off-limits (`stress-resilience.ts`: *"Do NOT 'improve' the algorithm or re-derive constants"*). So
this measures the two things that *are* ours: the one hand-tuned constant sitting on top of daytime
stress, and the inputs we feed the resilience model.

---

## 1. `STRESS_HIGH_DAY_THRESHOLD_MIN = 120` — the rate is fine, the signal points the wrong way

The constant is flagged in source as a judgement call — *"~2 h, a documented judgement call — tune
here, nowhere else"* — and it drives a real decision: `computeAiDynamicNextSession` raises a
**stress override** at `stressHighMinutes >= 120`, easing the day's prescribed session.

### 1.1 The firing rate, in isolation, is defensible

`claude_ro.oura_daily_derived`, n = **25** days carrying `stress_high_minutes` (of 96 rows):

| minutes | 0 | 30 | 60 | 90 | 120 | 150 | 180 |
|---|---|---|---|---|---|---|---|
| days | 4 | 7 | 7 | 3 | 2 | 1 | 1 |

Mean 58.8, median 60, sd 47.0. At 120 the override fires on **4 of 25 days (16%)** — a reasonable
rate for "today was stressful enough to back off", and nothing about that number invites a change.

### 1.2 But it fires on the best days and stays silent on the worst

| group | days | mean readiness | mean sleep | worst readiness |
|---|---|---|---|---|
| **fires (≥ 120)** | 4 | **79.0** | 92.8 | 69 |
| quiet (< 120) | 21 | **65.0** | 84.9 | **29** |

`corr(stress_high_minutes, readiness_score)` = **+0.400** (n = 25). The correlation is *positive*: the
more "high stress" minutes a day carries, the **better** that day's readiness.

The individual days make it concrete. The four days that would ease training are 2026-07-17
(readiness 69), 07-23 (**80**), 07-24 (**84**) and 07-27 (**83**) — among the best in the set. The two
genuinely bad days, 07-21 (readiness 37, sleep score 31) and 07-26 (readiness **29**), carry **0** and
**30** high-stress minutes and never fire.

### 1.3 What it is not

Two obvious explanations were tested and **neither holds**:

- **Not exercise.** 19 of the 25 days are completed-workout days, and they are spread evenly across
  the range — 4 of 4 days at 0 minutes are workout days, and 3 of 4 at ≥ 120.
- **Not purely wear coverage.** Coverage is a *partial* confound: `corr(stress_high, recovery_high)` =
  **+0.304**, and the two days at 0 high-stress minutes (07-20, 08-12) are also at 0 high-*recovery*
  minutes — the signature of a day with little daytime data rather than a calm one. But it does not
  explain the finding away: net stress (`stress_high − recovery_high`) still correlates **+0.379** with
  readiness.

For contrast, `daytime_stress_scaled` — the day's *mean* scaled level, the balance measure rather than
a bucket count — correlates **−0.111** with readiness. That has the right sign and essentially no
magnitude.

### 1.4 A precision illusion worth knowing about

`STRESS_BUCKET_MS = 30 * 60_000`, so `stress_high_minutes` can only ever be a multiple of 30 — the
observed values are exactly `{0, 30, 60, 90, 120, 150, 180}`, seven possible values. A threshold
written in minutes therefore has seven meaningful positions, and **120 sits exactly on an atom**:
`>= 120` fires on 4 days, `>= 121` on 2. A one-minute edit halves the firing rate. Any future change
to this constant should be expressed and justified in *buckets*, not minutes.

### 1.5 Proposal

**Do not tune the threshold.** Its rate is fine and its input is anti-correlated with the decision it
drives; moving a threshold on a signal pointing the wrong way changes which good days get eased, not
whether the right days do. This is the same shape as Q-506 — a constant sitting on a broken input —
with the failure inverted: there the input was dead, here it is alive and pointing backwards.

In preference order:

1. **Explain the sign before touching the constant.** The confound is partly coverage and partly
   something unidentified. Until `stress_high_minutes` correlates *negatively* with readiness, or is
   shown to measure something readiness legitimately shouldn't track, the override is firing close to
   at random with respect to recovery.
2. **Consider `daytime_stress_scaled` as the override input instead.** It has the right sign, it is a
   mean rather than a count so wear coverage cancels, and it is already persisted. It would need its
   own threshold calibrated from scratch — its observed range is only −0.14 to +0.23, so the constant
   is nothing like 120.
3. **Failing both, gate the override on coverage** so a day with few daytime buckets cannot fire it,
   which removes the confound that is measurable without removing the feature.

**n = 25 is small and this should be re-measured at n ≈ 60.** At n = 25 an r of +0.40 is around the
conventional significance boundary, so the *strength* is provisional. The group means are not
subtle — 79 against 65, and the worst two days silent — but they rest on four firing days.

---

## 2. Resilience has emitted exactly one value, ever

The window is `dayMinus(day, 13)` plus today, so `windowLength = 14` and `confidence = validDays/14`.
`resilience_level` is present on **13 of 96 rows**. On every one of those 13:

- `resilience_level` = **5** ("strong") — min = max = 5
- `resilience_granular` = **5.99** — min = max = 5.99
- `resilience_confidence` ≤ 0.57

**5.99 is the clamp bound.** `findGranularResilienceLevel` ends in
`Math.max(1.01, Math.min(5.99, granular))`, so that exact value is what the function returns when the
computation runs off the top of the scale. The score has never once produced an informative reading,
and it is displayed as a band label.

### 2.1 The port is not hard-wired — the golden proves it

The pinned golden vector (`stress_resilience_2_2_1.golden.json`) produces `resilienceLevel = 1.0` and
`granularResilienceLevel = 1.01` — the *bottom* clamp. So the port can span the range, and the
production pinning is driven by what we feed it.

### 2.2 The mechanism: one of the three long-term terms is a sum, not a mean

`longTermStress` and `longTermRestorativeTime` are weighted means (`Σ vᵢwᵢ / Σw`). `longTermSleepRecovery`
is not — it replicates a `[N,1] × [N]` broadcast from the `.pt`, which reduces to

```
longTermSleepRecovery = (Σ all weights × Σ list) / Σ used weights
```

i.e. **the plain sum of the window** when every day is valid. Verified exactly against the golden:
its `dailySleepRecoveryList` is 13 values of 0.6 and today's index is 29.99013, and
`13 × 0.6 + 29.99013 = 37.79013` — which is `out_7` to every stored digit.

That term carries most of the weight. Solving the golden's own outputs for the two recovery weights
(`out_8 = w_d·out_6 + w_s·out_7`, assuming they sum to 1) gives **`w_d = 0.30`, `w_s = 0.70`** — so
70% of `longTermRecovery` is a quantity that grows with the number of valid days in the window.

In production the per-day `resilience_daily_sleep_recovery` values run **0.0 – 55.6**. A window sum of
five to seven such values lands around 130–240, against the golden's 37.79 — far above every band
boundary, which is exactly `level = 5, granular = 5.99` every day.

**The golden cannot catch this**, and that is the transferable lesson: its list is 13 *identical*
values of 0.6, two orders of magnitude below what production produces, so the fixture pins the
arithmetic without ever exercising the sum's scale. A golden vector proves a port computes the same
function; it says nothing about whether the inputs you feed it are on the scale it was captured at.

### 2.3 A second oddity in the same term, not explained here

`resilience_daily_sleep_recovery` barely tracks sleep at all: sleep score 93 → **0.0**, 87 → 12.8,
83 → 10.2, 80 → 9.9, 78 → 13.5 — while sleep score **31 → 17.3**, higher than any of them. Only
2026-07-24 (94 → 55.6) and 07-20 (90 → 51.9) look like a sleep-driven number.

`dailySleepRecovery = clamp(polyval(sleepRecoveryScalerCoef, sr))` where `sr` is the weighted mean of
our sleep score, hrvBalance, recoveryIndex and RHR contributors. A polynomial fitted by the vendor
against *Oura's* contributor distribution, fed *our* contributors, is the obvious suspect — but this
was not chased down and should not be presented as diagnosed.

### 2.5 It has also been dormant for 13 days

The 2026-08-05 data-analysis review recorded `resilience_level` populated on **13 of 79** rows. Today
it is **13 of 96** — the same 13. The most recent level is **2026-08-05**, and nothing has been
produced since, while `daytime_stress_scaled` grew 11 → 25 over the same period.

The daily indices are the likely gate: only **12 of 96** rows carry a `resilience_daily_stress`, and
they cluster (2026-07-20 → 07-27, then 08-09, 08-10, 08-16, 08-21). `runStressResilience` only emits a
level when `validCount >= windowMinLength` within the 14-day window, so once the indices thin out past
a certain point the level stops entirely — which matches an eight-day run followed by scattered
singles. **This was not confirmed**: the `/api/admin/db-query` endpoint began returning `Forbidden`
to every query, including trivial ones, before the per-gate coverage could be pulled. Whichever of
`contributorsOk`'s four inputs is missing on recent days is the thing to check first.

So the score has two problems, not one: when it speaks it says only "strong", and it has not spoken
since 2026-08-05.

### 2.4 Proposal

**Do not touch the algorithm or the constants** — the file says so and it is right; the golden is the
contract. The questions are all about inputs and reporting:

1. **Establish whether the sum is faithful.** If the vendor's model genuinely sums, then Oura feeds it
   a per-day index on a much smaller scale than ours and the defect is in what we supply. If the port
   mis-replicates the broadcast, it is a port bug. **This repo cannot settle it** — the vendor source
   is in the private archive. That decision gates everything else.
2. **Add a golden case with realistic list magnitudes** whichever way (1) lands. The current fixture
   would pass under either reading.
3. **Until the level varies, do not surface it as a band.** A score that has returned "strong" on
   100% of days is worse than absent, because it reads as a measurement.
4. **Re-measure after both recalibrations reach stored rows.** The call site
   (`adapter.ts`, `computeResilienceForDay`) passes **our** `sleepScore` and
   `comp.contributors.recoveryIndex.score` — so *both* things this agent shipped this week feed `sr`:
   v1.319.0 moved the sleep-score mean 84.1 → 69.5, and v1.321.0 re-anchored the Recovery Index
   contributor. All 13 rows predate both. Anyone re-measuring resilience before those land in stored
   data (see Q-501) is measuring the old model, and the direction is *downward* on the term that is
   currently saturating.

---

## 3. What was not exercised

- **No code changed and nothing ran on-device.** No constant was altered.
- **The vendor sources for both models were not read** — they are not in this repository (Q-49 A4b).
  Every claim about the port's behaviour comes from the committed TypeScript and the pinned golden.
- **The resilience model was not re-run** against production inputs; §2.2's production figure of
  130–240 is arithmetic from the stored daily indices and the golden-inferred weights, not a replay.
  Per this agent's own standing rule, a replay would have to reproduce the stored values first, and
  the private constants needed to run it are not available in the sandbox.
- **§2.3 is an observation, not a diagnosis.** The scaler-polynomial hypothesis was not tested.
- **The stress finding is n = 25** and its correlations are provisional at that size; the group means
  are the durable part.
- Every figure is **the owner's** (`claude_ro` is row-scoped), pulled 2026-08-18, over
  2026-05-07 → 2026-08-22 with the stress/resilience columns populated from 2026-07-17.
