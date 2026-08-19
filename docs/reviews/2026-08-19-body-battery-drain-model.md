# Body Battery: the drain model, fitted

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[body]` `[activity]` `[readiness]`
**Closes the open design question in Q-521**, and completes the Q-276 decision.
**Owner decision, verbatim:** *"yes this is correct; the fitter we get, the more workout stimulus we
should need for draining, outside of BMR draining which should naturally go up too."*

The owner confirmed **goal-normalised** drain over absolute depletion, and added a term the earlier
brief did not have: **a baseline drain proportional to BMR**. This fits both against 90 days of their
own data and lands on concrete parameters with pass tests.

---

## 1. What the decision settles

| | |
|---|---|
| **Body Battery answers** | *"how much of my day have I spent?"* — energy remaining, goal-normalised |
| **Readiness answers** | *"where am I starting from?"* — a morning number from last night and yesterday |
| **Drain has two parts** | **baseline** (you deplete by being awake) **+ activity** (what you did, against your own targets) |
| **Both scale with fitness** | targets rise as you improve, and baseline rises with BMR |

The coherence the owner identified is real: **a fitter athlete needs more absolute work to empty the
same tank**, because their targets moved up with them, and their baseline burn moved up too. That is
what makes goal-normalisation defensible rather than a dodge.

---

## 2. Checking the BMR premise — correct in principle, not yet true in fact

`body_comp` holds 71 daily snapshots (2026-05-07 → 2026-08-19) with `bmr_kcal` and `ffm_kg`.

| month | BMR | fat-free mass |
|---|---|---|
| May | 1,529 | 53.7 kg |
| June | 1,514 | 53.0 kg |
| July | 1,582 | 56.1 kg |
| August | 1,522 | 53.3 kg |

**Trend over the full window: r = +0.080 — flat.** So the model should be *built* to respond to BMR,
but nobody should expect the baseline term to move soon. Say so in the UI copy rather than implying a
responsiveness the data has not yet shown.

### ⚠️ One corrupt snapshot, and it matters more once BMR drives drain

**2026-07-29 records body fat 3.0%**, fat-free mass **70.4 kg of 72.6 kg bodyweight**, BMR **1,890**
— against 24% and ~1,520 on the surrounding days. Three per cent is below the essential-fat floor for
a male; this is a bad scale reading propagated through `cunninghamBmr` into a stored BMR **24% above
baseline**.

Today it is inert. **Once BMR drives baseline drain, that single row becomes a day that drains a
quarter faster for no reason.** A plausibility guard is now load-bearing rather than cosmetic — filed
as **Q-527**.

---

## 3. The naive allocation fails, and the failure is instructive

Start with a straight split of the tank — baseline 40, workout 35, steps 25, each draining
proportionally to goal completion. Simulated over 90 real days:

| | measured |
|---|---|
| mean end value | **25.7** |
| sd | 16.4 |
| range | 0–58 |

**The typical day reads nearly empty and the tank never gets near full.** The cause is not saturation
— both inputs vary well (workout completion sd **0.403**, 16 days at ceiling and 29 at zero; steps sd
**0.346**). It is that a *typical* day is ~58% of a *full* day, so any linear split that puts a full
day at zero puts a typical day near it.

Sweeping the split does not fix it — every linear allocation lands mean 26–34, sd 16–22:

| baseline / workout / steps | mean | sd | max |
|---|---|---|---|
| 40 / 35 / 25 | 25.7 | 16.4 | 58 |
| 30 / 40 / 30 | 29.9 | 19.0 | 67 |
| 25 / 45 / 30 | 32.3 | 20.7 | 72 |
| 20 / 45 / 35 | 34.0 | 21.6 | 77 |

Three constraints are in play and **linear drain cannot satisfy all three**: everything-hit → 0,
nothing-done → still meaningfully depleted, typical day → mid-range.

---

## 4. The fit: a baseline plus a concave activity curve

Make the activity term **concave** — early effort drains less, and the last stretch to "everything"
carries a disproportionate share. That is also physiologically the right shape: the marginal cost of
the final push exceeds the first.

```
completion c = 0.5 × min(1, workoutVolume / sessionVolumeGoal)
             + 0.5 × min(1, steps / stepGoal)

