# Every metric the app records, and where the core/adjustment line could sit

**TN-38 task C.** The owner asked for every metric recorded, plus alternative definitions of "core"
with the reasoning for each, before setting the line. This is that inventory, measured against
production rather than read off the schema.

**Why the line matters.** Today a score renormalises its weighted mean over whichever contributors
are present (`sleep-score.ts:399`), so connecting a sensor changes the *denominator*. Two users' 78s
are computed from different weight sets, and the owner's own 78 today is not the same quantity as
his 78 next year on different hardware. Under `clamp(core + Σ adjustments)` the core is one quantity
everyone shares and an extra sensor contributes a signed delta.

---

## 1. Every metric currently recorded

Grouped by the cheapest device that can supply it. Coverage is the owner's last 60 days.

### Tier 0 — phone, scale and the user's own hands (no wearable)

| metric | table | coverage |
|---|---|---|
| body weight | `body_metrics.weight_kg` | 48/60 |
| body fat %, skeletal muscle %, visceral fat, body water %, bone mass, BMR, metabolic age | `body_metrics` (smart scale) | 48/60 |
| waist / chest / arm / thigh / hip / neck | `body_metrics.*_cm` | manual |
| calories, protein, carbs, fat, water | `body_metrics` (food log) | daily |
| workout sessions, sets, reps, load | `workout_sessions` · `set_logs` | every session |
| energy level, sleep quality, body state, sore muscles | `mood_logs` | check-in |
| steps, distance | `body_metrics.steps` · `distance_km` | 60/60 |
| bed/wake time | `sleep_sessions.manual_sleep_start` | manual fallback |

### Tier 1 — any basic wearable (watch, band, Health Connect)

| metric | table | coverage |
|---|---|---|
| resting heart rate | `body_metrics.resting_heart_rate` | 60/60 |
| sleep duration, time in bed | `sleep_sessions.duration_hours` · `time_in_bed_hours` | 71/71 |
| sleep efficiency | `sleep_sessions.efficiency` | 71/71 |
| onset latency | `sleep_sessions.onset_latency_sec` | 71/71 |
| overnight average / lowest HR | `sleep_sessions.avg_heart_rate` · `lowest_heart_rate` | 71/71 |
| intraday HR series → zone minutes, active calories, move hours | `oura_heartrate` | 74,860 strap + 12,673 ring / 45 d |
| sleep stages (REM / deep / light / awake) | `sleep_sessions.*_sleep_hours` | 71/71 |

⚠ **Stages are Tier 1 by availability and Tier 2 by trust.** Every consumer device reports them and
no two agree; the app's own stages come from SleepNet, our model, not from the ring.

### Tier 2 — ring, chest strap or premium wearable

| metric | table | coverage |
|---|---|---|
| overnight HRV (rMSSD) | `sleep_sessions.average_hrv_ms` · `body_metrics.hrv_ms` | 67/71 · 60/60 |
| SpO₂ | `body_metrics.spo2_pct` | 60/60 |
| respiratory rate | `sleep_sessions.respiratory_rate` | 71/71 |
| restless periods / restfulness | `sleep_sessions.restless_periods` | 71/71 |
| skin temperature deviation | derived, ring only | ring only |
| recovery index | `oura_daily_derived.recovery_index_hours` | ring only |
| daytime HRV, daytime stress, chronic stress, Body Battery, OTS, illness radar | `oura_daily_derived` | ring only, **no fallback branch** |

**`active_calories` reads 0 of 60** — it is derived at read time, not stored, which is worth knowing
before anyone treats the column as a source.

---

## 2. What each scored pillar is actually built from

Measured weights, not intentions.

| Sleep (sums to 110, renormalised) | | Readiness (sums to 1.00) | | Activity (sums to 100) | |
|---|---:|---|---:|---|---:|
| total sleep | 24 | previous night | .16 | strength frequency | 25 |
| HRV | 14 | resting HR | .15 | strength volume | 20 |
| overnight HR | 14 | HRV balance | .15 | steps | 18 |
| REM | 10 | temperature | .10 | active energy | 15 |
| deep | 10 | sleep balance | .10 | move hours | 12 |
| efficiency | 9 | check-in | .10 | zone minutes | 10 |
| restfulness | 9 | prev-day activity | .09 | | |
| schedule | 8 | recovery index | .09 | | |
| latency | 6 | activity balance | .06 | | |
| timing | 6 | | | | |

---

## 3. Three places the line could sit, and what each yields

Percentage = how much of the pillar's weight the **core** carries.

| | sleep | readiness | activity |
|---|---:|---:|---:|
| **A — phone only** | 35% | 35% | 63% |
| **B — phone + basic wearable** | **55%** | **66%** | **100%** |
| **C — B plus sleep stages** | 87% | 66% | 100% |

