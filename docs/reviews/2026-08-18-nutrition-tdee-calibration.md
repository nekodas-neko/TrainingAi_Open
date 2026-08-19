# The adaptive-TDEE gates hold 75% of the time, and the 25% that gets through is the harmful case

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-517 · **Lane:** A implements (this proposes only)
**Scope note:** the nutrition pillar's last uncalibrated item — *does the calorie target track the
owner's observed weight change?* The answer turned out to be a different, sharper question.

**`adaptive-tdee.ts` already runs this exact check and already anticipates this exact failure.** Its
header says an ungated estimate *"would tell the user their maintenance is 1200 kcal — actively
harmful advice"*. This review measures whether the gates it added actually hold. **They hold 75% of
the time, and the lowest value that gets through is 1,052 kcal.**

---

## 1. The owner's food log captures under half of what they eat

| | value |
|---|---|
| days with any food log | 44 of 110 |
| mean logged intake | **1,223 kcal/day** |
| median | 1,273 |
| days logging < 1,200 kcal | **19 of 44 (43%)** |
| mean entries per logged day | 4.8 |

Against the weight record — 75 weigh-ins over 109 days, least-squares slope **+8.0 g/day**
(+0.056 kg/week), i.e. an energy balance of **+62 kcal/day**:

- Cunningham BMR at 71.2 kg and 23.5% body fat (FFM 54.5 kg) = **1,547 kcal**
- × 1.55 (`activity_level: moderate`) → predicted TDEE **2,397**
- Implied actual intake = 2,397 + 62 = **~2,459 kcal/day**
- **So the log captures ~50% of actual intake.**

> **⚠️ CORRECTED 2026-08-19.** This section first published **1,698 / 2,632 / 2,694 / ~45%**, computed
> from the textbook Cunningham equation (`500 + 22 × LBM`) **from memory**. The app does not use that
> variant: `packages/shared/src/health/body-composition.ts` defines
> `cunninghamBmr = ffm × 21.6 + 370`, deliberately matched to Oura's `atlas` postprocessor and shared
> with the nutrition-goal baseline. Every figure above is now computed from **the formula the app
> actually uses**. **The conclusion is unchanged** — the log-implied maintenance of 1,161 is still
> below BMR — but the magnitudes were overstated.

The cross-check is decisive: taking the log at face value implies a maintenance of
**1,223 − 62 = 1,161 kcal**, which is **below this person's BMR**. That is not a slow metabolism; it
is arithmetic proof of under-logging.

**This is not a defect and nothing is filed for it.** People log partially. It is the input condition
everything below has to survive.

---

## 2. Replaying `estimateMaintenance` over the real data

Faithful replay of the shipped gates (`MIN_LOGGED_DAYS 10`, `MIN_LOGGED_FRACTION 0.7`,
`MIN_WEIGH_INS 4`, `MIN_WEIGHT_SPAN_DAYS 10`, plausibility 1,000–6,000), evaluated on every rolling
window:

| outcome | 14-day (97 windows) | 28-day (83 windows) |
|---|---|---|
| `not_enough_logged_days` | 68 | 35 |
| `logging_too_sparse` | — | 26 |
| `weight_span_too_short` | 4 | — |
| `implausible_result` | **2** | 0 |
| **PASSED** | **23 (24%)** | **22 (27%)** |
| passing range | **1,052 – 2,219** | **1,246 – 1,889** |

**The gates do most of the work** — three quarters of windows are correctly refused. The design is
sound and this review does not argue otherwise.

### 2.1 But the plausibility floor sits just below the artefact

`MIN_PLAUSIBLE_MAINTENANCE = 1000`. This owner's under-logging artefact lands at **1,052** — clearing
the floor by **52 kcal**. The module's own comment predicted the failure at "1200 kcal"; the floor was
set 200 below that prediction, and the real value slipped between them.

### 2.2 And the passing values are unstable

The same person, over a few weeks, gets estimates spanning **1,052 – 2,219** on a 14-day window — a
**1,167 kcal range**. Even where a value is not harmful, it is not reproducible.

### 2.3 Why the coverage gates cannot catch this

`MIN_LOGGED_FRACTION` counts **days that carry a log**, not whether each day's log is **complete**. A
day with breakfast logged and nothing else counts as fully logged. That is exactly this owner's
pattern — 4.8 entries and 1,223 kcal per "logged" day — so a 50%-complete record sails through a
70%-coverage gate.

