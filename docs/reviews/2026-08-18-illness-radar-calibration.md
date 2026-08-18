# Illness radar — it cannot fire, and the cause is one poisoned baseline

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-506 · **Lane:** A implements (this proposes only)
**Scope note:** picked because it is the highest-coverage score in the app that **no review has ever
calibrated**, and no other lane holds it — Lane A is on the DB volume reclaim, Lane B closed its
feature, and Review's five sweeps covered correctness rather than calibration.

The illness radar can lower readiness by up to 25 points and force a deload. In **46 days it has
never produced an action-bearing flag**. This measures why, and the answer is not "the owner was
never ill" — it is that one of its four biomarkers is scored against a baseline whose deviation is
**18.7× too large**, and that biomarker carries **40% of the weight**.

---

## 1. What the radar has actually done

`claude_ro.oura_daily_derived`, n = 46 days with an illness score:

| | value |
|---|---|
| score range | **0 – 38** |
| median | 7.5 |
| sd | 7.17 |

| flag | days |
|---|---|
| `normal` | 33 |
| `learning` | 13 |
| **`watch` / `elevated` / `fever`** | **0** |

The thresholds are `ILLNESS_WATCH_SCORE = 40`, `ILLNESS_ELEVATED_SCORE = 65`, and a separate
single-biomarker fever path at `FEVER_TEMP_Z = 2.5`. **The score has peaked at 38 — two points below
the lowest threshold — and never crossed it.**

That near-miss is what makes this worth measuring rather than shrugging at: the radar is not wildly
mis-scaled, it is *just* short, and one contributor explains the gap entirely.

---

## 2. The composition, and where the ceiling comes from

`score` is a **weighted mean** of four one-sided biomarker signals, each `clamp(z / ILLNESS_Z_FULL) ×
100` with `ILLNESS_Z_FULL = 3`, renormalised over whichever are present
(`packages/shared/src/health/illness-radar.ts`):

| biomarker | weight | z range observed (n = 31–33) | median z | days z ≥ 1.2 | days z ≥ 2.5 |
|---|---|---|---|---|---|
| **temperature** | **0.40** | **0.07 – 0.47** | 0.29 | **0** | **0** |
| breathing | 0.25 | −1.37 – 1.88 | 0.61 | 6 | 0 |
| restingHeartRate | 0.20 | −1.22 – 1.18 | −0.55 | 0 | 0 |
| hrvBalance | 0.15 | −2.51 – 3.77 | 1.25 | 17 | 7 |

Three of those look like z-scores: centred near zero, both signs, spanning roughly ±2–3 over a
month. **Temperature does not.** It is one-sided, always positive, and spans 0.4 in total. A z-score
that never leaves a 0.4-wide band is not measuring deviation.

The consequence is arithmetic. At its observed maximum (z = 0.47) temperature contributes
`0.47/3 × 100 × 0.40 ≈ 6` points of the 40 its weight allows. The best day on record shows it
exactly:

```
2026-07-26  score 38
  breathing        z= 1.36  contribution 11
  hrvBalance       z=-2.51  contribution 13
  restingHeartRate z= 1.18  contribution  8
  temperature      z= 0.44  contribution  6     <- 40% of the weight, 6 points
```

That day had a −2.5σ HRV drop, elevated breathing *and* elevated resting HR simultaneously — about
as illness-shaped as this dataset gets — and still landed 2 short of `watch`, because the heaviest
term was asleep.

**And the fever path is unreachable, not merely unused.** `FEVER_TEMP_Z = 2.5` against an observed
maximum of 0.47 means a fever would need a nightly skin temperature roughly **5 °C** above baseline.

---

## 3. The cause: the temperature baseline's deviation is 18.7× too large

Comparing each baseline's stored deviation against the **true night-to-night standard deviation** of
the value it summarises, over the same rows:

| baseline | true nightly sd | stored baseline dev | **ratio** |
|---|---|---|---|
| **temperature** (centi-°C) | **13.5** | **253.7** | **18.7×** |
| hrv (ms) | 9.3 | 5.8 | 0.6× |
| rhr (bpm) | 3.1 | 4.3 | 1.4× |
| breath (rpm ×10) | 5.4 | 7.6 | 1.4× |

