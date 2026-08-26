# Can the objective signals predict a good check-in? — 2026-08-26

*Tuning · production data pulled 2026-08-26, **n = 33 logged check-ins**. Feeds
[`TN-9`](../implementation-backlog.md). Propose-only. Counts are the owner's account only.*

## The question

Owner: *"we should have it not be affected by the checkin; but we should [keep] that as a tuning
opportunity. Not sure if it will correlate to anything useful but we can do a tuning lookback and see
if we can match up the signals that give a good check in."*

Also a claim of mine that needed testing rather than repeating. When TN-9 measured that dropping the
check-in barely moves readiness, I wrote that this was *"because the logged check-in tracks the
objective contributors closely enough to add little independent information."* **That was an
inference from one number, not a measurement.** This checks it.

## Single-signal correlations

The check-in contributor over 33 logged days: mean **66.9**, sd **14.1**, range **30–88** — a real
spread, not a rating stuck at one value.

| objective signal | r vs check-in | reading |
|---|---|---|
| **restingHeartRate** | **+0.557** | strong |
| **previousNight** | **+0.520** | strong |
| **sleepBalance** | **+0.470** | strong |
| **temperature** | **+0.463** | strong |
| hrvBalance | +0.427 | signal |
| sleep_score | +0.390 | signal |
| activityBalance | +0.327 | none |
| recoveryIndex | +0.221 | none |
| activity_score | +0.278 | none |
| prevDayActivity | +0.028 | none |

At n = 33, |r| > 0.35 is significant at p < 0.05 and |r| > 0.45 at p < 0.01.

**How the owner feels is predicted best by resting heart rate and last night's sleep**, which is
physiologically sensible and is a genuinely useful thing to know. **Yesterday's training predicts it
essentially not at all** (r = +0.028) — how hard you trained yesterday says nothing about how you
report feeling today.

## Multivariate, with leave-one-out — and this is where the honest answer is

| model | R² | adj R² | **LOO R²** |
|---|---|---|---|
| restingHeartRate alone | 0.310 | 0.288 | 0.225 |
| **restingHeartRate + previousNight** | 0.390 | 0.350 | **0.293** |
| + sleepBalance | 0.422 | 0.362 | 0.262 |
| + temperature | 0.473 | 0.398 | 0.192 |
| all 8 objective contributors | **0.541** | 0.389 | **0.047** |

**The best honest model is two predictors** — resting HR and last night's sleep — explaining about
**29% of check-in variance out of sample**. Every predictor after that raises in-sample R² and lowers
LOO. The all-eight model looks best on R² (0.541) and has **effectively no out-of-sample predictive
power at all (LOO 0.047)**.

That contrast is the reason to compute LOO on 33 rows rather than quoting R². An eight-predictor fit
on 33 points is memorising the sample.

## What this settles

**1. My earlier claim was half right, and the half that was wrong matters.** The check-in *is*
correlated with the objective contributors — r = 0.43–0.56 against the four heaviest. But r ≈ 0.5
means **~25% shared variance**, so roughly **three quarters of what the check-in says is information
the objective data does not contain.** "Adds little independent information" was wrong. The correct
statement is that dropping it barely moves readiness *because its weight is 10% and it correlates
with the rest*, not because it is redundant.

**2. Dropping it from readiness is still right**, and now for a better-stated reason: it is partly a
re-measurement of signals already in the composite, and the owner requires the score to be settled at
first open. Its independent 75% is real, but it belongs where it can be acted on — the session
prescription — not folded into a number that must be final before the user touches anything.

**3. ⛔ Do NOT impute the check-in from the objective signals.** The obvious next idea — predict it on
unlogged days instead of using a neutral 50 — is refuted here: the full model's LOO R² is **0.047**.
A prediction that explains 5% of out-of-sample variance is a fabricated number wearing a model's
authority, and this repo's rule against LLM/derived values presented as fact applies to regressions
too.

**4. The check-in is worth keeping as a signal in its own right.** It has real spread (sd 14.1), it
is only ~29% predictable from everything else, and it is the only input that can see stress, mood and
life. If anything, this argues for *more* use of it outside readiness, not less.

## What this does not establish

- **Direction.** These are same-day correlations. Whether a poor night causes a poor check-in, or a
  poor check-in reflects something that also worsened the night, is not answerable here.
- **Generality.** One person, 33 days, one season. The r values are this owner's, not a population's.
- **That 29% is a ceiling.** A different feature set — intraday stress, MET, the previous day's
  *subjective* load — might do better. Only the nine stored contributors were tested.

## Failure surfaces not exercised

No code ran — SQL against production plus arithmetic in Python. No `pnpm dev`, no device. The OLS and
leave-one-out were implemented directly (numpy is not available in the session container); the
single-signal Pearson values and the two-predictor fit agree with each other, which is the only
internal check performed.