**The gates measure the wrong kind of incompleteness.**

---

## 3. It reaches the user's calorie target

`TdeeAdaptationCard` offers the calibrated maintenance and, on accept, writes it through
`PUT /api/nutrition/targets`, which the component's own docstring notes *"is the source of truth for
the daily target and mirrors into `users.calorie_goal`"*. So a 1,052 kcal maintenance is one tap from
becoming the daily calorie goal of someone whose BMR is 1,547.

---

## 4. Proposal

**Replace the universal `MIN_PLAUSIBLE_MAINTENANCE = 1000` with the user's own BMR.**

Maintenance below BMR is not implausible-by-taste, it is **impossible by definition** — a living
person at rest burns BMR, and this one trains five times a week. `cunninghamBmr` is already imported
in the same package (`goal-recommendation.ts` uses it), so the number is available at no cost.

Measured effect on this owner's data:

| | shipped floor (1,000) | BMR floor (**1,547**) |
|---|---|---|
| 14-day windows passing | 23, range **1,052–2,219** | **13**, range **1,592–2,219** |
| 28-day windows passing | 22, range **1,246–1,889** | **13**, range **1,565–1,889** |

*(Corrected 2026-08-19 — first published against a 1,698 floor, which blocked more than the app's own
BMR would: 11 passing at 1,902–2,219 and 10 at 1,707–1,889. The proposal is unaffected; it blocks
fewer windows than first stated.)*

Every harmful value is blocked and the surviving range tightens sharply.

**It makes the estimate safe, not correct.** The survivors (1,592–2,219) still sit well below the
formula's 2,397, which is the residual under-logging showing through. A BMR floor stops the app giving
dangerous advice; it does not make the calibrated maintenance right, and it should not be described as
if it does.

**Two things NOT to do:**
1. **Do not raise `MIN_LOGGED_FRACTION`.** It already refuses three quarters of windows, and the
   failure is within-day incompleteness which that gate structurally cannot see. Raising it removes
   good windows and leaves the bad ones.
2. **Do not "fix" it by scaling logged intake up.** Inferring an under-logging multiplier from the
   weight trend and then feeding it back into a maintenance estimate derived from the weight trend is
   circular — it would reproduce the assumed TDEE and call it a measurement.

**The durable fix, larger and separate:** detect within-day incompleteness (meals expected vs logged,
or an intake floor relative to BMR) and treat a day as unlogged rather than low. That is a feature, not
a constant, and it is the real answer.

---

## 5. What was not exercised

- **No code changed and no constant altered.**
- **The replay is a faithful port of `estimateMaintenance`'s gates, not the shipped function**, and it
  could not be validated against stored output — **no maintenance estimate is persisted**, so there is
  nothing to reconcile against. Same limitation as the ACWR and RPE replays.
- **`linearFit` was re-implemented as a plain least-squares slope**; if the shipped one differs
  (weighting, robustness) the slopes differ slightly. The gate outcomes are dominated by the coverage
  counts, which do not depend on it.
- **Intake is `SUM(food_items.calories × quantity_multiplier)`** over non-deleted logs. Whether every
  `food_items.calories` value is accurate was not checked — an error there would bias the level,
  though not the under-logging conclusion, which rests on the weight trend.
- **`activity_level: moderate` (×1.55) is taken from the profile as-is.** If the owner is more active
  than that, predicted TDEE is understated and the under-logging is *worse* than 50%, not better.
- **The BMR formula was taken from memory on the first pass and corrected on 2026-08-19** by reading
  `body-composition.ts`. The repo's rule about verifying field names against the pinned source rather
  than memory applies to **formulas** too, and this is the worked example.
- **The 7,700 kcal/kg constant** is a fat-mass approximation; during genuine recomp the true figure
  differs. Over 109 days at +8 g/day this affects the balance figure by tens of kcal, not hundreds.
- **`tdeeAdjustment` in `tdee-adaptation.ts` is dead code** — referenced only by its tests and a
  comment in `TdeeAdaptationCard` explaining that it was replaced. Not filed; recorded so a successor
  does not calibrate it (the same trap as `amrapScaleFactor` in Q-514).
- Every figure is **the owner's** (`claude_ro` is row-scoped), 2026-05-01 → 08-18.
