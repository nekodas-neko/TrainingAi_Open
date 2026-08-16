# Calibrating the Activity goals — a design discussion (Q-137)

**Status:** ✅ **DECIDED 2026-08-11 — direction C, goals set ABOVE typical.** See §8. The rest of
this document is the analysis that led there; it stands as written.

Originally a proposal for the owner, not a decision. Written 2026-08-11 because the Q-137 options
("re-anchor the goals" / "re-weight" / "replace activeEnergy") all turned out to be downstream of a
question none of them asked: **what should an activity goal for a strength athlete actually
measure?**

---

## 1. What is measurably wrong

| fact | measured |
|---|---|
| Activity score, 30 days | mean **74.3**, sd **5.9**, range 60–81 |
| Steps over the same days | mean **6,959**, sd **4,028** |
| `strengthFreq` (weight **25**, the largest) | goal **3**/wk vs actual **4.9**/wk → ratio 1.63; curve caps at 100 from 1.0 |
| `activeEnergy` (weight 15, sd 29.5) | last input **2026-07-07** — the BLE re-key. 34 days dead |
| `activeCaloriesEst` (the intended replacement) | **0 of 42 days** populated |

The input that varies most swings by ±58% of its mean. The output moves within a 21-point band.
Roughly **57 of 100 weight cannot change**, so the score is close to a constant with a step counter
bolted on.

**The missing-days worry was unfounded** — checked, and every day from **2026-07-28** onward has an
activity score; the gaps are all before it. That is the score's own start date, not a live fault.

## 2. Why re-anchoring to the user's own baseline is the wrong instinct

It is the obvious fix and the model was **deliberately rewritten away from it on 2026-07-22**. The
file says so at the top: the previous model scored against the user's trailing average, so "100"
only meant *as active as you usually are* — and a lazy week lowered the bar.

Any rolling-baseline goal reintroduces that. It also creates a treadmill: train harder, the target
rises, the score stays 74. **Whatever we choose has to keep 100 meaning something absolute.**

## 3. What the established apps actually do

Worth grounding in, because this problem is not novel and the industry has converged:

| app | daily/period target | basis | how it handles lifting |
|---|---|---|---|
| **Garmin** | Intensity Minutes, 150/wk | HR-based: moderate >~50% HRR, vigorous >70% (**counts double**) | Poorly on IM alone — which is why Garmin *also* carries **Training Load** (EPOC-derived) and Training Status as the real load signal |
| **Apple** | Move (kcal), Exercise (30 min), Stand (12 h) | Move is user-set kcal; Exercise = brisk-walk-equivalent intensity | Strength counts via kcal, poorly via Exercise minutes |
| **Samsung Health** | Steps / Active time / Activity kcal | User-set, defaults 6,000 / 90 min / 500 kcal | Activity time counts logged workouts regardless of HR |
| **Whoop** | Strain 0–21, logarithmic | Cardiovascular load from continuous HR | Lifting registers — HR is elevated throughout, so strain accrues |
| **Strava** | Relative Effort, weekly | Banister-style TRIMP from HR | Registers whenever HR is recorded |
| **Oura** | Activity Score | Goal from stated activity level | The model we inherited the shape from |

**The pattern:** every app that handles strength training well does it by measuring **physiological
load from heart rate**, not by counting minutes above a cardio threshold. The ones that count
threshold-minutes (Garmin IM, Apple Exercise) all bolt a *second*, load-based metric alongside.

We already have the raw material for that — continuous HR from the ring **and** the chest strap
(`oura_heartrate` carries `chest_strap` samples; 1,090 on one day), plus `training_load_ots` already
on `oura_daily_derived`.

## 4. The evidence base for the absolute targets

If we keep goal-anchoring (and §2 says we should), the targets should cite something:

- **WHO 2020 physical activity guidelines** — 150–300 min/wk moderate *or* 75–150 vigorous, **plus
  muscle-strengthening ≥2 days/wk**. The current `DEFAULT_STRENGTH_FREQ_GOAL = 3` already sits above
  the WHO floor; the problem is that a floor is not a *target* for someone at 4.9.
- **Paluch et al. 2022** (Lancet Public Health, meta-analysis) — mortality benefit from steps
  plateaus around **6,000–8,000/day for 60+** and **8,000–10,000/day for under 60**. The current
  8,000 default is defensible; measured mean is 6,959, so this one is *not* saturated and is doing
  real work.
- **MET-minutes** — WHO's own equivalence is ~**500–1,000 MET-min/wk**. This is the unit that lets
  a lifting session and a walk be added together without pretending either is the other.

## 5. Three candidate directions

### A. Personal absolute goals, set once (smallest change)
Keep the model. Replace the saturated WHO floors with per-user values stored on the profile —
strength frequency, move hours, weekly volume — chosen by the owner, not derived.