**The other three are sane. Temperature alone is out by an order of magnitude**, and since
`tempZ = (value − mean) / dev`, every temperature z is divided by ~19× too much.

### 3.1 Why — a cold start that the EMA is still digesting

The baseline is an EMA, and its stored history shows it converging **upward from near zero**:

| date | baseline mean (centi-°C) | baseline dev |
|---|---|---|
| 2026-07-08 | **1791** (17.9 °C) | 224 |
| 2026-07-09 | 2678 | 307 |
| 2026-07-10 | 3134 | 326 |
| … | | |
| 2026-08-18 | 3538 | **196** |

True nightly values sit at **3547–3585** (35.5–35.9 °C), mean 3584. So the first nights produced
residuals of **~1,800 centi-°C — 130× the true sd** — and the deviation term is still carrying them
40 nights later. It *is* decaying (332 → 196), but it has an order of magnitude left to go, and the
mean is still biased low (3538 vs 3584), which is why every z is positive.

This is a **cold-start artefact specific to temperature**, and the reason it hit temperature and not
the others is scale: temp is stored in centi-°C (~3,500) while HRV is ~50 ms and RHR ~55 bpm, so an
identical "start from zero" produces a residual two orders of magnitude larger.

---

## 4. What it costs, beyond the radar

The same `tempZ` feeds **readiness's `temperature` contributor at 10% weight**
(`readiness-composite.ts`, `closer-better`: `100 − |z| × 66.7`). With |z| pinned near 0.3 it returns
~80 on essentially every day — measured contributor mean 70.5, sd 17.3, range 40–95, and **0 of 33
days with |z| ≥ 1.2**. So a contributor meant to catch fever and illness is close to a constant.

So one defect, two consumers:

1. **The illness radar cannot reach `watch`**, and its fever path cannot fire at all.
2. **Readiness's temperature term is near-constant**, contributing ~8 points every day regardless.

---

## 5. Proposal

**This is not a scoring-constant change and the thresholds should not be touched.** `watch = 40`,
`elevated = 65` and `FEVER_TEMP_Z = 2.5` are all defensible *given a correct z*. Lowering them to
make the radar fire would be fitting the threshold to a broken input — the exact mistake this
session already made once and reverted.

**Fix the baseline, then re-measure.** Options for Lane A, in preference order:

1. **Re-seed the temperature baseline from the observed distribution** (mean 3584, sd 13.5 over 40
   nights) rather than waiting for the EMA to finish converging. Cheapest, and it fixes both
   consumers at once.
2. **Exclude the cold-start transient from the deviation term** — a warm-up period during which the
   dev is not updated, or a first-observation seed (`mean = first value, dev = a sane prior`) instead
   of zero. This is the durable fix: without it, every *new user* repeats this, and the app has other
   users.
3. Failing both, gate the illness radar on baseline maturity for temperature specifically, so it
   reports `learning` rather than a confident `normal` built on a dead biomarker.

**Do not re-fit anything until the baseline is corrected** — and re-measure the whole table in §2
afterwards, because every z in it moves by ~19×. It is entirely possible the radar then fires *too*
often, and that is the next calibration question rather than this one.

**Worth checking in the same pass, not measured here:** whether `oura_daily_summary`'s other
baselines cold-start the same way and simply recover faster because their scale is small. The ratios
in §3 say they are fine *now*, at 40 nights; they do not say what they looked like at night 5.

---

## 6. What was not exercised

- **Nothing on-device**, and no code changed.
- **The baseline update rule itself was not read.** The cold-start diagnosis rests on the stored
  series (mean climbing 1791 → 3538, dev decaying 332 → 196) and on temperature being the only
  baseline out of line. Whether the seed is literally zero, or something else that behaves like it,
  is a code question for whoever implements the fix.
- **Whether the owner was actually ill on any of these 46 days is unknown**, and nothing here
  claims a missed detection. The finding is that the mechanism *could not* have fired, which is true
  independently of whether it should have.
- **`learning` on 13 of 46 days was not investigated** — that is the documented baseline-maturity
  gate, and it is expected behaviour rather than a defect.
- Every figure is **the owner's** (`claude_ro` is row-scoped), over 2026-07-07 → 2026-08-18,
  n = 31–46 depending on the column.