### The finding that should decide this

**The line barely matters for Activity, matters some for Readiness, and is the whole question for
Sleep.** Activity reaches 100% core on a basic wearable because its heaviest terms are logged
workouts and steps. Sleep is where the choice has teeth, because 48 of its 110 points sit in HRV,
stages and restfulness.

### A — phone only
**Core:** duration, bed/wake timing, schedule, steps, workouts, weight, check-in.
**For:** the most portable definition. Works for a friend with nothing but a phone, survives any
hardware change, and is the only option where the core never silently depends on a vendor's model.
**Against:** a 35% sleep core is close to "how long were you in bed". A user on a basic watch would
see two-thirds of their sleep score arrive as adjustments, which is the renormalisation problem
wearing a different hat — the number still moves for a reason unrelated to their body.

### B — phone + basic wearable ← recommended
**Core:** A, plus resting HR, sleep efficiency, overnight HR, zone minutes, active energy, move hours.
**For:** every one of these is something *any* wearable measures directly and reports consistently.
Resting HR and overnight HR are the two most device-agnostic recovery signals there are, and they
take readiness from 35% to 66% core. Activity reaches 100%.
**Against:** a phone-only user gets a thinner core than under A, so the app has to be explicit that
sleep and readiness are partial without a wearable.

### C — B plus sleep stages
**Core:** B, plus REM, deep, latency, restfulness.
**For:** an 87% sleep core, so the sleep number means something on a basic watch.
**Against:** **this is the one I would argue against.** Stage estimates differ wildly between
devices — the same night scores differently on different hardware — so putting them in the core
reintroduces exactly the incomparability the core is meant to remove. It also makes the core depend
on a vendored model rather than a measurement.

**Reversal cost:** moving an input from core to adjustment later re-scores history. The 2026-08-24
policy applies — stamp the model version and leave stored days alone — but it is still the
expensive-to-reverse decision in this entry, which is why it is the owner's.

---

## 4. What no line can fix

Chronic stress, resilience, daytime HRV, Body Battery, OTS and the illness radar read raw BLE frames
with **zero fallback branches**, and readiness's temperature term (0.10) passes null on every generic
path. These are not "normalise these" work — making them source-neutral means re-implementing
vendor models, which is a project rather than a task. Recorded here so it is not scoped as a task
later (TN-38 step D).

---

## 5. The owner's objection, and the measurement that answers it

**Raised 2026-09-15:** *"We can get all the data but no sleep data… from this we only get wake/sleep
time/duration — and this would need to score on the pillar and be able to get 100 I'd imagine. But
then when we add sleep staging in, it's got to make it more tuned and now that alone isn't enough
for 100."*

The objection is right and the current model has the problem **backwards**.

### One night, scored three ways

Eight hours in a consistent window, poor deep and REM, HRV below the personal baseline. Sub-scores
run through the live renormalising formula in `sleep-score.ts`:

| scored with | contributors seen | sleep score |
|---|---|---:|
| ring | 10 of 10 | **74** |
| basic watch | 6 of 10 | 84 |
| phone or manual only | 3 of 10 | **92** |

**The app currently pays 18 points for taking the ring off.** Same night, same body. Renormalising
over whichever contributors are present means removing the ones that were dragging the score down
*raises* it. So the defect is not that a phone-only user can score well — it is that **more
information can only ever hurt you**, which is exactly backwards and is a stronger argument for
core + adjustments than comparability alone.

### The resolution: the core does not reach 100

- **Core tops out at ~92**, not 100. Duration, timing and consistency earn *"as good as it looks
  from here"*. The last 8 points are not withheld as punishment — they are not knowable without
  deeper signals.
- **Adjustments run roughly −20 to +8**, weighted toward deduction. Staging, HRV and overnight HR
  mostly reveal a night that was worse than its duration implied; occasionally they confirm
  excellence, which is what unlocks the top of the range.
- The night above lands on **74 either way** — core 92, adjustments −18 — so a ring user's number is
  unchanged, while taking the ring off now leaves 92 **with lower confidence** instead of a free
  18-point gift.

**What this makes true, and it is the owner's requirement stated precisely:** 100 means *confirmed
good by everything visible*; 92 means *nothing visible is wrong, and little is visible*. **Adding
staging makes a perfect score possible AND a bad score possible.** Today it can only push the score
down.

### ⚠ The alternative this rules out, and why

Capping the core well below 100 (say sleep core 0–55, adjustments filling the rest) is the obvious
way to make sensors "add" rather than "deduct". **Reject it:** a phone-only user would be
permanently capped at 55, which reads as *"you sleep badly"* when the truth is *"we cannot see."*
Punishing a user for hardware they do not own is worse than an optimistic estimate carried with a
stated confidence.

