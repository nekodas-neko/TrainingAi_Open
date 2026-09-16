# 2026-09-16 — Lane A · TN-39: the daytime-stress imputation, checked against measured HRV

**Branch:** `lane-a/tn39-daytime-stress-validation` · **Measurement only — no code changed.**

TN-39 asked for the validation TN-33 and TN-34 both had to assume. The daytime-stress signal is an
imputation (`ln(rmssd) = a + b·hr + c·temp`, fit on night data, applied to daytime), and the Polar
H10 has been writing real beat intervals to `rr_intervals` the whole time. Nobody had compared them.

Full measurement:
[`docs/reviews/2026-09-16-daytime-stress-imputation-vs-measured-hrv.md`](../../reviews/2026-09-16-daytime-stress-imputation-vs-measured-hrv.md).

## The answer has three parts of very different strength, and the strongest is not about accuracy

**1. 41% of "daytime stress" is recorded while the owner is asleep.** Joined against
`sleep_sessions` directly: **277 of 672** stress buckets sit inside a recorded sleep session, and
**28 of the 140** buckets counted as high-stress. One minute in five of the `stress_high_minutes` the
app calls daytime stress happened while the owner was asleep. The series window is the whole local
calendar day and nothing restricts it to waking hours. Filed **LA-112** — a defect, not a
calibration question.

The same measurement shows the mirror problem: **11 buckets across 24 days** land in Brisbane
07:00–08:59, the owner's most active waking window, where the strap recorded **98**. That is the MET
gate doing its job — the model should not impute HRV from an activity heart rate — but the
consequence is a "daytime" series that is densest asleep and nearly empty while moving.

**2. The model's shape is validated.** `corr(HR, ln rmssd) = −0.78` on measured data across 30–37
days. The functional form is right and should not be re-investigated.

**3. A ~3.2× level gap that is real but confounded — and must not be acted on.** The model reads
×0.30 of measured RMSSD over 84 buckets / 37 days, with a spread far smaller than the bias. The
assumed temperature cannot explain it (inverting per bucket for the temperature that would make it
exact gives 67–87 °C). But the strap is chest ECG against a model fit on ring PPG, the measured
daytime values sit **above** the owner's ring night baseline, which is backwards for daytime resting
HRV, and the strap is worn while walking. Filed **LA-113**, owner-gated; the first action is a
controlled same-instrument capture, not a coefficient.

**4. `oura_daytime_stress_buckets.bucket_start` holds the bucket MIDPOINT**, so stored timestamps sit
on a `:15`/`:45` grid. This already cost something during this work: the obvious join returned zero
rows, which reads as "no overlapping data" rather than "the join is 15 minutes out". Filed
**LA-114**.

## Why the entry could be removed rather than kept

TN-39's pass test was *"a written agreement figure between imputed and measured daytime HRV over at
least ten days, with the disagreement characterised (bias, spread) rather than summarised as good or
bad"* — met at 37 days, with bias and spread separated and each confound named. Its two ⚠ constraints
were honoured: no model change, and no day-total comparison (bucket-to-bucket only, since the strap
covers ~6 waking hours).

## Method notes worth reusing

- **`rmssdFromRr` was used, not reimplemented** — including for the SQL-side temptation to compute
  successive differences with `lag()`, which would have been a second implementation of a formula the
  repo keeps in one place.
- **`oura_raw_samples.decoded` is now null on every tag** (Lever 1a), and decoding `body_hex` needs
  vendored constants absent from the sandbox. So the imputed side could not be rebuilt from the
  production path; it was evaluated arithmetically from the stored coefficients instead, with
  temperature swept rather than assumed at one value.
- **The admin db-query endpoint returned intermittent 401s** under a burst of ~48 sequential queries.
  Retrying with backoff cleared every one — worth building into any future pull rather than reading a
  401 as a permissions problem.

## Verification

`pnpm check:rules` **75 of 75**, typecheck and lint clean, `pnpm test` green. No application code
changed, so there is nothing here for CI to regress — the risk in this PR is that a number is wrong,
not that a behaviour is.

**Not exercised:** no device, no APK, no rollup run. Every production figure is the owner's rows only
(`claude_ro` is row-scoped), so none of it describes any other user. Temperature is assumed
throughout. The model was evaluated from its stored coefficients rather than by running the rollup,
so nothing here tests the rollup's own assembly of HR/temp/MET.
