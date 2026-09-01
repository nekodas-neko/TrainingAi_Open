# Why an 8 h 15 m night at 97% efficiency scored 63 — 2026-09-03

*Tuning · production data pulled 2026-09-03. Files **TN-23**; the other two causes are **TN-5** and
**TN-10**, both already queued. Propose-only. Counts are the owner's account only (`claude_ro` is
row-scoped).*

Owner, on the night of 2026-09-02: *"why would sleep score be so low for this? I'd imagine it would
be in the 80s if not 90s?"* — 8 h 15 m asleep, 97% efficiency, 1 restless period, 10 min latency,
REM 92, restfulness 95.

**The score is arithmetically correct and the intuition is also correct. Three separate things take
it from a defensible ~84 down to 63, and two of them are already filed.**

---

## The arithmetic, reproduced exactly

Stored contributors, against `SLEEP_WEIGHTS` (sum 110):

| contributor | score | weight | drags the blend by |
|---|---|---|---|
| **hrv** | **42** | 14 | **−7.38** |
| **hr** | **58** | 14 | **−5.35** |
| total_sleep | 81 | 24 | −4.15 |
| deep_sleep | 76 | 10 | −2.18 |
| schedule | 80 | 8 | −1.45 |
| timing | 77 | 6 | −1.25 |
| latency | 85 | 6 | −0.82 |
| rem_sleep | 92 | 10 | −0.73 |
| restfulness | 95 | 9 | −0.41 |
| efficiency | 97 | 9 | −0.25 |

**Weighted blend = 76.04.** `SCORE_CALIBRATION(76.04)` = **64.1**, displayed **63**. The model
computed a 76 and the display curve shipped a 63.

## Cause 1 — the display curve costs 11.9 points (TN-5, approved 2026-08-24, unshipped)

This is the single largest factor and it is not a judgement about the night at all. **TN-5 is signed
off and has not shipped.** The owner's *"80s if not 90s"* is closest to the **blend**, which is what
the ten contributors actually produced.

## Cause 2 — 8 h 15 m scores 81, where the code's own comment says ~92 (TN-10, signed off 2026-08-30)

`TOTAL_SLEEP`'s anchors give 77 at 8.0 h and 84 at 8.5 h, so 8.25 h → **81**. The comment three lines
above reads *"100 at ~9h; 8h is excellent (~92)"*. **The heaviest contributor (weight 24) disagrees
with its own documentation by ~11 points**, and this night sits exactly in that band.

## Cause 3 — NEW: one autonomic dip is counted twice (TN-23)

`hrv` (42) and `hr` (58) are the two weakest contributors and together drag the blend **12.7 points**.
Both are computed correctly:

- HRV **50 ms** against a ~59 ms baseline = ratio **0.85** → `HRV_RATIO` gives exactly **42**.
- Overnight HR **63 bpm** against a ~61 bpm baseline = ratio **1.035** → `HR_RATIO` gives **58**.

**Neither is a bug. The problem is that they are the same event.** Measured over 38 nights with both
stored:

| | |
|---|---|
| `corr(hrv contributor, hr contributor)` | **+0.869** |
| shared variance | **75%** |
| combined weight | **28 of 110 — 25% of the sleep score** |

**A quarter of the sleep score rides on one physiological axis, entered twice.** HRV falling and
overnight HR rising on the same night is one autonomic signal; the score charges for it in both
columns. On this night that is worth 12.7 blend points, and at the display curve's local gain
(≈3 display points per blend point in this band) roughly **9 points of the visible score**.

**⛔ Do not fix this by deleting one contributor.** Both curves are sound and the *combined* signal is
the strongest recovery evidence the score has — the 2026-08-26 check-in lookback found resting HR the
single best predictor of how the owner feels. The fix is to stop paying twice: combine them into one
autonomic contributor at roughly the weight of one, or down-weight the pair so their joint
contribution is ~14–18 rather than 28.

**Counterfactual:** had hrv and hr scored at this night's median (81) instead of 42/58, the blend is
**83.9** and the display **88**. That is not the proposed fix — the dip is real and should cost
something — it bounds how much of the 63 is this defect.

---

## So what should this night have scored?

**The honest answer is ~76 today by the app's own model, and low-to-mid 80s once TN-5 and TN-10 land**,
with a few points still owed to a genuine HRV dip (50 ms against a 59 ms norm, near the bottom of the
owner's 43–71 range). **The night was good and the app is right that it was not the owner's best.**
63 is the wrong number; 90 would have been too.

**Order:** TN-5 (the display curve, biggest single effect) → TN-10 (the duration curve) → TN-23 (the
double count). All three are independent; none blocks another.

---

## ⚑ A near-miss: the sleep score does NOT use `hrv_baseline_mean_x8`

Answering a follow-up about whether a 100 is reachable, this review nearly filed a second finding:
that the owner's best nights (97 on 2026-07-23, 96 on 08-05) carried **inflated** `hrv` contributors,
because their ratios against `oura_daily_summary.hrv_baseline_mean_x8` (1.19, 1.07) map to 92 and 80
on `HRV_RATIO` while the stored contributors read 100 and 98.

**That was the wrong baseline.** `buildSleepAudit` calls `sleepScoreBaselines(prior, tz)`
(`sleep-score.ts:359`), a **trailing window over the prior nights' own readings**
(`SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS`, newest last), excluding the night being scored. It never
reads the `×8` EMA. The two are different objects with different values, and comparing a stored
contributor against the EMA proves nothing.

**Worth stating positively, because it is the exception in this codebase:** the sleep score's
autonomic baseline is a **self-correcting trailing window that excludes the night under judgement**
— the construction the TN-6 review recommended for temperature and could not find anywhere. It is
untouched by `updateBaseline`'s zero-seed defect (BF-13).

**The general rule** — already in the baton from three earlier instances this week, and walked into
again: **read which baseline a consumer actually calls before comparing anything to a stored one.**

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The blend
was recomputed **in Python from the stored contributors and `SLEEP_WEIGHTS`**, reproducing 64.1
against a displayed 63 — the 1-point gap is rounding in the stored integers, not a discrepancy
chased down. **n = 38 nights** for the hrv/hr correlation, single-subject. The "≈3 display points per
blend point" figure is the local slope of `SCORE_CALIBRATION` in this band, not a measured elasticity.
