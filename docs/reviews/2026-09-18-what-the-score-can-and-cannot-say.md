# What the readiness score can and cannot say about this person

**Tuning agent · 2026-09-18 · the owner's own rows only (`claude_ro` is row-scoped)**

A calibration sweep prompted by the owner's ask: *make the results very personal — a real value that
depicts their health, using all available data.*

The headline finding is not that the score is wrong. Measured over 65 days, the composite is
**robust** — the distortions below move it by a mean of 0.4 points and never more than 4. What they
wreck is the **explanation**. On 46% of days the HRV contributor reads exactly 0 or exactly 100, and
a rail cannot tell "a bit low" from "catastrophically low". The number is fine; the reason it gives
is not.

---

## 1. The four baseline contributors are on four different rulers

Half the readiness weight (resting HR .15 + HRV .15 + temperature .10 + sleep .10) is
baseline-relative. All four divide by the personal baseline's `devX8`, which the EMA maintains as a
**mean absolute deviation**, not a standard deviation. For normal data MAD ≈ 0.798σ, so even a
perfectly-working baseline inflates every z by ~1.25×. It is not working perfectly:

| metric | EMA dev | true sd | ratio (ideal 0.80) | so its z runs |
|---|---:|---:|---:|---|
| **HRV** | 6.39 ms | 11.02 ms | **0.58** | **1.7× too hot** |
| **sleep** | 39.50 min | 63.63 min | **0.62** | **1.6× too hot** |
| resting HR | 4.19 bpm | 3.68 bpm | 1.14 | 0.9× — roughly right |
| **temperature** | 216 centi-°C | 12.5 centi-°C | **17.3** | **0.06× — cannot move** (Q-506) |

**This is not the medication transient.** Split at the first dose, the ratios hold either side —
HRV 0.67 pre / 0.65 during, sleep 0.61 / 0.56. The distortion is the formula, not the physiology.

`Z_POINTS_PER_UNIT = 50/1.5` rails a contributor at ±1.5σ. With z's running 1.6–1.7× hot, that
threshold arrives far too often:

| contributor | days railed at 0 or 100 | sd of the sub-score |
|---|---:|---:|
| **hrvBalance** | **46%** | 37.8 |
| **sleepBalance** | **29%** | 30.9 |
| restingHeartRate | 17% | 28.1 |

Recomputed on a true sd, HRV's rail rate falls **46% → 33%** and sleep's **29% → 17%**, while
resting HR — currently *under*-reacting — rises 17% → 25%, which is the correction working in the
other direction.

**And the composite barely notices: mean move 0.4 points, max 4, zero days moving more than 5.**
The nine weights average the distortion away. So this is worth fixing for the breakdown the user
reads, not for the number on the front of the card — and it should not be sold as a score change.

## 2. What each contributor actually supplies, versus what its weight claims

Weight × the sub-score's own standard deviation, normalised — how much of the score's real movement
each term delivers:

| contributor | share of actual movement | weight says | |
|---|---:|---:|---|
| hrvBalance | **22.8%** | 15% | over-delivers (and rails half the time) |
| previousNight | 16.2% | 16% | matched |
| restingHeartRate | 15.9% | 15% | matched |
| sleepBalance | 13.9% | 10% | over-delivers |
| recoveryIndex | 10.3% | 9% | matched |
| temperature | **7.0%** | 10% | under-delivers — the Q-506 baseline |
| checkin | **6.5%** | 10% | under-delivers — **and not independent; see the ⚠ below** |
| prevDayActivity | **4.6%** | 9% | near-constant: never below 57 |
| activityBalance | **2.8%** | 6% | near-constant: never below 51 |

**The two activity terms carry 15% of the weight and supply 7.4% of the movement.** Neither has ever
scored below 51 in 65 days. They are a floor with a label, not a measurement of this person's day.

**⚠ CORRECTION, 2026-09-18 — the `checkin` row above is not a clean measurement.** The owner does
not choose that value: the check-in sheet seeds it from `readinessToEnergy(readiness)`, and the same
day's mood then scores into the same day's readiness. Measured over the 62 days carrying both, the
saved level is exactly what the auto-select would have produced on **45 — 73%**. So on about three
days in four the `checkin` term is a re-reading of readiness, its 6.5% share is not independent of
the score it feeds, and it must be re-measured after the seeding is fixed. Filed as **TN-50**.

