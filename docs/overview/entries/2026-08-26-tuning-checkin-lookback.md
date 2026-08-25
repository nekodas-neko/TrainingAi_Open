# 2026-08-26 — the check-in lookback, and the second thing that unsettles readiness

*Tuning · docs-only · branch `tuning/checkin-lookback`*

Owner: readiness should not be affected by the check-in, but keep the check-in as a tuning
opportunity — *"see if we can match up the signals that give a good check in"* — and *"ideally I want
the starting values to not be depicted by anything."*

**The lookback, n = 33 logged days.** The check-in correlates meaningfully with the objective
signals: restingHeartRate **+0.557**, previousNight **+0.520**, sleepBalance **+0.470**, temperature
**+0.463**, hrvBalance +0.427. Yesterday's training predicts it essentially not at all (**+0.028**) —
how hard you trained says nothing about how you report feeling the next morning.

**The multivariate half is where the honest answer is.** Best model is two predictors — resting HR
and last night's sleep — at **LOO R² 0.293**. Every predictor after that raises in-sample R² and
lowers out-of-sample: all eight contributors reach R² **0.541** with **LOO R² 0.047**. On 33 rows an
eight-predictor fit is memorising the sample, and quoting its R² would have sold a model with no
predictive power.

**Three things follow.** Dropping the check-in from readiness stays right, but **not** for the reason
this session first gave — I had written that it "adds little independent information", and r ≈ 0.5 is
~25% shared variance, so **~75% of the check-in is information nothing else has**. It moves readiness
little because its weight is 10% and it correlates with the rest. And **imputing it on unlogged days
is refuted** — 5% out-of-sample is a fabricated value with a model's authority.

**The check-in is not the only thing that unsettles readiness, and the other cause is worse.**
`activityBalance` (weight 0.06) is **today's** activity score, which is a partial day filling through
the day (63 at 07:03 against 78 and 82 on the two preceding completed days). So readiness drifts
~1 point **continuously, with no user action at all** — where the check-in moves once, on a button
press. `prevDayActivity` already uses a completed day and is settled. TN-9 now covers both, with a
pass test that two reads twelve hours apart must be identical; the check-in half alone does not
achieve that.

Review: [`docs/reviews/2026-08-26-checkin-lookback.md`](../../reviews/2026-08-26-checkin-lookback.md).

**Not exercised:** no code ran — SQL plus arithmetic in Python (numpy is unavailable in the session
container, so OLS and leave-one-out were implemented directly).