endValue = max(0, 100 − baseline − (100 − baseline) × c^exponent)
```

Swept against 90 real days at baseline 25:

| exponent | mean | sd | range | days ending under 5 |
|---|---|---|---|---|
| 1.0 (linear) | 31.2 | 19.7 | 0–72 | 11 |
| 1.5 | 38.9 | 21.6 | 0–74 | 9 |
| **2.0** | **~44** | **~22.6** | **0–75** | **~9** |
| 2.2 | 46.1 | 22.9 | 0–75 | 8 |

### Recommended parameters

**`baseline = 25`, `exponent = 2.0`, workout and steps weighted 50/50 inside `c`.** All three
constraints hold:

| day | end value | matches the brief? |
|---|---|---|
| everything hit (`c = 1`) | **0** | ✅ *"a day where I have done everything — I'd expect to see 0"* |
| workout only, no walking | **~30** | ✅ *"a bit of reserve battery at the end of the day"* |
| nothing done (`c = 0`) | **75** | ✅ depleted by being awake, but not by much |
| typical day | **~44** | ✅ mid-range, so the number is readable rather than always empty |

**Baseline scales with BMR**, as the owner asked: `baseline = 25 × (bmrToday / bmrReference)`, where
`bmrReference` is a rolling median of their own recent BMR. A 10% BMR gain lifts baseline to 27.5 —
responsive, and never dominant.

### An honest comparison to what ships today

| | shipped | proposed |
|---|---|---|
| mean | 50.3 | ~44 |
| **sd** | **30.1** | **~22.6** |
| range | 0–100 | 0–75 |

**The proposed model has less spread, and that is not a regression.** Today's sd is largely produced
by how long the ring was worn — `corr(hr_sample_count, total_drained) = +0.518` while
`corr(steps, total_drained) = −0.153` (Q-521). Twenty-two points of spread driven by what the owner
did beats thirty driven by an artefact. **Range is a filter, not a verdict** — the cross-pillar review
made that point and it applies here against my own proposal.

The ceiling of 75 is a deliberate consequence: with a baseline term, a day cannot end full. If the
owner wants the full 0–100 used, baseline must go to zero, and then a sedentary day ends at 100 —
which contradicts the term they asked for. **Stated so it is a choice, not an accident.**

---

## 5. Pass tests for the implementation

1. `corr(steps, total_drained)` becomes **clearly positive** (it is −0.153 today).
2. `corr(hr_sample_count, total_drained)` **drops toward zero** — wear time must stop being the
   strongest predictor.
3. Workout days and non-workout days separate by **far more than 0.6 points** of end value (the
   measured difference today is 50.6 vs 50.0).
4. Re-simulate over the same 90 days: mean **40–48**, sd **≥ 20**, and **no more than ~15%** of days
   ending under 5. A model that empties most days is as uninformative as one that never does.
5. The 2026-07-29 body-comp row must not produce an outlier day (Q-527's guard).

**Do NOT ship this before Q-515** (the rest/active boundary) **and Q-527** (the BMR guard). Q-515
because a boundary that moves with fitness re-poisons anything built over it; Q-527 because BMR
becomes load-bearing the moment this lands.

---

## 6. What this model is deliberately not

**It is not a recovery or overreaching signal.** On a target-hitting day a well-recovered athlete and
an overreached one both read 0 — that is inherent to goal-normalisation, not a tuning gap. Overreach
lives in ACWR, readiness and the illness radar. Per the Q-276 decision, Body Battery and Readiness now
answer different questions and are not required to agree; their **+0.12** end-of-day correlation stops
being a defect and becomes the expected shape — the day starts where readiness says (anchor r =
**+0.93**) and diverges as energy is spent.

**Caveats.** One athlete, 90 days, `claude_ro` row-scoped. Every simulated figure is a *replay* using
current goals — the step goal moves to 7,000 under Q-524, which is the value used here. Workout
completion uses tonnage against `DEFAULT_SESSION_VOLUME_GOAL_KG`; if Q-505's redesign changes what a
"full" session means, these numbers move with it. The exponent of 2.0 is fitted to one person's
distribution of effort and should be re-swept before a second user relies on it.
