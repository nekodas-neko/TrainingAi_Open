# The daytime-stress imputation, checked against measured HRV (TN-39)

**2026-09-16 · Lane A · measurement only, no code changed.**

TN-39 asked for the validation TN-33 and TN-34 both had to assume: the daytime-stress signal is an
*imputation* — `ln(rmssd) = a + b·hr + c·temp`, fit on the ring's night-time HRV events and applied
to daytime HR and temperature — and the Polar H10 has been writing real beat intervals to
`rr_intervals` the whole time. Nobody had compared them.

The entry's pass test: *"a written agreement figure between imputed and measured daytime HRV over at
least ten days, with the disagreement characterised (bias, spread) rather than summarised as good or
bad."* This is that, and the answer has three parts of very different strength. **The strongest
finding is not about accuracy at all.**

## Method

- **Measured side:** all 141,745 beats in `rr_intervals` (48 UTC days, 2026-07-17 → 2026-09-15),
  grouped into 30-minute buckets on the absolute epoch grid the app itself uses, then through
  `rmssdFromRr` — **the app's own function, not a reimplementation**. 289 buckets cleared its
  30-beat floor.
- **Imputed side:** the live model row (`oura_daytime_hrv_model`, refit 2026-09-16 09:38, n=2306):
  `intercept 6.31064 · hr_coef −0.0554957 · temp_coef +0.0250380`.
- **HR** comes from the same beats (`60000 / mean(rr)`), so both sides of the comparison are measured
  from the same instrument in the same window.
- **Temperature is assumed and swept**, because `oura_raw_samples.decoded` is now null on every tag
  (Lever 1a) and decoding `body_hex` needs vendored constants absent from the sandbox. This turns out
  not to matter — see below.
- All production reads via the admin db-query endpoint, so every count is **the owner's rows only**.

## Finding 1 — 41% of "daytime stress" is recorded while the owner is asleep ⚠ strongest

This one needs no cross-instrument comparison and no assumption. It is the app's own data about its
own series:

| | buckets | inside a recorded sleep session |
|---|---:|---:|
| all stress buckets | 672 | **277 (41.2%)** |
| buckets counted as high-stress (`level ≤ −0.5`) | 140 | **28 (20.0%)** |

Joined against `sleep_sessions` directly (`sleep_start ≤ bucket_start < sleep_end`), not inferred
from clock hour. **So one minute in five of the `stress_high_minutes` the app reports as daytime
stress was recorded while the owner was asleep.**

The cause is in `lib/oura-ble/rollup/run.ts:1060` — the series window is
`aestMidnight(d)` → `aestMidnight(d+1)`, the whole local calendar day, and nothing anywhere
restricts it to waking hours. `summarizeStressDay` (`lib/health/daytime-stress.ts:245`) then counts
**every** bucket at or below `STRESS_HIGH_LEVEL`, with no waking filter of its own.

**And the gap falls exactly where the waking day is busiest.** Buckets by Brisbane hour:

| Brisbane hour | 00–06 | 07–08 | 09–12 | 13–23 |
|---|---:|---:|---:|---:|
| stress buckets | 289 | **11** | 73 | 299 |
| strap buckets | 0 | 98 | 129 | 62 |

Eleven buckets across the whole 24-day span land in 07:00–08:59, the owner's most active waking
window — where the strap recorded 98. The mechanism is `evaluateDaytimeHrvModel`'s MET gate
(`met > MET_ACTIVE_THRESHOLD → null`), which is correct in itself: the model has no business
imputing HRV from an elevated activity heart rate. But its consequence is that the series is densest
when the owner is asleep and nearly empty when they are moving.

**This bears directly on TN-34**, unwired earlier today for firing a deload override on 83% of days
off a `stress_high_minutes` figure measured to be uncorrelated with readiness. This is an
independent account of why that number carries so little signal.

## Finding 2 — the model's *shape* is validated ✅

On the 54–84 densest strap buckets (≥1200 and ≥300 beats — 30 and 37 days respectively):

| bucket floor | n | days | corr(HR, ln rmssd) | measured slope | model `hr_coef` |
|---|---:|---:|---:|---:|---:|
| ≥300 beats | 84 | 37 | **−0.778** | −0.0275/bpm | −0.0555/bpm |
| ≥600 beats | 71 | 33 | −0.765 | −0.0268/bpm | −0.0555/bpm |
| ≥1200 beats | 54 | 30 | −0.778 | −0.0258/bpm | −0.0555/bpm |

`ln(rmssd)` really does fall close to linearly with heart rate in measured daytime data, which is the
modelling assumption. **The functional form is sound.** The slope is roughly **half** the model's, so
the imputation is about twice as sensitive to a heart-rate change as the strap says it should be.