- *Keeps* 100 = an objectively good day. No treadmill.
- *Fixes* the three saturated contributors immediately, no device work.
- *Does not* fix the deeper issue: the score still cannot see how **hard** a session was, only that
  it happened. Two sessions of wildly different intensity score identically.

### B. Add a load lane from heart rate (the industry answer)
Introduce a MET-minute or TRIMP-style term computed from continuous HR, replacing `zoneMinutes` and
the dead `activeEnergy` with one physiologically-grounded contributor that both modalities feed.

- *Fixes* the structural problem: lifting, walking and cardio all register on one scale.
- *Aligns* with Whoop/Strava/Garmin-Training-Load rather than the threshold-minute approach that
  demonstrably fails for this training style.
- *Costs* the most: a new derivation, and it needs HR coverage on non-workout hours to be fair.
  `training_load_ots` already exists and may be most of it.

### C. Both, in order
A now (it is small, and the score is misleading *today*), B as its own planned item.

**My recommendation is C**, with one caveat worth the owner's attention: under A, the goals become
numbers you pick, and picking them badly is the same failure in a new costume. §4's anchors are how
we avoid that — a strength-frequency target of 5 for someone at 4.9 is defensible; 8 is not.

## 6. Decided already, and queued separately

- **`zoneMinutes` structural zero** — absent data is excluded and renormalised, but a *structural*
  zero scores as a genuine 0 at full weight (10). Zone 1 starts ~60% HRR, which lifting with rest
  rarely sustains, so a lifter scores ~0 on a cardio metric permanently. Owner approved fixing this;
  it is a prerequisite for any of the above, since it is currently dragging the score down for a
  reason that is not about the user's behaviour.
- **The dead `activeEnergy` pipe** — filed separately. `active_calories_est` exists end-to-end
  (device payload → Zod validation → storage → sync) and is **0 of 42 days** populated: the device
  never computes it. That is Kotlin work plus a new APK, which is why it is not part of this.

## 7. What was asked of the owner

1. Direction A, B, or C (§5).
2. If A or C: the actual target values, using §4 as the justification — strength sessions/week, move
   hours/day, weekly volume. Steps at 8,000 appears correct and I would leave it.

## 8. The decision (2026-08-11)

**Direction C** — A now, B as its own project. **Goals set ABOVE typical**, so 100 means a good day
rather than a Tuesday.

That second half is the load-bearing part and it was nearly missed. Setting the strength goal to 5
against a measured 4.9/wk gives ratio 0.98 → ~99: **the saturation would have been re-created with
better-looking numbers.** A only works if the targets sit meaningfully above typical.

**Two consequences to expect, and they pull in opposite directions:**

- **A will make the score move, and centre it LOWER than the current 74.** That is the intended
  behaviour — 100 should be reachable, not routine — but it is a visible change in what the number
  feels like, and it should not be mistaken for a regression.