**`recoveryIndex` is flagged `provisional` on 100% of days and is the 5th-largest driver of
movement** (sd 27.0, range 4–100). That is not a bug — `provisional` here means *the curve is an
approximation*, and Q-500 fitted the 5-hour anchor properly against 15 Cloud nights. But the file's
own header comment still says it is *"always neutral/provisional … never scored"*, which has been
false since Q-500 shipped. A stale comment on the one contributor whose honesty caveat matters.

## 3. Seven days show a score that contradicts its own explanation

Q-501 shipped on 2026-08-26 and now persists the input behind every contributor, so a stored score
can be re-derived from its own row. Doing that for all 65 days: **7 disagree**, all consecutive
(2026-07-16 → 07-22), all by −4 to −6 points.

They are the rows written before the 2026-07-22 weight rebalance. Their contributors were re-derived
under the new model; their **score was not**. And **40 of 65 rows carry no `model_versions.readiness`
stamp at all** (2026-07-16 → 08-25), with the stamped and unstamped ranges overlapping — so some
rows were re-derived and some were not, and the row cannot say which.

For a user opening a past day, the card and its breakdown disagree by up to 6 points with nothing to
explain why.

## 4. The most personal data in the app is collected daily and analysed nowhere

`body_metrics` carries a full bioimpedance suite — `skeletal_muscle_pct`, `muscle_mass_kg`,
`fat_free_mass_kg`, `visceral_fat_index`, `body_water_pct`, `bone_mass_kg`, `bmr_kcal`,
`metabolic_age` — on **49 of the last 90 days**. Grepped: those columns appear in 18 files and **zero
scoring or analysis modules**. They are stored, displayed as numbers, and never interpreted.

That matters right now, because the owner started Retatrutide on 2026-09-07 and the question a person
on a GLP-1 actually has is *am I losing fat or muscle* — which this data answers and nothing asks.

Taking the raw numbers at face value:

| | weight | fat mass | lean mass |
|---|---:|---:|---:|
| pre-dose (n=37) | 71.26 kg | 17.59 kg | 53.67 kg |
| on Retatrutide (n=12) | 70.16 kg | 17.92 kg | 52.24 kg |
| **change** | **−1.10 kg** | **+0.33 kg** | **−1.43 kg** |

Read alone that says *every kilo lost was lean, and then some* — which would be alarming, and is the
reading a user gets today from staring at the lean-mass number on the card.

**It is mostly wrong, and the app already holds the column that shows why.** Bioimpedance lean mass
includes body water, and body water fell 1.04 kg over the same window:

- total body water **−1.04 kg**
- lean mass **−1.43 kg**
- **lean minus water: −0.38 kg** — water explains **73%** of the apparent lean loss

A 0.38 kg non-water change over 12 days is inside scale noise. And the last eight readings are moving
the right way: body fat **25.7% → 25.2%**, muscle **39.4% → 39.6%**, water **54.3% → 54.6%**, weight
70.35 → 69.45.

**This is the single clearest case for the owner's ask.** The raw number frightens; the decomposition
reassures; the app has both and shows only the first.

---

## Recommendations

Filed as **TN-47** (the rulers), **TN-48** (body-composition decomposition) and **TN-49** (the seven
contradictory rows). Tuning proposes; Lane A implements.

The ordering is deliberate. **TN-48 first** — it is the only one that adds an answer the user cannot
get today, and it needs no scoring change at all. TN-47 second, scoped as an *explainability* fix
with the measured note that the composite moves 0.4 points, so nobody mistakes it for a re-score.
TN-49 last; it is a back-fill.

## What was not exercised

Every figure is a read of stored production rows, or a replay of the shipped scoring functions over
them, run in the sandbox. No code changed, no scoring touched, no device, no UI. All rows are the
owner's own — `claude_ro` is row-scoped, so none of this says anything about any other account. The
bioimpedance figures are what the scale reported; they are not a clinical body-composition
measurement, and the water decomposition is an argument about the arithmetic, not a medical finding.