---

## 6. Where this landed: inferred contributors, not a capped core

**⚠ §5's "core tops out at ~92" is RETRACTED.** The owner's objection to it is correct and fatal:
a permanent ceiling for not owning hardware is a penalty, not honesty. What follows replaces it.

### The trilemma, which is why this felt unresolvable

Three properties; **any design gets two**:

| | reaches 100 | means the same for everyone | stable across a hardware change |
|---|---|---|---|
| today — renormalise over what is present | ✅ | ❌ | ❌ (the 18-point jump, §5) |
| the retracted 92-cap | ❌ | ✅ | ✅ |
| **every contributor always has a value** | ✅ | ✅ | ✅ |

The third escapes the trilemma by removing its cause — **a score with holes in it**. If every
contributor always carries a value, measured where possible and inferred where not, everyone is
scored on the same list, 100 stays reachable, and connecting a sensor moves the score only when the
measurement differs from the estimate — which is a fact about the user's body, not their hardware.

### ⛔ Infer CONDITIONALLY. Inserting the population-typical pattern does not work.

The owner's first formulation was to split the known duration into *"the most commonly seen stage
pattern — nothing good or bad, just the commonly seen one."* **A neutral value stops being neutral
once it carries two-thirds of the weight.** A phone-only user has 38 of sleep's 110 points measured
and 72 inferred, so a fixed fill dominates the measured third and drags every user to the middle:

| night | today | unconditional fill | **conditional fill** |
|---|---:|---:|---:|
| textbook — 8 h, consistent | 100 | **80** | 92 |
| ordinary — 7.5 h | 78 | 73 | 75 |
| poor — 6 h, erratic | 57 | **66** | 52 |

**Unconditional filling collapses the scale to 14 points and inverts the ranking** — it rewards the
poor sleeper (66 against today's 57) and punishes the good one (80 against 100).

Condition the inference on the observables instead: eight consistent hours does not predict *average*
deep sleep, it predicts better than average, because the population average includes every six-hour
night. The estimate then moves with the evidence and the full range survives. It lands near the
retracted cap for the extremes — but **derived rather than decreed**, and, critically, **the score
does not jump when the sensor returns**, because a measurement replaces an estimate drawn from the
same distribution.

### Three rules that ship with it

1. **Every value carries a `measured | inferred` flag and an uncertainty**, surfaced in the UI.
   The owner asked for the flag unprompted; the uncertainty is what makes it actionable.
2. **⛔ An inferred value must never trigger an action** — no deload, no alert, no recommendation off
   an estimated contributor. Same class as CLAUDE.md's rule that no model-reported number may gate an
   automatic action or be shown as fact.
3. **Inference needs something to infer FROM.** A user with sensor history (the owner) can be
   estimated from their own baselines — `personal-baseline.ts` already maintains exactly this
   rolling mean and deviation for six metrics. A user who has *never* had the sensor has no personal
   prior, and a population prior cannot be fitted from one account. **They get the interim below
   until the data exists.**

### Sequencing — validate before betting on it

**The app already infers, and nobody has checked whether it works.** Daytime stress guesses HRV from
heart rate and temperature; **TN-39** validates that against measured HRV from the chest strap. It is
the same technique this design rests on. **Validate there, where ground truth exists, before
extending inference into scoring.**

**The interim, which is cheap and locks nothing in:** score on what is present and *say so* —
"82, from 3 of 10 signals". That is today's behaviour plus a label. **Do not ship the 92-cap.**

---

## 7. The contract: what a pillar actually requires

Required = what the app needs to produce a score at all. Everything else is measured when available
and inferred when not.

| pillar | minimum required input | supplied by | measured share |
|---|---|---|---:|
| **Sleep** | bed time + wake time | manual entry | 35% |
| **Readiness** | daily check-in + sleep + prior activity | manual entry | 35% |
| **Activity** | steps + logged workouts | phone + manual | 63% |
| **Workouts** | logged sets, reps, load | manual entry | 100% |
| **Body** | body weight | manual entry | ~100% |
| **Nutrition** | food log | manual entry | 100% |
| **Cardio** | **a heart-rate source** | **hardware — no substitute** | 0% |

**Six inputs carry the whole app: bed/wake times, steps, body weight, logged workouts, logged food,
and the daily check-in.** Every one can come from a phone and a person. That is the base set, and it
is a floor rather than a target — each pillar improves as real measurements replace inferred ones.

**⚠ Cardio is the single exception and should be treated as optional rather than scored at zero.**
It has no manual-entry floor and nothing to infer from: heart rate cannot be derived from steps or
sleep times. A user with no HR source should not see a Cardio score of 0 — they should not see the
pillar.