- **Q-183 pulled the other way, and has already shipped** (#1249, 2026-08-11, v1.279.2) — worth
  **+5 points** on a measured A/B. Its lift is therefore already in the baseline: **measure any
  before/after of the goal change against a post-Q-183 window, not against the 74.3 in §1.** Its own
  measurement is also the strongest argument for B — **40 of the last 45 days had exactly zero zone
  minutes**, which is what a threshold-minute metric looks like when it cannot see the training.

**Order of work:**

1. ~~**Q-183** — `zoneMinutes` structural zero.~~ **Shipped 2026-08-11 (#1249, v1.279.2).**
2. **A** — per-user goal values on the profile, replacing the WHO floors for strength frequency,
   move hours and weekly volume. **Steps stays at 8,000** — measured against a 6,959 mean, it is the
   one goal already doing real work. Target values still to be set; §4 is the justification and the
   91-day baseline in Q-137 is the reference.
3. **B** — gated, not queued. Before it is filed as a project, **measure two things**: HR coverage
   during non-workout hours (the ring power-gates its PPG when worn-idle, so sparse coverage would
   under-count ordinary movement and over-weight workouts), and whether `training_load_ots` is
   actually populated — the column exists, but that was verified from the schema, **not from the
   data**. Both are cheap queries and they decide whether B is a real option or a rebuild.

## 9. The target values (2026-08-11) — and what re-verifying them found

The owner chose **strength frequency 5** (at the optimum, not above it) and asked for the other two
baselines to be **re-verified before setting targets**. That instruction paid for itself twice.

| goal | current | actual (re-measured) | target | status |
|---|---|---|---|---|
| Steps | 8,000 | mean **6,959** (30 d) | **8,000 — unchanged** | ✅ verified; Paluch plateau; already discriminating (sd 33.6) |
| Strength frequency | 3 | **4.9**/wk | **5** | ✅ decided |
| Weekly volume | 4,700 | **25,159** mean, sd 4,545, range 16,843–31,083 (8 wk) | **28,000** | ✅ verified — see below |
| Move hours | `sleepHour − wakeHour` | — | **DO NOT RAISE** | ⛔ see below |

**Volume: the filed number was not representative.** Q-137 recorded 29,661. The measured 8-week mean
is **25,159** — 29,661 sits near the observed *maximum* (31,083), not the middle. A target set from
the filed figure would have been ~18% above the real mean instead of ~11%. **28,000** is ≈11% above
mean and below the best observed week, so a strong week reaches 100 and a typical one does not.

**Why strength frequency is 5 and not 6.** It is the one goal where "above typical" argues against
itself: more sessions is not monotonically better, and the model *already* tapers the score for
over-reaching via ACWR. A goal of 6 would have one part of the model rewarding what another
punishes. At 5, the contributor still discriminates where it matters — 3 sessions gives ratio 0.6 →
~73 — without pushing past the optimum.

**Move hours is NOT a goal-calibration problem, and raising it would have hidden the real fault.**
`moveHoursGoal()` is not the hardcoded 15 in `daily-goals.ts`; it is derived as
`sleepHour − wakeHour` — **waking hours**. But the numerator (`hourlyMovement`) adds any hour in
**0–23** whose HR clears the rest threshold, with no waking-hour filter. Numerator and denominator
measure different windows, so the ratio is structurally ≥ 1 and the contributor pins at 100 no
matter what the goal is. This is the same shape as Q-183's `zoneMinutes` structural zero, inverted.
Filed as **Q-188**; the move-hours goal must not be touched until it is fixed.

## 10. Corrections and decisions, round 2 (2026-08-11)

**I had the volume goal wrong in §9, and the error is worth recording rather than quietly editing.**
There is no stored weekly-volume target. `activity-score.ts:135` computes
`volTarget = typicalSessionVolumeKg × strengthFreqGoal`, and `typicalSessionVolumeKg` is the
**median of the user's own sessions**. The "4,700" in Q-137 is that per-session median, not a goal.
So the **28,000 weekly volume approved in §9 is not implementable as written** and is withdrawn.

Three consequences:

1. **A shrinks to a single value.** `DEFAULT_STRENGTH_FREQ_GOAL` 3 → 5 is the whole change. It fixes
   *both* strength lanes, because `volTarget` scales off it: 4,700 × 5 = 23,500 against a measured
   25,159 weekly mean, so a good week still reaches 100 while a weak week (16,843) drops to ~72.
   No migration, no new profile columns, no UI.
2. **The volume lane is self-referential** — the treadmill §2 says the 2026-07-22 rewrite removed.
   It was removed from the daily-movement lane and left here. Filed as **Q-190**; decided
   2026-08-11 to replace the median with an absolute per-session tonnage (~5,200, confirm before
   shipping). `lib/activity/blend-activity.ts:45` uses the same median and must be checked in the
   same PR.
3. **Q-188 decided:** restrict the move-hours numerator to waking hours rather than dividing by 24.
   Dividing by 24 is smaller but would flip the contributor from permanently ≥100 to permanently
   under it, since 24/24 is unreachable while asleep.

**Dependabot** was checked with the owner the same day and is **below the CLAUDE.md threshold**
(<5 high/critical, no stale critical), so the standing remediation item does not jump the queue.

**Order from here:** Q-137/A (one line) → Q-188 → Q-190 → direction B, still gated on the two
measurements in §8.

## 11. Direction B's two gates, measured (2026-08-11)

B was left **gated, not queued**, on two questions. Both are now answered, and they point in
opposite directions — one of them contradicts a worry I raised in §5.

### Gate 1 — is `training_load_ots` populated? **No. 0 of 42 days.**

§3 and §5 both said *"`training_load_ots` already exists and may be most of it"*. That was verified
from the **schema**, not the data. It is empty — the same shape as `active_calories_est` (Q-184):
a column that exists end-to-end and is never written. **B has no head start.** Any load term is a
from-scratch derivation.

### Gate 2 — is waking-hour HR coverage good enough for a load model? **Yes, comfortably.**

Distinct waking hours (07:00–21:59 Brisbane) carrying at least one HR sample, last 14 days:

| mean | worst | best |
|---|---|---|
| **13.3 of 15** | 1 (today, a partial day in progress) | 15 |

Excluding the partial day the range is **12–15 of 15**, i.e. ~80–100% coverage.

**The specific worry in §5 was wrong, and worth recording as wrong.** I argued the ring
power-gates its PPG when worn-idle, so non-workout coverage might be sparse and a load model would
under-count ordinary movement. Measured: on **2026-07-30 the ring alone covered 12 of 15 waking
hours with zero chest-strap samples**. Coverage is not strap-dependent, and the power-gating does
not leave the gaps I predicted.

Sources over the window: `chest_strap` 8,706 samples, `ble` 3,990.

### What this changes about B

- **Viable on data.** The fairness objection — the thing that could have made B a rebuild rather
  than a feature — does not hold.
- **Larger than hoped on effort.** No pre-computed load value exists to build on.

So B moves from *gated* to *queued* as **Q-204**, with the fairness question closed and the effort
estimate corrected.
