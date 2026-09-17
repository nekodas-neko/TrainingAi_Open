# What the temperature re-derive would actually do

**Tuning agent · 2026-09-17 · owner's rows only (`claude_ro` is row-scoped)**

Q-506 established that the illness radar cannot fire because the temperature baseline's stored
deviation is far too wide. The remedy shipped a month ago — `POST /api/admin/rederive-baselines`,
built for this exact defect, writing back temperature alone per the owner's 2026-08-24 decision.

Nobody has run it.

This review measures two things nobody had: **how far the defect has decayed on its own**, and
**what the radar does on the far side of the fix**. The second answer is the reason to read this:
the re-derive as it stands would take a radar that has never fired and make it call **fever on six
of sixty nights**, four of them with healthy HRV.

---

## 1. The defect is still live, and it is not going to fix itself

| | Q-506 (2026-08-18) | today (2026-09-17) | true value |
|---|---:|---:|---:|
| temp baseline deviation | 196 centi-°C | **166 centi-°C** | ~13 |
| ratio vs true nightly sd | 18.7× | **15.4×** | 1× |
| temp baseline mean | — | **35.34 °C** | ~35.87 |

Thirty nights moved the deviation 196 → 166. Extrapolating that decay rate, it reaches the true
value in roughly **450 more nights — about fifteen months**. "Wait for the EMA" is not a plan.

The mean is the other half, and it is the half that costs readiness every day: still **0.53 °C low**,
which is TN-6's standing −16 pt penalty.

**Temperature is the only one of the five baselines that is wrong.** Measured over the last 30
nights, stored baseline deviation against the real night-to-night spread of the same rows:

| baseline | stored dev | real sd | ratio |
|---|---:|---:|---:|
| **temperature** (centi-°C) | **166.26** | **10.79** | **15.4×** |
| resting HR (bpm) | 4.01 | 4.33 | 0.93× |
| breathing (rpm×10) | 6.33 | 7.59 | 0.83× |
| sleep (min) | 40.12 | 69.49 | 0.58× |
| HRV (ms) | 7.13 | 13.06 | 0.55× |

The EMA's deviation is a *mean absolute deviation*, which for normal data sits near 0.8σ — so
0.55–0.93 is the healthy range and temperature at 15.4× is the lone outlier. It was hit and the
others were not purely because of scale: its sample is ~3,590 in centi-°C where resting HR is ~54.
The cold start is visible in the first stored row — 2026-07-08 recorded a baseline mean of
**17.91 °C**, exactly half that night's 35.81 °C sample, which is `updateBaseline`'s
anneal-from-zero behaviour before BF-13 seeded it.

---

## 2. Why only the penalty-free band has ever fired

Not "has not happened to fire" — **cannot**, by arithmetic. Running the real `computeIllnessRadar`
with temperature pinned at its observed ceiling (z = 0.28):

| scenario | score | flag |
|---|---:|---|
| resting HR and HRV both maximally bad (z = ±3) | **39** | `normal` |
| the same at absurd z = ±10 (both saturate) | **39** | `normal` |
| …and breathing maximally bad too (z = +3) | **64** | `watch` |

`ILLNESS_WATCH_SCORE` is 40 and `ILLNESS_ELEVATED_SCORE` is 65. So resting HR and HRV together
**top out one point below `watch`**, and all three non-temperature biomarkers at maximum top out
**one point below `elevated`**. The 2026-09-16 firing at 41 happened only because breathing drifted
+0.45 on the night. That is the whole explanation of TN-45's 72-day table.

`fever` needs a skin temperature of **40.3 °C** against the stored baseline. With a correct
deviation it would need 35.66 °C.

---

## 3. What the fix does — the part to act on

The temperature baseline was replayed cold with `seedOrUpdateBaseline` over all 67 nights that have
a temperature, exactly as the re-derive route replays it, and the real `computeIllnessRadar` re-run
per night against the corrected z (resting HR, HRV and breathing kept at their stored, correct
values).