## Finding 3 — a ~3.2× level gap, which is real but confounded ⚠ do not act on this

Predicted against measured, mean log-ratio:

| bucket floor | n | days | model ÷ measured | sd of log-ratio |
|---|---:|---:|---:|---:|
| overlapping scored buckets | 14 | 10 | **×0.31** | 0.17 |
| ≥300 beats | 84 | 37 | **×0.30** | 0.40 |
| ≥1200 beats | 54 | 30 | **×0.32** | 0.42 |

So the imputation reads about **a third** of measured RMSSD, consistently — the spread (a factor of
~1.5 either way) is much smaller than the bias.

**The assumed temperature cannot explain it.** Swept across 28–36 °C the ratio moves only 0.30 → 0.36.
Inverting the model per bucket for the temperature that would make it exact gives **67–87 °C**. The
temp term is too weak to absorb a gap this size, which is why the missing temperature series does not
undermine the finding.

**But three things say do not act on it:**

1. **Different instruments.** The strap is chest ECG; the model was fit on the ring's PPG-derived
   night RMSSD. It predicts *ring-scale* values by construction.
2. **The measured numbers are physiologically surprising in the direction that matters.** Strap
   daytime RMSSD runs 76–93 ms against the owner's ring **night** baseline of ~55.8 ms. Daytime
   resting HRV is normally *below* night HRV. The model's direction is the plausible one here and the
   strap's is not, which points at the instrument or at the setting rather than at the fit.
3. **The strap is worn while moving.** These are morning-walk windows, and movement-driven
   respiratory sinus arrhythmia genuinely raises RMSSD. The 20% artifact filter removes ectopics, not
   this.

**The overlap is also a biased sample.** Median beats per bucket is 73 across all strap buckets and
68 on the 14 that join a scored stress bucket — under a minute of data each, because the MET gate
excludes precisely the dense workout buckets. The ≥300-beat rows above are the trustworthy ones, and
they are the model evaluated *outside* the gate it normally applies — informative about the fit, not
a description of production behaviour.

**What would settle it:** the strap worn at rest, in the same window the ring streams its own HRV
events, so ring RMSSD and strap RMSSD can be compared directly on the same minutes. Until then the
level gap has two candidate explanations and this measurement cannot separate them.

## Finding 4 — `oura_daytime_stress_buckets.bucket_start` holds the bucket MIDPOINT

Found while trying to join: the stored timestamps sit on a `:15`/`:45` grid, not `:00`/`:30`.
`daytimeHrvEstimatesPerBucket` returns `t = bStart + bucketMs/2`
(`packages/shared/src/health/daytime-hrv-model.ts:190`) and `run.ts:1108` writes that value straight
into a column called `bucket_start`. The name is wrong, and a naive join on it is silently 15 minutes
out — which is exactly what happened here, producing a zero-row overlap that looked like missing data.

> **Partly addressed the same day (LA-114), and the rename was REVERTED.** The Drizzle property is
> `bucketMid` and migration 275 is a `COMMENT ON COLUMN`, but **the SQL column is still
> `bucket_start` and `claude_ro` still exposes it that way** — so every join above still needs the
> 15 minutes added. The `ALTER TABLE ... RENAME COLUMN` was written, applied and reverted: CI's
> Migration Check replays every migration against the final schema, and each historical `claude_ro`
> view migration selects `t.bucket_start`, so a rename fails all of them. See LA-114's entry.

## Verdict

The imputation **has the right form and an unverified level**, and the series it feeds **covers the
wrong hours**. Of the three, only the coverage defect is safe to act on from this evidence alone; the
level gap needs a controlled same-instrument comparison first, and the slope follows the level.

## Not exercised

No code changed — the entry required that. The model was evaluated arithmetically from its stored
coefficients rather than by running the production path, so nothing here tests the rollup's own
assembly of HR/temp/MET. Temperature is assumed throughout. Every figure is the owner's rows only
(`claude_ro` is row-scoped), and the strap covers roughly six waking hours, so no daily total is
comparable — only bucket-to-bucket.

## Filed

- **LA-112** — the series includes sleep and misses the active morning (Finding 1). The only one of
  the three that this evidence supports acting on. **Shipped 2026-09-16**, v1.457.2.
- **LA-113** — the level and slope gap (Findings 2 and 3). Owner-gated: it is a scoring change, and it
  needs the controlled same-instrument comparison before anyone touches a coefficient.
- **LA-114** — the mislabelled `bucket_start` column (Finding 4). **Documented, not fixed** — the
  rename is blocked by the migration-replay contract; the entry is back in the queue.

All three carry `LA-` because Lane A found them; the letter records the finder, not who ships. LA-113
is a scoring proposal that Lane A must not implement on its own authority.