**Corrected baseline: mean 35.86 °C, deviation 0.077 °C** (stored: 35.34 °C / 1.99 °C).

**Flag distribution over the 60 mature nights:**

| flag | nights |
|---|---:|
| `normal` | 51 |
| `watch` | 3 |
| **`fever`** | **6** |

### The six fever nights

| date | temp z | resting HR z | HRV z | score |
|---|---:|---:|---:|---:|
| 2026-07-26 | 3.92 | 1.18 | −2.51 | 72 |
| 2026-07-29 | 3.83 | −0.76 | **+2.42** | 48 |
| 2026-08-11 | 2.96 | 0.03 | **+0.73** | 49 |
| 2026-08-22 | 2.65 | −0.59 | **+1.62** | **37** |
| 2026-08-31 | 2.72 | 0.50 | −0.09 | 46 |
| 2026-09-09 | 2.75 | 0.81 | −2.46 | 54 |

**Four of the six have healthy or neutral HRV and unremarkable resting HR.** They are temperature
artefacts.

**2026-08-22 is the one that shows the structural problem.** It scores **37 — below `watch`** — and
is still flagged `fever`, carrying the full 25-point readiness penalty, because `isFever` is tested
*before* the score thresholds and short-circuits them. A night the composite rates as unremarkable
gets the strongest flag in the system.

### Why fever becomes reachable on ordinary nights

The corrected deviation is **0.077 °C**, so `FEVER_TEMP_Z = 2.5` trips at **0.19 °C above baseline**.
The real night-to-night spread is **0.128 °C**. So a 1.5-sd night lands at z = 2.49 — the fever line
is inside normal variation.

The corrected z's run hot for a second reason: 0.077 °C is only ~0.6× the true sd, because the EMA
tracks a mean absolute deviation and lags. Every temperature z built from it is inflated ~1.7×. The
replayed distribution over 55 nights runs **−5.92 to +3.92**, which is not a z-score's range.

---

## 4. Recommendation

**Run the re-derive — and re-scale the fever threshold in the same PR.** Lane A implements; this is
a proposal.

1. **Run it.** It fixes the baseline mean, and that is TN-6's daily readiness penalty — a live cost
   every day it waits, against fifteen months of self-correction.
2. **Do not let it land with `FEVER_TEMP_Z = 2.5` unchanged**, or the owner gets six fever banners
   and 25-point readiness penalties across sixty days, four of them on nights his HRV was fine.
3. **The denominator is the actual defect to fix**, not the threshold. The EMA deviation is a mean
   absolute deviation at ~0.6σ, so temperature z's are inflated ~1.7× even after the re-derive.
   Either divide by a true standard deviation, or scale `FEVER_TEMP_Z` and `ILLNESS_Z_FULL` for
   temperature by the same factor. Fixing the threshold alone leaves the readiness `temperature`
   contributor — the same z at 10% weight, `closer-better` — reading hot.
4. **Test `isFever` against the score, not instead of it.** A night scoring 37 should not be able to
   reach `fever`. Requiring the composite to clear `watch` before the fever branch applies would
   have caught 2026-08-22 and cost nothing on 2026-07-26.
5. **Re-measure after it lands, before anything is tuned further.** Every number above is a
   simulation of a fold, not an observation of the shipped system.

**This does not block TN-45** — it supports it. Under the corrected baseline the two real `watch`
days score **61 and 60** rather than 41 and 36, so the band the owner just asked to surface fires
*more* decisively, not less. The `watch` UI and the temperature fix are independent.

## What was not exercised

Everything here is a replay of `computeDailySummaries`/`computeIllnessRadar` against stored
production rows, run in the sandbox. The re-derive route itself was **not** run, not even in
`dryRun`. No device, no APK, no UI. The row-scoping applies throughout: these are the owner's
nights, and say nothing about any other account.
